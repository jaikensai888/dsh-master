/**
 * Cross-workspace following: browser-record merging, display rows and source state.
 *
 * The follow list is built from the browser-local records in the sidebar store, never
 * from whatever the current roster happens to contain. Local rows read the existing
 * session subscription; remote rows are compiled from the single remote data owner
 * (`RemoteSection`) so a record whose node is offline, whose node list failed, or whose
 * Coordinator source no longer matches still renders — disabled, labelled, and
 * cancellable.
 *
 * @module dsh-master/workspace/following
 */

import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {
  MasterCoordinatorFacts,
  MasterNode,
  MasterSessionsValue,
} from '../protocol.js'
import { nodeDisplayName } from './browse-scope.js'
import { nodeIsOffline } from './remote-model.js'

/**
 * The identity of one followed session.
 *
 * A local session is identified by its id alone. A remote session additionally
 * needs the Coordinator source it was followed through, so two Coordinators that
 * expose the same `nodeId`/`sessionId` never alias one another.
 */
export type FollowTarget =
  | { readonly source: 'local'; readonly sessionId: string }
  | {
    readonly source: 'remote'
    /** The Coordinator's credential-free origin (`MasterCoordinatorFacts.url`). */
    readonly coordinatorUrl: string
    readonly nodeId: string
    readonly sessionId: string
  }

/** One browser-local follow record: identity, time and the last-known display summary. */
export interface FollowRecord {
  readonly target: FollowTarget
  /** Epoch ms. Re-following after an unfollow is a new record with a new time. */
  readonly followedAt: number
  readonly title: string
  /** The machine label: a node's display name, or the local label. */
  readonly machine: string
  /** The workspace title, or the localized Ungrouped label. */
  readonly workspace: string
}

/** The display fields a fresh source snapshot may replace on a follow record. */
export interface FollowSummary {
  readonly title: string
  readonly machine: string
  readonly workspace: string
}

/**
 * The stable key of a follow target.
 *
 * JSON encoding rather than delimiter concatenation: node, session and Coordinator
 * identifiers are opaque, so any separator could also occur inside one of them.
 *
 * @param target - local or remote identity.
 * @returns a collision-free key, also usable as persistent map key.
 */
export function followKey(target: FollowTarget): string {
  return target.source === 'local'
    ? JSON.stringify(['local', target.sessionId])
    : JSON.stringify(['remote', target.coordinatorUrl, target.nodeId, target.sessionId])
}

/** Why one followed row can or cannot be opened right now. */
export type FollowStatus =
  | 'ok'
  | 'loading'
  | 'offline'
  | 'source-unavailable'
  | 'load-failed'
  | 'not-found'
  | 'archived'

/** One rendered follow row, ordered by its record's follow time. */
export interface FollowingRow {
  /** {@link followKey} of the target. */
  readonly key: string
  readonly target: FollowTarget
  readonly followedAt: number
  readonly title: string
  readonly machine: string
  readonly workspace: string
  readonly status: FollowStatus
  /**
   * True when the row's display summary came from the current source rather than the
   * record. Only fresh summaries are written back to the browser store.
   */
  readonly fresh: boolean
}

/** Labels the model needs from the locale seat, so it stays a pure function. */
export interface FollowingLabels {
  readonly localMachine: string
  readonly ungrouped: string
  readonly newSession: string
}

/** The local half of the snapshot: the browser's existing subscriptions. */
export interface FollowingLocalSnapshot {
  readonly phase: string | undefined
  readonly byId: Readonly<Record<string, SessionSummary>>
  readonly workspaces: readonly WorkspaceView[]
  readonly archivedSessionIds: readonly string[]
}

/** The remote half of the snapshot: the single remote data owner's state. */
export interface FollowingRemoteSnapshot {
  readonly coordinator: MasterCoordinatorFacts | undefined
  readonly nodes: readonly MasterNode[]
  readonly data: Readonly<Record<string, MasterSessionsValue>>
  readonly loading: Readonly<Record<string, boolean>>
  readonly errors: Readonly<Record<string, string>>
  /** A verify/refresh is in flight; remote rows stay closed until it settles. */
  readonly verifying: boolean
  /** The roster probe itself failed, so there is no Coordinator facts object. */
  readonly verificationFailed: boolean
}

type LocalTarget = Extract<FollowTarget, { source: 'local' }>
type RemoteTarget = Extract<FollowTarget, { source: 'remote' }>

