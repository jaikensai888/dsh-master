import { describe, expect, it } from 'vitest'
import { CoordinatorClient, MasterUpstreamError } from '../src/coordinator/client.js'

/** One recorded request. */
interface Call {
  readonly url: string
  readonly init: RequestInit
}

/**
 * Build a client whose transport is a scripted function.
 * @param handler - returns the response for one call.
 * @returns the client and the recorded calls.
 */
function clientWith(handler: (call: Call) => Response | Promise<Response>, apiToken?: string): {
  client: CoordinatorClient
  calls: Call[]
} {
  const calls: Call[] = []
  const client = new CoordinatorClient({
    baseUrl: 'http://127.0.0.1:39472',
    ...(apiToken === undefined ? {} : { apiToken }),
    requestTimeoutMs: 5_000,
    fetchImpl: ((input: unknown, init: RequestInit) => {
      const call = { url: String(input), init }
      calls.push(call)
      return Promise.resolve(handler(call))
    }) as unknown as typeof fetch,
  })
  return { client, calls }
}

/** A JSON envelope response. */
function envelope(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** A raw NDJSON response body. */
function ndjson(lines: readonly unknown[], status = 200): Response {
  const text = `${lines.map(line => JSON.stringify(line)).join('\n')}\n`
  return new Response(text, { status, headers: { 'content-type': 'application/x-ndjson' } })
}

describe('CoordinatorClient.listNodes', () => {
  it('maps the fields the panel renders and drops rows without an id', async () => {
    const { client } = clientWith(() => envelope({
      ok: true,
      value: [
        { nodeId: 'node-1', nodeName: 'desktop', role: 'dev', state: 'ready', capabilityCount: 97, activeStreams: 1 },
        { nodeName: 'nameless', state: 'ready' },
      ],
    }))
    const nodes = await client.listNodes()
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ nodeId: 'node-1', nodeName: 'desktop', state: 'ready', capabilityCount: 97 })
  })

  it('fails loudly when the coordinator answers a non-array', async () => {
    const { client } = clientWith(() => envelope({ ok: true, value: { nodes: [] } }))
    await expect(client.listNodes()).rejects.toThrow(MasterUpstreamError)
  })
})

describe('CoordinatorClient.listSessions', () => {
  it('reads the projected title and the run flags', async () => {
    const { client } = clientWith(() => envelope({
      ok: true,
      value: {
        items: [{
          sessionId: 'abcdefgh-1234',
          updatedAt: 42,
          running: true,
          blank: false,
          cwd: 'C:\\work',
          projections: { asOfSeq: 9, values: { title: '排查构建' } },
        }],
      },
    }))
    const sessions = await client.listSessions('node-1')
    expect(sessions[0]).toMatchObject({ title: '排查构建', running: true, blank: false, cwd: 'C:\\work', updatedAt: 42 })
  })

  it('falls back to a short id so a row stays addressable', async () => {
    const { client } = clientWith(() => envelope({
      ok: true,
      value: { items: [{ sessionId: 'abcdefgh-1234', updatedAt: 0, running: false, blank: true }] },
    }))
    expect((await client.listSessions('node-1'))[0]?.title).toBe('abcdefgh…')
  })

  it('sends the node id in the body', async () => {
    const { client, calls } = clientWith(() => envelope({ ok: true, value: { items: [] } }))
    await client.listSessions('node-7')
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ nodeId: 'node-7' })
    expect(calls[0]?.url).toBe('http://127.0.0.1:39472/api/sessions')
  })
})

describe('CoordinatorClient.follow', () => {
  it('yields data values in order and stops at end', async () => {
    const { client } = clientWith(() => ndjson([
      { type: 'open', streamId: 'stream-1', endpoint: 'session/follow' },
      { type: 'data', value: { type: 'snapshot', records: [] } },
      { type: 'data', value: { type: 'event', event: { type: 'user/message', seq: 1, data: {} } } },
      { type: 'end', count: 2 },
    ]))
    const seen: unknown[] = []
    for await (const value of client.follow('node-1', 's-1')) seen.push(value)
    expect(seen).toHaveLength(2)
    expect(seen[1]).toMatchObject({ type: 'event' })
  })

  it('throws the node business code from an error record', async () => {
    const { client } = clientWith(() => ndjson([
      { type: 'open', streamId: 'stream-1', endpoint: 'session/follow' },
      { type: 'error', error: { code: 'session/not-found', message: 'the node reported a failure' }, count: 0 },
    ]))
    await expect(async () => {
      for await (const _value of client.follow('node-1', 'missing')) { /* drain */ }
    }).rejects.toMatchObject({ code: 'session/not-found' })
  })

  it('treats a non-JSON line as a truncated stream, not as something to skip', async () => {
    const { client } = clientWith(() => new Response('{"type":"open"}\nnot json\n', { status: 200 }))
    await expect(async () => {
      for await (const _value of client.follow('node-1', 's-1')) { /* drain */ }
    }).rejects.toMatchObject({ code: 'master/coordinator-unreadable' })
  })

  it('rejects an unknown record type instead of silently ignoring it', async () => {
    const { client } = clientWith(() => ndjson([{ type: 'surprise' }]))
    await expect(async () => {
      for await (const _value of client.follow('node-1', 's-1')) { /* drain */ }
    }).rejects.toMatchObject({ code: 'master/coordinator-unreadable' })
  })
})

describe('CoordinatorClient failure mapping', () => {
  it('keeps the upstream code from a failure envelope', async () => {
    const { client } = clientWith(() => envelope({
      ok: false,
      error: { code: 'coordinator/node-offline', message: 'the node is not ready' },
    }))
    await expect(client.listSessions('node-1')).rejects.toMatchObject({ code: 'coordinator/node-offline' })
  })

  it('reports an unreachable coordinator without throwing', async () => {
    const { client } = clientWith(() => { throw new Error('connect ECONNREFUSED 127.0.0.1:39472') })
    const facts = await client.probe()
    expect(facts.reachable).toBe(false)
    expect(facts.error).toContain('ECONNREFUSED')
  })

  it('reports a non-JSON body as unreadable rather than as success', async () => {
    const { client } = clientWith(() => new Response('<html>502</html>', { status: 502 }))
    await expect(client.listNodes()).rejects.toMatchObject({ code: 'master/coordinator-unreadable' })
  })
})

describe('CoordinatorClient credentials', () => {
  it('attaches the operator token as a bearer header', async () => {
    const { client, calls } = clientWith(() => envelope({ ok: true, value: [] }), 'tok-abc')
    await client.listNodes()
    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers['authorization']).toBe('Bearer tok-abc')
  })

  it('omits the header entirely when no token is configured', async () => {
    const { client, calls } = clientWith(() => envelope({ ok: true, value: [] }))
    await client.listNodes()
    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers['authorization']).toBeUndefined()
  })

  it('exposes the origin as the only displayable endpoint fact', () => {
    const { client } = clientWith(() => envelope({ ok: true, value: [] }), 'tok-abc')
    expect(client.baseUrl).toBe('http://127.0.0.1:39472')
    expect(client.baseUrl).not.toContain('tok-abc')
  })
})
