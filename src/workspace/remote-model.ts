/**
 * Pure display rules for the remote workspace tree.
 *
 * @module dsh-master/workspace/remote-model
 */

import type { MasterNode, MasterSession } from '../protocol.js'

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
 * @param sessions - one node's session rows, in coordinator order.
 * @param expanded - whether the overflow action is open.
 * @returns visible rows plus the number hidden while collapsed.
 */
export function visibleRemoteSessions(
  sessions: readonly MasterSession[],
  expanded: boolean,
  archivedSessionIds: readonly string[] = [],
): { sessions: MasterSession[]; hiddenCount: number } {
  const archived = new Set(archivedSessionIds)
  const visibleSessions = sessions.filter(session => !session.blank && !archived.has(session.sessionId))
  const hiddenCount = Math.max(0, visibleSessions.length - REMOTE_SESSION_LIMIT)
  return {
    sessions: expanded ? visibleSessions : visibleSessions.slice(0, REMOTE_SESSION_LIMIT),
    hiddenCount: expanded ? 0 : hiddenCount,
  }
}
