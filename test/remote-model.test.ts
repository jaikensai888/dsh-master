import { describe, expect, it } from 'vitest'
import type { MasterNode, MasterSession, MasterSessionsValue, MasterWorkspace } from '../src/protocol.js'
import {
  groupRemoteWorkspaces,
  nodeIsOffline,
  orderRemoteNodes,
  pollableNodeIds,
  replaceSessionTitle,
  reusableBlankSession,
  visibleRemoteSessions,
} from '../src/workspace/remote-model.js'

const node = (nodeId: string, state: string, revoked = false): MasterNode => ({ nodeId, state, revoked })

const session = (sessionId: string, blank = false): MasterSession => ({
  sessionId,
  title: sessionId,
  updatedAt: 1,
  running: false,
  blank,
})

describe('remote workspace row model', () => {
  it('uses registry membership instead of cwd, keeps empty directories and collects unassigned sessions', () => {
    const workspaces = [
      { workspaceId: 'w1', title: 'Renamed', path: '/repo', sessionIds: ['s1', 'missing'] },
      { workspaceId: 'w2', title: 'Empty', path: '/empty', sessionIds: [] },
    ]
    const rows = [{ ...session('s1'), cwd: '/elsewhere' }, { ...session('loose'), cwd: '/repo' },
      session('blank', true), session('archived')]
    expect(groupRemoteWorkspaces(workspaces, rows, ['archived'])).toEqual([
      { workspace: workspaces[0], sessions: [rows[0]] },
      { workspace: workspaces[1], sessions: [] },
      { workspace: undefined, sessions: [rows[1]] },
    ])
    expect(groupRemoteWorkspaces([], [session('blank', true), session('archived')], ['archived'])).toEqual([])
  })

  it('keeps per-directory overflow independent, even with identical names and paths', () => {
    const rows = Array.from({ length: 8 }, (_, i) => session(`s${i}`))
    const groups = groupRemoteWorkspaces([
      { workspaceId: 'a', title: 'repo', path: '/repo', sessionIds: rows.slice(0, 7).map(row => row.sessionId) },
      { workspaceId: 'b', title: 'repo', path: '/repo', sessionIds: ['s7'] },
    ], rows)
    expect(groups.map(group => visibleRemoteSessions(group.sessions, false).hiddenCount)).toEqual([2, 0])
  })
  it('puts ready nodes first without changing order inside either group', () => {
    const ordered = orderRemoteNodes([
      node('connecting-first', 'connecting'),
      node('ready-first', 'ready'),
      node('offline', 'offline'),
      node('ready-second', 'ready'),
      node('revoked', 'ready', true),
    ])

    expect(ordered.map(item => item.nodeId)).toEqual([
      'ready-first', 'ready-second', 'connecting-first', 'offline', 'revoked',
    ])
  })

  it('disables only offline or revoked node rows', () => {
    expect(nodeIsOffline(node('online', 'ready'))).toBe(false)
    expect(nodeIsOffline(node('closing', 'closing'))).toBe(false)
    expect(nodeIsOffline(node('offline', 'offline'))).toBe(true)
    expect(nodeIsOffline(node('revoked', 'ready', true))).toBe(true)
  })

  it('hides blank sessions and shows five until the remaining rows are expanded', () => {
    const rows = [
      session('s1'), session('blank', true), session('s2'), session('s3'),
      session('s4'), session('s5'), session('s6'),
    ]

    expect(visibleRemoteSessions(rows, false)).toEqual({
      sessions: [session('s1'), session('s2'), session('s3'), session('s4'), session('s5')],
      hiddenCount: 1,
    })
    expect(visibleRemoteSessions(rows, true)).toEqual({
      sessions: [session('s1'), session('s2'), session('s3'), session('s4'), session('s5'), session('s6')],
      hiddenCount: 0,
    })
  })

  it('keeps archived sessions hidden while calculating the five-row overflow', () => {
    const rows = [session('archived'), session('s1'), session('s2'), session('s3'), session('s4'), session('s5'), session('s6')]

    expect(visibleRemoteSessions(rows, false, ['archived', 's1'])).toEqual({
      sessions: [session('s2'), session('s3'), session('s4'), session('s5'), session('s6')],
      hiddenCount: 0,
    })
  })

  it('keeps the selected blank visible without charging it against the five-row limit', () => {
    const rows = [
      session('s1'), session('s2'), session('blank', true), session('s3'),
      session('s4'), session('s5'), session('s6'),
    ]

    expect(visibleRemoteSessions(rows, false, [], 'blank')).toEqual({
      sessions: [session('s1'), session('s2'), session('blank', true), session('s3'), session('s4'), session('s5')],
      hiddenCount: 1,
    })
    // A different blank stays hidden; only the selected provisional row is special.
    expect(visibleRemoteSessions(rows, false, [], 'other')).toEqual({
      sessions: [session('s1'), session('s2'), session('s3'), session('s4'), session('s5')],
      hiddenCount: 1,
    })
  })

  it('keeps an empty registered workspace with its selected blank session', () => {
    const workspace: MasterWorkspace = { workspaceId: 'w1', title: 'repo', path: '/repo', sessionIds: ['blank'] }
    const groups = groupRemoteWorkspaces([workspace], [session('blank', true)], [], 'blank')
    expect(groups).toEqual([{ workspace, sessions: [session('blank', true)] }])
  })

  it('reuses only an unarchived blank that belongs to the same workspace', () => {
    const workspace: MasterWorkspace = { workspaceId: 'w1', title: 'repo', path: '/repo', sessionIds: ['b1', 'b2', 'b3'] }
    const rows: MasterSession[] = [
      { ...session('b1', true), cwd: '/repo' },
      { ...session('b2', true), cwd: '/other' },
      session('b3', true),
    ]

    expect(reusableBlankSession(rows, [], workspace)).toBe('b1')
    expect(reusableBlankSession(rows, ['b1'], workspace)).toBe('b3')
    expect(reusableBlankSession(rows, ['b1', 'b3'], { ...workspace, sessionIds: ['b2'] })).toBeUndefined()
  })
})

