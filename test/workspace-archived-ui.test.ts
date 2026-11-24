import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const react = await import('react')
  const icon = (name: string) => (props: { className?: string }) => react.createElement('i', { 'data-icon': name, className: props.className })
  return {
    Button: (props: { icon?: ReactNode; disabled?: boolean; onClick?: () => void; children?: ReactNode; 'aria-label'?: string; title?: string }) => react.createElement('button', {
      'aria-label': props['aria-label'],
      title: props.title,
      disabled: props.disabled,
      onClick: props.onClick,
    }, props.icon, props.children),
    Menu: (props: { items?: readonly { id: string; label?: string; disabled?: boolean }[]; onSelect?: (id: string) => void }) => (
      react.createElement('div', {
        'data-menu-items': (props.items ?? []).map(item => `${item.id}${item.disabled === true ? ':disabled' : ''}`).join(','),
        'data-menu-select': props.onSelect,
      })
    ),
    Modal: (props: { open?: boolean; title?: string; description?: string; footer?: ReactNode; children?: ReactNode }) => (
      props.open === true
        ? react.createElement('div', { 'data-modal': props.title, 'data-description': props.description }, props.footer, props.children)
        : null
    ),
    StateDot: icon('state'),
    relativeTime: () => ({ unit: 'minutes', n: 5 }),
    IconArchiveOutlineRegular: icon('archive'),
    IconCloseFillRegular: icon('close'),
    IconEllipsisOutlineRegular: icon('ellipsis'),
    IconRefreshOutlineRegular: icon('refresh'),
  }
})

import { ArchivedList, ArchivedRowItem, type ArchivedListProps } from '../src/workspace/ArchivedList.js'
import { AddWorkspaceDialog } from '../src/workspace/AddWorkspaceDialog.js'

const translations: Record<string, string> = {
  'archived.title': '已归档',
  'archived.entry': '查看已归档会话',
  'archived.refresh': '刷新已归档会话',
  'archived.close': '返回会话列表',
  'archived.empty': '暂无已归档会话',
  'archived.loading': '正在读取已归档会话…',
  'archived.unarchiveFailed': '取消归档失败',
  'archived.unarchiveUnsupported': '此宿主不支持取消归档',
  'menu.unarchiveSession': '取消归档',
  'sessions.count.other': '{n} 个会话',
  'status.running': '进行中',
  'session.new': '新会话',
  'time.now': '刚刚',
  'time.minutes': '{n}分钟',
  'time.ago': '{t}前',
  'actions.session.aria': '会话“{name}”的操作',
  'addWorkspace.title': '添加工作区',
  'addWorkspace.desc': '登记 {target} 上已有的目录。',
  'addWorkspace.label': '目录路径',
  'addWorkspace.placeholder': '例如 D:\\projects\\my-app',
  'addWorkspace.hint': '{target} 会校验目录是否存在。',
  'addWorkspace.submit': '添加',
  'addWorkspace.pending': '正在添加…',
  'addWorkspace.failed': '添加工作区失败',
  'addWorkspace.browse': '浏览…',
  'addWorkspace.opening': '打开中…',
  'cancel': '取消',
  'close': '关闭',
}

function t(key: string, params?: Record<string, unknown>): string {
  return (translations[key] ?? key).replace(/\{(\w+)\}/gu, (_match, name: string) => String(params?.[name] ?? ''))
}

const rows = [
  { sessionId: 's-2', title: '归档的任务', workspace: 'camera', updatedAt: 200, running: false },
  { sessionId: 's-1', title: '另一个归档', workspace: '未分组', updatedAt: 100, running: true },
]

function renderList(overrides: Partial<ArchivedListProps> = {}): string {
  return renderToStaticMarkup(createElement(ArchivedList, {
    rows,
    now: 400_000,
    t,
    onOpen: () => undefined,
    onUnarchive: () => undefined,
    ...overrides,
  }))
}

/** Every menu element in the tree, in document order, with the props it was given. */
function menus(element: ReactNode): ReactElement<{
  items?: readonly { id: string; disabled?: boolean }[]
  onSelect?: (id: string) => void
}>[] {
  if (Array.isArray(element)) return element.flatMap(menus)
  if (!isValidElement(element)) return []
  const props = element.props as { items?: readonly { id: string; disabled?: boolean }[]; children?: ReactNode }
  const nested = props.items !== undefined ? [element as ReturnType<typeof menus>[number]] : []
  return [...nested, ...menus(props.children)]
}

