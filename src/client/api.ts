/**
 * Browser-side access to `/dsh-master/api/*`.
 *
 * Same origin as the page, so there is no base URL to configure and no cookie to
 * attach — the host's trust fence, not the browser session, is what admits these
 * requests. Every function here returns decoded values or throws an {@link ApiError}
 * carrying the upstream code, so a caller can tell `master/prompt-disabled` from
 * `coordinator/auth-rejected` without parsing a message.
 *
 * @module dsh-master/client/api
 */

import {
  ROUTE_PREFIX,
  type MasterEnvelope,
  type MasterArchiveValue,
  type MasterNodesValue,
  type MasterPendingQuestionsValue,
  type MasterQuestionAccepted,
  type MasterQuestionAnswer,
  type MasterSessionsValue,
  type MasterStatus,
  type MasterStreamRecord,
} from '../protocol.js'
import type {
  FileAbortUpload,
  FileArtifactList,
  FileBeginUpload,
  FileDescribe,
  FileWriteChunk,
} from '../files-protocol.js'

/** One failed call, with the code the host reported. */
export class ApiError extends Error {
  /** `master/*` for this plugin's refusals; otherwise the coordinator's or a node's code. */
  readonly code: string
  /** Non-sensitive context the host preserved from upstream. */
  readonly details: Readonly<Record<string, unknown>> | undefined

  /**
   * @param code - the reported code.
   * @param message - a human-readable line.
   * @param details - optional upstream context.
   */
  constructor(code: string, message: string, details?: Readonly<Record<string, unknown>>) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.details = details
  }
}

/** Unwrap an envelope, throwing on the failure arm. */
function unwrap<T>(envelope: MasterEnvelope<T>): T {
  if (envelope.ok) return envelope.value
  throw new ApiError(envelope.error.code, envelope.error.message, envelope.error.details)
}

const FOLLOW_RETRY_INITIAL_MS = 1_000
const FOLLOW_RETRY_MAX_MS = 30_000

/** Wait before reconnecting, but let a closed panel cancel the delay immediately. */
function waitForFollowRetry(signal: AbortSignal, delayMs: number): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    signal.addEventListener('abort', finish, { once: true })
    timer = setTimeout(finish, delayMs)
    if (signal.aborted) finish()
  })
}

/** Turn a connection failure into the same record shape used by the stream route. */
function followFailure(cause: unknown): MasterStreamRecord {
  return {
    type: 'error',
    error: {
      code: cause instanceof ApiError ? cause.code : 'master/follow-failed',
      message: cause instanceof Error ? cause.message : String(cause),
    },
    count: 0,
  }
}

/**
 * Build a request init, omitting `signal` when there is none.
 *
 * Spelled out rather than assigned because `exactOptionalPropertyTypes` distinguishes
 * an absent `signal` from one explicitly set to `undefined`, and `RequestInit` only
 * accepts the absent form.
 *
 * @param signal - caller cancellation, if any.
 * @param extra - the remaining request init.
 * @returns the init to pass to `fetch`.
 */
function init(signal: AbortSignal | undefined, extra: RequestInit = {}): RequestInit {
  return { ...extra, ...(signal === undefined ? {} : { signal }) }
}

/** Read a response as an envelope, tolerating a body that is not one. */
async function envelopeOf(response: Response): Promise<MasterEnvelope<never>> {
  try {
    return await response.json() as MasterEnvelope<never>
  } catch {
    throw new ApiError('master/unreadable', `the host answered HTTP ${String(response.status)} without JSON`)
  }
}

/**
 * Coordinator reachability and roster size.
 *
 * This call never fails for an unreachable coordinator: the answer says so, which is
 * what lets the panel distinguish "not running" from "no nodes".
 *
 * @param signal - caller cancellation.
 * @returns the status payload.
 */
export async function fetchStatus(signal?: AbortSignal): Promise<MasterStatus> {
  const response = await fetch(`${ROUTE_PREFIX}/api/status`, init(signal, { headers: { accept: 'application/json' } }))
  return unwrap(await envelopeOf(response) as MasterEnvelope<MasterStatus>)
}

/**
 * The full node roster.
 * @param signal - caller cancellation.
 * @returns the roster and the coordinator origin it came from.
 */
export async function fetchNodes(signal?: AbortSignal): Promise<MasterNodesValue> {
  const response = await fetch(`${ROUTE_PREFIX}/api/nodes`, init(signal, { headers: { accept: 'application/json' } }))
  return unwrap(await envelopeOf(response) as MasterEnvelope<MasterNodesValue>)
}

/**
 * One node's sessions.
 * @param nodeId - target node.
 * @param signal - caller cancellation.
 * @returns the session rows.
 */
