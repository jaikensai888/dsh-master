import type { Context } from '@deepseek-ai/cordis'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/workspace/RemoteSection.js', () => ({ RemoteSection: () => null }))
vi.mock('../src/workspace/WorkspacePicker.js', () => ({ WorkspacePicker: () => null }))
vi.mock('../src/workspace/rows/WorkspaceBrowser.js', () => ({ WorkspaceBrowser: () => null }))
vi.mock('../src/workspace/stores.js', () => ({ createWorkspaceViewStore: () => ({}) }))

import { applyWorkspaceBrowser } from '../src/workspace/index.js'
import { runSessionAction, UiWorkspaceService } from '../src/workspace/navigation.js'

describe('workspace UI actions', () => {
  it('accepts the shipped fire-and-forget session action', () => {
    const events: string[] = []
    const errors: unknown[] = []

    runSessionAction(() => { events.push('start') }, error => { errors.push(error) })

    expect(events).toEqual(['start'])
    expect(errors).toEqual([])
  })

  it('reports both synchronous throws and promise rejections', async () => {
    const syncFailure = new Error('sync failure')
    const asyncFailure = new Error('async failure')
    const errors: unknown[] = []

    runSessionAction(() => { throw syncFailure }, error => { errors.push(error) })
    runSessionAction(() => Promise.reject(asyncFailure), error => { errors.push(error) })
    await Promise.resolve()

    expect(errors).toEqual([syncFailure, asyncFailure])
  })
})

describe('workspace browser service lookup', () => {
  it('uses the registered uiWorkspace even while strict lookup reports it inactive', () => {
    const actions: string[] = []
    const registrations = new Map<string, { inject?: () => Record<string, unknown> }>()
    const uiWorkspace = {
      startSession: (workspaceId?: string) => { actions.push(`start:${workspaceId}`) },
      archiveSession: async (sessionId: string) => { actions.push(`archive:${sessionId}`) },
    }
    const slots = {
      provideRoot: () => () => undefined,
      inject: (_key: string, callback: () => () => void) => callback(),
      register: (options: { name: string; inject?: () => Record<string, unknown> }) => {
        registrations.set(options.name, options)
        return () => undefined
      },
      entries: () => [],
      subscribe: () => () => undefined,
    }
    const sessions = {
      list: { getSnapshot: () => ({ ids: [], byId: {} }) },
      searchResultLimit: 20,
      binding: () => undefined,
    }
    const workspaces = { list: { getSnapshot: () => ({ items: [], archivedSessionIds: [] }) } }
    const context = {
      slots,
      locale: { register: () => () => undefined },
      remote: { $host: undefined, directoryPicker: {} },
      sessions,
      workspaces,
      get: (_key: string, strict?: boolean) => strict === false ? uiWorkspace : undefined,
      on: () => () => undefined,
    } as unknown as Context

    applyWorkspaceBrowser(context, () => undefined, { selectPanel: () => undefined }, () => undefined)
    const props = registrations.get('sidebar.workspaces')?.inject?.()

    expect(props).toBeDefined()
    ;(props?.startSession as (workspaceId?: string) => void)('workspace-1')
    ;(props?.archiveSession as (sessionId: string) => Promise<void>)('session-1')

    expect(actions).toEqual(['start:workspace-1', 'archive:session-1'])
  })
})

describe('workspace session navigation', () => {
  it('returns to the conversation panel when a workspace starts a session', async () => {
    const events: string[] = []
    const context = {
      reflect: { provide: () => undefined },
      effect: () => undefined,
    } as unknown as Context
    const workspaces = {
      list: {
        getSnapshot: () => ({
          items: [{ workspaceId: 'workspace-1', path: 'C:/repo', sessionIds: [] }],
          archivedSessionIds: [],
        }),
      },
    } as unknown as IWorkspaces
    const sessions = {
      list: {
        getSnapshot: () => ({ ids: [], byId: {}, current: undefined }),
      },
      create: async (options: { workspaceId?: string }) => {
        events.push(`create:${options.workspaceId}`)
        return 'session-1'
      },
      open: (sessionId: string) => { events.push(`open:${sessionId}`) },
    } as unknown as ISessions
    const layout = { selectPanel: (id: string) => { events.push(`panel:${id}`) } }
    const service = new UiWorkspaceService(
      context,
      {} as ClientRemote['directoryPicker'],
      workspaces,
      sessions,
      layout,
    )

    await service.startSession('workspace-1')

    expect(events).toEqual([
      'create:workspace-1',
      'panel:conversation',
      'open:session-1',
    ])
  })

  it('returns creation failures to the workspace action instead of swallowing them', async () => {
    const failure = new Error('session creation rejected')
    const context = {
      reflect: { provide: () => undefined },
      effect: () => undefined,
    } as unknown as Context
    const workspaces = {
      list: {
        getSnapshot: () => ({
          items: [{ workspaceId: 'workspace-1', path: 'C:/repo', sessionIds: [] }],
          archivedSessionIds: [],
        }),
      },
    } as unknown as IWorkspaces
    const sessions = {
      list: { getSnapshot: () => ({ ids: [], byId: {}, current: undefined }) },
      create: async () => { throw failure },
      open: () => undefined,
    } as unknown as ISessions
    const service = new UiWorkspaceService(
      context,
      {} as ClientRemote['directoryPicker'],
      workspaces,
      sessions,
      { selectPanel: () => undefined },
    )

    await expect(service.startSession('workspace-1')).rejects.toBe(failure)
  })
})
