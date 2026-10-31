#!/usr/bin/env node
/**
 * Three-repository smoke test for the session-file feature.
 *
 * It starts the **real** coordinator, the **real** `dsh-node` host with its real
 * `SessionFileStore`/`SessionFilesOwner`, and the **real** `dsh-master` route
 * handler, then drives them exactly as the browser would:
 *
 *   browser → dsh-master /api/files → coordinator /api/files → WS → dsh-node
 *
 * Only the node's local DSH Gateway/registry are stand-ins (they ship with DSH
 * and are outside the `dsh-node/1` protocol); the file path, validation, storage,
 * commit, artifact snapshot and download are production code from `lib/`.
 *
 * Prerequisite: all three repositories are built (`pnpm build`, or the direct
 * `tsc -p tsconfig.build.json && tsdown` pair).
 *
 * Usage (from dsh-master):
 *   node tools/e2e-session-files.mjs
 *
 * Exit code 0 means every check passed; a failure prints the check and exits 1.
 */

import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MASTER = resolve(HERE, '..')
const NODE_REPO = resolve(MASTER, '..', 'dsh-node')
const COORDINATOR_REPO = resolve(MASTER, '..', 'dsh-coordinator')

const load = specifier => import(pathToFileURL(specifier).href)
const { Coordinator, silentLogger } = await load(join(COORDINATOR_REPO, 'lib', 'index.js'))
const {
  DshNodeHost,
  FILES_DESCRIPTORS,
  SessionFileStore,
  SessionFilesOwner,
  resolveNodeConfig,
} = await load(join(NODE_REPO, 'lib', 'index.js'))
const {
  CoordinatorClient,
  MasterService,
  createMasterRouteHandler,
} = await load(join(MASTER, 'lib', 'index.js'))

const TOKEN = 'e2e-session-files-secret'
const NODE_NS = 'demo'
const SESSION = 'session-11111111-1111-4111-8111-111111111111'
const OTHER = 'session-22222222-2222-4222-8222-222222222222'
const CHUNK = 256 * 1024

const checks = []
function check(label, condition, detail = '') {
  if (!condition) throw new Error(`${label}${detail === '' ? '' : `: ${detail}`}`)
  checks.push(label)
}

class FakeRemoteError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'RemoteError'
    this.code = code
    this.details = details
    this.isDSHRemoteError = true
  }
}

class FakeGateway {
  constructor(owner) {
    this.owner = owner
    this.invocations = []
    this.wireStream = {
      failure: error => {
        if (error instanceof FakeRemoteError) {
          return { code: error.code, message: error.message, details: error.details }
        }
        const remote = error
        if (remote?.isDSHRemoteError === true && typeof remote.code === 'string') {
          return {
            code: remote.code,
            message: error instanceof Error ? error.message : String(error),
            details: typeof remote.details === 'object' && remote.details !== null ? remote.details : {},
          }
        }
        return {
          code: 'gateway/internal',
          message: error instanceof Error ? error.message : String(error),
          details: {},
        }
      },
    }
  }

  async invoke(request) {
    const endpoint = `${request.namespace}/${request.method}`
    this.invocations.push({ endpoint, args: request.args })
    if (request.namespace === 'sessionFiles') {
      const descriptor = FILES_DESCRIPTORS.find(entry => entry.method === request.method)
      if (descriptor === undefined) throw new FakeRemoteError('gateway/method-unavailable', `no ${endpoint}`)
      const positional = descriptor.parameters.map(parameter => request.args[parameter.name])
      const implementation = this.owner[request.method]
      if (typeof implementation !== 'function') throw new FakeRemoteError('gateway/method-unavailable', `no ${endpoint}`)
      return await implementation.apply(this.owner, positional)
    }
    if (endpoint === `${NODE_NS}/echo`) return { echoed: request.args }
    throw new FakeRemoteError('gateway/method-unavailable', `no ${endpoint}`)
  }

  async stream(request) {
    throw new FakeRemoteError('gateway/method-unavailable', `no stream ${request.namespace}/${request.method}`)
  }
}

function registry(descriptors) {
  const byEndpoint = new Map(descriptors.map(entry => [`${entry.namespace}/${entry.method}`, entry]))
  return {
    local: {
      get: endpoint => byEndpoint.get(endpoint),
      hasSeen: endpoint => byEndpoint.has(endpoint),
      list: () => descriptors,
      subscribe: () => () => {},
    },
  }
}

