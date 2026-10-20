import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, Config, MASTER_SERVICE_KEY } from '../src/index.js'
import type { MasterConfig } from '../src/config.js'
import type { MasterService } from '../src/service.js'

afterEach(() => { vi.unstubAllGlobals() })

describe('dsh-master live settings', () => {
  it('mounts with the current settings service and reads a volatile URL on each request', async () => {
    let url = 'http://first.test'
    const requests: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      requests.push(String(input))
      return new Response(JSON.stringify({ ok: true, value: [] }), { status: 200 })
    })
    const services: Record<string, unknown> = {}
    const ctx = {
      get: () => undefined,
      provide: (key: string, value: unknown) => { services[key] = value },
      inject: (keys: string[], callback: (scoped: unknown) => void) => {
        if (keys[0] === 'settings') callback({ settings: { configure: () => () => undefined } })
      },
    } as unknown as Context
    expect(() => apply(ctx, { coordinatorUrl: { get: () => url } })).not.toThrow()
    const master = services[MASTER_SERVICE_KEY] as MasterService
    await master.status()
    url = 'https://next.test/'
    await master.status()
    expect(requests).toEqual([
      'http://first.test/api/health', 'http://first.test/api/nodes',
      'https://next.test/api/health', 'https://next.test/api/nodes',
    ])
  })

  it('exposes the coordinator URL as a live Config field for configForms', () => {
    expect(Config.dict?.['coordinatorUrl']?.meta.volatile).toBe(true)
    const config = Config({ coordinatorUrl: 'https://coordinator.test' })
    expect(config.coordinatorUrl.get()).toBe('https://coordinator.test')
  })

  it('uses the settings URL and credentials on the next coordinator request', async () => {
    const requests: { url: string; authorization: string | undefined }[] = []
    let token = 'first-token'
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      requests.push({ url: String(input), authorization: headers.get('authorization') ?? undefined })
      return new Response(JSON.stringify({ ok: true, value: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    let active: MasterConfig | undefined
    let onSettingsChange = (): void => undefined
    const service: Record<string, unknown> = {}
    const ctx = {
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
      get: (key: string) => key === 'credentials'
        ? { resolve: async () => ({ value: token }) }
        : undefined,
      provide: (key: string, value: unknown) => { service[key] = value },
      inject: (keys: string[], callback: (scoped: unknown) => void) => {
        if (keys[0] === 'settings') {
          callback({ settings: {
            installSection: (
              _owner: Context,
              _namespace: string,
              _schema: unknown,
              entry: MasterConfig,
              hooks: { setSource: (source: () => MasterConfig) => void; onChange: () => void },
            ) => {
              active = entry
              hooks.setSource(() => active as MasterConfig)
              onSettingsChange = hooks.onChange
              onSettingsChange()
            },
          } })
        } else if (keys[0] === 'webServer') {
          callback({ webServer: undefined })
        }
      },
    } as unknown as Context

    apply(ctx, { coordinatorUrl: 'http://first.test' })
    const master = service[MASTER_SERVICE_KEY] as MasterService
    const firstStatus = await master.status()
    active = { ...(active as MasterConfig), coordinatorUrl: 'https://next.test/' }
    token = 'second-token'
    onSettingsChange()
    const secondStatus = await master.status()

    expect(requests.map(request => request.url)).toEqual([
      'http://first.test/api/health',
      'http://first.test/api/nodes',
      'https://next.test/api/health',
      'https://next.test/api/nodes',
    ])
    expect(requests.map(request => request.authorization)).toEqual([
      'Bearer first-token', 'Bearer first-token', 'Bearer second-token', 'Bearer second-token',
    ])
    expect([firstStatus.coordinator.url, secondStatus.coordinator.url]).toEqual([
      'http://first.test', 'https://next.test',
    ])
  })
})
