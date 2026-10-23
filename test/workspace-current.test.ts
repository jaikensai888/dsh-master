import type { Context } from '@deepseek-ai/cordis'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UiWorkspaceService } from '../src/workspace/navigation.js'
import { adaptSessionList, adaptSessionStatusHook } from '../src/workspace/adapt.js'
import { deriveFlat } from '../src/workspace/tree.js'

afterEach(() => { vi.unstubAllGlobals() })

function fixture(ready = false) {
  const cleanups: (() => void)[] = []
  const events: string[] = []
  let navigation = new AbortController()
  const layout = {
    beginNavigation: () => { navigation.abort(); navigation = new AbortController(); return navigation.signal },
    selectPanel: (id: string | null) => { navigation.abort(); events.push(`panel:${id}`) },
  }
  const releases = new Map<string, ReturnType<typeof vi.fn>>()
  const sessions = {
    list: {
      getSnapshot: (): { ids: string[]; byId: Record<string, unknown>; phase: string } => ({ ids: [], byId: {}, phase: ready ? 'ready' : 'pending' }),
      subscribe: () => () => undefined,
    },
    retain: vi.fn((id: string, options: { source: string }) => {
      expect(options.source).toBe('mainView')
      events.push(`retain:${id}`)
      const release = vi.fn(() => { events.push(`release:${id}`) })
      releases.set(id, release)
      return { sessionId: id, ready: Promise.resolve(), release }
    }),
    create: vi.fn(async (_request: unknown) => 'new-session'),
    fork: vi.fn(async (request: { onCreated?: (id: string) => void }) => {
      request.onCreated?.('forked-session')
      return 'forked-session'
    }),
  }
  const workspaces = {
    list: {
      getSnapshot: () => ({ items: [{ workspaceId: 'w', path: 'C:/repo', sessionIds: [] as string[], createdAt: '2026-10-20' }], archivedSessionIds: [] as string[], phase: ready ? 'ready' : 'pending' }),
      subscribe: () => () => undefined,
    },
    archiveSession: vi.fn(async () => undefined),
    unarchiveSession: vi.fn(async () => undefined),
    pinSession: vi.fn(async () => undefined),
    unpinSession: vi.fn(async () => undefined),
  }
  const ctx = {
    reflect: { provide: () => undefined },
    effect: (create: () => () => void) => { cleanups.push(create()) },
    inject: (_keys: string[], create: () => () => void) => ({ dispose: create() }),
    get: () => undefined,
  } as unknown as Context
  const service = new UiWorkspaceService(ctx, {} as ClientRemote['directoryPicker'], workspaces as unknown as IWorkspaces, sessions as unknown as ISessions, layout)
  return { service, sessions, workspaces, layout, events, releases, dispose: () => { for (const cleanup of cleanups) cleanup() } }
}

