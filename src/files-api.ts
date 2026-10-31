/**
 * `/dsh-master/api/files/*` — upload proxy and artifact download.
 *
 * ## Why these routes are stricter than the rest of the panel
 *
 * A plugin prefix is served outside the host's browser-session cookie, so the
 * existing trust fence is a rebinding defense, not authentication. Upload and
 * download additionally require a **loopback source connection**: the operator
 * token never reaches this machine's browser, so "same machine, same user" is
 * the only identity available here. `trustedHosts` does not widen these routes.
 *
 * ## Download integrity
 *
 * The artifact's length and SHA-256 are known before the response starts. The
 * server reads every chunk, keeps the **last** one unwritten, and only writes it
 * after the byte count and the digest agree. A failure after the headers is a
 * destroyed response, never a JSON body appended to a binary stream: the browser
 * must see a failed download, not a plausibly complete file.
 *
 * @module dsh-master/files-api
 */

import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { once } from 'node:events'
import { isLoopbackHostname } from './net/trust-fence.js'
import {
  ARTIFACT_CHUNK_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_FILE_BODY_BYTES,
  MAX_FILE_BYTES,
  isFileProxyOperation,
  type FileArtifact,
  type FileAttachment,
  type FileBeginUpload,
  type FileDescribe,
  type FileWriteChunk,
} from './files-protocol.js'
import type { MasterError } from './protocol.js'
import type { MasterService } from './service.js'

/** One failure, ready to serialize. */
function failure(code: string, message: string, details?: Readonly<Record<string, unknown>>): MasterError {
  return { code, message, ...(details === undefined ? {} : { details }) }
}

/** Whether an address names this machine's loopback interface. */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false
  const normalized = address.trim().toLowerCase().replace(/^\[|\]$/gu, '').replace(/^::ffff:/u, '')
  return normalized === '::1' || isLoopbackHostname(normalized)
}

/**
 * Whether one request may reach a file route.
 *
 * Every condition is additive to the shared trust fence, which has already run:
 * the socket peer, the `Host` authority and a present `Origin` must all be
 * loopback. An absent `Origin` is accepted because a same-origin `fetch` may
 * omit it in some Chromium builds; the loopback peer is then the binding fact.
 * @param request - the incoming request.
 * @returns true when the request is from this machine's browser.
 */
export function isLoopbackFileRequest(request: IncomingMessage): boolean {
  const socket = request.socket as { readonly remoteAddress?: string } | undefined
  if (!isLoopbackAddress(socket?.remoteAddress)) return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (!isLoopbackHostname(hostUrl.hostname)) return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (typeof origin === 'string' && origin !== '') {
    try {
      if (!isLoopbackHostname(new URL(origin).hostname)) return false
    } catch {
      return false
    }
  }
  return true
}

/** Send one JSON envelope and end the response. */
function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.writableEnded) return
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(payload)),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(payload)
}

/** Send one failure envelope. */
function sendFailure(response: ServerResponse, status: number, error: MasterError): void {
  sendJson(response, status, { ok: false, error })
}

/** Map a thrown value to the plugin's HTTP behavior. */
function classify(error: unknown): { status: number; error: MasterError } {
  if (error instanceof Error && 'toWire' in error && typeof error.toWire === 'function') {
    const wire = (error as { toWire: () => MasterError }).toWire()
    return { status: statusOf(wire.code), error: wire }
  }
  // Argument validation raises a plain Error whose `name` is the code; keeping
  // that code is what makes a bad chunk a 400 instead of an opaque 502.
  const name = error instanceof Error ? error.name : ''
  if (name.startsWith('master/')) {
    return {
      status: statusOf(name),
      error: failure(name, error instanceof Error ? error.message : 'invalid request'),
    }
  }
  return {
    status: 502,
    error: failure('master/internal', error instanceof Error ? error.message : 'unknown failure'),
  }
}

