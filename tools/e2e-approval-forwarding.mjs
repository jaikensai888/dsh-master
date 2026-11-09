/** Run against installed Desktop packages, without loading or modifying its real profile. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Coordinator, silentLogger } from '../../dsh-coordinator/lib/index.js'
import * as nodePlugin from '../../dsh-node/lib/index.js'
import { CoordinatorClient, createMasterRouteHandler, MasterService } from '../lib/index.js'

const desktopRoot = process.argv[2]
if (!desktopRoot) throw new Error('Usage: node tools/e2e-approval-forwarding.mjs <DSH Desktop resources/app directory>')
const desktop = createRequire(join(resolve(desktopRoot), 'package.json'))
const load = name => import(pathToFileURL(desktop.resolve(`@deepseek-ai/${name}`)).href)
const { Context } = await load('cordis')
const { createScope } = await load('dsh-scope')
const { HostConnectionService } = await load('dsh-client-connection')
const { default: Registry } = await load('dsh-typert-registry')
const { default: RemoteAccess } = await load('dsh-api-remote-access')
const { default: Gateway } = await load('dsh-api-gateway')
const { default: Approval } = await load('dsh-user-approval')
const remotes = await load('dsh-api-remotes')

const scratch = resolve(tmpdir())
const home = await mkdtemp(join(scratch, 'dsh-approval-e2e-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = home
const ctx = new Context()
const fibers = []
const stop = new AbortController()
const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(12_000)])
const coordinator = new Coordinator({ host: '127.0.0.1', port: 0, logger: silentLogger,
  enrollment: { kind: 'shared-secret', token: 'isolated-approval-node' }, apiToken: 'isolated-approval-master' })
let peer, stream, agentScope, master
const mount = async (plugin, config) => { fibers.push(await ctx.plugin(plugin, config)) }

async function eventually(read, accept) {
  while (!signal.aborted) {
    const value = await read()
    if (accept(value)) return value
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw signal.reason
}

try {
  // This test uses the real in-process Connection carrier and does not authenticate any external browser.
  await mount(scope => { new HostConnectionService(scope, [], {}) })
  for (const plugin of [Registry, RemoteAccess, Gateway, Approval, { apply: remotes.apply, inject: remotes.inject }]) await mount(plugin)
  assert.equal(typeof ctx.approval.decidePending, 'undefined')
  assert.equal(ctx.get('permissionPresets', false), undefined)
  await coordinator.start()
  const coordinatorUrl = coordinator.address.url
  await mount({ apply: nodePlugin.apply, inject: nodePlugin.inject }, {
    coordinatorUrl, identityFile: join(home, 'identity.json'), auth: { token: 'isolated-approval-node' }, usage: { enabled: false },
  })
  const node = await eventually(() => ctx.get('dshNode', false), value => value?.status.state === 'ready')
  const client = new CoordinatorClient({ baseUrl: coordinatorUrl.replace(/^ws/, 'http').replace(/\/node$/, ''), apiToken: 'isolated-approval-master', requestTimeoutMs: 4_000 })
  let enabled = true
  const service = new MasterService(client, () => enabled)
  master = createServer(createMasterRouteHandler({ service: () => service, trustedHosts: () => [] }))
  await new Promise(resolve => { master.listen(0, '127.0.0.1', resolve) })
  const base = `http://127.0.0.1:${master.address().port}/dsh-master/api/session`
  const sessionId = 'installed-desktop-approval'
  const address = { nodeId: node.nodeId, sessionId }
  const query = `?${new URLSearchParams(address)}`
  const invoke = async (path, body) => {
    const response = await fetch(base + path, body === undefined ? { signal } : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal,
    })
    return { status: response.status, body: await response.json() }
  }

  // The original approval already exists on Desktop before master opens its approval stream.
  peer = ctx.connection.createPeer({ principal: { kind: 'owner' }, interactions: 'answer' })
  stream = (await ctx.typertGateway.wireStream.open('$events', { args: {} }, (async function* () {})(), peer, signal))[Symbol.asyncIterator]()
  const ready = (await stream.next()).value
  assert.equal(ready.type, 'ready')
  const localClientId = ready.clientId
  const events = [{ type: 'turn/start', data: {} }]
  const session = { get seq() { return events.length }, eventAt: seq => events[seq], append: (type, data) => events.push({ type, data }) }
  const agent = { id: sessionId, session }
  agentScope = createScope(ctx, agent)
  agent.ctx = agentScope.ctx
  const pending = ctx.approval.request({ agent, toolName: 'fixture-write', signal })
  const original = (await stream.next()).value
  assert.equal(original.event, 'approval/request')

  assert.equal((await invoke(`/access${query}`)).body.error.code, 'nodeSessionAccess/unsupported')
  const result = await eventually(() => invoke(`/approvals${query}`), value => value.body.value?.requests?.length === 1)
  const { requestId } = result.body.value.requests[0]
  assert.equal(requestId, original.eventId)
  enabled = false
  const denied = await invoke('/approval-decision', { ...address, requestId, outcome: 'allowed-once' })
  assert.equal(denied.status, 403)
  assert.equal(denied.body.error.code, 'master/prompt-disabled')
  enabled = true
  assert.equal((await invoke('/approval-decision', { ...address, sessionId: 'foreign', requestId, outcome: 'allowed-once' })).body.error.code, 'nodeApprovals/not-found')
  assert.deepEqual((await invoke('/approval-decision', { ...address, requestId, outcome: 'allowed-once' })).body.value, { accepted: true })
  assert.equal(await pending, 'allowed-once')
  assert.deepEqual((await stream.next()).value, { type: 'cancel', eventId: requestId })
  assert.equal((await invoke('/approval-decision', { ...address, requestId, outcome: 'allowed-once' })).body.error.code, 'nodeApprovals/not-found')
  assert.equal(events.filter(event => event.type === 'approval/decided').length, 1)

  const second = ctx.approval.request({ agent, toolName: 'fixture-write', signal })
  const next = (await stream.next()).value
  await eventually(() => invoke(`/approvals${query}`), value => value.body.value?.requests?.some(request => request.requestId === next.eventId))
  assert.deepEqual((await invoke('/approval-decision', { ...address, requestId: next.eventId, outcome: 'rejected' })).body.value, { accepted: true })
  assert.equal(await second, 'rejected')
  assert.deepEqual((await stream.next()).value, { type: 'cancel', eventId: next.eventId })
  assert.equal(events.filter(event => event.type === 'approval/decided').length, 2)

  const third = ctx.approval.request({ agent, toolName: 'fixture-write', signal })
  const local = (await stream.next()).value
  await eventually(() => invoke(`/approvals${query}`), value => value.body.value?.requests?.some(request => request.requestId === local.eventId))
  const rpcId = 'fixture-local-answer'
  const response = await ctx.connection.createSharedFetchHandler('/api').fetch(new Request('http://localhost/api/$events/result', {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal,
    body: JSON.stringify({ type: 'client-request', rpcId, method: '$events/result', payload: { args: {
      clientId: localClientId, eventId: local.eventId, outcome: { kind: 'result', value: 'rejected' },
    } } }),
  }), peer)
  assert.equal((await response.json()).result.ok, true)
  assert.equal(await third, 'rejected')
  await eventually(() => invoke(`/approvals${query}`), value => value.body.value?.requests?.length === 0)
  assert.equal((await invoke('/approval-decision', { ...address, requestId: local.eventId, outcome: 'allowed-once' })).body.error.code, 'nodeApprovals/not-found')
  assert.equal(events.filter(event => event.type === 'approval/decided').length, 3)

  // Closing the local listener leaves the bridge for this session as the only answering peer.
  await stream.return()
  const otherSessionId = 'another-desktop-session'
  const otherAgent = { id: otherSessionId, session }
  const otherScope = createScope(ctx, otherAgent)
  try {
    otherAgent.ctx = otherScope.ctx
    const foreign = ctx.approval.request({ agent: otherAgent, toolName: 'fixture-other-session', signal })
    let settled = false
    void foreign.then(() => { settled = true }, () => { settled = true })
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(settled, false, 'viewing one session must leave other sessions waiting for their own answer')
    const otherQuery = `?${new URLSearchParams({ ...address, sessionId: otherSessionId })}`
    const other = await eventually(() => invoke(`/approvals${otherQuery}`), value => value.body.value?.requests?.length === 1)
    assert.deepEqual((await invoke('/approval-decision', { ...address, sessionId: otherSessionId,
      requestId: other.body.value.requests[0].requestId, outcome: 'rejected' })).body.value, { accepted: true })
    assert.equal(await foreign, 'rejected')
  } finally {
    await otherScope.dispose()
  }
  console.log('PASS: stock Desktop host, real node and Coordinator, master HTTP, replay, allow, reject, local answer, session isolation and read-only refusal')
} finally {
  stop.abort()
  await stream?.return()
  await peer?.dispose()
  await agentScope?.dispose()
  if (master !== undefined) await new Promise(resolve => { master.close(() => resolve()) })
  for (const fiber of fibers.reverse()) await fiber.dispose()
  await coordinator.stop()
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  if (!resolve(home).startsWith(scratch + sep)) throw new Error('Invalid fixture cleanup path')
  await rm(home, { recursive: true, force: true })
}
