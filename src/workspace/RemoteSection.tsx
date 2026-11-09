/**
 * Independent remote-node sections alongside the forked local workspace tree.
 *
 * @module dsh-master/workspace/RemoteSection
 */

import clsx from 'clsx'
import { createPortal } from 'react-dom'
import { WorkspaceNodeChooser } from './WorkspaceNodeChooser.js'
import { browseNodes, nodeDisplayName } from './browse-scope.js'
import {
  Button,
  IconFolderCloseRegular,
  IconFolderOpenRegular,
  IconPlusOutlineRegular as IconPlusOutline16,
  IconTriangleRightFillRegular,
  IconArchiveOutlineRegular as IconArchiveOutline20,
  IconEllipsisOutlineRegular as IconEllipsisOutline16,
  IconGlobeOutlineRegular as IconGlobeOutline14,
  IconRefreshOutlineRegular as IconRefreshOutline14,
  Menu,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import type {
  MasterCoordinatorFacts,
  MasterNode,
  MasterSession,
  MasterSessionsValue,
  MasterWorkspace,
} from '../protocol.js'
import {
  ApiError,
  archiveRemoteSession,
  createRemoteSession,
  fetchNodes,
  fetchSessions,
  fetchStatus,
} from '../client/api.js'
import { timeAgo } from '../client/copy.js'
import { getRemoteSelection, setRemoteSelection, subscribeRemoteSelection } from '../client/selection.js'
import type { RemoteSessionSelection } from '../client/selection.js'
import type { RemoteSectionProps } from './contract/slots.js'
import {
  groupRemoteWorkspaces,
  nodeIsOffline,
  orderRemoteNodes,
  reusableBlankSession,
  visibleRemoteSessions,
} from './remote-model.js'
import {
  FOLLOWING_NODE_CONCURRENCY,
  filterFollowingRows,
  followingNodes,
  followingRows,
  followingSelectionKey,
  followingSummaryUpdates,
  mapWithConcurrency,
  sessionFollowToken,
} from './following.js'
import type { FollowingLocalSnapshot, FollowingRemoteSnapshot, FollowingRow } from './following.js'
import { FollowingList } from './FollowingList.js'
import { followKey, type FollowRecord } from './following.js'
import { FollowPin } from './follow-pin.js'
import { RowsCss, RemoteSectionCss as css, WorkspaceBrowserCss } from './styles.generated.js'

/** Describe one failed call without losing the host's stable error code. */
function describe(cause: unknown): string {
  if (cause instanceof ApiError) return `${cause.code}: ${cause.message}`
  return cause instanceof Error ? cause.message : String(cause)
}

/** Whether the node/coordinator reported that this endpoint does not exist there. */
function isCapabilityFailure(cause: unknown): boolean {
  return cause instanceof ApiError
    && (cause.code === 'node/capability-unavailable' || cause.code === 'coordinator/capability-mismatch')
}

/** Remove one key from a read-only record without mutating it. */
function omitKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const next = { ...record }
  delete next[key]
  return next
}

/** Shared empty follow set for a section that was composed without follow wiring. */
const EMPTY_FOLLOWED: ReadonlySet<string> = new Set()

/** Local subscription state before the browser supplies it. */
const EMPTY_LOCAL_SNAPSHOT: FollowingLocalSnapshot = {
  phase: undefined,
  byId: {},
  workspaces: [],
  archivedSessionIds: [],
}

/**
 * Insert a just-created blank session before the node's next list refresh.
 *
 * The node has already attached it to the workspace, so this only bridges the
 * window until `loadSessions` returns the authoritative rows.
 */
export function insertOptimisticBlank(
  data: Readonly<Record<string, MasterSessionsValue>>,
  nodeId: string,
  workspace: MasterWorkspace,
  sessionId: string,
): Readonly<Record<string, MasterSessionsValue>> {
  const current = data[nodeId]
  if (current === undefined) return data
  if (current.sessions.some(session => session.sessionId === sessionId)) return data
  const created: MasterSession = {
    sessionId,
    title: '',
    updatedAt: Date.now(),
    running: false,
    blank: true,
    cwd: workspace.path,
  }
  return {
    ...data,
    [nodeId]: {
      ...current,
      sessions: [created, ...current.sessions],
      workspaces: current.workspaces.map(entry => entry.workspaceId === workspace.workspaceId
        && !entry.sessionIds.includes(sessionId)
        ? { ...entry, sessionIds: [...entry.sessionIds, sessionId] }
        : entry),
    },
  }
}

