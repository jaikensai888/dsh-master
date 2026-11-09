/**
 * Pure display rules for the remote workspace tree.
 *
 * @module dsh-master/workspace/remote-model
 */

import type { MasterNode, MasterSession, MasterWorkspace } from '../protocol.js'

/** Project registry membership, retaining empty workspaces and visible unassigned sessions. */
export function groupRemoteWorkspaces(
  workspaces: readonly MasterWorkspace[],
  sessions: readonly MasterSession[],
  archivedSessionIds: readonly string[] = [],
  currentSessionId?: string,
): { workspace: MasterWorkspace | undefined; sessions: MasterSession[] }[] {
  const visible = visibleRemoteSessions(sessions, true, archivedSessionIds, currentSessionId).sessions
  const assigned = new Set<string>()
  const groups = workspaces.map(workspace => {
    const membership = new Set(workspace.sessionIds)
    const rows = visible.filter(session => membership.has(session.sessionId) && !assigned.has(session.sessionId))
    for (const session of rows) assigned.add(session.sessionId)
    return { workspace: workspace as MasterWorkspace | undefined, sessions: rows }
  })
  const ungrouped = visible.filter(session => !assigned.has(session.sessionId))
  if (ungrouped.length > 0) groups.push({ workspace: undefined, sessions: ungrouped })
  return groups
}

/**
 * Find an unarchived blank session that is already a member of this workspace.
 *
 * The node still decides whether it is reusable (it may have started a turn);
 * this only avoids asking for a new identity when one is already known.
 *
 * @param sessions - the node's session rows.
 * @param archivedSessionIds - the node's archive set.
 * @param workspace - target workspace.
 * @returns the blank session id, or undefined when none is a candidate.
 */
export function reusableBlankSession(
  sessions: readonly MasterSession[],
  archivedSessionIds: readonly string[],
  workspace: MasterWorkspace,
): string | undefined {
  const archived = new Set(archivedSessionIds)
  return sessions.find(session => session.blank
    && !archived.has(session.sessionId)
    && workspace.sessionIds.includes(session.sessionId)
    && (session.cwd === undefined || session.cwd === workspace.path))?.sessionId
}

/** Number of non-empty sessions shown before the per-node overflow action. */
export const REMOTE_SESSION_LIMIT = 5

/**
 * Put ready nodes first while preserving the coordinator's order within each group.
 *
 * @param nodes - coordinator roster order.
 * @returns a stable online-first copy.
 */
export function orderRemoteNodes(nodes: readonly MasterNode[]): MasterNode[] {
  return nodes
    .map((node, index) => ({ node, index }))
    .sort((a, b) => Number(b.node.state === 'ready' && b.node.revoked !== true)
      - Number(a.node.state === 'ready' && a.node.revoked !== true) || a.index - b.index)
    .map(entry => entry.node)
}

/**
 * Whether this row represents a node the coordinator says is offline or revoked.
 *
 * Connecting, authenticating and closing remain expandable so the operator can see
 * a useful session-load error if the upstream still refuses the request.
 *
 * @param node - coordinator roster row.
 * @returns whether the row must be muted and non-interactive.
 */
export function nodeIsOffline(node: MasterNode): boolean {
  return node.state === 'offline' || node.revoked === true
}

/**
 * Hide unstarted sessions and apply the remote tree's five-row overflow rule.
 *
 * The currently selected blank session stays visible: creating a session and
 * immediately losing its row would make the remote tree contradict the open
 * panel. That row does not consume one of the five ordinary slots.
 *
 * @param sessions - one node's session rows, in coordinator order.
 * @param expanded - whether the overflow action is open.
 * @param archivedSessionIds - the node's archive set.
 * @param currentSessionId - the session selected in the remote panel, if any.
 * @returns visible rows plus the number hidden while collapsed.
 */
export function visibleRemoteSessions(
  sessions: readonly MasterSession[],
  expanded: boolean,
  archivedSessionIds: readonly string[] = [],
  currentSessionId?: string,
): { sessions: MasterSession[]; hiddenCount: number } {
  const archived = new Set(archivedSessionIds)
  const visibleSessions = sessions.filter(session => !archived.has(session.sessionId)
    && (!session.blank || session.sessionId === currentSessionId))
  const ordinaryCount = visibleSessions.filter(session => !session.blank).length
  const hiddenCount = Math.max(0, ordinaryCount - REMOTE_SESSION_LIMIT)
  if (expanded) return { sessions: visibleSessions, hiddenCount: 0 }

  let ordinary = 0
  const rows = visibleSessions.filter((session) => {
    if (session.blank) return true
    if (ordinary >= REMOTE_SESSION_LIMIT) return false
    ordinary += 1
    return true
  })
  return { sessions: rows, hiddenCount }
}
