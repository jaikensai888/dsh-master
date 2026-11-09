import { describe, expect, it, vi } from 'vitest'
import { SessionAccessController } from '../src/client/session-access.js'
import type { SessionAccess } from '../src/session-access-protocol.js'

const snapshot = (full = false): SessionAccess => ({ currentValue: full ? 'danger-full-access' : 'workspace-write', revision: full ? 'r2' : 'r1', supportsResumePending: true,
  options: [{ value: 'workspace-write', name: 'workspace-write', sandbox: 'workspace-write', approval: 'ask' }, { value: 'danger-full-access', name: 'danger-full-access', sandbox: 'danger-full-access', approval: 'never' }], pendingApprovals: [{ requestId: 'a1', toolName: 'write' }] })
function fixture() {
  let current = snapshot()
  const calls: string[] = []
  const api = {
    read: vi.fn(async () => current),
    set: vi.fn(async () => { calls.push('set'); current = snapshot(true); return current }),
    decide: vi.fn(async (_n: string, _s: string, id: string) => { calls.push(id); return { outcome: 'allowed-once' as const } }),
  }
  const controller = new SessionAccessController('n', 's', true, api)
  return { controller, api, calls, update: (next: SessionAccess) => { current = next } }
}
describe('remote session access state', () => {
  it('clears a recovered read error and a resolved partial-approval warning', async () => {
    const { controller, api, update } = fixture()
    api.read.mockRejectedValueOnce(new Error('offline'))
    await controller.refresh()
    expect(controller.getSnapshot().error).toBe('offline')
    await controller.refresh()
    expect(controller.getSnapshot().error).toBeUndefined()
    await controller.choose('danger-full-access')
    api.decide.mockRejectedValueOnce(new Error('connection lost'))
    await controller.confirm()
    expect(controller.getSnapshot().error).toContain('权限已切换')
    await controller.refresh()
    expect(controller.getSnapshot().error).toContain('权限已切换')
    update({ ...snapshot(true), pendingApprovals: [] })
    await controller.refresh()
    expect(controller.getSnapshot().error).toBeUndefined()
  })
  it('switches first and approves only requests captured in the confirmation', async () => {
    const { controller, api, calls, update } = fixture()
    await controller.refresh()
    await controller.choose('danger-full-access')
    expect(api.set).not.toHaveBeenCalled()
    expect(controller.getSnapshot().confirmation?.requests.map(r => r.requestId)).toEqual(['a1'])
    update({ ...snapshot(), pendingApprovals: [{ requestId: 'a2', toolName: 'other' }] })
    await controller.confirm()
    expect(calls).toEqual(['set', 'a1'])
    expect(controller.getSnapshot().access?.currentValue).toBe('danger-full-access')
  })
  it('does not approve after set failure and keeps partial success visible', async () => {
    const { controller, api } = fixture()
    await controller.refresh()
    await controller.choose('danger-full-access')
    api.set.mockRejectedValueOnce(new Error('offline'))
    await controller.confirm()
    expect(api.decide).not.toHaveBeenCalled()
    expect(controller.getSnapshot().error).toContain('offline')
    await controller.refresh()
    await controller.choose('danger-full-access')
    api.decide.mockRejectedValueOnce(new Error('connection lost'))
    await controller.confirm()
    expect(controller.getSnapshot().access?.currentValue).toBe('danger-full-access')
    expect(controller.getSnapshot().error).toContain('权限已切换')
  })
  it('ignores a response after disposal and refuses disabled mutations', async () => {
    const { controller, api } = fixture()
    let finish!: (value: SessionAccess) => void
    api.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const read = controller.refresh()
    controller.dispose()
    finish(snapshot())
    await read
    expect(controller.getSnapshot().access).toBeUndefined()
    const other = fixture()
    await other.controller.refresh()
    other.controller.setEnabled(false)
    await other.controller.choose('danger-full-access')
    expect(other.api.set).not.toHaveBeenCalled()
    expect(other.controller.getSnapshot().confirmation).toBeUndefined()
  })
})
