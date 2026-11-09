import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../src/client/api.js'
import { RemoteApprovalPanel } from '../src/client/RemoteApprovalPanel.js'
import { SessionAccessController } from '../src/client/session-access.js'
import { CoordinatorClient } from '../src/coordinator/client.js'
import { MasterService } from '../src/service.js'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ IconWarningOutlineRegular: () => null }))

describe('native remote approval forwarding', () => {
  it('keeps the requested permission and reason readable without disabling forwarded approvals', () => {
    const markup = renderToStaticMarkup(createElement(RemoteApprovalPanel, {
      enabled: true,
      controller: undefined,
      state: { unsupported: true, busy: false, forwardedApprovals: [
        { requestId: 'a', toolName: 'pwsh', reason: 'escalate sandbox to danger-full-access: 创建测试文件？' },
        { requestId: 'b', toolName: 'write', reason: '其他工具的原始原因' },
      ] },
    }))
    expect(markup).toContain('本次操作请求完全访问权限')
    expect(markup).toContain('创建测试文件？')
    expect(markup).toContain('其他工具的原始原因')
    expect(markup).not.toContain('escalate sandbox to')
    expect(markup).toContain('允许一次</button>')
    expect(markup).toContain('拒绝</button>')
    expect(markup).not.toContain('disabled=')
  })

  it('shows and answers the existing approval when permission switching is unsupported', async () => {
    const pending = vi.fn(async () => ({ requests: [{ requestId: 'event-1', toolName: 'write' }] }))
    const decideForwarded = vi.fn(async () => {
      pending.mockResolvedValue({ requests: [] })
      return { accepted: true as const }
    })
    const legacyDecide = vi.fn()
    const set = vi.fn()
    const controller = new SessionAccessController('node', 'session', true, {
      read: async () => { throw new ApiError('nodeSessionAccess/unsupported', 'requires custom host') },
      set, decide: legacyDecide, pending, decideForwarded,
    })
    await controller.refresh()
    expect(controller.getSnapshot()).toMatchObject({ unsupported: true, forwardedApprovals: [{ requestId: 'event-1' }] })
    expect(controller.getSnapshot().error).toBeUndefined()
    await controller.decide('another-event', 'allowed-once')
    expect(decideForwarded).not.toHaveBeenCalled()
    await controller.decide('event-1', 'allowed-once')
    expect(decideForwarded).toHaveBeenCalledWith('node', 'session', 'event-1', 'allowed-once', expect.any(AbortSignal))
    expect(controller.getSnapshot().forwardedApprovals).toEqual([])
    expect(legacyDecide).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('forwards only named approval methods and prevents read-only master from claiming approvals', async () => {
    const calls: unknown[] = []
    const client = new CoordinatorClient({ baseUrl: 'http://127.0.0.1:1234', requestTimeoutMs: 5000,
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { endpoint: string }
        calls.push(body)
        return Response.json({ ok: true, value: body.endpoint.endsWith('/pending') ? { requests: [] } : { accepted: true } })
      },
    })
    const locked = new MasterService(client, false)
    await locked.pendingForwardedApprovals('n', 's')
    expect(() => locked.decideForwardedApproval('n', 's', 'a', 'rejected')).toThrow()
    await new MasterService(client, true).decideForwardedApproval('n', 's', 'a', 'rejected')
    expect(calls).toEqual([
      { nodeId: 'n', endpoint: 'nodeApprovals/pending', args: { sessionId: 's', interactive: false } },
      { nodeId: 'n', endpoint: 'nodeApprovals/decide', args: { sessionId: 's', requestId: 'a', outcome: 'rejected' } },
    ])
  })
})