describe('DSH 0.2 workspace navigation', () => {
  it('persists and restores the selected local session across a reload', () => {
    let saved: string | null = null
    vi.stubGlobal('localStorage', {
      getItem: () => saved,
      setItem: (_key: string, value: string) => { saved = value },
    })
    const first = fixture()
    first.service.openSession('remembered')
    expect(JSON.parse(saved!)).toMatchObject({ sessionId: 'remembered' })
    first.dispose()
    const second = fixture()
    second.sessions.list.getSnapshot = () => ({ ids: ['remembered'], byId: {
      remembered: { id: 'remembered', displayTitle: 'Saved session', blank: false, updatedAt: 123 },
    }, phase: 'ready' })
    second.workspaces.list.getSnapshot = () => ({ items: [], archivedSessionIds: [], phase: 'ready' })
    // A new service observes the ready baseline, as after a page reload.
    second.dispose()
    const effects: (() => void)[] = []
    new UiWorkspaceService({ reflect: { provide: () => undefined }, effect: (create: () => () => void) => { effects.push(create()) },
      inject: (_keys: string[], create: () => () => void) => ({ dispose: create() }) } as unknown as Context,
      {} as ClientRemote['directoryPicker'], second.workspaces as unknown as IWorkspaces, second.sessions as unknown as ISessions, second.layout)
    expect(second.sessions.retain).toHaveBeenCalledWith('remembered', { source: 'mainView' })
    effects.forEach(dispose => { dispose() })
  })
  it('projects pending interactions and unread completion from the current status hook', () => {
    const status = new Map([
      ['done', { completionUnread: true }],
      ['question', { completionUnread: false, pendingInteraction: { kind: 'question' } }],
    ])
    const raw = <S>(selector: (value: typeof status) => S): S => selector(status)
    const usePending = adaptSessionStatusHook(raw)
    const pending = usePending(value => value)
    expect(usePending(value => value)).toBe(pending)
    expect(pending.get('question')?.kind).toBe('question')
    const row = { id: 'done', displayTitle: 'Finished', blank: false, updatedAt: 123, running: false }
    const list = { ids: ['done'], byId: { done: row }, current: undefined }
    expect(deriveFlat(list, [], pending)[0]?.completed).toBe(true)
  })
  it('does not let delayed initial workspace selection override the user navigation', async () => {
    const f = fixture(true)
    f.layout.selectPanel('dsh-master')
    await new Promise<void>(resolve => { setImmediate(resolve) })
    expect(f.sessions.retain).not.toHaveBeenCalled()
    f.dispose()
  })

  it('derives selection for already projected runtime rows without dropping snapshot fields', () => {
    const row = { id: 'one', displayTitle: 'Local session', blank: false, updatedAt: 123, retainedBy: { mainView: 1 } }
    const source = { ids: ['one'], byId: { one: row }, phase: 'ready', pendingInteractions: {} }
    const adapted = adaptSessionList(source)
    expect(adapted.current).toBe('one')
    expect(adapted.byId['one']).toBe(row)
    expect(adapted).toHaveProperty('pendingInteractions', source.pendingInteractions)
  })
  it('opens retained main-view references, returns to the default panel, and releases replaced references', () => {
    const f = fixture()
    f.service.openSession('one')
    f.service.openSession('two')
    expect(f.events).toEqual(['panel:null', 'retain:one', 'panel:null', 'retain:two', 'release:one'])
    f.dispose()
    expect(f.releases.get('two')).toHaveBeenCalledOnce()
  })

  it('passes archive options and releases an archived main view; supports restore and fork callbacks', async () => {
    const f = fixture()
    f.service.openSession('one')
    await f.service.archiveSession('one', { stopActivity: true })
    expect(f.workspaces.archiveSession).toHaveBeenCalledWith('one', { stopActivity: true })
    expect(f.releases.get('one')).toHaveBeenCalledOnce()
    await f.service.unarchiveSession('one')
    expect(f.workspaces.unarchiveSession).toHaveBeenCalledWith('one')
    const created = vi.fn()
    expect(await f.service.forkSession('one', created, { allowMigration: true })).toBe('forked-session')
    expect(created).toHaveBeenCalledWith('forked-session')
    expect(f.sessions.fork).toHaveBeenCalledWith({ sessionId: 'one', increaseTitle: true, onCreated: created, allowMigration: true })
    f.dispose()
  })

  it('does not replace the selected panel when session creation was superseded', async () => {
    const f = fixture()
    let resolve!: (id: string) => void
    f.sessions.create.mockImplementation(() => new Promise<string>(done => { resolve = done }))
    const pending = f.service.startSession('w')
    f.layout.selectPanel('dsh-master')
    resolve('late-session')
    await pending
    expect(f.sessions.retain).not.toHaveBeenCalled()
    f.dispose()
  })

  it('opens a workspace with preset selection and calls beforeOpen after retaining the binding', async () => {
    const f = fixture()
    const beforeOpen = vi.fn(() => { expect(f.sessions.retain).toHaveBeenCalledOnce() })
    await f.service.openWorkspace('w', beforeOpen, { agentPreset: 'coding' })
    expect(f.sessions.create).toHaveBeenCalledWith({ workspaceId: 'w', agentPreset: 'coding' })
    expect(beforeOpen).toHaveBeenCalledWith('new-session')
    f.dispose()
  })

  it('asks the host to validate a reusable blank but creates a fresh explicit New Session', async () => {
    const f = fixture()
    f.sessions.list.getSnapshot = () => ({ ids: ['blank'], byId: {
      blank: { id: 'blank', displayTitle: '', blank: true, cwd: 'C:/repo', updatedAt: 0 },
    }, phase: 'pending' })
    f.workspaces.list.getSnapshot = () => ({ items: [{ workspaceId: 'w', path: 'C:/repo', sessionIds: ['blank'], createdAt: '2026-10-20' }], archivedSessionIds: [], phase: 'pending' })
    await f.service.connectWorkspace('w', { agentPreset: 'coding' })
    expect(f.sessions.create).toHaveBeenLastCalledWith({ workspaceId: 'w', sessionId: 'blank', agentPreset: 'coding' })
    await f.service.startSession('w')
    expect(f.sessions.create).toHaveBeenLastCalledWith({ workspaceId: 'w' })
    f.dispose()
  })

  it('adapts current catalog titles, projections and main-view retention to the sidebar', () => {
    const row = { id: 'one', title: 'Local session', blank: false, updatedAt: 123, retainedBy: { mainView: 1 }, running: true, projectionValues: { title: 'Local session', agentPreset: 'coding' } }
    const source = { ids: ['one'], byId: { one: row }, phase: 'ready' }
    const adapted = adaptSessionList(source)
    expect(adapted.current).toBe('one')
    expect(adapted.byId['one']).toMatchObject({ id: 'one', displayTitle: 'Local session', projectionValues: row.projectionValues })
    expect(adaptSessionList(source)).toBe(adapted)
  })
})
