import { describe, expect, it, vi } from 'vitest'

const persistence = vi.hoisted(() => ({ value: undefined as Record<string, unknown> | undefined }))

// DSH replaces the initial snapshot wholesale when restoring a persisted view.
vi.mock('@deepseek-ai/dsh-client-store', () => ({
  defineStore: (spec: {
    init: () => Record<string, unknown>
    actions: Record<string, (draft: Record<string, unknown>, ...args: unknown[]) => void>
  }) => ({
    spec,
    create: () => {
      const state = structuredClone(persistence.value ?? spec.init())
      return {
        getSnapshot: () => state,
        store: { update: (mutate: (draft: Record<string, unknown>) => void) => { mutate(state) } },
        actions: Object.fromEntries(Object.entries(spec.actions).map(([name, mutate]) => [name,
          (...args: unknown[]) => { mutate(state, ...args) },
        ])),
      }
    },
  }),
}))

import { createWorkspaceViewStore } from '../src/workspace/stores.js'
import { followKey, type FollowRecord } from '../src/workspace/following.js'

describe('workspace view persistence compatibility', () => {
  it('migrates browse scope independently of session and directory preferences', () => {
    persistence.value = { groupBy: 'workspace', groupExpansion: { local: true } }
    const store = createWorkspaceViewStore().create()
    expect(store.getSnapshot().browseScope).toEqual({ kind: 'local' })
    store.actions.setBrowseScope({ kind: 'remote', nodeId: 'my-desktop' })
    expect(store.getSnapshot().browseScope).toEqual({ kind: 'remote', nodeId: 'my-desktop' })
    expect(store.getSnapshot().groupExpansion).toEqual({ local: true })
    persistence.value = { ...store.getSnapshot() }
    expect(createWorkspaceViewStore().create().getSnapshot().browseScope).toEqual({ kind: 'remote', nodeId: 'my-desktop' })
  })
  it('migrates and isolates node and directory expansion without local pruning', () => {
    persistence.value = { groupBy: 'workspace', orderBy: 'manual', groupExpansion: { local: true }, remoteExpanded: false }
    const store = createWorkspaceViewStore().create()
    expect(store.getSnapshot()).toMatchObject({ remoteNodeExpansion: {}, remoteWorkspaceExpansion: {}, remoteExpanded: false })
    store.actions.setRemoteNodeExpanded('node-a', true)
    store.actions.setRemoteNodeExpanded('node-b', false)
    store.actions.setRemoteWorkspaceExpanded('["node-a","same"]', false)
    store.actions.setRemoteWorkspaceExpanded('["node-b","same"]', true)
    store.actions.retainAccountKeys(['local'])
    expect(store.getSnapshot()).toMatchObject({
      groupExpansion: { local: true },
      remoteNodeExpansion: { 'node-a': true, 'node-b': false },
      remoteWorkspaceExpansion: { '["node-a","same"]': false, '["node-b","same"]': true },
    })
  })
  it('restores a current official v5 snapshot without losing saved preferences', () => {
    persistence.value = {
      groupBy: 'workspace', orderBy: 'manual',
      groupExpansion: { project: true },
      sessionOrderByAccount: { project: ['second', 'first'] },
      archivedFilter: 'all',
    }
    const store = createWorkspaceViewStore().create()
    expect(store.getSnapshot()).toMatchObject({
      groupBy: 'workspace', orderBy: 'manual',
      groupExpansion: { project: true },
      sessionOrderByAccount: { project: ['second', 'first'] },
      sessionUpdatedAtByAccount: {}, localExpanded: true, remoteExpanded: true,
      archivedFilter: 'all',
    })
    expect(() => store.actions.retainAccountKeys(['project'])).not.toThrow()
    store.actions.syncSessionOrderAccount('project', ['second', 'first'], { first: 12, second: 34 })
    expect(store.getSnapshot().sessionUpdatedAtByAccount['project']).toEqual({ first: 12, second: 34 })
  })

  it('preserves prior master timestamps and explicit collapsed sections', () => {
    persistence.value = {
      groupBy: 'flat', orderBy: 'updated', groupExpansion: {}, sessionOrderByAccount: {},
      sessionUpdatedAtByAccount: { project: { first: 12 } }, localExpanded: false, remoteExpanded: false,
    }
    const store = createWorkspaceViewStore().create()
    expect(store.getSnapshot()).toMatchObject(persistence.value)
  })
})

