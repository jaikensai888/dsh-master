import { Context, Service } from '@deepseek-ai/cordis'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UiWorkspaceService } from '../src/workspace/navigation.js'

afterEach(() => { vi.unstubAllGlobals() })

describe('local composer startup', () => {
  it.each(['remembered', 'blank'])('waits for the active conversation service before restoring %s', async (selection) => {
    vi.stubGlobal('localStorage', {
      getItem: () => selection === 'remembered' ? JSON.stringify({ sessionId: 'saved' }) : null,
      setItem: () => undefined,
    })
    const ctx = new Context()
    const restoredWithConversation: boolean[] = []
    const sessions = {
      list: {
        getSnapshot: () => ({ ids: ['saved'], byId: {
          saved: { id: 'saved', displayTitle: 'Saved', blank: false, updatedAt: 123 },
        }, phase: 'ready' }),
        subscribe: () => () => undefined,
      },
      retain: vi.fn((sessionId: string) => {
        // The real composer inject uses the same strict service lookup.
        restoredWithConversation.push(ctx.get('conversation') !== undefined)
        return { sessionId, ready: Promise.resolve(), release: () => undefined }
      }),
      create: vi.fn(async () => 'blank'),
    }
    const workspaces = {
      list: {
        getSnapshot: () => ({ items: [{ workspaceId: 'w', path: 'C:/repo', sessionIds: ['saved'], createdAt: '2026-10-23' }], archivedSessionIds: [], phase: 'ready' }),
        subscribe: () => () => undefined,
      },
    }
    try {
      new UiWorkspaceService(ctx, {} as ClientRemote['directoryPicker'],
        workspaces as unknown as IWorkspaces, sessions as unknown as ISessions,
        { selectPanel: () => undefined })
      await Promise.resolve()
      expect(sessions.retain).not.toHaveBeenCalled()
      expect(sessions.create).not.toHaveBeenCalled()

      // Like ui-conversation, publish the controller from a separate child fiber.
      await ctx.plugin(class extends Service {
        constructor(scope: Context) { super(scope, 'conversation') }
      })
      await vi.waitFor(() => { expect(sessions.retain).toHaveBeenCalledOnce() })
      expect(restoredWithConversation).toEqual([true])
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
