import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  archiveRemoteSession,
  createRemoteSession,
  createRemoteWorkspace,
  fetchModelCatalog,
  followSession,
  renameRemoteSession,
  selectRemoteModel,
  unarchiveRemoteSession,
} from '../src/client/api.js'
import type { MasterStreamRecord } from '../src/protocol.js'

describe('remote session create browser API', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('posts the node, workspace and optional blank id', async () => {
    const fetchSpy = vi.fn<typeof fetch>()
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      value: { sessionId: 'session-9' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(createRemoteSession('node-1', 'workspace-1', 'blank-1')).resolves.toEqual({
      sessionId: 'session-9',
    })
    const [url, init] = fetchSpy.mock.calls[0] ?? []
    expect(String(url)).toBe('/dsh-master/api/session/create')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      nodeId: 'node-1',
      workspaceId: 'workspace-1',
      sessionId: 'blank-1',
    })
  })

  it('omits the blank id when none is reused', async () => {
    const fetchSpy = vi.fn<typeof fetch>()
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      value: { sessionId: 'fresh' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchSpy)

    await createRemoteSession('node-1', 'workspace-1')
    const init = fetchSpy.mock.calls[0]?.[1]
    expect(JSON.parse(String(init?.body))).toEqual({ nodeId: 'node-1', workspaceId: 'workspace-1' })
  })
})

describe('remote archive browser API', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('posts the node/session identity and returns the coordinator-confirmed archive set', async () => {
    const fetchSpy = vi.fn<typeof fetch>()
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      value: { archivedSessionIds: ['old', 'session-1'] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(archiveRemoteSession('node-1', 'session-1')).resolves.toEqual({
      archivedSessionIds: ['old', 'session-1'],
    })
    const [url, init] = fetchSpy.mock.calls[0] ?? []
    expect(String(url)).toBe('/dsh-master/api/session/archive')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ nodeId: 'node-1', sessionId: 'session-1' })
  })
})

describe('remote session rename browser API', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('posts the node, session and title, and returns the accepted title', async () => {
    const fetchSpy = vi.fn<typeof fetch>()
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      value: { sessionId: 'session-1', title: '新的标题' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(renameRemoteSession('node-1', 'session-1', '新的标题')).resolves.toEqual({
      sessionId: 'session-1',
      title: '新的标题',
    })
    const [url, init] = fetchSpy.mock.calls[0] ?? []
    expect(String(url)).toBe('/dsh-master/api/session/rename')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      nodeId: 'node-1',
      sessionId: 'session-1',
      title: '新的标题',
    })
  })
})

describe('remote unarchive browser API', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('posts the node/session identity and returns the node-confirmed archive set', async () => {
    const fetchSpy = vi.fn<typeof fetch>()
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      value: { archivedSessionIds: ['still-hidden'] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(unarchiveRemoteSession('node-1', 'session-1')).resolves.toEqual({
      archivedSessionIds: ['still-hidden'],
    })
    const [url, init] = fetchSpy.mock.calls[0] ?? []
    expect(String(url)).toBe('/dsh-master/api/session/unarchive')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ nodeId: 'node-1', sessionId: 'session-1' })
  })

  it('surfaces the node code when the capability is missing there', async () => {
    const fetchSpy = vi.fn<typeof fetch>()
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error: { code: 'node/capability-unavailable', message: 'workspace/unarchiveSession' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(unarchiveRemoteSession('node-1', 'session-1')).rejects.toMatchObject({
      code: 'node/capability-unavailable',
    })
  })
})

describe('remote workspace create browser API', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('posts the node and path, and returns the registry row with its created flag', async () => {
    const fetchSpy = vi.fn<typeof fetch>()
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      value: {
        workspace: { workspaceId: 'ws-1', title: 'my-app', path: 'D:\\projects\\my-app', sessionIds: [] },
        created: false,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(createRemoteWorkspace('node-1', 'D:\\projects\\my-app')).resolves.toEqual({
      workspace: { workspaceId: 'ws-1', title: 'my-app', path: 'D:\\projects\\my-app', sessionIds: [] },
      created: false,
    })
    const [url, init] = fetchSpy.mock.calls[0] ?? []
    expect(String(url)).toBe('/dsh-master/api/workspace/create')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ nodeId: 'node-1', path: 'D:\\projects\\my-app' })
  })
})

describe('remote session follow API', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('reopens a failed follow and receives the latest session snapshot', async () => {
    const controller = new AbortController()
    const fetchSpy = vi.fn<typeof fetch>()
    const ndjson = (records: readonly unknown[]): Response => new Response(
      `${records.map(record => JSON.stringify(record)).join('\n')}\n`,
      { status: 200, headers: { 'content-type': 'application/x-ndjson' } },
    )
    const latestSnapshot = {
      type: 'snapshot',
      header: { version: 3, id: 'session-1', createdAt: 1, isSeeded: false },
      cursor: 2,
      records: [
        { type: 'event', event: { type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'text', text: 'latest prompt' }] } } },
        { type: 'event', event: { type: 'assistant/message', seq: 2, time: 2, data: { message: { role: 'assistant', content: [{ type: 'text', text: 'latest reply' }] } } } },
      ],
      hasMore: false,
      projections: { asOfSeq: 2, values: {} },
    }
    fetchSpy
      .mockResolvedValueOnce(ndjson([
        { type: 'open', nodeId: 'node-1', sessionId: 'session-1' },
        { type: 'error', error: { code: 'coordinator/request-timeout', message: 'follow stream idle timeout' }, count: 1 },
      ]))
      .mockResolvedValueOnce(ndjson([
        { type: 'open', nodeId: 'node-1', sessionId: 'session-1' },
        { type: 'data', value: latestSnapshot },
      ]))
    vi.stubGlobal('fetch', fetchSpy)

    const received: MasterStreamRecord[] = []
    await followSession('node-1', 'session-1', controller.signal, record => {
      received.push(record)
      if (record.type === 'data'
        && typeof record.value === 'object'
        && record.value !== null
        && !Array.isArray(record.value)
        && 'type' in record.value
        && record.value.type === 'snapshot') controller.abort()
    })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(received).toContainEqual({ type: 'data', value: latestSnapshot })
  })
})

describe('remote model browser API', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('reads one node catalog through its own route', async () => {
    const fetchSpy = vi.fn<typeof fetch>()
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      value: { groups: [{ id: 'p', name: 'P', models: [{ id: 'm', name: 'M' }] }], failures: [] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchSpy)

    const catalog = await fetchModelCatalog('node-1')
    expect(catalog.groups[0]?.models[0]?.id).toBe('m')
    const [url, init] = fetchSpy.mock.calls[0] ?? []
    expect(String(url)).toBe('/dsh-master/api/session/models?nodeId=node-1')
    expect(init?.method ?? 'GET').toBe('GET')
  })

  it('posts the complete selection and omits an absent effort', async () => {
    const fetchSpy = vi.fn<typeof fetch>()
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      value: { selected: { provider: 'p', model: 'm' } },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(selectRemoteModel('node-1', 'session-1', { provider: 'p', model: 'm' }))
      .resolves.toEqual({ selected: { provider: 'p', model: 'm' } })
    const [url, init] = fetchSpy.mock.calls[0] ?? []
    expect(String(url)).toBe('/dsh-master/api/session/model')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      nodeId: 'node-1', sessionId: 'session-1', provider: 'p', model: 'm',
    })
  })
})
