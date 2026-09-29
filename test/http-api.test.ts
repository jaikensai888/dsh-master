import { describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { MAX_PROMPT_BODY_BYTES, createMasterRouteHandler } from '../src/http-api.js'
import type { MasterService } from '../src/service.js'
import type { MasterStatus } from '../src/protocol.js'

/** A response that records what the handler wrote. */
class FakeResponse {
  status = 0
  headers: Record<string, unknown> = {}
  writableEnded = false
  readonly chunks: string[] = []

  writeHead(status: number, headers?: Record<string, unknown>): this {
    this.status = status
    if (headers !== undefined) Object.assign(this.headers, headers)
    return this
  }

  setHeader(name: string, value: unknown): this {
    this.headers[name.toLowerCase()] = value
    return this
  }

  write(chunk: unknown): boolean {
    this.chunks.push(String(chunk))
    return true
  }

  end(chunk?: unknown): this {
    if (chunk !== undefined) this.chunks.push(String(chunk))
    this.writableEnded = true
    return this
  }

  on(): this {
    return this
  }

  get body(): string {
    return this.chunks.join('')
  }

  get json(): unknown {
    return JSON.parse(this.body) as unknown
  }
}

/** Build request facts for one call. */
function fakeRequest(options: {
  method?: string
  url?: string
  headers?: Record<string, string>
  body?: string
} = {}): IncomingMessage {
  const body = options.body ?? ''
  const request = {
    method: options.method ?? 'GET',
    url: options.url ?? '/',
    headers: options.headers ?? { host: '127.0.0.1:43120' },
    async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
      if (body !== '') yield Buffer.from(body)
    },
  }
  return request as unknown as IncomingMessage
}

/** Invoke the handler and wait for the response to settle. */
async function call(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  request: IncomingMessage,
): Promise<FakeResponse> {
  const response = new FakeResponse()
  handler(request, response as unknown as ServerResponse)
  for (let tick = 0; tick < 200 && !response.writableEnded; tick += 1) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  return response
}

/** A service double with only the methods a route under test reaches. */
function service(overrides: Partial<Record<keyof MasterService, unknown>> = {}): MasterService {
  const status: MasterStatus = {
    coordinator: { url: 'http://127.0.0.1:39472', reachable: true },
    nodeCount: 1,
    promptEnabled: overrides['promptEnabled'] === true,
  }
  return {
    promptEnabled: false,
    status: () => Promise.resolve(status),
    nodes: () => Promise.resolve({ coordinator: status.coordinator, nodes: [] }),
    sessions: (nodeId: string) => Promise.resolve({ nodeId, sessions: [] }),
    follow: async function* () { yield { type: 'snapshot' } },
    prompt: () => Promise.resolve(),
    ...overrides,
  } as unknown as MasterService
}

/** A handler bound to one service double. */
function handlerFor(master: MasterService | undefined): (request: IncomingMessage, response: ServerResponse) => void {
  return createMasterRouteHandler({
    service: () => master,
    trustedHosts: () => [],
  })
}

describe('the trust fence runs before any route', () => {
  it('refuses a rebound hostname', async () => {
    const response = await call(handlerFor(service()), fakeRequest({
      url: '/dsh-master/api/status',
      headers: { host: 'evil.example' },
    }))
    expect(response.status).toBe(403)
    expect(response.json).toMatchObject({ ok: false, error: { code: 'master/forbidden' } })
  })

  it('refuses a cross-site request from a loopback host', async () => {
    const response = await call(handlerFor(service()), fakeRequest({
      url: '/dsh-master/api/status',
      headers: { host: '127.0.0.1:43120', 'sec-fetch-site': 'cross-site' },
    }))
    expect(response.status).toBe(403)
  })
})

describe('route dispatch', () => {
  it('answers an unknown route with 404', async () => {
    const response = await call(handlerFor(service()), fakeRequest({ url: '/dsh-master/api/nope' }))
    expect(response.status).toBe(404)
    expect(response.json).toMatchObject({ error: { code: 'master/not-found' } })
  })

  it('answers a wrong method with 405 and an Allow header', async () => {
    const response = await call(handlerFor(service()), fakeRequest({
      method: 'POST',
      url: '/dsh-master/api/nodes',
    }))
    expect(response.status).toBe(405)
    expect(response.headers['allow']).toBe('GET, HEAD')
  })

  it('answers 503 when the service is not mounted', async () => {
    const response = await call(handlerFor(undefined), fakeRequest({ url: '/dsh-master/api/nodes' }))
    expect(response.status).toBe(503)
    expect(response.json).toMatchObject({ error: { code: 'master/unavailable' } })
  })

  it('returns the status envelope', async () => {
    const response = await call(handlerFor(service()), fakeRequest({ url: '/dsh-master/api/status' }))
    expect(response.status).toBe(200)
    expect(response.json).toMatchObject({ ok: true, value: { nodeCount: 1, promptEnabled: false } })
  })

  it('requires nodeId on the session list', async () => {
    const response = await call(handlerFor(service()), fakeRequest({ url: '/dsh-master/api/sessions' }))
    expect(response.status).toBe(400)
    expect(response.json).toMatchObject({ error: { code: 'master/invalid-arguments' } })
  })
})

