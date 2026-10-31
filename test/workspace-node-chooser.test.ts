import { describe, expect, it } from 'vitest'
import { browseNodes, nodeChoices, browseNavigationKey } from '../src/workspace/browse-scope.js'

const nodes = [
  { nodeId: 'same', nodeName: 'Local', state: 'ready' },
  { nodeId: 'other', nodeName: 'Local', state: 'offline' },
  { nodeId: 'revoked', state: 'ready', revoked: true },
  { nodeId: 'closing', nodeName: 'Office', state: 'closing' },
  { nodeId: 'unknown', nodeName: 'Pending', state: 'unknown' },
  { nodeId: 'office', nodeName: 'Office', state: 'ready' },
]
describe('workspace browse scope', () => {
  it('does not select a node when Enter confirms an IME composition', () => {
    expect(browseNavigationKey({key:'Enter',isComposing:true,keyCode:13})).toBeUndefined()
    expect(browseNavigationKey({key:'Enter',isComposing:false,keyCode:229})).toBeUndefined()
    expect(browseNavigationKey({key:'Enter',isComposing:false,keyCode:13})).toBe('Enter')
  })
  it('shows one node and never aliases a remote ID with local', () => {
    expect(browseNodes(nodes, { kind: 'local' })).toEqual([])
    expect(browseNodes(nodes, { kind: 'remote', nodeId: 'same' })).toEqual([nodes[0]])
    expect(browseNodes(nodes, { kind: 'remote', nodeId: 'missing' })).toEqual([])
  })
  it('searches only ready, non-revoked nodes by name or ID', () => {
    expect(nodeChoices(nodes, 'LOCAL').map(n => n.nodeId)).toEqual(['same'])
    expect(nodeChoices(nodes, 'office')).toEqual([nodes[5]])
    expect(nodeChoices(nodes, '  OFFICE  ')).toEqual([nodes[5]])
    expect(nodeChoices(nodes, 'SAME')).toEqual([nodes[0]])
    expect(nodeChoices(nodes, 'revoked')).toEqual([])
    expect(nodeChoices(nodes, 'closing')).toEqual([])
    expect(nodeChoices(nodes, 'unknown')).toEqual([])
    expect(nodeChoices(nodes, 'absent')).toEqual([])
  })
  it('keeps every eligible node in server order for an empty query', () => {
    expect(nodeChoices(nodes, '')).toEqual([nodes[0], nodes[5]])
    expect(nodeChoices(nodes, '   ')).toEqual([nodes[0], nodes[5]])
  })
})
