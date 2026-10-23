import { describe, expect, it } from 'vitest'
import type { MasterNode, MasterSession } from '../src/protocol.js'
import { groupRemoteWorkspaces, nodeIsOffline, orderRemoteNodes, visibleRemoteSessions } from '../src/workspace/remote-model.js'

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
})