/** HTTP status for a failure code. */
function statusOf(code: string): number {
  switch (code) {
    case 'master/prompt-disabled':
    case 'master/forbidden':
      return 403
    case 'master/invalid-arguments':
      return 400
    case 'master/too-large':
    case 'coordinator/frame-too-large':
      return 413
    case 'files/not-found':
    case 'master/not-found':
      return 404
    case 'files/expired':
      return 410
    case 'files/forbidden':
      return 403
    case 'files/too-large':
    case 'files/quota-exceeded':
      return 413
    default:
      return 502
  }
}

/** Read a bounded JSON body. */
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = chunk as Buffer
    size += buffer.byteLength
    if (size > MAX_FILE_BODY_BYTES) {
      const error = new Error(`request body exceeds ${String(MAX_FILE_BODY_BYTES)} bytes`)
      error.name = 'master/too-large'
      throw error
    }
    chunks.push(buffer)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    const error = new Error('request body is not JSON')
    error.name = 'master/invalid-arguments'
    throw error
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    const error = new Error('request body must be a JSON object')
    error.name = 'master/invalid-arguments'
    throw error
  }
  return parsed as Record<string, unknown>
}

/** Read a required non-empty string. */
function requireText(value: unknown, field: string, maxLength = 300): string {
  if (typeof value !== 'string' || value === '' || value.length > maxLength) {
    const error = new Error(`"${field}" must be a non-empty string of at most ${String(maxLength)} characters`)
    error.name = 'master/invalid-arguments'
    throw error
  }
  return value
}

/** Read a bounded integer. */
function requireInt(value: unknown, field: string, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) {
    const error = new Error(`"${field}" must be an integer between 0 and ${String(max)}`)
    error.name = 'master/invalid-arguments'
    throw error
  }
  return value
}

/** A display name without control characters. */
function requireName(value: unknown): string {
  const name = requireText(value, 'name')
  if (/[\u0000-\u001f\u007f]/u.test(name)) {
    const error = new Error('"name" contains a control character')
    error.name = 'master/invalid-arguments'
    throw error
  }
  return name
}

/** A canonical base64 chunk within both ceilings. */
function requireChunk(value: unknown): string {
  const chunk = requireText(value, 'base64', 512 * 1024)
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(chunk)) {
    const error = new Error('"base64" is not canonical base64')
    error.name = 'master/invalid-arguments'
    throw error
  }
  if (Buffer.from(chunk, 'base64').byteLength > 256 * 1024) {
    const error = new Error('the chunk decodes past the per-call ceiling')
    error.name = 'master/too-large'
    throw error
  }
  return chunk
}

/** A lowercase SHA-256 digest. */
function requireSha256(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/iu.test(value)) {
    const error = new Error('"sha256" must be 64 hexadecimal characters')
    error.name = 'master/invalid-arguments'
    throw error
  }
  return value.toLowerCase()
}

/** One to five unique attachment ids. */
function requireIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    const error = new Error(`attachmentIds must contain 1 to ${String(MAX_ATTACHMENTS_PER_MESSAGE)} ids`)
    error.name = 'master/invalid-arguments'
    throw error
  }
  const ids = value.map((entry, index) => requireText(entry, `attachmentIds[${index}]`, 200))
  if (new Set(ids).size !== ids.length) {
    const error = new Error('attachmentIds must not repeat')
    error.name = 'master/invalid-arguments'
    throw error
  }
  return ids
}