const tmp = await mkdtemp(join(tmpdir(), 'dsh-files-e2e-'))
let coordinator
let node
let masterServer
let store

try {
  const workspace = join(tmp, 'workspace')
  await mkdir(workspace, { recursive: true })

  store = new SessionFileStore({
    root: join(tmp, 'node-files'),
    nodeId: () => node?.nodeId ?? 'node-e2e',
    sessionCwd: id => (id === SESSION ? workspace : undefined),
  })
  await store.open()
  const owner = new SessionFilesOwner({ store, deliveryToolAvailable: () => true })
  const gateway = new FakeGateway(owner)

  coordinator = new Coordinator({
    port: 0,
    host: '127.0.0.1',
    apiToken: TOKEN,
    enrollment: { kind: 'shared-secret', token: TOKEN },
    logger: silentLogger,
  })
  await coordinator.start()
  const coordinatorUrl = coordinator.address?.url
  if (coordinatorUrl === undefined) throw new Error('the coordinator did not listen')

  const resolution = resolveNodeConfig(
    {
      coordinatorUrl,
      identityFile: join(tmp, 'identity.json'),
      nodeName: 'e2e-files-node',
      mode: 'full-access',
      auth: { token: TOKEN },
      heartbeatIntervalMs: 250,
      handshakeTimeoutMs: 3_000,
      requestTimeoutMs: 5_000,
      maxFrameBytes: 1_048_576,
      maxInFlightRequests: 8,
      reconnect: { initialDelayMs: 30, maxDelayMs: 150, jitterRatio: 0, stableResetMs: 100 },
    },
    {},
  )
  if (resolution.status !== 'ok') throw new Error(resolution.errors.join('; '))

  const files = [
    ...FILES_DESCRIPTORS.map(entry => ({ namespace: entry.namespace, method: entry.method })),
    { namespace: NODE_NS, method: 'echo' },
  ]
  const services = new Map([
    ['typert', registry(files)],
    ['typertGateway', gateway],
  ])
  const ctx = {
    typertGateway: gateway,
    get: key => services.get(key),
  }
  node = new DshNodeHost({ ctx, resolution, env: {}, logSink: () => {} })
  await node.start()
  await waitFor(() => node.status.state === 'ready' && coordinator.listNodes().some(view => view.state === 'ready'), 5_000)
  check('real node reached ready state', node.status.state === 'ready')

  const httpOrigin = `http://${new URL(coordinatorUrl).host}`
  const client = new CoordinatorClient({ baseUrl: httpOrigin, apiToken: TOKEN, requestTimeoutMs: 10_000 })
  const service = new MasterService(client, true)
  masterServer = createServer(createMasterRouteHandler({
    service: () => service,
    trustedHosts: () => [],
  }))
  await new Promise((resolvePromise, reject) => {
    masterServer.once('error', reject)
    masterServer.listen({ host: '127.0.0.1', port: 0 }, resolvePromise)
  })
  const masterPort = masterServer.address()
  if (typeof masterPort !== 'object' || masterPort === null) throw new Error('the master route did not listen')
  const masterBase = `http://127.0.0.1:${masterPort.port}/dsh-master`

  const filePost = async (operation, body, disabled = false) => {
    const response = await fetch(`${masterBase}/api/files/${operation}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: node.nodeId, sessionId: SESSION, ...body }),
    })
    const json = await response.json()
    if (disabled) return { status: response.status, json }
    if (json.ok !== true) throw new Error(`${operation} failed: ${JSON.stringify(json.error)}`)
    return { status: response.status, json }
  }

  const described = await filePost('describe', {})
  check('master proxies describe through the coordinator', described.json.value.protocolVersion === 1)
  check('node reports the delivery tool as available', described.json.value.deliveryTool === 'available')

  const bytes = Buffer.alloc(600 * 1024)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 7) % 251
  const sha256 = createHash('sha256').update(bytes).digest('hex')

  const begun = await filePost('beginUpload', {
    name: '双向 附件.bin',
    size: bytes.length,
    clientUploadId: 'e2e-client',
  })
  let offset = 0
  while (offset < bytes.length) {
    const slice = bytes.subarray(offset, offset + CHUNK)
    const written = await filePost('writeChunk', { uploadId: begun.json.value.uploadId, offset, base64: slice.toString('base64') })
    offset = written.json.value.nextOffset
  }
  check('multi-chunk upload completed', offset === bytes.length)

  const committed = await filePost('commitUpload', {
    uploadId: begun.json.value.uploadId,
    size: bytes.length,
    sha256,
  })
  check('commit returned a confirmed attachment', committed.json.value.sha256 === sha256)
  check('browser response omits the remote path', committed.json.value.remotePath === undefined)

  const resolved = await client.fileOperation(node.nodeId, 'resolveAttachments', {
    sessionId: SESSION,
    attachmentIds: [committed.json.value.attachmentId],
  })
  check('host can resolve the attachment for a prompt', resolved.attachments?.length === 1)

  // Simulate the Agent calling deliver_file: the real store snapshots the file.
  const source = join(workspace, '交付 报告.docx')
  const document = Buffer.alloc(300 * 1024, 0x42)
  await writeFile(source, document)
  const artifact = await store.publishArtifact({ sessionId: SESSION, path: source, cwd: workspace })
  check('artifact snapshot published', artifact.state === 'ready')

  const listed = await filePost('listArtifacts', {})
  check('master lists the artifact through the coordinator', listed.json.value.artifacts.length === 1)

  const download = await fetch(`${masterBase}/api/files/download?nodeId=${node.nodeId}&sessionId=${SESSION}&artifactId=${artifact.artifactId}`)
  check('download answered 200', download.status === 200)
  check('download is octet-stream', download.headers.get('content-type') === 'application/octet-stream')
  check('download advertises the Chinese name', (download.headers.get('content-disposition') ?? '').includes("filename*=UTF-8''"))
  check('download has the exact length', download.headers.get('content-length') === String(document.length))
  const downloaded = Buffer.from(await download.arrayBuffer())
  check('downloaded bytes match the snapshot hash', createHash('sha256').update(downloaded).digest('hex') === artifact.sha256)
  check('downloaded bytes equal the source', downloaded.equals(document))
  check('downloaded file is Chinese-named', artifact.name === '交付 报告.docx')

  const other = await fetch(`${masterBase}/api/files/download?nodeId=${node.nodeId}&sessionId=${OTHER}&artifactId=${artifact.artifactId}`)
  check('another session cannot download the artifact', other.status === 404 || other.status === 410, String(other.status))

  const missing = await client.fileOperation(node.nodeId, 'readArtifactChunk', {
    sessionId: SESSION,
    artifactId: 'missing',
    offset: 0,
    length: 4,
  }).then(() => undefined, error => error)
  check('missing artifact keeps its files/* code', missing?.code === 'files/not-found', String(missing?.code))

  // Prompt-disabled behavior at the master boundary (a second service instance).
  const disabledService = new MasterService(client, false)
  const disabledServer = createServer(createMasterRouteHandler({ service: () => disabledService, trustedHosts: () => [] }))
  await new Promise((resolvePromise, reject) => {
    disabledServer.once('error', reject)
    disabledServer.listen({ host: '127.0.0.1', port: 0 }, resolvePromise)
  })
  const disabledAddress = disabledServer.address()
  const disabledBase = `http://127.0.0.1:${disabledAddress.port}/dsh-master`
  const refused = await fetch(`${disabledBase}/api/files/beginUpload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: node.nodeId, sessionId: SESSION, name: 'x', size: 1, clientUploadId: 'x' }),
  })
  check('upload is refused while allowPrompt is false', refused.status === 403, String(refused.status))
  const disabledDescribe = await fetch(`${disabledBase}/api/files/describe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: node.nodeId, sessionId: SESSION }),
  })
  check('describe stays available while allowPrompt is false', disabledDescribe.status === 200)
  await new Promise(resolvePromise => disabledServer.close(resolvePromise))

  console.log(JSON.stringify({ ok: true, checks, nodeId: node.nodeId, artifactId: artifact.artifactId }, null, 2))
} finally {
  if (masterServer !== undefined) await new Promise(resolvePromise => masterServer.close(resolvePromise)).catch(() => {})
  if (node !== undefined) await node.stop('e2e teardown').catch(() => {})
  if (coordinator !== undefined) await coordinator.stop().catch(() => {})
  if (store !== undefined) await store.close().catch(() => {})
  await rm(tmp, { recursive: true, force: true }).catch(() => {})
}

/** Poll until `probe` is true or the deadline passes. */
async function waitFor(probe, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (!probe()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the node handshake')
    await new Promise(resolvePromise => setTimeout(resolvePromise, 10))
  }
}
