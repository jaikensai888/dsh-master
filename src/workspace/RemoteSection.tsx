/**
 * The remote-node group appended to the forked local workspace tree.
 *
 * @module dsh-master/workspace/RemoteSection
 */

import clsx from 'clsx'
import {
  Button,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconGlobeOutline14,
  IconRefreshOutline14,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import type { MasterCoordinatorFacts, MasterNode, MasterSession } from '../protocol.js'
import { ApiError, fetchNodes, fetchSessions, fetchStatus } from '../client/api.js'
import { timeAgo } from '../client/copy.js'
import { getRemoteSelection, subscribeRemoteSelection } from '../client/selection.js'
import type { RemoteSessionSelection } from '../client/selection.js'
import type { RemoteSectionProps } from './contract/slots.js'
import { nodeIsOffline, orderRemoteNodes, visibleRemoteSessions } from './remote-model.js'
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
  onOpenRemoteSession,
}: {
  nodeId: string
  nodeName: string
  session: MasterSession
  selection: RemoteSessionSelection | undefined
  now: number
  onOpenRemoteSession: (nodeId: string, sessionId: string, nodeName: string, sessionTitle: string) => void
}): ReactElement {
  const selected = selection?.nodeId === nodeId && selection.sessionId === session.sessionId

  return (
    <button
      type="button"
      role="treeitem"
      className={clsx(RowsCss.sessionRow, css.sessionRow, selected && RowsCss.selected)}
      aria-selected={selected}
      title={session.sessionId}
      onClick={() => { onOpenRemoteSession(nodeId, session.sessionId, nodeName, session.title) }}
    >
      <span className={css.sessionTitle}>{session.title}</span>
      {session.running
        ? <StateDot state="ongoing" />
        : <span className={css.sessionAge}>{timeAgo(session.updatedAt, now)}</span>}
    </button>
  )
}

/**
 * Render the remote group or its node-only collapsed-rail form.
 *
 * @param props - persisted group state and the owner navigation callback.
 * @returns the remote tree section.
 */