/** Map coordinator state to the shipped status-dot vocabulary. */
function NodeStatus({ node }: { node: MasterNode }): ReactElement {
  if (nodeIsOffline(node)) {
    return <span className={css.offlineDot} aria-hidden="true" />
  }
  if (node.state === 'ready') return <StateDot state="done" />
  if (node.state === 'closing') return <StateDot state="warning" />
  return <StateDot state="ongoing" />
}

/** Render one session row with the same selected state as the remote main panel. */
export function RemoteSessionItem({
  nodeId,
  nodeName,
  session,
  selection,
  now,
  menuOpen,
  archiveAvailable,
  followed = false,
  onToggleFollow,
  onMenuOpenChange,
  onOpenRemoteSession,
  onArchiveRemoteSession,
  t,
}: {
  nodeId: string
  nodeName: string
  session: MasterSession
  selection: RemoteSessionSelection | undefined
  now: number
  menuOpen: boolean
  archiveAvailable: boolean
  /** This session has a browser-local follow marker under the current source. */
  followed?: boolean | undefined
  /** Add or remove the follow marker; absent means the action is not offered. */
  onToggleFollow?: (() => void) | undefined
  onMenuOpenChange: (open: boolean) => void
  onOpenRemoteSession: (nodeId: string, sessionId: string, nodeName: string, sessionTitle: string) => void
  onArchiveRemoteSession: (nodeId: string, sessionId: string) => void
  t: (key: string, params?: Record<string, unknown>) => string
}): ReactElement {
  const selected = selection?.nodeId === nodeId && selection.sessionId === session.sessionId
  const title = session.blank ? t('session.new') : session.title
  const menuItems = [
    // Following is independent of the archive capability: a node that cannot
    // archive can still be followed.
    ...(onToggleFollow === undefined
      ? []
      : [{
        id: followed ? 'unfollow' : 'follow',
        label: t(followed ? 'menu.unfollow' : 'menu.follow'),
        icon: <FollowPin filled={followed} />,
      }]),
    ...(archiveAvailable
      ? [{ id: 'archive', label: t('menu.archiveSession'), icon: <IconArchiveOutline20 size={16} /> }]
      : []),
  ]
  const showMenu = session.blank !== true && menuItems.length > 0

  return (
    <div
      role="treeitem"
      className={clsx(RowsCss.sessionRow, css.sessionRow, selected && RowsCss.selected, menuOpen && RowsCss.menuOpen)}
      aria-selected={selected}
      title={session.sessionId}
      onClick={() => { onOpenRemoteSession(nodeId, session.sessionId, nodeName, title) }}
    >
      <span className={css.sessionTitle}>{title}</span>
      {session.blank ? null : session.running
        ? <StateDot state="ongoing" />
        : <span className={css.sessionAge}>{timeAgo(session.updatedAt, now)}</span>}
      {showMenu ? (
        <span className={RowsCss.rowActions}>
          <Menu
            open={menuOpen}
            onClose={() => { onMenuOpenChange(false) }}
            items={menuItems}
            onSelect={(id) => {
              onMenuOpenChange(false)
              if (id === 'archive') onArchiveRemoteSession(nodeId, session.sessionId)
              if (id === 'follow' || id === 'unfollow') onToggleFollow?.()
            }}
            portal
            closeOnPointerLeave
            anchor={(
              <button
                type="button"
                className={RowsCss.iconButton}
                aria-label={t('actions.session.aria', { name: session.title })}
                onClick={(event) => { event.stopPropagation(); onMenuOpenChange(!menuOpen) }}
              >
                <IconEllipsisOutline16 />
              </button>
            )}
          />
        </span>
      ) : null}
    </div>
  )
}

/** View of one remote node, with all identities scoped to that node. */
export interface RemoteNodeSectionProps {
  unavailable?: boolean
  scrollPositions?: Record<string, number>
  node: MasterNode
  expanded: boolean
  busy: boolean
  loading: boolean
  error: string | undefined
  data: MasterSessionsValue | undefined
  selection: RemoteSessionSelection | undefined
  now: number
  workspaceExpansion: RemoteSectionProps['workspaceExpansion']
  overflow: readonly string[]
  openSessionMenu: { nodeId: string; sessionId: string } | undefined
  t: RemoteSectionProps['t']
  compact?: boolean
  /** Per-workspace create calls currently in flight, keyed by node + workspace. */
  creating?: Readonly<Record<string, boolean>>
  /** Per-workspace create failures, keyed the same way. */
  createErrors?: Readonly<Record<string, string>>
  /** The node rejected `session/create` as an unsupported capability. */
  createUnsupported?: boolean
  /** Tokens of followed sessions under the current Coordinator source. */
  followedSessions?: ReadonlySet<string>
  /** Add or remove one session's follow marker; absent on surfaces without follow wiring. */
  onToggleFollow?: ((
    node: MasterNode,
    session: MasterSession,
    workspace: MasterWorkspace | undefined,
    followed: boolean,
  ) => void) | undefined
  onToggleNode: () => void
  onRefresh: () => void
  onWorkspaceExpandedChange: RemoteSectionProps['onWorkspaceExpandedChange']
  onToggleOverflow: (key: string) => void
  onSessionMenuChange: (nodeId: string, sessionId: string, open: boolean) => void
  onOpenRemoteSession: RemoteSectionProps['onOpenRemoteSession']
  onArchiveRemoteSession: (nodeId: string, sessionId: string) => void
  onCreateRemoteSession: (workspace: MasterWorkspace) => void
}

