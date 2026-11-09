import type { MasterNode } from '../protocol.js'
import type { WorkspaceBrowseScope } from './stores.js'

export function browseNavigationKey(event: Pick<KeyboardEvent, 'key' | 'isComposing' | 'keyCode'>): string | undefined {
  if (event.isComposing || event.keyCode === 229) return undefined
  return ['Enter', 'Escape', 'Tab', 'ArrowDown', 'ArrowUp'].includes(event.key) ? event.key : undefined
}

export function browseNodes(nodes: readonly MasterNode[], scope: WorkspaceBrowseScope): MasterNode[] {
  return scope.kind === 'remote' ? nodes.filter(node => node.nodeId === scope.nodeId) : []
}

/**
 * The label a node is presented under.
 *
 * An empty or whitespace-only display name must not become a blank title, and a
 * node id is the one identity that is always present.
 */
export function nodeDisplayName(node: Pick<MasterNode, 'nodeId' | 'nodeName'>): string {
  const name = node.nodeName?.trim()
  return name === undefined || name === '' ? node.nodeId : name
}

/**
 * The sidebar title for a browse scope.
 *
 * The title follows `browseScope`, never the current conversation's node. A
 * remote scope keeps its persisted node id while the roster is loading, has
 * failed, or no longer contains that node, rather than pretending to be local;
 * when the roster does contain it, the title tracks the latest name by node id.
 */
export function browseScopeName(
  nodes: readonly MasterNode[],
  scope: WorkspaceBrowseScope,
  localLabel: string,
  followingLabel: string,
): string {
  if (scope.kind === 'local') return localLabel
  if (scope.kind === 'following') return followingLabel
  const node = nodes.find(candidate => candidate.nodeId === scope.nodeId)
  return node === undefined ? scope.nodeId : nodeDisplayName(node)
}

/**
 * The remote nodes the picker may offer: online and not revoked.
 *
 * Filtering happens only here, on the candidate list. The roster keeps offline
 * nodes because an already-open session can still belong to one.
 */
export function nodeChoices(nodes: readonly MasterNode[], query: string): MasterNode[] {
  const term = query.trim().toLocaleLowerCase()
  return nodes.filter(node => node.state === 'ready' && node.revoked !== true
    && `${nodeDisplayName(node)} ${node.nodeId}`.toLocaleLowerCase().includes(term))
}
