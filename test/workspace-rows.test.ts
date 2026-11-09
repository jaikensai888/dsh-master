import { describe, expect, it, vi } from 'vitest'

// The row module imports the shipped atom library at module scope; these tests only
// exercise its pure menu builders, so every component can resolve to a stub.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const react = await import('react')
  const icon = (name: string) => (props: { className?: string }) => react.createElement('i', { 'data-icon': name, className: props.className })
  const stub = (name: string) => () => react.createElement('div', { 'data-stub': name })
  return {
    HoverCard: stub('hover'),
    Menu: stub('menu'),
    StateDot: icon('state'),
    relativeTime: () => ({ unit: 'minutes', n: 1 }),
    IconAlarmClockOutlineRegular: icon('clock'),
    IconArchiveOutlineRegular: icon('archive'),
    IconBranchOutlineRegular: icon('branch'),
    IconEditOutlineRegular: icon('edit'),
    IconEllipsisOutlineRegular: icon('ellipsis'),
    IconFolderCloseRegular: icon('folder-closed'),
    IconFolderOpenRegular: icon('folder-open'),
    IconPlusOutlineRegular: icon('plus'),
    IconTrashOutlineRegular: icon('trash'),
    IconTriangleRightFillRegular: icon('triangle'),
  }
})

import { runSessionRowMenuAction, sessionRowMenuItems } from '../src/workspace/rows/Rows.js'

const t = (key: string): string => key === 'menu.follow' ? '关注' : key === 'menu.unfollow' ? '取消关注' : key

describe('the local session row menu', () => {
  it('keeps the upstream entries and appends follow when the browser offers it', () => {
    expect(sessionRowMenuItems(t, false, false).map(entry => entry.id)).toEqual(['rename', 'fork', 'archive'])
    const items = sessionRowMenuItems(t, false, true)
    expect(items.map(entry => entry.id)).toEqual(['rename', 'fork', 'archive', 'follow'])
    expect(items.at(-1)?.label).toBe('关注')
    expect(sessionRowMenuItems(t, true, true).at(-1)).toMatchObject({ id: 'unfollow', label: '取消关注' })
  })

  it('routes follow and unfollow to the follow toggle only', () => {
    const calls: string[] = []
    const actions = {
      onRename: (id: string, title: string) => { calls.push(`rename:${id}:${title}`) },
      onFork: (id: string) => { calls.push(`fork:${id}`) },
      onArchive: (id: string) => { calls.push(`archive:${id}`) },
      onFollowToggle: (id: string) => { calls.push(`follow:${id}`) },
    }
    runSessionRowMenuAction('follow', 's1', 'Deploy', actions)
    runSessionRowMenuAction('unfollow', 's1', 'Deploy', actions)
    runSessionRowMenuAction('archive', 's1', 'Deploy', actions)
    expect(calls).toEqual(['follow:s1', 'follow:s1', 'archive:s1'])
  })
})
