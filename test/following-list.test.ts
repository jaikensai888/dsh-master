import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { FollowingRow } from '../src/workspace/following.js'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const react = await import('react')
  const icon = (name: string) => (props: { className?: string }) => react.createElement('i', { 'data-icon': name, className: props.className })
  return {
    Button: (props: { icon?: ReactNode; disabled?: boolean; 'aria-label'?: string; title?: string; onClick?: () => void }) =>
      react.createElement('button', {
        'aria-label': props['aria-label'], title: props.title, disabled: props.disabled, onClick: props.onClick,
      }, props.icon),
    IconEllipsisOutlineRegular: icon('ellipsis'),
    IconRefreshOutlineRegular: icon('refresh'),
    Menu: () => null,
  }
})

import { FollowingList, FollowingRowItem } from '../src/workspace/FollowingList.js'
import { RemoteSectionCss } from '../src/workspace/styles.generated.js'

const t = (key: string, params?: Record<string, unknown>): string => {
  const labels: Record<string, string> = {
    'following.title': '关注',
    'following.refresh': '刷新关注',
    'following.empty': '在会话的 ··· 菜单中选择关注',
    'following.noMatches': '没有匹配的关注',
    'following.actions.aria': '关注“{name}”的操作',
    'following.offline': '离线',
    'following.archived': '已归档',
    'menu.unfollow': '取消关注',
  }
  return (labels[key] ?? key).replace('{name}', String(params?.['name'] ?? ''))
}

const row = (overrides: Partial<FollowingRow> = {}): FollowingRow => ({
  key: 'local:s1',
  target: { source: 'local', sessionId: 's1' },
  followedAt: 1,
  title: 'Deploy pipeline',
  machine: '本地',
  workspace: 'infra',
  status: 'ok',
  fresh: true,
  ...overrides,
})

function renderList(rows: readonly FollowingRow[], total = rows.length, query = ''): string {
  return renderToStaticMarkup(createElement(FollowingList, {
    rows,
    total,
    query,
    selectedKey: undefined,
    busy: false,
    error: undefined,
    t,
    onOpen: () => undefined,
    onUnfollow: () => undefined,
    onRefresh: () => undefined,
  }))
}

describe('the follow list', () => {
  it('explains how to follow when there is no record, and separates a filtered-empty list', () => {
    expect(renderList([])).toContain('在会话的 ··· 菜单中选择关注')
    const filtered = renderList([], 3, 'nothing')
    expect(filtered).toContain('没有匹配的关注')
    expect(filtered).not.toContain('在会话的 ··· 菜单中选择关注')
  })

  it('renders title, machine, workspace and the selected state', () => {
    const markup = renderToStaticMarkup(createElement(FollowingList, {
      rows: [row()],
      total: 1,
      query: '',
      selectedKey: 'local:s1',
      busy: false,
      error: undefined,
      t,
      onOpen: () => undefined,
      onUnfollow: () => undefined,
      onRefresh: () => undefined,
    }))
    expect(markup).toContain('Deploy pipeline')
    expect(markup).toContain('本地')
    expect(markup).toContain('infra')
    expect(markup).toContain('aria-selected="true"')
  })

  it('opens only rows whose source is currently usable', () => {
    const opened: string[] = []
    const offline = FollowingRowItem({
      row: row({ status: 'offline' }),
      selected: false,
      menuOpen: false,
      onMenuOpenChange: () => undefined,
      t,
      onOpen: value => { opened.push(value.key) },
      onUnfollow: () => undefined,
    })
    expect(renderToStaticMarkup(offline)).toContain('离线')
    ;(offline.props as { onClick: () => void }).onClick()
    expect(opened).toEqual([])

    const ok = FollowingRowItem({
      row: row(),
      selected: false,
      menuOpen: false,
      onMenuOpenChange: () => undefined,
      t,
      onOpen: value => { opened.push(value.key) },
      onUnfollow: () => undefined,
    })
    ;(ok.props as { onClick: () => void }).onClick()
    expect(opened).toEqual(['local:s1'])
  })

  it('offers unfollow from the row menu and reports its key', () => {
    const unfollowed: string[] = []
    const item = FollowingRowItem({
      row: row(),
      selected: false,
      menuOpen: false,
      onMenuOpenChange: () => undefined,
      t,
      onOpen: () => undefined,
      onUnfollow: key => { unfollowed.push(key) },
    })
    const menu = findMenu(item)
    expect(menu?.props.items?.map(entry => ({ id: entry.id, label: entry.label }))).toEqual([
      { id: 'unfollow', label: '取消关注' },
    ])
    menu?.props.onSelect?.('unfollow')
    expect(unfollowed).toEqual(['local:s1'])
  })

  it('carries the follow row and its actions class so the menu can be revealed', () => {
    // `RowsCss.rowActions` stays `display:none` here: its reveal rules only target the
    // local/remote session rows. The follow row must ask for its own class, and an open
    // menu must carry the state class that keeps the trigger visible.
    const closed = FollowingRowItem({
      row: row(),
      selected: false,
      menuOpen: false,
      onMenuOpenChange: () => undefined,
      t,
      onOpen: () => undefined,
      onUnfollow: () => undefined,
    })
    const closedMarkup = renderToStaticMarkup(closed)
    expect(closedMarkup).toContain(RemoteSectionCss.followingRow)
    expect(closedMarkup).toContain(RemoteSectionCss.followingActions)
    expect(closedMarkup).not.toContain(RemoteSectionCss.followingRowOpen)

    const open = renderToStaticMarkup(FollowingRowItem({
      row: row(),
      selected: false,
      menuOpen: true,
      onMenuOpenChange: () => undefined,
      t,
      onOpen: () => undefined,
      onUnfollow: () => undefined,
    }))
    expect(open).toContain(RemoteSectionCss.followingRowOpen)
  })
})

function findMenu(element: ReactNode): ReactElement<{
  items?: readonly { id: string; label?: string }[]
  onSelect?: (id: string) => void
}> | undefined {
  if (Array.isArray(element)) {
    for (const child of element) {
      const found = findMenu(child)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (!isValidElement(element)) return undefined
  const props = element.props as { items?: readonly { id: string; label?: string }[]; children?: ReactNode }
  if (props.items !== undefined) return element as ReturnType<typeof findMenu>
  return findMenu(props.children)
}
