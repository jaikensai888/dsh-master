/*
 * FORKED from @deepseek-ai/dsh-client-ui-workspace (MIT, Copyright (c) 2026 DeepSeek).
 * Upstream: packages/client/ui-workspace/client/stores.ts @ 0.1.2-rc.1
 * Regenerate the mechanical part with: node tools/import-fork.mjs
 * Local edits are expected and preserved — the --check mode compares only the
 * rewritten import header, never the body.
 */
/**
 * The workspace browser's viewing store: the session-list grouping mode,
 * persisted across reloads. Module level exports the factory only (a
 * module-level handle would pin the store identity across plugin reloads);
 * register() receives the factory and the browser derives its PropsStore
 * share from the return type.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import { followKey, type FollowRecord, type FollowSummary, type FollowTarget } from './following.js'

export { followKey, type FollowRecord, type FollowSummary, type FollowTarget }

/** Browser-local order account for the hierarchy-free flat Session list. */
export const FLAT_SESSION_ORDER_KEY = '__flat_session_order__'
/** The sidebar region currently browsing: local sessions, one remote node, or the follow list. */
export type WorkspaceBrowseScope =
  | { kind: 'local' }
  | { kind: 'remote'; nodeId: string }
  | { kind: 'following' }

/** Narrow one unknown persisted entry into a follow record, or drop it. */
function readFollowRecord(value: unknown): FollowRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const entry = value as {
    target?: unknown
    followedAt?: unknown
    title?: unknown
    machine?: unknown
    workspace?: unknown
  }
  const raw = typeof entry.target === 'object' && entry.target !== null
    ? entry.target as Record<string, unknown>
    : undefined
  if (raw === undefined) return undefined
  let target: FollowTarget
  if (raw['source'] === 'local' && typeof raw['sessionId'] === 'string') {
    target = { source: 'local', sessionId: raw['sessionId'] }
  } else if (raw['source'] === 'remote'
    && typeof raw['coordinatorUrl'] === 'string'
    && typeof raw['nodeId'] === 'string'
    && typeof raw['sessionId'] === 'string') {
    target = {
      source: 'remote',
      coordinatorUrl: raw['coordinatorUrl'],
      nodeId: raw['nodeId'],
      sessionId: raw['sessionId'],
    }
  } else {
    return undefined
  }
  const followedAt = typeof entry.followedAt === 'number' && Number.isFinite(entry.followedAt)
    ? entry.followedAt
    : 0
  return {
    target,
    followedAt,
    title: typeof entry.title === 'string' ? entry.title : '',
    machine: typeof entry.machine === 'string' ? entry.machine : '',
    workspace: typeof entry.workspace === 'string' ? entry.workspace : '',
  }
}

/**
 * Migrate the persisted follow list, keeping the first record per identity.
 *
 * Old v5 snapshots have no such field at all, and a hand-edited or partially
 * written snapshot may carry malformed entries; neither may break the sidebar.
 */
function readFollowRecords(value: unknown): FollowRecord[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const records: FollowRecord[] = []
  for (const entry of value) {
    const record = readFollowRecord(entry)
    if (record === undefined) continue
    const key = followKey(record.target)
    if (seen.has(key)) continue
    seen.add(key)
    records.push(record)
  }
  return records
}

/** Session-list grouping mode: workspace sections or one flat recency list. */
export type SessionGroupBy = 'workspace' | 'flat'
/** Session order: user-arranged only, or user-arranged plus activity promotion. */
export type SessionOrderBy = 'manual' | 'updated'

