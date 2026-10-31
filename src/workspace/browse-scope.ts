import type { MasterNode } from '../protocol.js'
import type { WorkspaceBrowseScope } from './stores.js'

export function browseNavigationKey(event: Pick<KeyboardEvent, 'key' | 'isComposing' | 'keyCode'>): string | undefined {
  if (event.isComposing || event.keyCode === 229) return undefined
  return ['Enter', 'Escape', 'Tab', 'ArrowDown', 'ArrowUp'].includes(event.key) ? event.key : undefined
}

export function browseNodes(nodes: readonly MasterNode[], scope: WorkspaceBrowseScope): MasterNode[] {
  return scope.kind === 'local' ? [] : nodes.filter(node => node.nodeId === scope.nodeId)
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
    && `${node.nodeName ?? ''} ${node.nodeId}`.toLocaleLowerCase().includes(term))
}
