import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { MasterSession } from '../src/protocol.js'
import type { RemoteSessionSelection } from '../src/client/selection.js'
import { RowsCss, RemoteSectionCss } from '../src/workspace/styles.generated.js'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const react = await import('react')
  const icon = (name: string) => (props: { className?: string }) => react.createElement('i', { 'data-icon': name, className: props.className })
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
    IconChevronDownOutlineRegular: icon('chevron-down'),
    IconChevronRightOutlineRegular: icon('chevron-right'),
    IconFolderCloseRegular: icon('folder-closed'),
    IconFolderOpenRegular: icon('folder-open'),
    IconTriangleRightFillRegular: icon('triangle'),
    IconArchiveOutlineRegular: icon('archive'),
    IconEllipsisOutlineRegular: icon('ellipsis'),
    IconGlobeOutlineRegular: icon('globe'),
    IconRefreshOutlineRegular: icon('refresh'),
    Menu: () => null,
    StateDot: icon('state'),
  }
})

import { RemoteSection, RemoteNodeSection, RemoteSessionItem, type RemoteNodeSectionProps } from '../src/workspace/RemoteSection.js'
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

describe('the remote workspace sidebar', () => {
  it('labels stale snapshots and blocks opening their session rows', () => {
    const opened = vi.fn()
    const props = {
      node: { nodeId: 'a', state: 'ready' }, expanded: true, compact: true, unavailable: true,
      busy: false, loading: false, error: 'coordinator offline', selection: undefined, now: 0,
      workspaceExpansion: {}, overflow: [], openSessionMenu: undefined,
      data: { nodeId: 'a', sessions: [{sessionId:'s',title:'stale session',running:false,blank:false,updatedAt:0}], workspaces: [], archivedSessionIds: [] },
      t: (key: string) => key, onToggleNode: () => {}, onRefresh: () => {}, onWorkspaceExpandedChange: () => {},
      onToggleOverflow: () => {}, onSessionMenuChange: () => {}, onOpenRemoteSession: opened, onArchiveRemoteSession: () => {},
    }
    const element = RemoteNodeSection(props)
    expect(renderToStaticMarkup(element)).toContain('browse.stale')
    function findRow(n: ReactNode): ReactElement<RemoteSessionItemProps> | undefined {
      if (Array.isArray(n)) return n.map(findRow).find(Boolean)
      if (!isValidElement(n)) return
      if (n.type === RemoteSessionItem) return n as ReactElement<RemoteSessionItemProps>
      return findRow((n.props as {children?:ReactNode}).children)
    }
    const row = findRow(element)!
    row.props.onOpenRemoteSession('a','s','a','stale session')
    expect(opened).not.toHaveBeenCalled()
  })
  it('keeps the remote owner renderless when browsing local without a chooser mount', () => {
    const markup = renderToStaticMarkup(createElement(RemoteSection, {
      t: (key: string) => key, defaultNodeExpanded: true, nodeExpansion: {}, workspaceExpansion: {},
      onNodeExpandedChange: () => {}, onWorkspaceExpandedChange: () => {}, onOpenRemoteSession: () => {},
      browseScope: { kind: 'local' }, onBrowseScopeChange: () => {},
    }))
    expect(markup).toBe('')
  })
  it('offers refresh before the node roster loads', () => {
    const props: RemoteSectionProps = {
      t: key => key === 'remote.group' ? '远程工作区' : key,
      defaultNodeExpanded: true,
      nodeExpansion: {},
      workspaceExpansion: {},
      onNodeExpandedChange: () => {},
      onWorkspaceExpandedChange: () => {},
      onOpenRemoteSession: () => {},
    }
    const markup = renderToStaticMarkup(createElement(RemoteSection, props))

    expect(markup).toContain('远程工作区')
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

  it('marks each node for flexible fill only while it is expanded', () => {
    const props = nodeProps()
    const expanded = renderToStaticMarkup(createElement(RemoteNodeSection, props))
    const collapsed = renderToStaticMarkup(createElement(RemoteNodeSection, { ...props, expanded: false }))

    expect(expanded).toContain(RemoteSectionCss.expanded)
    expect(collapsed).not.toContain(RemoteSectionCss.expanded)
  })
})

function nodeProps(): RemoteNodeSectionProps {
  return {
    node: { nodeId: 'node-a', nodeName: 'Office', state: 'ready' },
    expanded: true, busy: false, loading: false, error: undefined,
    data: {
      nodeId: 'node-a', archivedSessionIds: [],
      workspaces: [
        { workspaceId: 'same', title: 'Actual name', path: '/repo', sessionIds: ['s1'] },
        { workspaceId: 'empty', title: 'Empty directory', path: '/empty', sessionIds: [] },
      ],
      sessions: [
        { sessionId: 's1', title: 'Assigned', cwd: '/other', updatedAt: 0, running: false, blank: false },
        { sessionId: 'loose', title: 'Unassigned', cwd: '/repo', updatedAt: 0, running: false, blank: false },
      ],
    },
    selection: undefined, now: 0, workspaceExpansion: {}, overflow: [], openSessionMenu: undefined,
    onToggleNode: () => {}, onRefresh: () => {}, onToggleOverflow: () => {},
    onWorkspaceExpandedChange: () => {}, onSessionMenuChange: () => {},
    onOpenRemoteSession: () => {}, onArchiveRemoteSession: () => {},
    t: key => key,
  }
}

describe('per-node remote workspace hierarchy', () => {
  it('uses the local folder-to-triangle hover affordance for expanded and collapsed directories', () => {
    const props = nodeProps()
    props.workspaceExpansion = { '["node-a","same"]': false }
    const markup = renderToStaticMarkup(createElement(RemoteNodeSection, props))
    expect(markup).toContain(`class="${RowsCss.slot} ${RowsCss.folder}"`)
    expect(markup).toContain(`class="${RowsCss.slot} ${RowsCss.chevron}"`)
    expect(markup).toContain('data-icon="folder-closed"')
    expect(markup).toContain('data-icon="folder-open"')
    expect(markup).toContain(`data-icon="triangle" class="${RowsCss.arrow}"`)
    expect(markup).toContain(`data-icon="triangle" class="${RowsCss.arrow} ${RowsCss.arrowOpen}"`)
    expect(markup).not.toContain('data-icon="chevron-right"')
    expect(markup).not.toContain('data-icon="chevron-down"')
  })
  it('renders the node header above registered directories, empty directories and Ungrouped', () => {
    const markup = renderToStaticMarkup(createElement(RemoteNodeSection, nodeProps()))
    expect(markup).toContain('data-dsh-remote-node="node-a"')
    expect(markup).toContain('title="/repo"')
    expect(markup).toContain('Actual name')
    expect(markup).toContain('Empty directory')
    expect(markup).toContain('Assigned')
    expect(markup).toContain('group.ungrouped')
    expect(markup).toContain('Unassigned')
    expect(markup).not.toContain('remote.group')
  })

  it('collapses one directory using both node and workspace identity', () => {
    const props = nodeProps()
    props.workspaceExpansion = { '["node-a","same"]': false }
    const collapsed = renderToStaticMarkup(createElement(RemoteNodeSection, props))
    const anotherNode = renderToStaticMarkup(createElement(RemoteNodeSection, {
      ...props, node: { nodeId: 'node-b', state: 'ready' },
    }))
    expect(collapsed).not.toContain('>Assigned<')
    expect(collapsed).toContain('Unassigned')
    expect(anotherNode).toContain('>Assigned<')
  })

  it('shows registry errors and still exposes unassigned sessions', () => {
    const props = nodeProps()
    const markup = renderToStaticMarkup(createElement(RemoteNodeSection, {
      ...props,
      data: { ...props.data!, workspaces: [], workspaceError: { code: 'coordinator/endpoint-not-found', message: 'upgrade node' } },
    }))
    expect(markup).toContain('remote.workspacesUnavailable')
    expect(markup).toContain('upgrade node')
    expect(markup).toContain('Assigned')
    expect(markup).toContain('Unassigned')
  })
})