/** Build the exact arguments one operation sends to the coordinator. */
function operationArgs(operation: string, body: Record<string, unknown>, sessionId: string): Record<string, unknown> {
  switch (operation) {
    case 'describe':
      return { sessionId }
    case 'beginUpload':
      return {
        sessionId,
        name: requireName(body['name']),
        size: requireInt(body['size'], 'size', MAX_FILE_BYTES),
        clientUploadId: requireText(body['clientUploadId'], 'clientUploadId', 200),
      }
    case 'writeChunk':
      return {
        sessionId,
        uploadId: requireText(body['uploadId'], 'uploadId', 200),
        offset: requireInt(body['offset'], 'offset', MAX_FILE_BYTES),
        base64: requireChunk(body['base64']),
      }
    case 'commitUpload':
      return {
        sessionId,
        uploadId: requireText(body['uploadId'], 'uploadId', 200),
        size: requireInt(body['size'], 'size', MAX_FILE_BYTES),
        sha256: requireSha256(body['sha256']),
      }
    case 'abortUpload':
      return { sessionId, uploadId: requireText(body['uploadId'], 'uploadId', 200) }
    case 'resolveAttachments':
      return { sessionId, attachmentIds: requireIds(body['attachmentIds']) }
    case 'listArtifacts':
      return { sessionId }
    default: {
      const error = new Error(`unknown file operation ${JSON.stringify(operation)}`)
      error.name = 'master/invalid-arguments'
      throw error
    }
  }
}

/** Read an attachment row, dropping the node-side path. */
function readAttachment(value: unknown): FileAttachment {
  const row = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  const attachmentId = requireText(row['attachmentId'], 'attachmentId', 200)
  const nodeId = requireText(row['nodeId'], 'nodeId', 200)
  const sessionId = requireText(row['sessionId'], 'sessionId', 200)
  const name = requireText(row['name'], 'name')
  const size = requireInt(row['size'], 'size', MAX_FILE_BYTES)
  const sha256 = requireSha256(row['sha256'])
  const createdAt = requireText(row['createdAt'], 'createdAt', 64)
  const expiresAt = requireText(row['expiresAt'], 'expiresAt', 64)
  return { attachmentId, nodeId, sessionId, name, size, sha256, createdAt, expiresAt }
}

/** Read a begin-upload row. */
function readBegin(value: unknown): FileBeginUpload {
  const row = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  return {
    uploadId: requireText(row['uploadId'], 'uploadId', 200),
    chunkBytes: requireInt(row['chunkBytes'], 'chunkBytes', 1024 * 1024),
    received: requireInt(row['received'], 'received', MAX_FILE_BYTES),
  }
}

/** Read a write-chunk row. */
function readWrite(value: unknown): FileWriteChunk {
  const row = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  return {
    nextOffset: requireInt(row['nextOffset'], 'nextOffset', MAX_FILE_BYTES),
    received: requireInt(row['received'], 'received', MAX_FILE_BYTES),
  }
}

/** Read an artifact list, rejecting a row that does not belong to the session. */
function readArtifacts(value: unknown, sessionId: string): FileArtifact[] {
  const rows = typeof value === 'object' && value !== null ? (value as Record<string, unknown>)['artifacts'] : undefined
  if (!Array.isArray(rows)) {
    const error = new Error('listArtifacts did not return an artifacts array')
    error.name = 'master/coordinator-unreadable'
    throw error
  }
  return rows.map((row) => {
    if (typeof row !== 'object' || row === null) {
      const error = new Error('listArtifacts returned an invalid row')
      error.name = 'master/coordinator-unreadable'
      throw error
    }
    const record = row as Record<string, unknown>
    const artifactId = requireText(record['artifactId'], 'artifactId', 200)
    const owner = requireText(record['sessionId'], 'sessionId', 200)
    if (owner !== sessionId) {
      const error = new Error('listArtifacts returned a cross-session row')
      error.name = 'master/coordinator-unreadable'
      throw error
    }
    const state = record['state']
    if (state !== 'ready' && state !== 'expired' && state !== 'missing') {
      const error = new Error('listArtifacts returned an unknown artifact state')
      error.name = 'master/coordinator-unreadable'
      throw error
    }
    return {
      artifactId,
      nodeId: requireText(record['nodeId'], 'nodeId', 200),
      sessionId: owner,
      name: requireText(record['name'], 'name'),
      size: requireInt(record['size'], 'size', MAX_FILE_BYTES),
      sha256: requireSha256(record['sha256']),
      createdAt: requireText(record['createdAt'], 'createdAt', 64),
      expiresAt: requireText(record['expiresAt'], 'expiresAt', 64),
      state,
    }
  })
}

