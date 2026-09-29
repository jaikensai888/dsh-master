import { afterEach, describe, expect, it, vi } from 'vitest'
import { archiveRemoteSession, followSession } from '../src/client/api.js'
import type { MasterStreamRecord } from '../src/protocol.js'

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