/** The stable per-node/per-session token a source row uses to show follow state. */
export function sessionFollowToken(nodeId: string, sessionId: string): string {
  return JSON.stringify([nodeId, sessionId])
}

/** Follow time descending; equal timestamps keep the record order the store holds. */
export function orderFollowRecords(records: readonly FollowRecord[]): FollowRecord[] {
  return records
    .map((record, index) => ({ record, index }))
    .sort((a, b) => {
      if (a.record.followedAt !== b.record.followedAt) return b.record.followedAt - a.record.followedAt
      return a.index - b.index
    })
    .map(entry => entry.record)
}

/** Find the registered workspace a local session belongs to. */
function workspaceOf(
  workspaces: readonly WorkspaceView[],
  sessionId: string,
): WorkspaceView | undefined {
  return workspaces.find(workspace => workspace.sessionIds.includes(sessionId))
}

/** Build the row for one local record. */
function localRow(
  record: FollowRecord,
  target: LocalTarget,
  local: FollowingLocalSnapshot,
  labels: FollowingLabels,
): FollowingRow {
  const sessionId = target.sessionId
  const summary = local.byId[sessionId]
  const base = { key: followKey(target), target, followedAt: record.followedAt }
  if (summary === undefined) {
    const archived = local.archivedSessionIds.includes(sessionId)
    const status: FollowStatus = local.phase === 'ready'
      ? (archived ? 'archived' : 'not-found')
      : 'loading'
    return {
      ...base,
      title: record.title,
      machine: record.machine,
      workspace: record.workspace,
      status,
      fresh: false,
    }
  }
  const title = summary.blank
    ? labels.newSession
    : summary.displayTitle.trim() === '' ? record.title : summary.displayTitle
  const archived = local.archivedSessionIds.includes(sessionId)
  return {
    ...base,
    title,
    machine: labels.localMachine,
    workspace: workspaceOf(local.workspaces, sessionId)?.title ?? labels.ungrouped,
    status: archived ? 'archived' : 'ok',
    fresh: true,
  }
}

/** Build the row for one remote record from the remote owner's snapshot. */
function remoteRow(
  record: FollowRecord,
  target: RemoteTarget,
  remote: FollowingRemoteSnapshot,
  labels: FollowingLabels,
): FollowingRow {
  const base = { key: followKey(target), target, followedAt: record.followedAt }
  const saved = {
    ...base,
    title: record.title,
    machine: record.machine,
    workspace: record.workspace,
    fresh: false,
  }
  const coordinator = remote.coordinator
  if (coordinator === undefined) {
    return { ...saved, status: remote.verificationFailed ? 'source-unavailable' : 'loading' }
  }
  if (coordinator.url !== target.coordinatorUrl || coordinator.reachable === false) {
    return { ...saved, status: 'source-unavailable' }
  }
  if (remote.verifying) return { ...saved, status: 'loading' }
  const node = remote.nodes.find(candidate => candidate.nodeId === target.nodeId)
  if (node === undefined || nodeIsOffline(node)) return { ...saved, status: 'offline' }
  if (remote.errors[target.nodeId] !== undefined) return { ...saved, status: 'load-failed' }
  const data = remote.data[target.nodeId]
  if (data === undefined) return { ...saved, status: 'loading' }
  const workspace = data.workspaces.find(entry => entry.sessionIds.includes(target.sessionId))
  const machine = nodeDisplayName(node)
  const workspaceTitle = workspace?.title ?? labels.ungrouped
  if (data.archivedSessionIds.includes(target.sessionId)) {
    return {
      ...base,
      title: record.title,
      machine,
      workspace: workspaceTitle,
      status: 'archived',
      fresh: true,
    }
  }
  const session = data.sessions.find(entry => entry.sessionId === target.sessionId)
  if (session === undefined) return { ...saved, status: 'not-found' }
  const title = session.blank
    ? labels.newSession
    : session.title.trim() === '' ? record.title : session.title
  return {
    ...base,
    title,
    machine,
    workspace: workspaceTitle,
    status: 'ok',
    fresh: true,
  }
}

/**
 * Compile every follow record into a rendered row, preserving the follow-time order.
 *
 * @param records - the browser-local records, unsorted.
 * @param local - the local subscriptions' snapshot.
 * @param remote - the remote data owner's snapshot.
 * @param labels - localized fallbacks.
 * @returns rows in follow-time order.
 */
