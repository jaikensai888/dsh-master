import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { browseScopeName, nodeDisplayName } from '../src/workspace/browse-scope.js'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const react = await import('react')
  const icon = (name: string) => (props: { className?: string }) => react.createElement('i', { 'data-icon': name, className: props.className })
  return {
    IconCheckOutlineRegular: icon('check'),
    IconRefreshOutlineRegular: icon('refresh'),
    IconTriangleRightFillRegular: icon('triangle'),
  }
})

import { WorkspaceNodeChooser } from '../src/workspace/WorkspaceNodeChooser.js'

const translations: Record<string, string> = {
  'browse.local': '本地',
  'browse.localWorkspace': '本地工作区',
  'browse.choose': '切换工作节点',
  'browse.titleAria': '切换工作节点，当前为 {name}',
}

function t(key: string, params?: Record<string, unknown>): string {
  return (translations[key] ?? key).replace('{name}', String(params?.['name'] ?? ''))
}

function renderChooser(scope: { kind: 'local' } | { kind: 'remote'; nodeId: string }, nodes = [
  { nodeId: 'node-a', nodeName: 'office1', state: 'ready' as const },
  { nodeId: 'node-b', nodeName: 'Office B', state: 'offline' as const },
], currentNodeId?: string): string {
  return renderToStaticMarkup(createElement(WorkspaceNodeChooser, {
    nodes,
    scope,
    onChange: () => undefined,
    busy: false,
    error: undefined,
    t,
    onRefresh: () => undefined,
    ...(currentNodeId === undefined ? {} : { currentNodeId }),
    rail: false,
  }))
}

/** The trigger is the only button while the popover is closed. */
function triggerMarkup(markup: string): string {
  const match = markup.match(/<button[\s\S]*?<\/button>/u)
  if (match === null) throw new Error('chooser trigger missing')
  return match[0]
}

describe('the browsing title', () => {
  it('resolves the local title and a remote name from the browse scope', () => {
    expect(browseScopeName([], { kind: 'local' }, '本地工作区', '关注')).toBe('本地工作区')
    expect(browseScopeName([], { kind: 'following' }, '本地工作区', '关注')).toBe('关注')
    expect(browseScopeName([
      { nodeId: 'node-a', nodeName: 'office1', state: 'ready' },
    ], { kind: 'remote', nodeId: 'node-a' }, '本地工作区', '关注')).toBe('office1')
  })

  it('keeps the persisted remote node id when the roster has not loaded or lost the node', () => {
    // A pending/failed roster must not turn a saved remote choice into the local title.
    expect(browseScopeName([], { kind: 'remote', nodeId: 'office1' }, '本地工作区', '关注')).toBe('office1')
    expect(browseScopeName([
      { nodeId: 'another', nodeName: 'Other', state: 'ready' },
    ], { kind: 'remote', nodeId: 'office1' }, '本地工作区', '关注')).toBe('office1')
  })

  it('tracks a renamed node by node id and falls back to the id for an empty name', () => {
    expect(browseScopeName([
      { nodeId: 'office1', nodeName: 'Renamed office', state: 'ready' },
    ], { kind: 'remote', nodeId: 'office1' }, '本地工作区', '关注')).toBe('Renamed office')
    expect(nodeDisplayName({ nodeId: 'office1', nodeName: '' })).toBe('office1')
    expect(nodeDisplayName({ nodeId: 'office1', nodeName: '   ' })).toBe('office1')
  })

  it('puts the scope title and the arrow into one trigger, not the current session node', () => {
    const markup = renderChooser({ kind: 'remote', nodeId: 'node-a' }, undefined, 'node-b')
    const trigger = triggerMarkup(markup)
    expect(trigger).toContain('>office1<')
    expect(trigger).toContain('data-icon="triangle"')
    expect(trigger).toContain('aria-label="切换工作节点，当前为 office1"')
    expect(markup.match(/<button/gu)).toHaveLength(1)
  })

  it('renders the local title in the same trigger', () => {
    const markup = renderChooser({ kind: 'local' })
    expect(triggerMarkup(markup)).toContain('>本地工作区')
    expect(triggerMarkup(markup)).toContain('data-icon="triangle"')
  })

  it('keeps the rail entry arrow-only while the collapsed sidebar stays reachable', () => {
    const markup = renderToStaticMarkup(createElement(WorkspaceNodeChooser, {
      nodes: [{ nodeId: 'node-a', nodeName: 'office1', state: 'ready' as const }],
      scope: { kind: 'remote', nodeId: 'node-a' },
      onChange: () => undefined,
      busy: false,
      error: undefined,
      t,
      onRefresh: () => undefined,
      rail: true,
      onExpand: () => undefined,
    }))
    // The collapsed rail keeps the icon-only control; the node name remains in
    // its accessible label and tooltip.
    expect(markup).not.toContain('>office1<')
    expect(markup).not.toContain('chooserTitleText')
    expect(markup).toContain('aria-label="切换工作节点，当前为 office1"')
    expect(markup).toContain('data-icon="triangle"')
  })
})
