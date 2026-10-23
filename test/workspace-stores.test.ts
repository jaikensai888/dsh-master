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

describe('workspace view persistence compatibility', () => {
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