export async function fetchSessions(nodeId: string, signal?: AbortSignal): Promise<MasterSessionsValue> {
  const query = new URLSearchParams({ nodeId })
  const response = await fetch(`${ROUTE_PREFIX}/api/sessions?${query.toString()}`, init(signal, {
    headers: { accept: 'application/json' },
  }))
  return unwrap(await envelopeOf(response) as MasterEnvelope<MasterSessionsValue>)
}

/** Archive one remote session without deleting its transcript. */
export async function archiveRemoteSession(
  nodeId: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<MasterArchiveValue> {
  const response = await fetch(`${ROUTE_PREFIX}/api/session/archive`, init(signal, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ nodeId, sessionId }),
  }))
  return unwrap(await envelopeOf(response) as MasterEnvelope<MasterArchiveValue>)
}

/** Read questions currently waiting for the selected remote session. */
export async function fetchPendingQuestions(
  nodeId: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<MasterPendingQuestionsValue> {
  const query = new URLSearchParams({ nodeId, sessionId })
  const response = await fetch(`${ROUTE_PREFIX}/api/session/questions?${query.toString()}`, init(signal, {
    headers: { accept: 'application/json' },
  }))
  return unwrap(await envelopeOf(response) as MasterEnvelope<MasterPendingQuestionsValue>)
}

/** Return the selected values to the original remote question request. */
export async function answerRemoteQuestion(
  nodeId: string,
  sessionId: string,
  requestId: string,
  answer: MasterQuestionAnswer,
  signal?: AbortSignal,
): Promise<MasterQuestionAccepted> {
  const response = await fetch(`${ROUTE_PREFIX}/api/session/question-answer`, init(signal, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ nodeId, sessionId, requestId, answer }),
  }))
  return unwrap(await envelopeOf(response) as MasterEnvelope<MasterQuestionAccepted>)
}

/** Cancel an outstanding remote question without sending a session prompt. */
export async function cancelRemoteQuestion(
  nodeId: string,
  sessionId: string,
  requestId: string,
  signal?: AbortSignal,
): Promise<MasterQuestionAccepted> {
  const response = await fetch(`${ROUTE_PREFIX}/api/session/question-cancel`, init(signal, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ nodeId, sessionId, requestId }),
  }))
  return unwrap(await envelopeOf(response) as MasterEnvelope<MasterQuestionAccepted>)
}

/**
 * Send a prompt to a remote session.
 *
 * Rejected by the host unless the deployment set `allowPrompt`; the thrown
 * {@link ApiError} then carries `master/prompt-disabled`.
 *
 * @param nodeId - target node.
 * @param sessionId - target session.
 * @param text - prompt text.
 * @param mode - `queue` (default) or `steer`.
 * @param signal - caller cancellation.
 * @param attachmentIds - confirmed attachments for this session.
 */
export async function sendPrompt(
  nodeId: string,
  sessionId: string,
  text: string,
  mode: 'queue' | 'steer',
  signal?: AbortSignal,
  attachmentIds?: readonly string[],
): Promise<void> {
  const response = await fetch(`${ROUTE_PREFIX}/api/session/prompt`, init(signal, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      nodeId,
      sessionId,
      text,
      mode,
      ...(attachmentIds === undefined || attachmentIds.length === 0 ? {} : { attachmentIds }),
    }),
  }))
  unwrap(await envelopeOf(response) as MasterEnvelope<unknown>)
}

/**
 * Follow one session, handing each record to a callback.
 *
 * Streaming through a callback rather than returning an async iterator keeps the
 * caller in control of React state: an iterator driven from an effect would need the
 * same bookkeeping anyway. Disconnects and terminal stream records reconnect with
 * bounded backoff; a closed panel ends the loop by aborting one signal.
 *
 * @param nodeId - target node.
 * @param sessionId - target session.
 * @param signal - cancellation; aborting releases the stream on the node.
 * @param onRecord - called for each record, in arrival order.
 */