describe('the archived session list', () => {
  it('renders each row with its title, workspace and update time', () => {
    const markup = renderList()
    expect(markup).toContain('归档的任务')
    expect(markup).toContain('camera')
    expect(markup).toContain('5分钟')
    expect(markup).toContain('2 个会话')
  })

  it('offers unarchive in every row menu and targets the row it came from', () => {
    const unarchive = vi.fn()
    const element = ArchivedRowItem({
      row: rows[0]!, now: 400_000, selected: false, menuOpen: false, pending: false,
      unarchiveAvailable: true, nonInteractive: false, t,
      onOpen: () => undefined, onUnarchive: unarchive, onMenuOpenChange: () => undefined,
    })
    const found = menus(element)
    expect(found).toHaveLength(1)
    expect(found[0]?.props.items?.map(item => item.id)).toEqual(['unarchive'])
    found[0]?.props.onSelect?.('unarchive')
    expect(unarchive).toHaveBeenCalledWith('s-2')
    // Every row carries the same single entry, so the list has one per row.
    expect(renderList().match(/data-menu-items="unarchive"/gu)).toHaveLength(2)
  })

  it('disables the menu entry while that row is being restored', () => {
    const pendingElement = ArchivedRowItem({
      row: rows[0]!, now: 400_000, selected: false, menuOpen: false, pending: true,
      unarchiveAvailable: true, nonInteractive: false, t,
      onOpen: () => undefined, onUnarchive: () => undefined, onMenuOpenChange: () => undefined,
    })
    expect(menus(pendingElement)[0]?.props.items?.[0]?.disabled).toBe(true)
    const idleElement = ArchivedRowItem({
      row: rows[0]!, now: 400_000, selected: false, menuOpen: false, pending: false,
      unarchiveAvailable: true, nonInteractive: false, t,
      onOpen: () => undefined, onUnarchive: () => undefined, onMenuOpenChange: () => undefined,
    })
    expect(menus(idleElement)[0]?.props.items?.[0]?.disabled).toBe(false)
  })

  it('disables the menu entry and explains the capability when the host cannot unarchive', () => {
    const markup = renderList({ unsupported: '此节点不支持取消归档', onClose: () => undefined })
    expect(markup).toContain('此节点不支持取消归档')
    expect(markup).toContain('data-menu-items="unarchive:disabled"')
  })

  it('shows the empty and loading copy instead of rows', () => {
    expect(renderList({ rows: [] })).toContain('暂无已归档会话')
    expect(renderList({ rows: [], loading: true })).toContain('正在读取已归档会话…')
  })

  it('reports a load failure and the concrete unarchive failure', () => {
    const markup = renderList({
      rows: [],
      error: 'coordinator/node-offline: 节点离线',
      actionError: { sessionId: 's-2', message: '取消归档失败 · workspace/not-archived' },
    })
    expect(markup).toContain('coordinator/node-offline')
    expect(markup).toContain('取消归档失败 · workspace/not-archived')
  })

  it('keeps rows visible but inert while the snapshot is stale', () => {
    const markup = renderList({ nonInteractive: true })
    expect(markup).toContain('归档的任务')
    expect(markup).toContain('aria-disabled="true"')
  })

  it('exposes close and refresh controls only when the owner wires them', () => {
    expect(renderList()).not.toContain('aria-label="返回会话列表"')
    const markup = renderList({ onClose: () => undefined, onRefresh: () => undefined })
    expect(markup).toContain('aria-label="返回会话列表"')
    expect(markup).toContain('aria-label="刷新已归档会话"')
  })
})

describe('the add-workspace path dialog', () => {
  it('stays closed until asked for', () => {
    const markup = renderToStaticMarkup(createElement(AddWorkspaceDialog, {
      open: false, target: '本机', busy: false, error: undefined, t,
      onSubmit: () => undefined, onClose: () => undefined,
    }))
    expect(markup).toBe('')
  })

  it('names the target host and explains that the host validates the path', () => {
    const markup = renderToStaticMarkup(createElement(AddWorkspaceDialog, {
      open: true, target: 'office1', busy: false, error: undefined, t,
      onSubmit: () => undefined, onClose: () => undefined,
    }))
    expect(markup).toContain('data-modal="添加工作区"')
    expect(markup).toContain('登记 office1 上已有的目录。')
    expect(markup).toContain('office1 会校验目录是否存在。')
    expect(markup).toContain('id="dsh-master-add-workspace-path"')
  })

  it('shows the create failure next to the field and disables submit while busy', () => {
    const markup = renderToStaticMarkup(createElement(AddWorkspaceDialog, {
      open: true, target: '本机', busy: true, error: '添加工作区失败 · workspace/not-found', t,
      onSubmit: () => undefined, onClose: () => undefined,
    }))
    expect(markup).toContain('添加工作区失败 · workspace/not-found')
    expect(markup).toContain('正在添加…')
    expect(markup).toContain('disabled=""')
  })

  it('offers a browse button only where this machine resolves the path', () => {
    const local = renderToStaticMarkup(createElement(AddWorkspaceDialog, {
      open: true, target: '本机', busy: false, error: undefined, t,
      onSubmit: () => undefined, onClose: () => undefined,
      pickDirectory: () => Promise.resolve(null),
    }))
    expect(local).toContain('浏览…')
    // A remote node's directories are not reachable through this machine's
    // chooser, so the typed path stays the only route there.
    const remote = renderToStaticMarkup(createElement(AddWorkspaceDialog, {
      open: true, target: 'office1', busy: false, error: undefined, t,
      onSubmit: () => undefined, onClose: () => undefined,
    }))
    expect(remote).not.toContain('浏览…')
  })
})