/** Render registered directories inside one independently collapsible node. */
export function RemoteNodeSection({
  node, expanded, busy, loading, error, data, selection, now, compact = false, scrollPositions, unavailable = false,
  workspaceExpansion, overflow, openSessionMenu, t, creating = {}, createErrors = {}, createUnsupported = false,
  followedSessions = EMPTY_FOLLOWED, onToggleFollow,
  onToggleNode, onRefresh, onWorkspaceExpandedChange, onToggleOverflow,
  onSessionMenuChange, onOpenRemoteSession, onArchiveRemoteSession, onCreateRemoteSession,
}: RemoteNodeSectionProps): ReactElement {
  const offline = nodeIsOffline(node)
  const name = nodeDisplayName(node)
  const currentSessionId = selection?.nodeId === node.nodeId ? selection.sessionId : undefined
  const groups = groupRemoteWorkspaces(
    data?.workspaces ?? [],
    data?.sessions ?? [],
    data?.archivedSessionIds ?? [],
    currentSessionId,
  )
  return (
    <div className={clsx(css.group, expanded && css.expanded)} data-dsh-remote-node={node.nodeId}>
      {!compact && <div className={css.header}>
        <button type="button" className={clsx(css.groupToggle, css.nodeRow)}
          aria-expanded={expanded}
          aria-label={t('remote.nodeAria', { name, status: offline ? t('remote.nodeOffline') : t('remote.nodeOnline') })}
          title={node.nodeId} onClick={onToggleNode}>
          <span className={css.disclosureSlot} aria-hidden="true" data-expanded={expanded} />
          <span className={css.groupTitle}>{name}</span>
          <NodeStatus node={node} />
        </button>
        <Button variant="ghost" icon={<IconRefreshOutline14 />} disabled={busy || loading}
          onClick={onRefresh} aria-label={t('remote.refresh')} title={t('remote.refresh')} />
      </div>}
      {!expanded ? null : (
        <div className={css.content} role="tree" aria-label={name}
          ref={element => { if (element && scrollPositions) element.scrollTop = scrollPositions[node.nodeId] ?? 0 }}
          onScroll={event => { if (scrollPositions) scrollPositions[node.nodeId] = event.currentTarget.scrollTop }}>
          {unavailable && <div role="alert" className={css.message}>{t('browse.stale')}</div>}
          {offline ? <div className={css.message} role="status">{t('remote.nodeOffline')}</div> : (
            <>
              {loading ? <div className={css.message} role="status">{t('remote.workspacesLoading')}</div> : null}
              {error === undefined ? null : <div className={css.message} role="alert">{error}</div>}
              {data?.workspaceError === undefined ? null : (
                <div className={css.message} role="status">
                  {t('remote.workspacesUnavailable')} · {data.workspaceError.code}: {data.workspaceError.message}
                </div>
              )}
              {data?.archiveError === undefined || data.workspaceError !== undefined ? null : (
                <div className={css.message} role="status">{t('remote.archiveUnavailable')} · {data.archiveError.message}</div>
              )}
              {createUnsupported ? (
                <div className={css.message} role="status">{t('remote.createSessionUnsupported')}</div>
              ) : null}
              {data !== undefined && groups.length === 0 ? <div className={css.message}>{t('remote.noWorkspaces')}</div> : null}
              {groups.map(group => {
                const workspace = group.workspace
                const key = JSON.stringify([node.nodeId, workspace?.workspaceId ?? null])
                const directoryExpanded = workspaceExpansion[key] ?? true
                const more = overflow.includes(key)
                const visible = visibleRemoteSessions(
                  group.sessions,
                  more,
                  data?.archivedSessionIds ?? [],
                  currentSessionId,
                )
                const title = workspace?.title ?? t('group.ungrouped')
                const createBusy = creating[key] === true
                const createDisabled = createBusy || unavailable || offline || createUnsupported
                  || node.state !== 'ready'
                const createTitle = createBusy
                  ? t('remote.creatingSession')
                  : createUnsupported
                    ? t('remote.createSessionUnsupported')
                    : unavailable || node.state !== 'ready'
                      ? t('remote.createSessionUnavailable')
                      : undefined
                return (
                  <div key={key} className={WorkspaceBrowserCss.groupSection} role="none">
                    <div className={clsx(RowsCss.projectRow, css.workspaceRow)} role="treeitem"
                      aria-expanded={directoryExpanded} aria-label={title} title={workspace?.path}
                      tabIndex={0}
                      onClick={() => { onWorkspaceExpandedChange(key, !directoryExpanded) }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        onWorkspaceExpandedChange(key, !directoryExpanded)
                      }}>
                      <span className={clsx(RowsCss.slot, RowsCss.folder)} aria-hidden="true">
                        {directoryExpanded ? <IconFolderOpenRegular /> : <IconFolderCloseRegular />}
                      </span>
                      <span className={clsx(RowsCss.slot, RowsCss.chevron)} aria-hidden="true">
                        <IconTriangleRightFillRegular className={clsx(RowsCss.arrow, directoryExpanded && RowsCss.arrowOpen)} />
                      </span>
                      <span className={css.nodeTitle}>{title}</span>
                      {workspace === undefined ? null : (
                        <span className={RowsCss.rowActions} data-dsh-workspace-actions>
                          <button
                            type="button"
                            className={RowsCss.iconButton}
                            aria-label={t('actions.newSession.aria', { name: title })}
                            aria-busy={createBusy ? true : undefined}
                            disabled={createDisabled}
                            title={createTitle}
                            onClick={(event) => {
                              event.stopPropagation()
                              onCreateRemoteSession(workspace)
                            }}
                          >
                            <IconPlusOutline16 />
                          </button>
                        </span>
                      )}
                    </div>
                    {createErrors[key] === undefined ? null : (
                      <div className={css.createError} role="alert">{createErrors[key]}</div>
                    )}
                    {!directoryExpanded ? null : (
                      <div role="group">
                        {visible.sessions.length === 0 ? <div className={css.message}>{t('remote.noSessions')}</div> : null}
                        {visible.sessions.map(session => (
                          <RemoteSessionItem key={session.sessionId} nodeId={node.nodeId} nodeName={name}
                            session={session} selection={selection} now={now}
                            menuOpen={openSessionMenu?.nodeId === node.nodeId && openSessionMenu.sessionId === session.sessionId}
                            archiveAvailable={!unavailable && data?.archiveError === undefined}
                            followed={followedSessions.has(sessionFollowToken(node.nodeId, session.sessionId))}
                            onToggleFollow={unavailable || onToggleFollow === undefined
                              ? undefined
                              : () => {
                                onToggleFollow(
                                  node,
                                  session,
                                  workspace,
                                  followedSessions.has(sessionFollowToken(node.nodeId, session.sessionId)),
                                )
                              }}
                            onMenuOpenChange={open => { onSessionMenuChange(node.nodeId, session.sessionId, open) }}
                            onOpenRemoteSession={(...args) => { if (!unavailable) onOpenRemoteSession(...args) }} onArchiveRemoteSession={(...args) => { if (!unavailable) onArchiveRemoteSession(...args) }} t={t} />
                        ))}
                        {visible.hiddenCount > 0 || more ? (
                          <button type="button" className={WorkspaceBrowserCss.sessionOverflowButton}
                            aria-expanded={more} onClick={() => { onToggleOverflow(key) }}>
                            {more ? t('remote.sessionsCollapse') : t('remote.sessionsExpand', { n: visible.hiddenCount })}
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Load remote data once, then render each node alongside the local section. */
export function RemoteSection({
  t, defaultNodeExpanded, nodeExpansion, workspaceExpansion,
  onNodeExpandedChange, onWorkspaceExpandedChange, onOpenRemoteSession,
  rail = false, onRailNodePick, browseScope, onBrowseScopeChange, chooserMount, contentHidden = false, onExpandChooser, requestChooser, onChooserOpened,
  following = [], followingLocal, followingQuery = '', currentLocalSessionId,
  onFollow, onUnfollow, onSyncFollowingSummaries, onOpenFollowingLocal,
}: RemoteSectionProps): ReactElement {
  const selection = useSyncExternalStore(subscribeRemoteSelection, getRemoteSelection, getRemoteSelection)
  const [coordinator, setCoordinator] = useState<MasterCoordinatorFacts | undefined>(undefined)
  const [nodes, setNodes] = useState<readonly MasterNode[]>([])
  const [data, setData] = useState<Readonly<Record<string, MasterSessionsValue>>>({})
  const [loading, setLoading] = useState<Readonly<Record<string, boolean>>>({})
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const [overflow, setOverflow] = useState<readonly string[]>([])
  const scrollPositions = useRef<Record<string, number>>({})
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [openSessionMenu, setOpenSessionMenu] = useState<{ nodeId: string; sessionId: string } | undefined>(undefined)
  const [creating, setCreating] = useState<Readonly<Record<string, boolean>>>({})
  const [createErrors, setCreateErrors] = useState<Readonly<Record<string, string>>>({})
  const [createUnsupported, setCreateUnsupported] = useState<Readonly<Record<string, boolean>>>({})
  const browsing = useRef(browseScope)
  browsing.current = browseScope
  const changeScope = useRef(onBrowseScopeChange)
  changeScope.current = onBrowseScopeChange
  const cache = useRef(data)
  cache.current = data
  const expansion = useRef({ nodeExpansion, defaultNodeExpanded })
  expansion.current = { nodeExpansion, defaultNodeExpanded }
  const rosterRequest = useRef(0)
  const rosterController = useRef<AbortController | undefined>(undefined)
  const sessionControllers = useRef(new Map<string, AbortController>())
  /** Blank sessions created here, until the node's next list includes them. */
  const createdBlanks = useRef(new Map<string, { nodeId: string; sessionId: string }>())
  /** Synchronous per-workspace guard: state alone can lag a double click. */
  const inflightCreates = useRef(new Set<string>())
  /** The follow records this render saw; refresh reads them without re-creating its callback. */
  const followingRef = useRef(following)
  followingRef.current = following
  /** The last verified Coordinator origin, so a source switch can drop cached rows. */
  const coordinatorUrl = useRef<string | undefined>(undefined)
  /** True while entering or manually refreshing the follow view blocks remote opens. */
  const [followingVerifying, setFollowingVerifying] = useState(false)
  /**
   * True from the render that observes the follow scope until the verification it
   * starts settles. The effect runs one commit after that render, so without this the
   * first painted frame of the list could open a remote row from a previous source's
   * cached data. A surface mounted directly into a persisted follow scope starts
   * pending: nothing has been verified for this mount yet.
   */
  const entryPending = useRef(browseScope?.kind === 'following')
  const previousScopeKind = useRef(browseScope?.kind)
  if (previousScopeKind.current !== browseScope?.kind) {
    previousScopeKind.current = browseScope?.kind
    entryPending.current = browseScope?.kind === 'following'
  }
  if (browseScope?.kind !== 'following') entryPending.current = false

  const loadSessions = useCallback(async (nodeId: string, force = false): Promise<void> => {
    if (!force && (Object.hasOwn(cache.current, nodeId) || sessionControllers.current.has(nodeId))) return
    sessionControllers.current.get(nodeId)?.abort()
    const controller = new AbortController()
    sessionControllers.current.set(nodeId, controller)
    const rosterAtStart = rosterRequest.current
    const current = () => !controller.signal.aborted && rosterRequest.current === rosterAtStart
      && sessionControllers.current.get(nodeId) === controller
    setLoading(previous => ({ ...previous, [nodeId]: true }))
    setErrors(previous => {
      const next = { ...previous }
      delete next[nodeId]
      return next
    })
    try {
      const result = await fetchSessions(nodeId, controller.signal)
      if (current()) {
        setData(previous => ({ ...previous, [nodeId]: result }))
        // The authoritative list now carries any blank created from this panel,
        // so the short-lived hint is no longer needed.
        for (const [key, created] of createdBlanks.current) {
          if (created.nodeId !== nodeId) continue
          if (result.sessions.some(session => session.sessionId === created.sessionId)) {
            createdBlanks.current.delete(key)
          }
        }
      }
    } catch (cause) {
      if (current()) setErrors(previous => ({ ...previous, [nodeId]: describe(cause) }))
    } finally {
      if (sessionControllers.current.get(nodeId) === controller) {
        sessionControllers.current.delete(nodeId)
        setLoading(previous => ({ ...previous, [nodeId]: false }))
      }
    }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const request = ++rosterRequest.current
    rosterController.current?.abort()
    for (const controller of sessionControllers.current.values()) controller.abort()
    sessionControllers.current.clear()
    setLoading({})
    const controller = new AbortController()
    rosterController.current = controller
    setBusy(true)
    // Entering the follow view verifies the Coordinator source before any remote
    // row may open; the same gate applies to a manual refresh from that view.
    if (browsing.current?.kind === 'following') setFollowingVerifying(true)
    setError(undefined)
    setCreateErrors({})
    setCreateUnsupported({})
    try {
      const status = await fetchStatus(controller.signal)
      if (rosterRequest.current !== request || controller.signal.aborted) return
      // A different Coordinator may expose the same node/session ids. Cached lists
      // from the previous source must not be rendered under the new one.
      const sourceChanged = coordinatorUrl.current !== undefined
        && coordinatorUrl.current !== status.coordinator.url
      coordinatorUrl.current = status.coordinator.url
      setCoordinator(status.coordinator)
      if (!status.coordinator.reachable) {
        setErrors({})
        return
      }
      const roster = await fetchNodes(controller.signal)
      if (rosterRequest.current !== request || controller.signal.aborted) return
      const ordered = orderRemoteNodes(roster.nodes)
      setCoordinator(roster.coordinator)
      setNodes(ordered)
      const present = new Set(ordered.map(node => node.nodeId))
      const selectedScope = browsing.current
      if (selectedScope?.kind === 'remote' && !present.has(selectedScope.nodeId)) {
        changeScope.current?.({ kind: 'local' })
        setError(t('browse.removed'))
      }
      setData((previous) => {
        const filtered = Object.fromEntries(Object.entries(previous).filter(([id]) => present.has(id)))
        return sourceChanged ? {} : filtered
      })
      setErrors({})
      const state = expansion.current
      // Following queries only the nodes it actually carries, once per node even
      // when several followed sessions live there.
      const targets = browsing.current?.kind === 'following'
        ? followingNodes(followingRef.current, roster.coordinator.url, ordered)
        : ordered.filter(node => !nodeIsOffline(node)
          && (browsing.current === undefined ? (state.nodeExpansion[node.nodeId] ?? state.defaultNodeExpanded)
            : browsing.current.kind === 'remote' && browsing.current.nodeId === node.nodeId))
      await mapWithConcurrency(targets, FOLLOWING_NODE_CONCURRENCY, node => loadSessions(node.nodeId, true))
    } catch (cause) {
      if (controller.signal.aborted || rosterRequest.current !== request) return
      setCoordinator(undefined)
      setError(describe(cause))
    } finally {
      if (rosterRequest.current === request && !controller.signal.aborted) {
        setBusy(false)
        setFollowingVerifying(false)
        entryPending.current = false
        rosterController.current = undefined
      }
    }
  }, [loadSessions, t])

  const archiveSession = useCallback(async (nodeId: string, sessionId: string): Promise<void> => {
    try {
      const result = await archiveRemoteSession(nodeId, sessionId)
      // A list fetched before this archive must not resurrect the archived row.
      sessionControllers.current.get(nodeId)?.abort()
      setData(previous => {
        const node = previous[nodeId]
        return node === undefined ? previous : { ...previous, [nodeId]: { ...node, archivedSessionIds: result.archivedSessionIds } }
      })
      void loadSessions(nodeId, true)
      if (selection?.nodeId === nodeId && selection.sessionId === sessionId) setRemoteSelection(undefined)
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === 'AbortError')) {
        setErrors(previous => ({ ...previous, [nodeId]: describe(cause) }))
      }
    }
  }, [selection, loadSessions])

  const createSession = useCallback(async (
    node: MasterNode,
    workspace: MasterWorkspace,
    sessions: MasterSessionsValue | undefined,
  ): Promise<void> => {
    const nodeId = node.nodeId
    const nodeName = nodeDisplayName(node)
    const key = JSON.stringify([nodeId, workspace.workspaceId])
    if (inflightCreates.current.has(key) || nodeIsOffline(node) || node.state !== 'ready') return

    // Prefer a known blank so the node reuses it instead of minting another.
    // The node still validates reusability and may return a different identity.
    const reusable = reusableBlankSession(
      sessions?.sessions ?? [],
      sessions?.archivedSessionIds ?? [],
      workspace,
    ) ?? createdBlanks.current.get(key)?.sessionId

    inflightCreates.current.add(key)
    setCreating(previous => ({ ...previous, [key]: true }))
    setCreateErrors(previous => omitKey(previous, key))
    try {
      const created = await createRemoteSession(nodeId, workspace.workspaceId, reusable)
      createdBlanks.current.set(key, { nodeId, sessionId: created.sessionId })
      setData(previous => insertOptimisticBlank(previous, nodeId, workspace, created.sessionId))
      onWorkspaceExpandedChange(key, true)
      onOpenRemoteSession(nodeId, created.sessionId, nodeName, t('session.new'))
      void loadSessions(nodeId, true)
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') return
      setCreateErrors(previous => ({
        ...previous,
        [key]: `${t('remote.createSessionFailed')} · ${describe(cause)}`,
      }))
      if (isCapabilityFailure(cause)) {
        setCreateUnsupported(previous => ({ ...previous, [nodeId]: true }))
      }
    } finally {
      inflightCreates.current.delete(key)
      setCreating(previous => omitKey(previous, key))
    }
  }, [loadSessions, onOpenRemoteSession, onWorkspaceExpandedChange, t])

  useEffect(() => {
    void refresh()
    return () => {
      rosterController.current?.abort()
      for (const controller of sessionControllers.current.values()) controller.abort()
    }
  }, [refresh])

  // Entering Following re-verifies the Coordinator source. A surface mounted
  // directly into that scope is already covered by the mount effect above.
  const lastScopeKind = useRef(browseScope?.kind)
  useEffect(() => {
    const previous = lastScopeKind.current
    lastScopeKind.current = browseScope?.kind
    if (browseScope?.kind === 'following' && previous !== 'following') void refresh()
  }, [browseScope?.kind, refresh])

  // Also hydrate a node expanded from the collapsed sidebar rail, and the follow
  // view's own target nodes (each node at most once per render).
  useEffect(() => {
    if (browseScope?.kind === 'following') {
      for (const node of followingNodes(following, coordinator?.url, nodes)) void loadSessions(node.nodeId)
      return
    }
    for (const node of nodes) {
      if (!nodeIsOffline(node) && (browseScope === undefined ? (nodeExpansion[node.nodeId] ?? defaultNodeExpanded)
        : browseScope.kind === 'remote' && browseScope.nodeId === node.nodeId)) void loadSessions(node.nodeId)
    }
  }, [nodes, nodeExpansion, defaultNodeExpanded, loadSessions, browseScope, following, coordinator?.url])

  const followingRemoteSnapshot: FollowingRemoteSnapshot = {
    coordinator,
    nodes,
    data,
    loading,
    errors,
    // A verify/refresh blocks remote opens even when cached summaries are present.
    // `entryPending` covers the frame before the entry effect starts that verify.
    verifying: followingVerifying || entryPending.current || busy,
    verificationFailed: coordinator === undefined && error !== undefined,
  }
  const compiledFollowing = followingRows(
    following,
    followingLocal ?? EMPTY_LOCAL_SNAPSHOT,
    followingRemoteSnapshot,
    {
      localMachine: t('browse.local'),
      ungrouped: t('group.ungrouped'),
      newSession: t('session.new'),
    },
  )
  const visibleFollowing = filterFollowingRows(compiledFollowing, followingQuery)
  useEffect(() => {
    if (browseScope?.kind !== 'following' || onSyncFollowingSummaries === undefined) return
    const updates = followingSummaryUpdates(following, compiledFollowing)
    if (Object.keys(updates).length > 0) onSyncFollowingSummaries(updates)
  }, [browseScope?.kind, compiledFollowing, following, onSyncFollowingSummaries])

  const followingSelectedKey = followingSelectionKey(currentLocalSessionId, selection, coordinator?.url)
  /** Tokens of followed sessions under the current source, for the source-row menu. */
  const followedSessions = new Set<string>()
  for (const record of following) {
    if (record.target.source !== 'remote' || record.target.coordinatorUrl !== coordinator?.url) continue
    followedSessions.add(sessionFollowToken(record.target.nodeId, record.target.sessionId))
  }
  const toggleRemoteFollow = (
    node: MasterNode,
    session: MasterSession,
    workspace: MasterWorkspace | undefined,
    followed: boolean,
  ): void => {
    const url = coordinator?.url
    if (url === undefined) return
    if (followed) {
      onUnfollow?.(followKey({
        source: 'remote',
        coordinatorUrl: url,
        nodeId: node.nodeId,
        sessionId: session.sessionId,
      }))
      return
    }
    onFollow?.({
      target: { source: 'remote', coordinatorUrl: url, nodeId: node.nodeId, sessionId: session.sessionId },
      followedAt: Date.now(),
      title: session.blank ? t('session.new') : session.title,
      machine: nodeDisplayName(node),
      workspace: workspace?.title ?? t('group.ungrouped'),
    })
  }
  const followWiring = onFollow === undefined || coordinator?.url === undefined ? undefined : toggleRemoteFollow
  const openFollowingRow = (row: FollowingRow): void => {
    const target = row.target
    if (target.source === 'local') {
      onOpenFollowingLocal?.(target.sessionId)
      return
    }
    const node = nodes.find(entry => entry.nodeId === target.nodeId)
    onOpenRemoteSession(
      target.nodeId,
      target.sessionId,
      node === undefined ? row.machine : nodeDisplayName(node),
      row.title,
    )
  }

  const chooser = browseScope && onBrowseScopeChange ? <WorkspaceNodeChooser nodes={nodes}
    scope={browseScope} onChange={onBrowseScopeChange} busy={busy} error={error ?? (coordinator?.reachable === false ? t('remote.coordinatorOffline') : undefined)}
    t={t} onRefresh={() => { void refresh() }} currentNodeId={selection?.nodeId} rail={rail} onExpand={onExpandChooser} requestOpen={requestChooser} onOpened={onChooserOpened} /> : null
  const chooserPortal = chooserMount && chooser ? createPortal(chooser, chooserMount) : null
  if (browseScope?.kind === 'following') {
    if (rail) return <>{chooser}</>
    return (
      <>
        {chooserPortal}
        <FollowingList
          rows={visibleFollowing}
          total={following.length}
          query={followingQuery}
          selectedKey={followingSelectedKey}
          busy={busy}
          error={error ?? (coordinator?.reachable === false ? t('remote.coordinatorOffline') : undefined)}
          t={t}
          onOpen={openFollowingRow}
          onUnfollow={key => { onUnfollow?.(key) }}
          onRefresh={() => { void refresh() }}
        />
      </>
    )
  }
  if (browseScope?.kind === 'local' || contentHidden || rail && browseScope) {
    return <>{rail ? chooser : chooserPortal}</>
  }
  if (browseScope && nodes.length === 0) {
    return <>{chooserPortal}<div className={css.message} role="status">{error ?? (coordinator?.reachable === false ? t('remote.coordinatorOffline') : t('remote.loading'))}</div></>
  }
  if (rail) {
    return (
      <div className={css.rail} aria-label={t('remote.group')}>
        <Button variant="ghost" icon={<IconRefreshOutline14 />} disabled={busy}
          onClick={() => { void refresh() }} aria-label={t('remote.refresh')} />
        {nodes.map(node => (
          <button type="button" key={node.nodeId} className={css.railNode} disabled={nodeIsOffline(node)}
            aria-label={t('remote.nodeAria', {
              name: nodeDisplayName(node),
              status: nodeIsOffline(node) ? t('remote.nodeOffline') : t('remote.nodeOnline'),
            })}
            title={nodeDisplayName(node)} onClick={() => { onRailNodePick?.(node.nodeId) }}>
            <IconGlobeOutline14 />
            <span className={css.railDot}><NodeStatus node={node} /></span>
          </button>
        ))}
      </div>
    )
  }

  if (nodes.length === 0) {
    return (
      <div className={css.group}>
        <div className={css.header}>
          <span className={css.groupTitle}>{t('remote.group')}</span>
          <Button variant="ghost" icon={<IconRefreshOutline14 />} disabled={busy}
            onClick={() => { void refresh() }} aria-label={t('remote.refresh')} />
        </div>
        <div className={css.message} role="status">
          {error ?? (busy ? t('remote.loading') : coordinator?.reachable === false
            ? t('remote.coordinatorOffline') + ' · ' + (coordinator.error ?? coordinator.url) : t('remote.noNodes'))}
        </div>
      </div>
    )
  }

  return (
    <>
      {chooserPortal}
      {(browseScope ? browseNodes(nodes, browseScope) : nodes).map(node => (
        <RemoteNodeSection compact={browseScope !== undefined} unavailable={coordinator?.reachable === false || error !== undefined} scrollPositions={scrollPositions.current} key={node.nodeId} node={node}
          expanded={browseScope !== undefined || (nodeExpansion[node.nodeId] ?? defaultNodeExpanded)}
          busy={busy} loading={loading[node.nodeId] === true} error={errors[node.nodeId] ?? error ?? (coordinator?.reachable === false ? t('remote.coordinatorOffline') : undefined)} data={data[node.nodeId]}
          selection={selection} now={Date.now()} t={t} workspaceExpansion={workspaceExpansion}
          overflow={overflow} openSessionMenu={openSessionMenu}
          onToggleNode={() => { onNodeExpandedChange(node.nodeId, !(nodeExpansion[node.nodeId] ?? defaultNodeExpanded)) }}
          onRefresh={() => { void refresh() }} onWorkspaceExpandedChange={onWorkspaceExpandedChange}
          onToggleOverflow={key => { setOverflow(previous => previous.includes(key) ? previous.filter(id => id !== key) : [...previous, key]) }}
          onSessionMenuChange={(nodeId, sessionId, open) => {
            setOpenSessionMenu(current => open ? { nodeId, sessionId }
              : current?.nodeId === nodeId && current.sessionId === sessionId ? undefined : current)
          }}
          onOpenRemoteSession={onOpenRemoteSession}
          onArchiveRemoteSession={(nodeId, sessionId) => { void archiveSession(nodeId, sessionId) }}
          followedSessions={followedSessions}
          onToggleFollow={followWiring}
          creating={creating} createErrors={createErrors}
          createUnsupported={createUnsupported[node.nodeId] === true}
          onCreateRemoteSession={workspace => { void createSession(node, workspace, data[node.nodeId]) }} />
      ))}
    </>
  )
}