/** Route dependencies. */
export interface FileRouteDeps {
  readonly service: () => MasterService | undefined
}

/**
 * Handle one file route.
 *
 * @param request - the incoming request.
 * @param response - the response to write.
 * @param url - the parsed request URL.
 * @param route - the path below `/dsh-master`.
 * @param deps - the master service.
 * @returns nothing; the response is ended by this function.
 */
export async function handleFileRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  route: string,
  deps: FileRouteDeps,
): Promise<void> {
  if (!isLoopbackFileRequest(request)) {
    sendFailure(response, 403, failure('master/forbidden', 'file routes are only available to a loopback browser'))
    return
  }
  const service = deps.service()
  if (service === undefined) {
    sendFailure(response, 503, failure('master/unavailable', 'the master service is not mounted'))
    return
  }

  if (route === '/api/files/download') {
    if ((request.method ?? 'GET') !== 'GET') {
      response.setHeader('allow', 'GET')
      sendFailure(response, 405, failure('master/method-not-allowed', 'the download route only accepts GET'))
      return
    }
    await serveDownload(request, response, url, service)
    return
  }

  const operation = route.slice('/api/files/'.length)
  if (operation === '') {
    sendFailure(response, 404, failure('master/not-found', 'no file operation was named'))
    return
  }
  if (!isFileProxyOperation(operation)) {
    // `resolveAttachments` and `readArtifactChunk` are host-internal: the first
    // returns a node path, the second is what the download stream uses. Neither
    // is a browser-callable operation.
    sendFailure(response, 404, failure('master/not-found', `no browser file operation for ${JSON.stringify(operation)}`))
    return
  }
  if ((request.method ?? 'GET') !== 'POST') {
    response.setHeader('allow', 'POST')
    sendFailure(response, 405, failure('master/method-not-allowed', 'file operations only accept POST'))
    return
  }
  const writeOperation = operation === 'beginUpload' || operation === 'writeChunk'
    || operation === 'commitUpload' || operation === 'abortUpload'
  if (writeOperation && !service.promptEnabled) {
    // Checked before the body is read: a disabled deployment must not accept a
    // file it will then refuse to attach to any task.
    sendFailure(response, 403, failure(
      'master/prompt-disabled',
      'uploading files is disabled while allowPrompt is false',
    ))
    return
  }

  let body: Record<string, unknown>
  try {
    body = await readBody(request)
  } catch (error) {
    const code = error instanceof Error && error.name.startsWith('master/') ? error.name : 'master/invalid-arguments'
    sendFailure(response, code === 'master/too-large' ? 413 : 400, failure(
      code,
      error instanceof Error ? error.message : 'unreadable request body',
    ))
    return
  }

  let nodeId: string
  let sessionId: string
  try {
    nodeId = requireText(body['nodeId'], 'nodeId', 200)
    sessionId = requireText(body['sessionId'], 'sessionId', 200)
  } catch (error) {
    sendFailure(response, 400, failure(
      'master/invalid-arguments',
      error instanceof Error ? error.message : 'nodeId and sessionId are required',
    ))
    return
  }

  const controller = new AbortController()
  response.on('close', () => {
    if (!response.writableEnded) controller.abort()
  })

  try {
    if (operation === 'describe') {
      const value: FileDescribe = await service.describeFiles(nodeId, sessionId, controller.signal)
      sendJson(response, 200, { ok: true, value })
      return
    }
    const args = operationArgs(operation, body, sessionId)
    const value = await service.fileOperation(nodeId, operation, args, controller.signal)
    if (operation === 'beginUpload') {
      sendJson(response, 200, { ok: true, value: readBegin(value) })
      return
    }
    if (operation === 'writeChunk') {
      sendJson(response, 200, { ok: true, value: readWrite(value) })
      return
    }
    if (operation === 'abortUpload') {
      sendJson(response, 200, { ok: true, value: { accepted: true } })
      return
    }
    if (operation === 'commitUpload') {
      sendJson(response, 200, { ok: true, value: readAttachment(value) })
      return
    }
    if (operation === 'listArtifacts') {
      sendJson(response, 200, { ok: true, value: { artifacts: readArtifacts(value, sessionId) } })
      return
    }
    throw new Error(`unhandled file operation ${operation}`)
  } catch (error) {
    const mapped = classify(error)
    sendFailure(response, mapped.status, mapped.error)
  }
}

