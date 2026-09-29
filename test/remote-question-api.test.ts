import { afterEach, describe, expect, it, vi } from 'vitest'
import { answerRemoteQuestion, cancelRemoteQuestion, fetchPendingQuestions } from '../src/client/api.js'

afterEach(() => { vi.unstubAllGlobals() })

describe('remote question browser API', () => {
  it('fetches only the selected node/session and passes its abort signal', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ok: true, value: { requests: [] } })))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await expect(fetchPendingQuestions('node 1', 'session/1', controller.signal)).resolves.toEqual({ requests: [] })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/dsh-master/api/session/questions?nodeId=node+1&sessionId=session%2F1')
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal)
  })

  it('posts an answer or cancellation to question routes, never to session/prompt', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ok: true, value: { accepted: true } })))
    vi.stubGlobal('fetch', fetchMock)
    const answer = { answers: [{ id: 'q1', selected: ['A'] }] }

    await answerRemoteQuestion('node-1', 'session-1', 'r1', answer)
    await cancelRemoteQuestion('node-1', 'session-1', 'r1')
    expect(fetchMock.mock.calls.map(([url, init]) => [url, JSON.parse(String(init?.body))])).toEqual([
      ['/dsh-master/api/session/question-answer', { nodeId: 'node-1', sessionId: 'session-1', requestId: 'r1', answer }],
      ['/dsh-master/api/session/question-cancel', { nodeId: 'node-1', sessionId: 'session-1', requestId: 'r1' }],
    ])
  })

  it('lets session cleanup abort an in-flight question poll', async () => {
    const fetchMock = vi.fn((_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) }, { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const pending = fetchPendingQuestions('node-1', 'session-1', controller.signal)

    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
