import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
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
    IconArchiveOutline20: icon('archive'),
    IconEllipsisOutline16: icon('ellipsis'),
    IconGlobeOutline14: icon('globe'),
    IconRefreshOutline14: icon('refresh'),
    Menu: () => null,
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
  menuOpen: boolean
  archiveAvailable: boolean
  onMenuOpenChange: (open: boolean) => void
  onOpenRemoteSession: (nodeId: string, sessionId: string, nodeName: string, sessionTitle: string) => void
  onArchiveRemoteSession: (nodeId: string, sessionId: string) => void
  t: (key: string, params?: Record<string, unknown>) => string
}

function findMenu(element: ReactNode): ReactElement<{
  items?: readonly { id: string; label: string }[]
  onSelect?: (id: string) => void
  anchor?: ReactElement<{ onClick?: (event: { stopPropagation(): void }) => void }>
}> | undefined {
  if (Array.isArray(element)) {
    for (const child of element) {
      const menu = findMenu(child)
      if (menu !== undefined) return menu
    }
    return undefined
  }
  if (!isValidElement(element)) return undefined
  const props = element.props as { items?: readonly { id: string; label: string }[]; children?: ReactNode }
  if (props.items !== undefined) return element as ReturnType<typeof findMenu>
  return findMenu(props.children)
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
      menuOpen: false,
      archiveAvailable: true,
      onMenuOpenChange: () => {},
      onOpenRemoteSession: (...values) => { opened.push(values) },
      onArchiveRemoteSession: () => {},
      t: key => key,
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

  it('offers archive in the remote session row menu and targets that session', async () => {
    const module = await import('../src/workspace/RemoteSection.js') as unknown as {
      RemoteSessionItem?: (props: RemoteSessionItemProps) => ReactElement
    }
    expect(module.RemoteSessionItem).toBeDefined()
    if (module.RemoteSessionItem === undefined) return

    const archived: string[][] = []
    const props: RemoteSessionItemProps = {
      nodeId: 'node-7',
      nodeName: 'office1',
      session: { sessionId: 'session-archive-me', title: '会话', updatedAt: 0, running: false, blank: false },
      selection: undefined,
      now: 1000,
      menuOpen: false,
      archiveAvailable: true,
      onMenuOpenChange: () => {},
      onOpenRemoteSession: () => {},
      onArchiveRemoteSession: (...values) => { archived.push(values) },
      t: key => key === 'menu.archiveSession' ? '归档会话' : key,
    }
    const menu = findMenu(module.RemoteSessionItem(props))

    expect(menu?.props.items?.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'archive', label: '归档会话' },
    ])
    menu?.props.onSelect?.('archive')
    expect(archived).toEqual([['node-7', 'session-archive-me']])
  })

  it('opens the local-style row menu without opening the conversation', async () => {
    const module = await import('../src/workspace/RemoteSection.js') as unknown as {
      RemoteSessionItem?: (props: RemoteSessionItemProps) => ReactElement
    }
    expect(module.RemoteSessionItem).toBeDefined()
    if (module.RemoteSessionItem === undefined) return

    let menuState: boolean | undefined
    let opened = false
    const menu = findMenu(module.RemoteSessionItem({
      nodeId: 'node-1',
      nodeName: 'desktop',
      session: { sessionId: 'session-1', title: '会话', updatedAt: 0, running: false, blank: false },
      selection: undefined,
      now: 0,
      menuOpen: false,
      archiveAvailable: true,
      onMenuOpenChange: value => { menuState = value },
      onOpenRemoteSession: () => { opened = true },
      onArchiveRemoteSession: () => {},
      t: key => key,
    }))
    let stopped = false

    menu?.props.anchor?.props.onClick?.({ stopPropagation: () => { stopped = true } })

    expect(menuState).toBe(true)
    expect(stopped).toBe(true)
    expect(opened).toBe(false)
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