describe('the prompt gate', () => {
  it('refuses before reading the body when prompting is disabled', async () => {
    let called = false
    const master = service({ prompt: () => { called = true; return Promise.resolve() } })
    const response = await call(handlerFor(master), fakeRequest({
      method: 'POST',
      url: '/dsh-master/api/session/prompt',
      headers: { host: '127.0.0.1:43120', 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: 'n', sessionId: 's', text: 'hi' }),
    }))
    expect(response.status).toBe(403)
    expect(response.json).toMatchObject({ error: { code: 'master/prompt-disabled' } })
    // The deployment's choice does not depend on what the caller sent, and nothing
    // may run a turn on a remote machine while it is off.
    expect(called).toBe(false)
  })

  it('passes the prompt through when enabled, defaulting to queue', async () => {
    const seen: unknown[][] = []
    const master = service({
      promptEnabled: true,
      prompt: (...args: unknown[]) => { seen.push(args); return Promise.resolve() },
    })
    const response = await call(handlerFor(master), fakeRequest({
      method: 'POST',
      url: '/dsh-master/api/session/prompt',
      headers: { host: '127.0.0.1:43120', 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: 'n1', sessionId: 's1', text: '检查类型错误' }),
    }))
    expect(response.status).toBe(200)
    expect(response.json).toMatchObject({ ok: true, value: { accepted: true } })
    expect(seen[0]?.slice(0, 4)).toEqual(['n1', 's1', '检查类型错误', 'queue'])
  })

  it('archives the requested remote session and returns the complete archive set', async () => {
    const seen: unknown[][] = []
    const master = service({
      archiveSession: (...args: unknown[]) => {
        seen.push(args)
        return Promise.resolve({ archivedSessionIds: ['previously-archived', 'session-1'] })
      },
    })
    const response = await call(handlerFor(master), fakeRequest({
      method: 'POST',
      url: '/dsh-master/api/session/archive',
      headers: { host: '127.0.0.1:43120', 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: 'node-1', sessionId: 'session-1' }),
    }))

    expect(response.status).toBe(200)
    expect(response.json).toEqual({
      ok: true,
      value: { archivedSessionIds: ['previously-archived', 'session-1'] },
    })
    expect(seen[0]).toEqual(['node-1', 'session-1'])
  })

  it('honours an explicit steer mode', async () => {
    const seen: unknown[][] = []
    const master = service({
      promptEnabled: true,
      prompt: (...args: unknown[]) => { seen.push(args); return Promise.resolve() },
    })
    await call(handlerFor(master), fakeRequest({
      method: 'POST',
      url: '/dsh-master/api/session/prompt',
      headers: { host: '127.0.0.1:43120', 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: 'n1', sessionId: 's1', text: '停一下', mode: 'steer' }),
    }))
    expect(seen[0]?.[3]).toBe('steer')
  })

  it('refuses an unreadable body and a missing field', async () => {
    const master = service({ promptEnabled: true })
    const notJson = await call(handlerFor(master), fakeRequest({
      method: 'POST',
      url: '/dsh-master/api/session/prompt',
      headers: { host: '127.0.0.1:43120' },
      body: 'not json',
    }))
    expect(notJson.status).toBe(400)

    const missing = await call(handlerFor(master), fakeRequest({
      method: 'POST',
      url: '/dsh-master/api/session/prompt',
      headers: { host: '127.0.0.1:43120' },
      body: JSON.stringify({ nodeId: 'n1', sessionId: 's1' }),
    }))
    expect(missing.status).toBe(400)
    expect(missing.json).toMatchObject({ error: { code: 'master/invalid-arguments' } })
  })

  it('answers 413 for a body over the cap', async () => {
    const response = await call(handlerFor(service({ promptEnabled: true })), fakeRequest({
      method: 'POST',
      url: '/dsh-master/api/session/prompt',
      headers: { host: '127.0.0.1:43120' },
      body: JSON.stringify({ nodeId: 'n', sessionId: 's', text: 'x'.repeat(MAX_PROMPT_BODY_BYTES + 1) }),
    }))
    expect(response.status).toBe(413)
    expect(response.json).toMatchObject({ error: { code: 'master/too-large' } })
  })
})

describe('the follow route', () => {
  it('frames the stream as open, data, end', async () => {
    const master = service({
      follow: async function* () { yield { type: 'snapshot', records: [] } },
    })
    const response = await call(handlerFor(master), fakeRequest({
      url: '/dsh-master/api/session/follow?nodeId=n1&sessionId=s1',
    }))
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('application/x-ndjson; charset=utf-8')
    const records = response.body.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(records.map(record => record['type'])).toEqual(['open', 'data', 'end'])
  })

  it('reports a mid-stream failure as an error record, since the status is already sent', async () => {
    const master = service({
      follow: async function* () {
        yield { type: 'snapshot', records: [] }
        throw Object.assign(new Error('the node went away'), {
          toWire: () => ({ code: 'node/connection-lost', message: 'the node went away' }),
        })
      },
    })
    const response = await call(handlerFor(master), fakeRequest({
      url: '/dsh-master/api/session/follow?nodeId=n1&sessionId=s1',
    }))
    expect(response.status).toBe(200)
    const records = response.body.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>)
    expect(records.at(-1)).toMatchObject({ type: 'error', error: { code: 'node/connection-lost' } })
  })

  it('requires both parameters', async () => {
    const response = await call(handlerFor(service()), fakeRequest({
      url: '/dsh-master/api/session/follow?nodeId=n1',
    }))
    expect(response.status).toBe(400)
  })
})