describe('remote session rename model', () => {  const data: Record<string, MasterSessionsValue> = {
    'node-1': {
      nodeId: 'node-1',
      sessions: [session('s1'), session('s2')],
      workspaces: [{ workspaceId: 'w1', title: 'repo', path: '/repo', sessionIds: ['s1', 's2'] }],
      archivedSessionIds: ['archived'],
    },
    'node-2': {
      nodeId: 'node-2',
      sessions: [session('s1')],
      workspaces: [],
      archivedSessionIds: [],
    },
  }

  it('retitles only the renamed row and keeps membership, order and archive state', () => {
    const next = replaceSessionTitle(data, 'node-1', 's1', '新的标题')
    expect(next['node-1']?.sessions.map(row => row.title)).toEqual(['新的标题', 's2'])
    expect(next['node-1']?.sessions.map(row => row.sessionId)).toEqual(['s1', 's2'])
    expect(next['node-1']?.workspaces).toEqual(data['node-1']?.workspaces)
    expect(next['node-1']?.archivedSessionIds).toEqual(['archived'])
    // Another node with the same session id is untouched.
    expect(next['node-2']).toBe(data['node-2'])
    // The input cache is not mutated.
    expect(data['node-1']?.sessions[0]?.title).toBe('s1')
  })

  it('leaves the cache unchanged when the node, row or title is already settled', () => {
    expect(replaceSessionTitle(data, 'missing-node', 's1', 'x')).toBe(data)
    expect(replaceSessionTitle(data, 'node-1', 'unknown', 'x')).toBe(data)
    expect(replaceSessionTitle(data, 'node-1', 's1', 's1')).toBe(data)
  })
})

describe('status poll targets', () => {
  const loaded: MasterSessionsValue = {
    nodeId: 'loaded', sessions: [], workspaces: [], archivedSessionIds: [],
  }

  it('only refreshes ready nodes whose first list has landed, in candidate order', () => {
    expect(pollableNodeIds(
      [
        node('first', 'ready'),
        node('connecting', 'connecting'),
        node('unloaded', 'ready'),
        node('offline', 'offline'),
        node('revoked', 'ready', true),
        node('second', 'ready'),
      ],
      { first: loaded, connecting: loaded, offline: loaded, revoked: loaded, second: loaded },
    )).toEqual(['first', 'second'])
  })

  it('skips every node before the first list arrives', () => {
    expect(pollableNodeIds([node('fresh', 'ready')], {})).toEqual([])
  })
})
