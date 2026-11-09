import { describe, expect, it } from 'vitest'
import type { MasterNode, MasterSessionsValue } from '../src/protocol.js'
import {
  FOLLOWING_NODE_CONCURRENCY,
  filterFollowingRows,
  followKey,
  followingNodes,
  followingRows,
  followingSelectionKey,
  followingSummaryUpdates,
  mapWithConcurrency,
  orderFollowRecords,
  type FollowingLocalSnapshot,
  type FollowingRemoteSnapshot,
  type FollowingRow,
  type FollowRecord,
} from '../src/workspace/following.js'

const labels = { localMachine: '本地', ungrouped: '未分组', newSession: '新会话' }

const localRecord = (sessionId: string, followedAt: number, title = `local ${sessionId}`): FollowRecord => ({
  target: { source: 'local', sessionId },
  followedAt,
  title,
  machine: '本地',
  workspace: 'local repo',
})

const remoteRecord = (
  coordinatorUrl: string,
  nodeId: string,
  sessionId: string,
  followedAt: number,
  title = `remote ${sessionId}`,
): FollowRecord => ({
  target: { source: 'remote', coordinatorUrl, nodeId, sessionId },
  followedAt,
  title,
  machine: 'old machine',
  workspace: 'old repo',
})

const localSnapshot = (overrides: Partial<FollowingLocalSnapshot> = {}): FollowingLocalSnapshot => ({
  phase: 'ready',
  byId: {
    s1: {
      id: 's1', displayTitle: 'Local title', blank: false, running: false, updatedAt: 1,
    },
    blank: {
      id: 'blank', displayTitle: '', blank: true, running: false, updatedAt: 2,
    },
  },
  workspaces: [
    { workspaceId: 'w1', title: 'Local repo', path: 'C:/repo', createdAt: '2026-01-01', sessionIds: ['s1'] },
  ],
  archivedSessionIds: [],
  ...overrides,
})

const node = (nodeId: string, state = 'ready'): MasterNode => ({ nodeId, nodeName: `Machine ${nodeId}`, state })

const sessionsValue = (overrides: Partial<MasterSessionsValue> = {}): MasterSessionsValue => ({
  nodeId: 'node-a',
  sessions: [
    { sessionId: 'r1', title: 'Remote title', updatedAt: 1, running: false, blank: false },
  ],
  workspaces: [
    { workspaceId: 'rw', title: 'Remote repo', path: '/repo', sessionIds: ['r1'] },
  ],
  archivedSessionIds: [],
  ...overrides,
})

const remoteSnapshot = (overrides: Partial<FollowingRemoteSnapshot> = {}): FollowingRemoteSnapshot => ({
  coordinator: { url: 'http://a', reachable: true },
  nodes: [node('node-a'), node('node-b')],
  data: { 'node-a': sessionsValue() },
  loading: {},
  errors: {},
  verifying: false,
  verificationFailed: false,
  ...overrides,
})

const one = <T>(rows: readonly T[]): T => {
  expect(rows).toHaveLength(1)
  return rows[0] as T
}

describe('follow identity', () => {
  it('keeps local, node and Coordinator identities distinct', () => {
    expect(followKey({ source: 'local', sessionId: 'same' }))
      .not.toBe(followKey({ source: 'remote', coordinatorUrl: 'http://a', nodeId: 'n', sessionId: 'same' }))
    expect(followKey({ source: 'remote', coordinatorUrl: 'http://a', nodeId: 'n1', sessionId: 'same' }))
      .not.toBe(followKey({ source: 'remote', coordinatorUrl: 'http://a', nodeId: 'n2', sessionId: 'same' }))
    expect(followKey({ source: 'remote', coordinatorUrl: 'http://a', nodeId: 'n', sessionId: 'same' }))
      .not.toBe(followKey({ source: 'remote', coordinatorUrl: 'http://b', nodeId: 'n', sessionId: 'same' }))
  })

  it('orders by follow time descending and keeps equal times in stored order', () => {
    const ordered = orderFollowRecords([
      localRecord('first', 1),
      localRecord('second', 5),
      localRecord('third', 5),
      localRecord('fourth', 2),
    ])
    expect(ordered.map(record => record.target.sessionId)).toEqual([
      'second', 'third', 'fourth', 'first',
    ])
  })

  it('derives the selected row from the local or remote selection', () => {
    expect(followingSelectionKey('s1', undefined, 'http://a'))
      .toBe(followKey({ source: 'local', sessionId: 's1' }))
    expect(followingSelectionKey(undefined, { nodeId: 'node-a', sessionId: 'r1' }, 'http://a'))
      .toBe(followKey({ source: 'remote', coordinatorUrl: 'http://a', nodeId: 'node-a', sessionId: 'r1' }))
    expect(followingSelectionKey(undefined, { nodeId: 'node-a', sessionId: 'r1' }, undefined))
      .toBeUndefined()
  })
})