export async function followSession(
  nodeId: string,
  sessionId: string,
  signal: AbortSignal,
  onRecord: (record: MasterStreamRecord) => void,
): Promise<void> {
  const query = new URLSearchParams({ nodeId, sessionId })
  let retry = 0
  while (!signal.aborted) {
    let opened = false
    try {
      const response = await fetch(`${ROUTE_PREFIX}/api/session/follow?${query.toString()}`, init(signal, {
        headers: { accept: 'application/x-ndjson' },
      }))

      if (response.status !== 200 || response.body === null) {
        // The host answers a pre-stream failure as JSON. Past the first byte it
        // answers NDJSON instead, which is why only this branch parses an envelope.
        unwrap(await envelopeOf(response) as MasterEnvelope<unknown>)
        throw new ApiError('master/unreadable', 'the follow route answered without a body')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffered = ''
      let terminal = false
      const emit = (line: string): void => {
        const record = JSON.parse(line) as MasterStreamRecord
        if (record.type === 'open') opened = true
        if (record.type === 'end' || record.type === 'error') terminal = true
        onRecord(record)
      }
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffered += decoder.decode(value, { stream: true })
          let newline = buffered.indexOf('\n')
          while (newline !== -1) {
            const line = buffered.slice(0, newline).trim()
            buffered = buffered.slice(newline + 1)
            if (line !== '') emit(line)
            if (terminal) break
            newline = buffered.indexOf('\n')
          }
          if (terminal) break
        }
        if (!terminal) {
          const tail = buffered.trim()
          if (tail !== '') emit(tail)
        }
      } finally {
        await reader.cancel().catch(() => undefined)
      }
      if (!terminal && !signal.aborted) {
        onRecord(followFailure(new ApiError('master/follow-ended', 'the follow stream ended unexpectedly')))
      }
    } catch (cause: unknown) {
      if (signal.aborted) return
      onRecord(followFailure(cause))
    }

    if (signal.aborted) return
    const delayMs = Math.min(FOLLOW_RETRY_INITIAL_MS * 2 ** retry, FOLLOW_RETRY_MAX_MS)
    await waitForFollowRetry(signal, delayMs)
    retry = opened ? 0 : Math.min(retry + 1, 5)
  }
}

/**
 * Call one file operation through the host's proxy.
 *
 * @param nodeId - target node.
 * @param sessionId - target session.
 * @param operation - browser-facing operation.
 * @param fields - operation-specific fields.
 * @param signal - caller cancellation.
 * @returns the host's validated value.
 */
export async function fileOperation<T>(
  nodeId: string,
  sessionId: string,
  operation: string,
  fields: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${ROUTE_PREFIX}/api/files/${encodeURIComponent(operation)}`, init(signal, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ nodeId, sessionId, ...fields }),
  }))
  return unwrap(await envelopeOf(response) as MasterEnvelope<T>)
}

/** Read the node's file limits and delivery-tool state. */
export function fetchFileSupport(nodeId: string, sessionId: string, signal?: AbortSignal): Promise<FileDescribe> {
  return fileOperation<FileDescribe>(nodeId, sessionId, 'describe', {}, signal)
}

/** Open one upload. */
export function beginUpload(
  nodeId: string,
  sessionId: string,
  name: string,
  size: number,
  clientUploadId: string,
  signal?: AbortSignal,
): Promise<FileBeginUpload> {
  return fileOperation<FileBeginUpload>(nodeId, sessionId, 'beginUpload', { name, size, clientUploadId }, signal)
}

/** Append one chunk. */
export function writeUploadChunk(
  nodeId: string,
  sessionId: string,
  uploadId: string,
  offset: number,
  base64: string,
  signal?: AbortSignal,
): Promise<FileWriteChunk> {
  return fileOperation<FileWriteChunk>(nodeId, sessionId, 'writeChunk', { uploadId, offset, base64 }, signal)
}

/** Commit one upload. */
export function commitUpload(
  nodeId: string,
  sessionId: string,
  uploadId: string,
  size: number,
  sha256: string,
  signal?: AbortSignal,
): Promise<unknown> {
  return fileOperation(nodeId, sessionId, 'commitUpload', { uploadId, size, sha256 }, signal)
}

/** Abort one uncommitted upload. */
export function abortUpload(
  nodeId: string,
  sessionId: string,
  uploadId: string,
  signal?: AbortSignal,
): Promise<FileAbortUpload> {
  return fileOperation<FileAbortUpload>(nodeId, sessionId, 'abortUpload', { uploadId }, signal)
}

/** List one session's artifacts. */
export function fetchArtifacts(nodeId: string, sessionId: string, signal?: AbortSignal): Promise<FileArtifactList> {
  return fileOperation<FileArtifactList>(nodeId, sessionId, 'listArtifacts', {}, signal)
}

/**
 * Build the browser download URL for one artifact.
 *
 * The URL carries only identity: there is no path parameter to misuse.
 * @param nodeId - owning node.
 * @param sessionId - owning session.
 * @param artifactId - artifact identity.
 * @returns a same-origin URL.
 */
export function downloadArtifactUrl(nodeId: string, sessionId: string, artifactId: string): string {
  const query = new URLSearchParams({ nodeId, sessionId, artifactId })
  return `${ROUTE_PREFIX}/api/files/download?${query.toString()}`
}