/** Stream one artifact with length and hash verification. */
async function serveDownload(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  service: MasterService,
): Promise<void> {
  let nodeId: string
  let sessionId: string
  let artifactId: string
  try {
    nodeId = requireText(url.searchParams.get('nodeId'), 'nodeId', 200)
    sessionId = requireText(url.searchParams.get('sessionId'), 'sessionId', 200)
    artifactId = requireText(url.searchParams.get('artifactId'), 'artifactId', 200)
  } catch (error) {
    sendFailure(response, 400, failure(
      'master/invalid-arguments',
      error instanceof Error ? error.message : 'nodeId, sessionId and artifactId are required',
    ))
    return
  }

  const controller = new AbortController()
  response.on('close', () => {
    if (!response.writableEnded) controller.abort()
  })

  let download
  try {
    download = await service.artifactDownload(nodeId, sessionId, artifactId, controller.signal)
  } catch (error) {
    const mapped = classify(error)
    sendFailure(response, mapped.status, mapped.error)
    return
  }

  const { artifact } = download
  response.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': String(artifact.size),
    'content-disposition': contentDisposition(artifact.name),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })

  const hash = createHash('sha256')
  let offset = 0
  let pending: Buffer | undefined
  try {
    while (offset < artifact.size) {
      const chunk = await download.read(
        offset,
        Math.min(ARTIFACT_CHUNK_BYTES, artifact.size - offset),
        controller.signal,
      )
      const bytes = Buffer.from(chunk.base64, 'base64')
      if (bytes.byteLength === 0 || chunk.nextOffset <= offset || offset + bytes.byteLength > artifact.size) {
        throw new Error('the artifact stream did not advance within its declared length')
      }
      hash.update(bytes)
      offset = chunk.nextOffset
      if (pending !== undefined) await writeWithBackpressure(request, response, pending)
      pending = bytes
    }
    if (offset !== artifact.size) throw new Error('the artifact stream ended before its declared length')
    if (hash.digest('hex') !== artifact.sha256) throw new Error('the artifact digest does not match its metadata')
    if (pending !== undefined) await writeWithBackpressure(request, response, pending)
    if (!response.writableEnded) response.end()
  } catch {
    /*
      Past the first byte there is no JSON envelope to send: a body appended to
      a binary stream would look like part of the file. Destroying the response
      is what makes the browser mark the download failed.
    */
    response.destroy()
  }
}

/** Write one buffer, waiting for drain or for the client to go away. */
async function writeWithBackpressure(
  request: IncomingMessage,
  response: ServerResponse,
  bytes: Buffer,
): Promise<void> {
  if (response.write(bytes)) return
  if (response.destroyed || response.writableEnded || request.destroyed) return
  await Promise.race([
    once(response, 'drain'),
    once(response, 'close'),
    once(request, 'close'),
  ])
}

/**
 * Build a `Content-Disposition` that carries a Chinese name safely.
 *
 * `filename` is an ASCII fallback for clients that ignore RFC 5987; `filename*`
 * is the authoritative UTF-8 value. Control characters and CR/LF are removed
 * first, so a name can never inject a header.
 * @param name - the display name from node metadata.
 * @returns the header value.
 */
export function contentDisposition(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/gu, '').replace(/[\\"]/gu, '_').trim() || 'file'
  const fallback = cleaned.replace(/[^\x20-\x7e]/gu, '_')
  const encoded = encodeURIComponent(cleaned).replace(
    /['()*]/gu,
    character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}
