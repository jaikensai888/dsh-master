import { describe, expect, it, vi } from 'vitest'
import {
  MASTER_SETTINGS_TOKEN_REF,
  MasterSettingsCardController,
  type MasterSettingsScope,
} from '../src/client/settings-card.js'

function testScope(initial: { coordinatorUrl: string }): MasterSettingsScope {
  let snapshot = {
    status: 'ready' as const,
    value: initial,
    user: {} as Record<string, unknown>,
    writable: true,
  }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: vi.fn(async (field: string, value: unknown) => {
      snapshot = {
        ...snapshot,
        value: { ...snapshot.value, [field]: value },
        user: { ...snapshot.user, [field]: value },
      }
      for (const listener of listeners) listener()
    }),
    unset: vi.fn(async () => undefined),
  }
}

describe('MasterSettingsCardController', () => {
  it('saves the coordinator URL and writes a token only through credentials', async () => {
    const scope = testScope({ coordinatorUrl: 'http://127.0.0.1:39472' })
    let configured = false
    const credentials = {
      describe: vi.fn(async () => ({
        ok: true as const,
        value: { [MASTER_SETTINGS_TOKEN_REF]: { configured, writable: true } },
      })),
      set: vi.fn(async () => { configured = true; return { ok: true as const, value: undefined } }),
    }
    const controller = new MasterSettingsCardController(scope, credentials)
    await controller.refreshCredential()
    controller.editCoordinatorUrl('https://coordinator.example:39472/')
    controller.editApiToken('new-token')
    await controller.save()

    expect(scope.set).toHaveBeenCalledWith('coordinatorUrl', 'https://coordinator.example:39472')
    expect(credentials.set).toHaveBeenCalledWith(MASTER_SETTINGS_TOKEN_REF, 'new-token')
    expect(controller.getSnapshot()).toMatchObject({
      coordinatorUrl: 'https://coordinator.example:39472',
      apiToken: '',
      credentialConfigured: true,
      dirty: false,
      failed: false,
    })
  })

  it('rejects non-http coordinator URLs without writing settings or credentials', async () => {
    const scope = testScope({ coordinatorUrl: 'http://127.0.0.1:39472' })
    const credentials = {
      describe: vi.fn(async () => ({
        ok: true as const,
        value: { [MASTER_SETTINGS_TOKEN_REF]: { configured: false, writable: true } },
      })),
      set: vi.fn(async () => ({ ok: true as const, value: undefined })),
    }
    const controller = new MasterSettingsCardController(scope, credentials)
    controller.editCoordinatorUrl('javascript:alert(1)')
    controller.editApiToken('must-not-save')
    await controller.save()

    expect(controller.getSnapshot().invalidUrl).toBe(true)
    expect(scope.set).not.toHaveBeenCalled()
    expect(credentials.set).not.toHaveBeenCalled()
    expect(controller.getSnapshot().apiToken).toBe('must-not-save')
  })

  it('shows legacy token presence from the redacted settings mirror only', () => {
    const scope = testScope({ coordinatorUrl: 'http://127.0.0.1:39472' })
    const describe = {
      getSnapshot: () => ({
        view: {
          namespaces: [{ ns: 'dsh-master', secrets: [{ path: ['apiToken'], set: true }] }],
        },
      }),
      subscribe: () => () => undefined,
    }
    const controller = new MasterSettingsCardController(scope, undefined, describe)

    expect(controller.getSnapshot()).toMatchObject({
      credentialConfigured: false,
      legacyTokenConfigured: true,
    })
  })

  it('leaves an existing credential untouched when the token field is blank', async () => {
    const scope = testScope({ coordinatorUrl: 'http://127.0.0.1:39472' })
    const credentials = {
      describe: vi.fn(async () => ({
        ok: true as const,
        value: { [MASTER_SETTINGS_TOKEN_REF]: { configured: true, writable: true } },
      })),
      set: vi.fn(async () => ({ ok: true as const, value: undefined })),
    }
    const controller = new MasterSettingsCardController(scope, credentials)
    await controller.refreshCredential()
    controller.editCoordinatorUrl('https://next.example')
    await controller.save()

    expect(credentials.set).not.toHaveBeenCalled()
    expect(controller.getSnapshot()).toMatchObject({ credentialConfigured: true, apiToken: '', failed: false })
  })

  it('ignores an older credential-description response after a newer read', async () => {
    const scope = testScope({ coordinatorUrl: 'http://127.0.0.1:39472' })
    const resolvers: ((value: {
      ok: boolean
      value: Record<string, { configured: boolean; writable: boolean }>
    }) => void)[] = []
    const credentials = {
      describe: vi.fn(() => new Promise<{
        ok: boolean
        value: Record<string, { configured: boolean; writable: boolean }>
      }>(resolve => { resolvers.push(resolve) })),
      set: vi.fn(async () => ({ ok: true as const, value: undefined })),
    }
    const controller = new MasterSettingsCardController(scope, credentials)
    const latestRead = controller.refreshCredential()
    resolvers[1]?.({ ok: true, value: { [MASTER_SETTINGS_TOKEN_REF]: { configured: true, writable: true } } })
    await latestRead
    resolvers[0]?.({ ok: true, value: { [MASTER_SETTINGS_TOKEN_REF]: { configured: false, writable: true } } })
    await new Promise(resolve => { setTimeout(resolve, 0) })

    expect(controller.getSnapshot().credentialConfigured).toBe(true)
  })
})