describe('local follow rows', () => {
  it('uses the fresh local title, machine label and workspace name', () => {
    const row = one(followingRows([localRecord('s1', 1)], localSnapshot(), remoteSnapshot(), labels))
    expect(row).toMatchObject({
      status: 'ok', title: 'Local title', machine: '本地', workspace: 'Local repo', fresh: true,
    })
  })

  it('falls back to the saved summary and labels a not-found session after the list is ready', () => {
    const row = one(followingRows([localRecord('gone', 1)], localSnapshot(), remoteSnapshot(), labels))
    expect(row).toMatchObject({ status: 'not-found', title: 'local gone', fresh: false })
  })

  it('keeps the row loading while the local list is still loading', () => {
    const row = one(followingRows([localRecord('gone', 1)], localSnapshot({ phase: 'pending' }), remoteSnapshot(), labels))
    expect(row.status).toBe('loading')
  })

  it('keeps an archived local session visible and unavailable', () => {
    const row = one(followingRows(
      [localRecord('s1', 1)],
      localSnapshot({ archivedSessionIds: ['s1'] }),
      remoteSnapshot(),
      labels,
    ))
    expect(row).toMatchObject({ status: 'archived', title: 'Local title', fresh: true })
  })

  it('renders a blank local follow with the New Session label', () => {
    const row = one(followingRows([localRecord('blank', 1)], localSnapshot(), remoteSnapshot(), labels))
    expect(row.title).toBe('新会话')
  })
})

describe('remote follow rows', () => {
  const record = remoteRecord('http://a', 'node-a', 'r1', 10)

  it('uses the fresh node, workspace and session summary', () => {
    const row = one(followingRows([record], localSnapshot(), remoteSnapshot(), labels))
    expect(row).toMatchObject({
      status: 'ok',
      title: 'Remote title',
      machine: 'Machine node-a',
      workspace: 'Remote repo',
      fresh: true,
    })
  })

  it('shows the saved summary while the source is being verified', () => {
    const row = one(followingRows([record], localSnapshot(), remoteSnapshot({ verifying: true }), labels))
    expect(row).toMatchObject({ status: 'loading', title: 'remote r1', machine: 'old machine', fresh: false })
  })

  it('marks a record from another Coordinator source unavailable even when the node ids match', () => {
    const stale = one(followingRows(
      [remoteRecord('http://old', 'node-a', 'r1', 10)],
      localSnapshot(),
      remoteSnapshot(),
      labels,
    ))
    expect(stale.status).toBe('source-unavailable')
  })

  it('does not render cached data from the old source for a new-source record', () => {
    // The old Coordinator's list is still cached under the same node id; the record
    // belongs to another source, so the mismatch wins over the cached row.
    const row = one(followingRows(
      [remoteRecord('http://b', 'node-a', 'r1', 10)],
      localSnapshot(),
      remoteSnapshot({ data: { 'node-a': sessionsValue() } }),
      labels,
    ))
    expect(row.status).toBe('source-unavailable')
  })

  it('labels an unreachable Coordinator and an offline or removed node', () => {
    const unreachable = one(followingRows(
      [record], localSnapshot(), remoteSnapshot({ coordinator: { url: 'http://a', reachable: false } }), labels,
    ))
    expect(unreachable.status).toBe('source-unavailable')
    const offline = one(followingRows(
      [record], localSnapshot(), remoteSnapshot({ nodes: [node('node-a', 'offline')] }), labels,
    ))
    expect(offline.status).toBe('offline')
    const removed = one(followingRows(
      [record], localSnapshot(), remoteSnapshot({ nodes: [node('node-b')] }), labels,
    ))
    expect(removed.status).toBe('offline')
  })

  it('isolates a failed node list from the saved summary', () => {
    const row = one(followingRows(
      [record], localSnapshot(), remoteSnapshot({ errors: { 'node-a': 'node/timeout' } }), labels,
    ))
    expect(row).toMatchObject({ status: 'load-failed', title: 'remote r1', fresh: false })
  })

  it('distinguishes a not-found, archived and still-loading session', () => {
    const missing = one(followingRows(
      [record],
      localSnapshot(),
      remoteSnapshot({ data: { 'node-a': sessionsValue({ sessions: [] }) } }),
      labels,
    ))
    expect(missing.status).toBe('not-found')

    const archived = one(followingRows(
      [record],
      localSnapshot(),
      remoteSnapshot({
        data: { 'node-a': sessionsValue({ sessions: [], archivedSessionIds: ['r1'] }) },
      }),
      labels,
    ))
    expect(archived.status).toBe('archived')

    const loading = one(followingRows([record], localSnapshot(), remoteSnapshot({ data: {} }), labels))
    expect(loading.status).toBe('loading')
  })

  it('reports an unverified source when the roster probe itself failed', () => {
    const row = one(followingRows(
      [record],
      localSnapshot(),
      remoteSnapshot({ coordinator: undefined, verificationFailed: true }),
      labels,
    ))
    expect(row.status).toBe('source-unavailable')
  })
})

