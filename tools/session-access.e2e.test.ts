import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import Projections from '@deepseek-ai/dsh-session-projection'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import Presets from '@deepseek-ai/dsh-permission-presets'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import FileSystem from '@deepseek-ai/dsh-fs-sandbox'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway'
import { NodeSessionAccess, ACCESS_DESCRIPTORS } from '../../dsh-node/src/session-access.js'
import { DshNodeHost, resolveNodeConfig } from '../../dsh-node/src/index.js'
import { Coordinator } from '../../dsh-coordinator/src/server.js'
import { silentLogger } from '../../dsh-coordinator/src/log.js'
import { CoordinatorClient } from '../src/coordinator/client.js'
import { MasterService } from '../src/service.js'
import { createMasterRouteHandler } from '../src/http-api.js'
import { SessionAccessController } from '../src/client/session-access.js'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join, resolve, sep } from 'node:path'

describe('remote session permission integration', () => {
  it('resumes one original approval across real transports and restores confinement when switched back', async () => {
    const scratch = resolve(process.env['DSH_ACCESS_E2E_ROOT'] ?? '.tmp')
    await mkdir(scratch, { recursive: true })
    const base = await mkdtemp(join(scratch, 'session-access-e2e-'))
    const workspace = join(base, 'workspace'), outside = join(base, 'outside.txt')
    await mkdir(workspace)
    const ctx = new Context()
    const fibers: Awaited<ReturnType<Context['plugin']>>[] = []
    const mount = async (plugin: unknown, config?: unknown): Promise<void> => { fibers.push(await ctx.plugin(plugin as never, config as never)) }
    const coordinator = new Coordinator({ host: '127.0.0.1', port: 0, enrollment: { kind: 'shared-secret', token: 'session-access-e2e-token' }, apiToken: 'session-access-e2e-operator', logger: silentLogger })
    let node: DshNodeHost | undefined
    let access: NodeSessionAccess | undefined
    let masterServer: ReturnType<typeof createServer> | undefined
    let disposeAccess: (() => void) | undefined
    let disposeInvocations: (() => Promise<void>) | undefined
    let disposeLookup: (() => Promise<void>) | undefined
    let disposeAnswerer: (() => boolean) | undefined
    const abort = new AbortController()
    try {
      await mount(SessionStore)
      await mount(Projections)
      await mount(SandboxPolicy, { mode: 'workspace-write', workspaceRoot: workspace })
      await mount(FileSystem, { cwd: workspace })
      ctx.provide('shell', { sandboxMode: 'workspace-write' })
      await mount(ApprovalService)
      await mount(Presets)
      await mount(TypertRegistry)
      await mount(TypertGatewayService, { websocketHeartbeatIntervalMs: 2000 })
      const session = ctx.sessions.create(SessionId('access-e2e'), { meta: { cwd: workspace } })
      const unrelated = ctx.sessions.create(SessionId('unrelated'), { meta: { cwd: workspace } })
      session.append('turn/start', { turn: 1 })
      const agent = { id: session.id, session, inject: vi.fn() } as unknown as Agent
      disposeLookup = ctx.typert.lookups.register('agent', { parameter: 'agent', wire: 'agentId', hostTypeSymbol: '@deepseek-ai/dsh-agent#Agent', wireTypeSymbol: '@deepseek-ai/dsh-session/types#SessionId', resolve: id => id === session.id ? agent : undefined })
      access = new NodeSessionAccess(ctx)
      disposeAccess = ctx.provide('nodeSessionAccess', access)
      disposeInvocations = ctx.typert.register({ package: 'dsh-node-session-access-e2e', face: 'host', schemas: [], model: { services: [], events: [], objects: [] }, invocations: ACCESS_DESCRIPTORS })
      disposeAnswerer = ctx.on('approval/request', (request, next) => access!.answer(request, next), { prepend: true, global: true })
      await coordinator.start()
      const address = coordinator.address!
      const config = resolveNodeConfig({ coordinatorUrl: address.url, identityFile: join(base, 'identity.json'), auth: { token: 'session-access-e2e-token' } }, {})
      expect(config.status).toBe('ok')
      node = new DshNodeHost({ ctx, resolution: config, env: {}, logSink: () => {} })
      await node.start()
      const client = new CoordinatorClient({ baseUrl: address.url.replace(/^ws/, 'http').replace(/\/node$/, ''), apiToken: 'session-access-e2e-operator', requestTimeoutMs: 5000 })
      for (let attempt = 0; attempt < 100 && node.status.state !== 'ready'; attempt++) await new Promise(resolve => setTimeout(resolve, 20))
      expect(node.status.state).toBe('ready')
      const service = new MasterService(client, true)
      const handler = createMasterRouteHandler({ service: () => service, trustedHosts: () => [] })
      masterServer = createServer(handler)
      await new Promise<void>(resolve => { masterServer!.listen(0, '127.0.0.1', resolve) })
      const masterAddress = masterServer.address() as { port: number }
      const baseUrl = `http://127.0.0.1:${masterAddress.port}/dsh-master/api/session/access`
      const invoke = async (path: string, body?: unknown): Promise<unknown> => {
        const response = await fetch(baseUrl + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        const result = await response.json() as { ok: boolean; value?: unknown; error?: unknown }
        if (!result.ok) throw new Error(JSON.stringify(result.error))
        return result.value
      }
      const transport = {
        read: async (nodeId: string, sessionId: string) => await invoke(`?${new URLSearchParams({ nodeId, sessionId })}`) as Awaited<ReturnType<MasterService['fetchSessionAccess']>>,
        set: async (nodeId: string, sessionId: string, preset: string, expectedRevision: string, operationId: string) => await invoke('/set', { nodeId, sessionId, preset, expectedRevision, operationId }) as Awaited<ReturnType<MasterService['setSessionAccess']>>,
        decide: async (nodeId: string, sessionId: string, requestId: string, outcome: 'allowed-once' | 'rejected', operationId: string) => await invoke('/decide', { nodeId, sessionId, requestId, outcome, operationId }) as Awaited<ReturnType<MasterService['decideSessionApproval']>>,
      }
      const controller = new SessionAccessController(node.nodeId, session.id, true, transport)
      await controller.refresh()
      expect(controller.getSnapshot().access?.currentValue).toBe('workspace-write')
      const target = await ctx.fs.resolve(outside)
      await expect(ctx.fs.writeText(target, 'denied', undefined, undefined, ctx.sandboxPolicy.resolve({ session }))).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
      let executions = 0
      const original = ctx.approval.request({ agent, toolName: 'fixture-write', reason: 'outside workspace', signal: abort.signal }).then(async outcome => {
        if (outcome !== 'allowed-once') throw new Error(outcome)
        executions++
        await ctx.fs.writeText(target, 'approved', undefined, undefined, ctx.sandboxPolicy.resolve({ session }))
      })
      await controller.refresh()
      expect(controller.getSnapshot().access?.pendingApprovals).toHaveLength(1)
      await controller.choose('danger-full-access')
      await controller.confirm()
      await original
      expect(controller.getSnapshot().error).toBeUndefined()
      expect(await readFile(outside, 'utf8')).toBe('approved')
      expect(executions).toBe(1)
      expect(ctx.permissionPresets.current(unrelated)).toBe('workspace-write')
      const restored = Session.create(SessionId('restored'), session.snapshotEvents())
      expect(ctx.permissionPresets.current(restored)).toBe('danger-full-access')
      await controller.choose('workspace-write')
      expect(controller.getSnapshot().access?.currentValue).toBe('workspace-write')
      await expect(ctx.fs.writeText(target, 'denied-again', undefined, undefined, ctx.sandboxPolicy.resolve({ session }))).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
      expect(session.snapshotEvents().filter(event => event.type === 'approval/decided')).toHaveLength(1)
      controller.dispose()
    } finally {
      abort.abort()
      if (masterServer !== undefined) await new Promise<void>(resolve => { masterServer!.close(() => resolve()) })
      await node?.stop('e2e-complete')
      await coordinator.stop()
      disposeAnswerer?.()
      access?.dispose()
      await disposeInvocations?.()
      await disposeLookup?.()
      disposeAccess?.()
      for (const fiber of fibers.reverse()) await fiber.dispose()
      if (!resolve(base).startsWith(scratch + sep)) throw new Error('Invalid fixture cleanup path')
      await rm(base, { recursive: true, force: true })
    }
  })
})
