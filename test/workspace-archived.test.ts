import { describe, expect, it } from 'vitest'
import { archivedRows, filterArchivedRows, installArchiveSet } from '../src/workspace/archived.js'

const UNGROUPED = '未分组'

const workspaces = [
  { workspaceId: 'ws-a', title: 'camera', sessionIds: ['s-1', 's-2'] },
  { workspaceId: 'ws-b', title: 'dsh-master', sessionIds: ['s-3'] },
]

const sessions = [
  { sessionId: 's-1', title: '老会话一', updatedAt: 100 },
  { sessionId: 's-2', title: '老会话二', updatedAt: 300 },
  { sessionId: 's-3', title: '老会话三', updatedAt: 200 },
  { sessionId: 's-live', title: '还在用', updatedAt: 400 },
]

describe('archived session projection', () => {
  it('lists only archived ids that still have a summary, newest first', () => {
    const rows = archivedRows(sessions, workspaces, ['s-1', 's-3', 's-2'], UNGROUPED)
    expect(rows.map(row => row.sessionId)).toEqual(['s-2', 's-3', 's-1'])
  })

  it('carries the owning workspace title and the ungrouped fallback', () => {
    const rows = archivedRows(sessions, workspaces, ['s-1', 's-3'], UNGROUPED)
    expect(rows.find(row => row.sessionId === 's-1')?.workspace).toBe('camera')
    // A session whose workspace registration was deleted keeps its archive entry.
    const orphan = archivedRows(sessions, [], ['s-3'], UNGROUPED)
    expect(orphan[0]?.workspace).toBe(UNGROUPED)
  })

  it('drops archived ids without a summary instead of rendering an unopenable row', () => {
    const rows = archivedRows(sessions, workspaces, ['s-1', 'deleted-transcript'], UNGROUPED)
    expect(rows.map(row => row.sessionId)).toEqual(['s-1'])
  })

  it('collapses duplicate ids and defaults running to false', () => {
    const rows = archivedRows(
      [...sessions, { sessionId: 's-1', title: '重复摘要', updatedAt: 999 }],
      workspaces,
      ['s-1', 's-1'],
      UNGROUPED,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ sessionId: 's-1', title: '老会话一', running: false })
  })

  it('keeps a running archived session marked so the row can show the dot', () => {
    const rows = archivedRows(
      [{ sessionId: 's-1', title: '跑着', updatedAt: 5, running: true }],
      workspaces,
      ['s-1'],
      UNGROUPED,
    )
    expect(rows[0]?.running).toBe(true)
  })

  it('is empty only when nothing is archived', () => {
    expect(archivedRows(sessions, workspaces, [], UNGROUPED)).toEqual([])
    // An archived session the registry no longer accounts to a workspace is
    // still listable: the archive set, not membership, decides what is shown.
    expect(archivedRows(sessions, workspaces, ['s-live'], UNGROUPED)[0]).toMatchObject({
      sessionId: 's-live',
      workspace: UNGROUPED,
    })
  })
})

describe('archived list filtering', () => {
  const rows = archivedRows(sessions, workspaces, ['s-1', 's-2', 's-3'], UNGROUPED)

  it('returns every row for a blank query', () => {
    expect(filterArchivedRows(rows, '   ')).toHaveLength(3)
  })

  it('matches title or workspace, case-insensitively', () => {
    expect(filterArchivedRows(rows, '老会话三').map(row => row.sessionId)).toEqual(['s-3'])
    expect(filterArchivedRows(rows, 'CAMERA').map(row => row.sessionId)).toEqual(['s-2', 's-1'])
    expect(filterArchivedRows(rows, 'nothing-here')).toEqual([])
  })
})

describe('archive-set installation', () => {
  it('replaces the cached set for the node that answered', () => {
    const data = { 'node-1': { archivedSessionIds: ['a'], sessions: [] } }
    const next = installArchiveSet(data, 'node-1', ['b'])
    expect(next['node-1']?.archivedSessionIds).toEqual(['b'])
    expect(data['node-1']?.archivedSessionIds).toEqual(['a'])
  })

  it('leaves the cache untouched for a node with no list yet', () => {
    const data = { 'node-1': { archivedSessionIds: ['a'], sessions: [] } }
    expect(installArchiveSet(data, 'node-2', ['b'])).toBe(data)
  })
})
