import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSessionAccess, setSessionAccess, decideSessionApproval } from '../src/client/api.js'
import { CoordinatorClient } from '../src/coordinator/client.js'

const snapshot = { currentValue: 'workspace-write', options: [{ value: 'workspace-write', name: 'workspace-write', sandbox: 'workspace-write', approval: 'ask' }], revision: 'rev1', pendingApprovals: [], supportsResumePending: true }
afterEach(() => vi.unstubAllGlobals())

describe('session access transport', () => {
  it('uses named routes and preserves session identity and cancellation', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true, value: snapshot })))
    vi.stubGlobal('fetch', fetcher)
    const controller = new AbortController()
    await expect(fetchSessionAccess('n 1', 's/1', controller.signal)).resolves.toEqual(snapshot)
    expect(fetcher.mock.calls[0]).toEqual(['/dsh-master/api/session/access?nodeId=n+1&sessionId=s%2F1', expect.objectContaining({ signal: controller.signal })])
    await setSessionAccess('n', 's', 'danger-full-access', 'rev1', 'op1', controller.signal)
    expect(fetcher.mock.calls[1]).toEqual(['/dsh-master/api/session/access/set', expect.objectContaining({ method: 'POST', body: JSON.stringify({ nodeId: 'n', sessionId: 's', preset: 'danger-full-access', expectedRevision: 'rev1', operationId: 'op1' }) })])
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ ok: true, value: { outcome: 'allowed-once' } })))
    await expect(decideSessionApproval('n', 's', 'r1', 'allowed-once', 'op2')).resolves.toEqual({ outcome: 'allowed-once' })
  })

  it('maps only fixed Remote endpoints and rejects malformed upstream snapshots', async () => {
    let value: unknown = snapshot
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true, value })))
    const client = new CoordinatorClient({ baseUrl: 'http://127.0.0.1:1234', requestTimeoutMs: 5000, fetchImpl: fetcher })
    await expect(client.fetchSessionAccess('n', 's')).resolves.toEqual(snapshot)
    expect(fetcher.mock.calls[0]).toEqual(['http://127.0.0.1:1234/api/invoke', expect.objectContaining({ body: JSON.stringify({ nodeId: 'n', endpoint: 'nodeSessionAccess/get', args: { sessionId: 's', interactive: false } }) })])
    value = { ...snapshot, options: [{ value: 'fake' }] }
    await expect(client.fetchSessionAccess('n', 's')).rejects.toThrow()
  })
})
