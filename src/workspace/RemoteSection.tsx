/**
 * Independent remote-node sections alongside the forked local workspace tree.
 *
 * @module dsh-master/workspace/RemoteSection
 */

import clsx from 'clsx'
import { createPortal } from 'react-dom'
import { WorkspaceNodeChooser } from './WorkspaceNodeChooser.js'
import { browseNodes } from './browse-scope.js'
import {
  Button,
  IconFolderCloseRegular,
  IconFolderOpenRegular,
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
import type { MasterCoordinatorFacts, MasterNode, MasterSession, MasterSessionsValue } from '../protocol.js'
import { ApiError, archiveRemoteSession, fetchNodes, fetchSessions, fetchStatus } from '../client/api.js'
import { timeAgo } from '../client/copy.js'
import { getRemoteSelection, setRemoteSelection, subscribeRemoteSelection } from '../client/selection.js'
import type { RemoteSessionSelection } from '../client/selection.js'
import type { RemoteSectionProps } from './contract/slots.js'
import { groupRemoteWorkspaces, nodeIsOffline, orderRemoteNodes, visibleRemoteSessions } from './remote-model.js'
import { RowsCss, RemoteSectionCss as css, WorkspaceBrowserCss } from './styles.generated.js'

/** Describe one failed call without losing the host's stable error code. */
function describe(cause: unknown): string {
  if (cause instanceof ApiError) return `${cause.code}: ${cause.message}`
  return cause instanceof Error ? cause.message : String(cause)
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
  onMenuOpenChange: (open: boolean) => void
  onOpenRemoteSession: (nodeId: string, sessionId: string, nodeName: string, sessionTitle: string) => void
  onArchiveRemoteSession: (nodeId: string, sessionId: string) => void
  t: (key: string, params?: Record<string, unknown>) => string
}): ReactElement {
  const selected = selection?.nodeId === nodeId && selection.sessionId === session.sessionId
  const menuItems = [
    { id: 'archive', label: t('menu.archiveSession'), icon: <IconArchiveOutline20 size={16} /> },
  ]

  return (
    <div
      role="treeitem"
      className={clsx(RowsCss.sessionRow, css.sessionRow, selected && RowsCss.selected, menuOpen && RowsCss.menuOpen)}
      aria-selected={selected}
      title={session.sessionId}
      onClick={() => { onOpenRemoteSession(nodeId, session.sessionId, nodeName, session.title) }}
    >
      <span className={css.sessionTitle}>{session.title}</span>
      {session.running
        ? <StateDot state="ongoing" />
        : <span className={css.sessionAge}>{timeAgo(session.updatedAt, now)}</span>}
      {!archiveAvailable ? null : (
        <span className={RowsCss.rowActions}>
          <Menu
            open={menuOpen}
            onClose={() => { onMenuOpenChange(false) }}
            items={menuItems}
            onSelect={(id) => {
              onMenuOpenChange(false)
              if (id === 'archive') onArchiveRemoteSession(nodeId, session.sessionId)
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
      )}
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
  onToggleNode: () => void
  onRefresh: () => void
  onWorkspaceExpandedChange: RemoteSectionProps['onWorkspaceExpandedChange']
  onToggleOverflow: (key: string) => void
  onSessionMenuChange: (nodeId: string, sessionId: string, open: boolean) => void
  onOpenRemoteSession: RemoteSectionProps['onOpenRemoteSession']
  onArchiveRemoteSession: (nodeId: string, sessionId: string) => void
}

/** Render registered directories inside one independently collapsible node. */
export function RemoteNodeSection({
  node, expanded, busy, loading, error, data, selection, now, compact = false, scrollPositions, unavailable = false,
  workspaceExpansion, overflow, openSessionMenu, t,
  onToggleNode, onRefresh, onWorkspaceExpandedChange, onToggleOverflow,
  onSessionMenuChange, onOpenRemoteSession, onArchiveRemoteSession,
}: RemoteNodeSectionProps): ReactElement {
  const offline = nodeIsOffline(node)
  const name = node.nodeName ?? node.nodeId
  const groups = groupRemoteWorkspaces(data?.workspaces ?? [], data?.sessions ?? [], data?.archivedSessionIds ?? [])
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
              {data !== undefined && groups.length === 0 ? <div className={css.message}>{t('remote.noWorkspaces')}</div> : null}
              {groups.map(group => {
                const workspace = group.workspace
                const key = JSON.stringify([node.nodeId, workspace?.workspaceId ?? null])
                const directoryExpanded = workspaceExpansion[key] ?? true
                const more = overflow.includes(key)
                const visible = visibleRemoteSessions(group.sessions, more)
                const title = workspace?.title ?? t('group.ungrouped')
                return (
                  <div key={key} className={WorkspaceBrowserCss.groupSection} role="treeitem"
                    aria-expanded={directoryExpanded} aria-label={title}>
                    <button type="button" className={clsx(RowsCss.projectRow, css.workspaceRow)}
                      title={workspace?.path} aria-expanded={directoryExpanded}
                      onClick={() => { onWorkspaceExpandedChange(key, !directoryExpanded) }}>
                      <span className={clsx(RowsCss.slot, RowsCss.folder)} aria-hidden="true">
                        {directoryExpanded ? <IconFolderOpenRegular /> : <IconFolderCloseRegular />}
                      </span>
                      <span className={clsx(RowsCss.slot, RowsCss.chevron)} aria-hidden="true">
                        <IconTriangleRightFillRegular className={clsx(RowsCss.arrow, directoryExpanded && RowsCss.arrowOpen)} />
                      </span>
                      <span className={css.nodeTitle}>{title}</span>
                    </button>
                    {!directoryExpanded ? null : (
                      <div role="group">
                        {visible.sessions.length === 0 ? <div className={css.message}>{t('remote.noSessions')}</div> : null}
                        {visible.sessions.map(session => (
                          <RemoteSessionItem key={session.sessionId} nodeId={node.nodeId} nodeName={name}
                            session={session} selection={selection} now={now}
                            menuOpen={openSessionMenu?.nodeId === node.nodeId && openSessionMenu.sessionId === session.sessionId}
                            archiveAvailable={!unavailable && data?.archiveError === undefined}
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
      if (current()) setData(previous => ({ ...previous, [nodeId]: result }))
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
    setError(undefined)
    try {
      const status = await fetchStatus(controller.signal)
      if (rosterRequest.current !== request || controller.signal.aborted) return
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
      setData(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => present.has(id))))
      setErrors({})
      const state = expansion.current
      await Promise.all(ordered.filter(node => !nodeIsOffline(node)
        && (browsing.current === undefined ? (state.nodeExpansion[node.nodeId] ?? state.defaultNodeExpanded)
          : browsing.current.kind === 'remote' && browsing.current.nodeId === node.nodeId))
        .map(node => loadSessions(node.nodeId, true)))
    } catch (cause) {
      if (controller.signal.aborted || rosterRequest.current !== request) return
      setCoordinator(undefined)
      setError(describe(cause))
    } finally {
      if (rosterRequest.current === request && !controller.signal.aborted) {
        setBusy(false)
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

  useEffect(() => {
    void refresh()
    return () => {
      rosterController.current?.abort()
      for (const controller of sessionControllers.current.values()) controller.abort()
    }
  }, [refresh])

  // Also hydrate a node expanded from the collapsed sidebar rail.
  useEffect(() => {
    for (const node of nodes) {
      if (!nodeIsOffline(node) && (browseScope === undefined ? (nodeExpansion[node.nodeId] ?? defaultNodeExpanded)
        : browseScope.kind === 'remote' && browseScope.nodeId === node.nodeId)) void loadSessions(node.nodeId)
    }
  }, [nodes, nodeExpansion, defaultNodeExpanded, loadSessions, browseScope])

  const chooser = browseScope && onBrowseScopeChange ? <WorkspaceNodeChooser nodes={nodes}
    scope={browseScope} onChange={onBrowseScopeChange} busy={busy} error={error ?? (coordinator?.reachable === false ? t('remote.coordinatorOffline') : undefined)}
    t={t} onRefresh={() => { void refresh() }} currentNodeId={selection?.nodeId} rail={rail} onExpand={onExpandChooser} requestOpen={requestChooser} onOpened={onChooserOpened} /> : null
  const chooserPortal = chooserMount && chooser ? createPortal(chooser, chooserMount) : null
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
              name: node.nodeName ?? node.nodeId,
              status: nodeIsOffline(node) ? t('remote.nodeOffline') : t('remote.nodeOnline'),
            })}
            title={node.nodeName ?? node.nodeId} onClick={() => { onRailNodePick?.(node.nodeId) }}>
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
          onArchiveRemoteSession={(nodeId, sessionId) => { void archiveSession(nodeId, sessionId) }} />
      ))}
    </>
  )
}
