import { createElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { MasterSession } from '../src/protocol.js'
import type { RemoteSessionSelection } from '../src/client/selection.js'
import { RowsCss, RemoteSectionCss } from '../src/workspace/styles.generated.js'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const react = await import('react')
  const icon = (name: string) => () => react.createElement('i', { 'data-icon': name })
  return {
    Button: (props: {
      icon?: ReactNode
      disabled?: boolean
      onClick?: () => void
      'aria-label'?: string
      title?: string
    }) => react.createElement('button', {
      'aria-label': props['aria-label'],
      title: props.title,
      disabled: props.disabled,
      onClick: props.onClick,
    }, props.icon),
    IconChevronDownOutline14: icon('chevron-down'),
    IconChevronRightOutline14: icon('chevron-right'),
    IconGlobeOutline14: icon('globe'),
    IconRefreshOutline14: icon('refresh'),
    StateDot: icon('state'),
  }
})

import { RemoteSection } from '../src/workspace/RemoteSection.js'
import type { RemoteSectionProps } from '../src/workspace/contract/slots.js'

interface RemoteSessionItemProps {
  nodeId: string
  nodeName: string
  session: MasterSession
  selection: RemoteSessionSelection | undefined
  now: number
  onOpenRemoteSession: (nodeId: string, sessionId: string, nodeName: string, sessionTitle: string) => void
}

describe('the remote workspace group heading', () => {
  it('shows the disclosure and refresh controls without a globe icon', () => {
    const props: RemoteSectionProps = {
      t: key => key === 'remote.group' ? '远程工作区' : key,
      expanded: true,
      onToggleGroup: () => {},
      expandedNodeId: undefined,
      onExpandedNodeChange: () => {},
      onOpenRemoteSession: () => {},
    }
    const markup = renderToStaticMarkup(createElement(RemoteSection, props))
    const disclosureSlot = (RemoteSectionCss as Readonly<Record<string, string>>)['disclosureSlot']

    expect(markup).toContain('远程工作区')
    expect(disclosureSlot).toBeDefined()
    expect(markup).toContain(`class="${disclosureSlot}"`)
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('data-expanded="true"')
    expect(markup).toContain('data-icon="refresh"')
    expect(markup).not.toContain('data-icon="globe"')
  })

  it('highlights only the remote session matching the selected node and session', async () => {
    const module = await import('../src/workspace/RemoteSection.js') as unknown as {
      RemoteSessionItem?: (props: RemoteSessionItemProps) => ReactElement
    }
    expect(module.RemoteSessionItem).toBeDefined()
    if (module.RemoteSessionItem === undefined) return

    const session: MasterSession = {
      sessionId: 'session-1',
      title: 'selected remote session',
      updatedAt: 1000,
      running: false,
      blank: false,
    }
    const opened: string[][] = []
    const props: RemoteSessionItemProps = {
      nodeId: 'node-1',
      nodeName: 'my-desktop',
      session,
      selection: { nodeId: 'node-1', sessionId: 'session-1' },
      now: 1000,
      onOpenRemoteSession: (...values) => { opened.push(values) },
    }
    const selected = renderToStaticMarkup(createElement(module.RemoteSessionItem, props))
    const sameSessionIdOnAnotherNode = renderToStaticMarkup(createElement(module.RemoteSessionItem, {
      ...props,
      nodeId: 'node-2',
    }))

    expect(selected).toContain('aria-selected="true"')
    expect(selected).toContain(RowsCss.selected)
    expect(sameSessionIdOnAnotherNode).toContain('aria-selected="false"')
    expect(sameSessionIdOnAnotherNode).not.toContain(RowsCss.selected)

    const item = module.RemoteSessionItem(props)
    const onClick = item.props['onClick'] as (() => void) | undefined
    onClick?.()
    expect(opened).toEqual([['node-1', 'session-1', 'my-desktop', 'selected remote session']])
  })

  it('marks the group for flexible fill only while it is expanded', () => {
    const props: RemoteSectionProps = {
      t: key => key,
      expanded: true,
      onToggleGroup: () => {},
      expandedNodeId: undefined,
      onExpandedNodeChange: () => {},
      onOpenRemoteSession: () => {},
    }
    const expanded = renderToStaticMarkup(createElement(RemoteSection, props))
    const collapsed = renderToStaticMarkup(createElement(RemoteSection, { ...props, expanded: false }))

    expect(expanded).toContain(RemoteSectionCss.expanded)
    expect(collapsed).not.toContain(RemoteSectionCss.expanded)
  })
})