/** Workspace browser viewing state persisted across surface remounts and reloads. */
type WorkspaceViewState = {
  browseScope: WorkspaceBrowseScope
  groupBy: SessionGroupBy
  orderBy: SessionOrderBy
  /** Explicit zero-or-five-session state keyed by Workspace group identity. */
  groupExpansion: Record<string, boolean>
  /** Shared editable order per Workspace group plus the browser-local flat-list account. */
  sessionOrderByAccount: Record<string, string[]>
  /** Last observed update timestamps per order account for one-time promotion events. */
  sessionUpdatedAtByAccount: Record<string, Record<string, number>>
  /** Whether the local workspace/session section is expanded. */
  localExpanded?: boolean
  /** Whether the remote-node group is expanded; optional for v5 persistence migration. */
  remoteExpanded?: boolean
  /** Independent remote state; local account pruning must never remove these maps. */
  remoteNodeExpansion: Record<string, boolean>
  remoteWorkspaceExpansion: Record<string, boolean>
  /** Browser-local follow records, independent of the Workspace order accounts. */
  following: FollowRecord[]
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type WorkspaceViewActions = {
  setBrowseScope: (draft: WorkspaceViewState, scope: WorkspaceBrowseScope) => void
  setGroupBy: (draft: WorkspaceViewState, mode: SessionGroupBy) => void
  setOrderBy: (draft: WorkspaceViewState, mode: SessionOrderBy) => void
  setGroupExpanded: (draft: WorkspaceViewState, key: string, expanded: boolean) => void
  setLocalExpanded: (draft: WorkspaceViewState, expanded: boolean) => void
  setRemoteExpanded: (draft: WorkspaceViewState, expanded: boolean) => void
  setRemoteNodeExpanded: (draft: WorkspaceViewState, nodeId: string, expanded: boolean) => void
  setRemoteWorkspaceExpanded: (draft: WorkspaceViewState, key: string, expanded: boolean) => void
  retainAccountKeys: (draft: WorkspaceViewState, workspaceKeys: readonly string[]) => void
  syncSessionOrderAccount: (
    draft: WorkspaceViewState,
    accountKey: string,
    order: string[],
    updatedAt: Record<string, number>,
  ) => void
  setSessionOrder: (draft: WorkspaceViewState, accountKey: string, order: string[]) => void
  /** Add one follow record; an existing identity is left untouched. */
  followSession: (draft: WorkspaceViewState, record: FollowRecord) => void
  /** Remove one follow marker by key; the open conversation is not affected. */
  unfollowSession: (draft: WorkspaceViewState, key: string) => void
  /** Replace the last-known display summary of the records a fresh source provided. */
  syncFollowSummaries: (draft: WorkspaceViewState, updates: Readonly<Record<string, FollowSummary>>) => void
}

/**
 * Create the workspace browser viewing store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createWorkspaceViewStore(): EngineStoreHandle<WorkspaceViewState, WorkspaceViewActions> {
  const handle = defineStore({
    init: (): WorkspaceViewState => ({
      browseScope: { kind: 'local' },
      groupBy: 'workspace',
      orderBy: 'updated',
      groupExpansion: {},
      sessionOrderByAccount: {},
      sessionUpdatedAtByAccount: {},
      localExpanded: true,
      remoteExpanded: true,
      remoteNodeExpansion: {},
      remoteWorkspaceExpansion: {},
      following: [],
    }),
    persist: 'dsh.workspace.view.v5',
    actions: {
      setBrowseScope: (d, scope: WorkspaceBrowseScope) => { d.browseScope = scope },
      setGroupBy: (d, mode: SessionGroupBy) => { d.groupBy = mode },
      setOrderBy: (d, mode: SessionOrderBy) => { d.orderBy = mode },
      setGroupExpanded: (d, key: string, expanded: boolean) => { d.groupExpansion[key] = expanded },
      setLocalExpanded: (d, expanded: boolean) => { d.localExpanded = expanded },
      setRemoteExpanded: (d, expanded: boolean) => { d.remoteExpanded = expanded },
      setRemoteNodeExpanded: (d, nodeId: string, expanded: boolean) => { d.remoteNodeExpansion[nodeId] = expanded },
      setRemoteWorkspaceExpanded: (d, key: string, expanded: boolean) => { d.remoteWorkspaceExpansion[key] = expanded },
      retainAccountKeys: (d, workspaceKeys: readonly string[]) => {
        const retained = new Set(workspaceKeys)
        d.groupExpansion = Object.fromEntries(
          Object.entries(d.groupExpansion).filter(([key]) => retained.has(key)),
        )
        d.sessionOrderByAccount = Object.fromEntries(
          Object.entries(d.sessionOrderByAccount).filter(([key]) => retained.has(key)),
        )
        d.sessionUpdatedAtByAccount = Object.fromEntries(
          Object.entries(d.sessionUpdatedAtByAccount).filter(([key]) => retained.has(key)),
        )
      },
      syncSessionOrderAccount: (d, accountKey: string, order: string[], updatedAt: Record<string, number>) => {
        d.sessionOrderByAccount[accountKey] = order
        d.sessionUpdatedAtByAccount[accountKey] = updatedAt
      },
      setSessionOrder: (d, accountKey: string, order: string[]) => {
        d.sessionOrderByAccount[accountKey] = order
      },
      followSession: (d, record: FollowRecord) => {
        const key = followKey(record.target)
        if (d.following.some(entry => followKey(entry.target) === key)) return
        d.following = [...d.following, record]
      },
      unfollowSession: (d, key: string) => {
        d.following = d.following.filter(entry => followKey(entry.target) !== key)
      },
      syncFollowSummaries: (d, updates: Readonly<Record<string, FollowSummary>>) => {
        let changed = false
        const next = d.following.map((entry) => {
          const update = updates[followKey(entry.target)]
          if (update === undefined) return entry
          if (entry.title === update.title && entry.machine === update.machine
            && entry.workspace === update.workspace) return entry
          changed = true
          return { ...entry, ...update }
        })
        if (changed) d.following = next
      },
    },
  })
  return {
    ...handle,
    create(scopeKey) {
      const instance = handle.create(scopeKey)
      // Official v5 snapshots replace init wholesale and omit the fork's timestamp map.
      instance.store.update(draft => {
        draft.browseScope ??= { kind: 'local' }
        draft.groupExpansion ??= {}
        draft.sessionOrderByAccount ??= {}
        draft.sessionUpdatedAtByAccount ??= {}
        draft.localExpanded ??= true
        draft.remoteExpanded ??= true
        draft.remoteNodeExpansion ??= {}
        draft.remoteWorkspaceExpansion ??= {}
        // v5 snapshots predate following; malformed entries are dropped, not fatal.
        draft.following = readFollowRecords(draft.following)
      })
      return instance
    },
  }
}