export function RemoteSection({
  t,
  expanded,
  onToggleGroup,
  expandedNodeId,
  onExpandedNodeChange,
  onOpenRemoteSession,
  rail = false,
  onRailNodePick,
}: RemoteSectionProps): ReactElement {
  const selection = useSyncExternalStore(
    subscribeRemoteSelection,
    getRemoteSelection,
    getRemoteSelection,
  )
  const [coordinator, setCoordinator] = useState<MasterCoordinatorFacts | undefined>(undefined)
  const [nodes, setNodes] = useState<readonly MasterNode[]>([])
  const [sessions, setSessions] = useState<Readonly<Record<string, readonly MasterSession[]>>>({})
  const [loadingSessions, setLoadingSessions] = useState<Readonly<Record<string, boolean>>>({})
  const [sessionErrors, setSessionErrors] = useState<Readonly<Record<string, string>>>({})
  const [sessionOverflow, setSessionOverflow] = useState<readonly string[]>([])
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const sessionCache = useRef(sessions)
  sessionCache.current = sessions
  const expandedNode = useRef(expandedNodeId)
  expandedNode.current = expandedNodeId
  const rosterRequest = useRef(0)
  const sessionRequests = useRef<Record<string, number>>({})
  const sessionControllers = useRef(new Map<string, AbortController>())
  const rosterController = useRef<AbortController | undefined>(undefined)
  const sessionPending = useRef(new Set<string>())

  const loadSessions = useCallback(async (nodeId: string, force = false): Promise<void> => {
    if (!force && (Object.hasOwn(sessionCache.current, nodeId) || sessionPending.current.has(nodeId))) return
    const request = (sessionRequests.current[nodeId] ?? 0) + 1
    sessionRequests.current[nodeId] = request
    sessionControllers.current.get(nodeId)?.abort()
    const controller = new AbortController()
    sessionControllers.current.set(nodeId, controller)
    sessionPending.current.add(nodeId)
    const rosterAtStart = rosterRequest.current
    setLoadingSessions(previous => ({ ...previous, [nodeId]: true }))
    setSessionErrors(previous => {
      const next = { ...previous }
      delete next[nodeId]
      return next
    })
    try {
      const result = await fetchSessions(nodeId, controller.signal)
      if (sessionRequests.current[nodeId] !== request || rosterRequest.current !== rosterAtStart) return
      setSessions(previous => ({ ...previous, [nodeId]: result.sessions }))
    } catch (cause) {
      if (!controller.signal.aborted && sessionRequests.current[nodeId] === request
        && rosterRequest.current === rosterAtStart) {
        setSessionErrors(previous => ({ ...previous, [nodeId]: describe(cause) }))
      }
    } finally {
      if (sessionRequests.current[nodeId] === request) {
        sessionPending.current.delete(nodeId)
        sessionControllers.current.delete(nodeId)
        setLoadingSessions(previous => ({ ...previous, [nodeId]: false }))
      }
    }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const request = ++rosterRequest.current
    rosterController.current?.abort()
    const controller = new AbortController()
    rosterController.current = controller
    setBusy(true)
    setError(undefined)
    try {
      const status = await fetchStatus(controller.signal)
      if (rosterRequest.current !== request) return
      setCoordinator(status.coordinator)
      if (!status.coordinator.reachable) {
        setNodes([])
        setSessions({})
        setSessionErrors({})
        return
      }

      const roster = await fetchNodes(controller.signal)
      if (rosterRequest.current !== request) return
      const ordered = orderRemoteNodes(roster.nodes)
      setCoordinator(roster.coordinator)
      setNodes(ordered)
      const present = new Set(ordered.map(node => node.nodeId))
      setSessions(previous => Object.fromEntries(
        Object.entries(previous).filter(([nodeId]) => present.has(nodeId)),
      ))
      setSessionErrors(previous => Object.fromEntries(
        Object.entries(previous).filter(([nodeId]) => present.has(nodeId)),
      ))

      const openNodeId = expandedNode.current
      const openNode = ordered.find(node => node.nodeId === openNodeId)
      if (openNodeId !== undefined && openNode !== undefined && !nodeIsOffline(openNode)) {
        await loadSessions(openNodeId, true)
      }
    } catch (cause) {
      if (controller.signal.aborted || rosterRequest.current !== request) return
      setNodes([])
      setSessions({})
      setCoordinator(undefined)
      setError(describe(cause))
    } finally {
      if (rosterRequest.current === request) {
        setBusy(false)
        rosterController.current = undefined
      }
    }
  }, [loadSessions])

  useEffect(() => {
    void refresh()
    return () => {
      rosterController.current?.abort()
      for (const controller of sessionControllers.current.values()) controller.abort()
    }
  }, [refresh])

  const toggleNode = useCallback((node: MasterNode): void => {
    if (nodeIsOffline(node)) return
    if (expandedNodeId === node.nodeId) {
      onExpandedNodeChange(undefined)
      return
    }
    onExpandedNodeChange(node.nodeId)
    void loadSessions(node.nodeId)
  }, [expandedNodeId, loadSessions, onExpandedNodeChange])

  if (rail) {
    return (
      <div className={css.rail} aria-label={t('remote.group')}>
        {nodes.map(node => (
          <button
            type="button"
            key={node.nodeId}
            className={css.railNode}
            disabled={nodeIsOffline(node)}
            aria-label={t('remote.nodeAria', {
              name: node.nodeName ?? node.nodeId,
              status: nodeIsOffline(node) ? t('remote.nodeOffline') : t('remote.nodeOnline'),
            })}
            title={node.nodeName ?? node.nodeId}
            onClick={() => { onRailNodePick?.(node.nodeId) }}
          >
            <IconGlobeOutline14 />
            <span className={css.railDot}><NodeStatus node={node} /></span>
          </button>
        ))}
      </div>
    )
  }

  const now = Date.now()
  const coordinatorLine = coordinator?.error === undefined
    ? coordinator?.url
    : `${coordinator.url} — ${coordinator.error}`

  return (
    <div
      role="tree"
      aria-label={t('remote.group')}
      className={clsx(WorkspaceBrowserCss.groupSection, css.group, expanded && css.expanded)}
    >
      <div className={css.header}>
        <button
          type="button"
          role="treeitem"
          className={css.groupToggle}
          aria-expanded={expanded}
          aria-label={t('remote.group')}
          onClick={onToggleGroup}
        >
          <span
            className={css.disclosureSlot}
            aria-hidden="true"
            data-expanded={expanded}
          />
          <span className={css.groupTitle}>{t('remote.group')}</span>
        </button>
        <Button
          variant="ghost"
          icon={<IconRefreshOutline14 />}
          disabled={busy}
          onClick={() => { void refresh() }}
          aria-label={busy ? t('remote.refreshing') : t('remote.refresh')}
          title={busy ? t('remote.refreshing') : t('remote.refresh')}
        />
      </div>

      {!expanded ? null : (
        <div className={css.content}>
          {coordinator?.reachable === false
            ? (
              <div className={css.message} role="status">
                {t('remote.coordinatorOffline')}{coordinatorLine === undefined ? '' : ` · ${coordinatorLine}`}
              </div>
            )
            : null}
          {error === undefined ? null : <div className={css.message} role="status">{error}</div>}
          {coordinator === undefined && error === undefined && busy
            ? <div className={css.message} role="status">{t('remote.loading')}</div>
            : null}
          {coordinator?.reachable === true && nodes.length === 0 && error === undefined
            ? <div className={css.message}>{t('remote.noNodes')}</div>
            : null}

          {nodes.map(node => {
            const nodeExpanded = expandedNodeId === node.nodeId
            const nodeOffline = nodeIsOffline(node)
            const allSessions = sessions[node.nodeId] ?? []
            const visible = visibleRemoteSessions(allSessions, sessionOverflow.includes(node.nodeId))
            return (
              <div key={node.nodeId}>
                <button
                  type="button"
                  role="treeitem"
                  className={clsx(RowsCss.projectRow, css.nodeRow)}
                  disabled={nodeOffline}
                  aria-expanded={nodeOffline ? undefined : nodeExpanded}
                  aria-label={t('remote.nodeAria', {
                    name: node.nodeName ?? node.nodeId,
                    status: nodeOffline ? t('remote.nodeOffline') : t('remote.nodeOnline'),
                  })}
                  title={node.nodeId}
                  onClick={() => { toggleNode(node) }}
                >
                  <span className={css.nodeIcon}>
                    {nodeOffline
                      ? <IconGlobeOutline14 />
                      : nodeExpanded ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
                  </span>
                  <span className={css.nodeTitle}>{node.nodeName ?? node.nodeId}</span>
                  <NodeStatus node={node} />
                </button>

                {!nodeExpanded || nodeOffline ? null : (
                  <div role="group">
                    {loadingSessions[node.nodeId] === true && !Object.hasOwn(sessions, node.nodeId)
                      ? <div className={css.message} role="status">{t('remote.sessionsLoading')}</div>
                      : null}
                    {sessionErrors[node.nodeId] === undefined
                      ? null
                      : <div className={css.message} role="status">{sessionErrors[node.nodeId]}</div>}
                    {Object.hasOwn(sessions, node.nodeId) && visible.sessions.length === 0
                      ? <div className={css.message}>{t('remote.noSessions')}</div>
                      : null}
                    {visible.sessions.map(session => (
                      <RemoteSessionItem
                        key={session.sessionId}
                        nodeId={node.nodeId}
                        nodeName={node.nodeName ?? node.nodeId}
                        session={session}
                        selection={selection}
                        now={now}
                        onOpenRemoteSession={onOpenRemoteSession}
                      />
                    ))}
                    {visible.hiddenCount > 0 || sessionOverflow.includes(node.nodeId)
                      ? (
                        <button
                          type="button"
                          className={WorkspaceBrowserCss.sessionOverflowButton}
                          aria-expanded={sessionOverflow.includes(node.nodeId)}
                          onClick={() => {
                            setSessionOverflow(current => current.includes(node.nodeId)
                              ? current.filter(id => id !== node.nodeId)
                              : [...current, node.nodeId])
                          }}
                        >
                          {sessionOverflow.includes(node.nodeId)
                            ? t('remote.sessionsCollapse')
                            : t('remote.sessionsExpand', { n: visible.hiddenCount })}
                        </button>
                      )
                      : null}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