const localFollow: FollowRecord = {
  target: { source: 'local', sessionId: 's1' },
  followedAt: 100,
  title: 'Local task',
  machine: '本地',
  workspace: 'repo',
}

describe('following persistence', () => {
  it('migrates an official v5 snapshot without a following field', () => {
    persistence.value = {
      groupBy: 'workspace', orderBy: 'manual', groupExpansion: { project: true },
      sessionOrderByAccount: { project: ['a'] }, archivedFilter: 'all',
    }
    const store = createWorkspaceViewStore().create()
    expect(store.getSnapshot().following).toEqual([])
    expect(store.getSnapshot()).toMatchObject({ groupBy: 'workspace', orderBy: 'manual' })
    persistence.value = { ...store.getSnapshot() }
    expect(createWorkspaceViewStore().create().getSnapshot().following).toEqual([])
  })

  it('restores persisted follow records and the following scope', () => {
    persistence.value = { browseScope: { kind: 'following' }, following: [localFollow] }
    const store = createWorkspaceViewStore().create()
    expect(store.getSnapshot().browseScope).toEqual({ kind: 'following' })
    expect(store.getSnapshot().following).toEqual([localFollow])
  })

  it('keeps one record per identity and lets a re-follow get a new time', () => {
    const store = createWorkspaceViewStore().create()
    store.actions.followSession(localFollow)
    store.actions.followSession({ ...localFollow, followedAt: 200, title: 'Renamed' })
    expect(store.getSnapshot().following).toEqual([localFollow])

    const key = followKey(localFollow.target)
    store.actions.unfollowSession(key)
    expect(store.getSnapshot().following).toEqual([])
    store.actions.followSession({ ...localFollow, followedAt: 300 })
    expect(store.getSnapshot().following).toEqual([{ ...localFollow, followedAt: 300 }])
  })

  it('separates the same session id on another node and another Coordinator source', () => {
    const store = createWorkspaceViewStore().create()
    const remote = (coordinatorUrl: string, nodeId: string): FollowRecord => ({
      target: { source: 'remote', coordinatorUrl, nodeId, sessionId: 'same' },
      followedAt: 1,
      title: 'Remote',
      machine: nodeId,
      workspace: 'remote repo',
    })
    store.actions.followSession(remote('http://a', 'node-1'))
    store.actions.followSession(remote('http://a', 'node-2'))
    store.actions.followSession(remote('http://b', 'node-1'))
    store.actions.followSession(localFollow)
    expect(store.getSnapshot().following).toHaveLength(4)
  })

  it('keeps follow records when workspace accounts are pruned', () => {
    persistence.value = { following: [localFollow] }
    const store = createWorkspaceViewStore().create()
    store.actions.retainAccountKeys([])
    expect(store.getSnapshot().following).toEqual([localFollow])
  })

  it('updates only the summaries a fresh source provided, never the identity', () => {
    persistence.value = { following: [localFollow] }
    const store = createWorkspaceViewStore().create()
    store.actions.syncFollowSummaries({
      [followKey(localFollow.target)]: { title: 'Renamed upstream', machine: '本地', workspace: 'other' },
    })
    expect(store.getSnapshot().following[0]).toEqual({
      ...localFollow, title: 'Renamed upstream', workspace: 'other',
    })
    store.actions.syncFollowSummaries({ [followKey(localFollow.target)]: { title: 'Renamed upstream', machine: '本地', workspace: 'other' } })
    expect(store.getSnapshot().following).toHaveLength(1)
  })

  it('drops malformed and duplicate entries from a persisted snapshot', () => {
    persistence.value = {
      following: [
        localFollow,
        { ...localFollow, followedAt: 999 },
        { target: { source: 'remote' }, followedAt: 1 },
        { target: { source: 'local', sessionId: 'bad' }, followedAt: 'soon' },
        null,
      ],
    }
    const store = createWorkspaceViewStore().create()
    expect(store.getSnapshot().following).toEqual([
      localFollow,
      { target: { source: 'local', sessionId: 'bad' }, followedAt: 0, title: '', machine: '', workspace: '' },
    ])
  })
})