describe('follow list filtering and summaries', () => {
  const rows: FollowingRow[] = [
    {
      key: 'a', target: { source: 'local', sessionId: 'a' }, followedAt: 2,
      title: 'Deploy pipeline', machine: '本地', workspace: 'infra', status: 'ok', fresh: true,
    },
    {
      key: 'b', target: { source: 'remote', coordinatorUrl: 'http://a', nodeId: 'n', sessionId: 'b' }, followedAt: 1,
      title: 'Fix tests', machine: 'Office', workspace: 'web', status: 'offline', fresh: false,
    },
  ]

  it('filters by title, machine or workspace without matching across fields', () => {
    expect(filterFollowingRows(rows, 'deploy').map(row => row.key)).toEqual(['a'])
    expect(filterFollowingRows(rows, 'OFFICE').map(row => row.key)).toEqual(['b'])
    expect(filterFollowingRows(rows, 'web').map(row => row.key)).toEqual(['b'])
    expect(filterFollowingRows(rows, 'deploy web')).toEqual([])
    expect(filterFollowingRows(rows, '   ')).toEqual(rows)
  })

  it('writes back only changed summaries read from the current source', () => {
    const records = [localRecord('a', 2, 'Old local'), remoteRecord('http://a', 'n', 'b', 1, 'Old remote')]
    const [local, remote] = rows
    const updates = followingSummaryUpdates(records, [
      { ...(local as FollowingRow), key: followKey(records[0]!.target) },
      { ...(remote as FollowingRow), key: followKey(records[1]!.target) },
      { ...(remote as FollowingRow), key: followKey(records[1]!.target), title: 'changed but stale', fresh: false },
    ])
    expect(updates[followKey(records[0]!.target)]).toEqual({
      title: 'Deploy pipeline', machine: '本地', workspace: 'infra',
    })
    expect(updates[followKey(records[1]!.target)]).toBeUndefined()
  })
})

describe('follow node requests', () => {
  it('merges several followed sessions on one node into one routable request target', () => {
    const nodes = [node('node-a'), node('node-b'), node('node-c', 'offline')]
    const records = [
      remoteRecord('http://a', 'node-a', 'one', 1),
      remoteRecord('http://a', 'node-a', 'two', 2),
      remoteRecord('http://a', 'node-b', 'three', 3),
      remoteRecord('http://a', 'node-c', 'offline-one', 4),
      remoteRecord('http://old', 'node-a', 'other-source', 5),
      localRecord('local', 6),
    ]
    expect(followingNodes(records, 'http://a', nodes).map(entry => entry.nodeId)).toEqual(['node-a', 'node-b'])
    expect(followingNodes(records, 'http://old', nodes).map(entry => entry.nodeId)).toEqual(['node-a'])
    expect(followingNodes(records, undefined, nodes)).toEqual([])
  })

  it('bounds concurrency and isolates a failed target', async () => {
    let active = 0
    let peak = 0
    const seen: number[] = []
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (item) => {
      active += 1
      peak = Math.max(peak, active)
      seen.push(item)
      await new Promise<void>(resolve => { setImmediate(resolve) })
      active -= 1
      if (item === 3) throw new Error('node failed')
    })
    expect(peak).toBeLessThanOrEqual(2)
    expect(peak).toBe(2)
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
    expect(FOLLOWING_NODE_CONCURRENCY).toBeGreaterThan(0)
  })
})