export function followingRows(
  records: readonly FollowRecord[],
  local: FollowingLocalSnapshot,
  remote: FollowingRemoteSnapshot,
  labels: FollowingLabels,
): FollowingRow[] {
  return orderFollowRecords(records).map((record) => {
    const target = record.target
    return target.source === 'local'
      ? localRow(record, target, local, labels)
      : remoteRow(record, target, remote, labels)
  })
}

/** Filter rows by title, machine or workspace (case-insensitive substring). */
export function filterFollowingRows(rows: readonly FollowingRow[], query: string): FollowingRow[] {
  const term = query.trim().toLocaleLowerCase()
  if (term === '') return [...rows]
  return rows.filter(row => [row.title, row.machine, row.workspace]
    .some(value => value.toLocaleLowerCase().includes(term)))
}

/**
 * The display summaries a fresh snapshot supersedes.
 *
 * Rows built from the current source are candidates; rows still showing their saved
 * summary never are, so an offline or failed node cannot rewrite its last-known title.
 *
 * @param records - the stored records.
 * @param rows - compiled rows.
 * @returns keyed changes, empty when nothing moved.
 */
export function followingSummaryUpdates(
  records: readonly FollowRecord[],
  rows: readonly FollowingRow[],
): Record<string, FollowSummary> {
  const byKey = new Map(records.map(record => [followKey(record.target), record]))
  const updates: Record<string, FollowSummary> = {}
  for (const row of rows) {
    if (!row.fresh) continue
    const record = byKey.get(row.key)
    if (record === undefined) continue
    if (record.title === row.title && record.machine === row.machine
      && record.workspace === row.workspace) continue
    updates[row.key] = { title: row.title, machine: row.machine, workspace: row.workspace }
  }
  return updates
}

/**
 * The routable nodes this Coordinator source must query for the follow list.
 *
 * Only nodes with at least one record under the current source; each node appears
 * once even when several followed sessions live on it, so the caller issues one list
 * request per node.
 *
 * @param records - browser-local follow records.
 * @param coordinatorUrl - the currently verified Coordinator source.
 * @param nodes - the roster.
 * @returns online, non-revoked target nodes in roster order.
 */
export function followingNodes(
  records: readonly FollowRecord[],
  coordinatorUrl: string | undefined,
  nodes: readonly MasterNode[],
): MasterNode[] {
  if (coordinatorUrl === undefined) return []
  const wanted = new Set<string>()
  for (const record of records) {
    if (record.target.source !== 'remote') continue
    if (record.target.coordinatorUrl !== coordinatorUrl) continue
    wanted.add(record.target.nodeId)
  }
  if (wanted.size === 0) return []
  return nodes.filter(node => wanted.has(node.nodeId) && !nodeIsOffline(node))
}

/** Maximum concurrent node list requests the follow view issues. */
export const FOLLOWING_NODE_CONCURRENCY = 4

/**
 * Run one asynchronous task per item with a bounded number in flight.
 *
 * A rejected task is isolated: it settles that item and the remaining items still
 * run, which is what keeps one failed node from blanking the rest of the list.
 *
 * @param items - work items, in request order.
 * @param limit - maximum in-flight tasks (at least one).
 * @param run - the task itself.
 * @returns a promise that resolves after every task settled.
 */
export async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return
  const width = Math.min(items.length, Math.max(1, Math.floor(limit)))
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      const item = items[index] as T
      try {
        await run(item)
      } catch {
        // loadSessions already records the per-node failure; a rejected task must not
        // cancel the other nodes' requests.
      }
    }
  }
  await Promise.all(Array.from({ length: width }, worker))
}

/**
 * The key of the row a current selection highlights.
 *
 * @param localSessionId - the locally open session, if any.
 * @param remoteSelection - the remote panel's selection, if any.
 * @param coordinatorUrl - the verified Coordinator source.
 * @returns a follow key when the selection can be one of the followed identities.
 */
export function followingSelectionKey(
  localSessionId: string | undefined,
  remoteSelection: { readonly nodeId: string; readonly sessionId: string } | undefined,
  coordinatorUrl: string | undefined,
): string | undefined {
  if (remoteSelection !== undefined) {
    return coordinatorUrl === undefined
      ? undefined
      : followKey({
        source: 'remote',
        coordinatorUrl,
        nodeId: remoteSelection.nodeId,
        sessionId: remoteSelection.sessionId,
      })
  }
  return localSessionId === undefined ? undefined : followKey({ source: 'local', sessionId: localSessionId })
}

