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
  type MasterNodesValue,
  type MasterSessionsValue,
  type MasterStatus,
  type MasterStreamRecord,
} from '../protocol.js'

/** One failed call, with the code the host reported. */
export class ApiError extends Error {
  /** `master/*` for this plugin's refusals; otherwise the coordinator's or a node's code. */
  readonly code: string

  /**
   * @param code - the reported code.
   * @param message - a human-readable line.
   */
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

/** Unwrap an envelope, throwing on the failure arm. */
function unwrap<T>(envelope: MasterEnvelope<T>): T {
  if (envelope.ok) return envelope.value
  throw new ApiError(envelope.error.code, envelope.error.message)
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
 */
export async function sendPrompt(
  nodeId: string,
  sessionId: string,
  text: string,
  mode: 'queue' | 'steer',
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${ROUTE_PREFIX}/api/session/prompt`, init(signal, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ nodeId, sessionId, text, mode }),
  }))
  unwrap(await envelopeOf(response) as MasterEnvelope<unknown>)
}

/**
 * Follow one session, handing each record to a callback.
 *
 * Streaming through a callback rather than returning an async iterator keeps the
 * caller in control of React state: an iterator driven from an effect would need the
 * same bookkeeping anyway, and this way a closed panel ends the loop by aborting one
 * signal.
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
  const response = await fetch(`${ROUTE_PREFIX}/api/session/follow?${query.toString()}`, init(signal, {
    headers: { accept: 'application/x-ndjson' },
  }))

  if (response.status !== 200 || response.body === null) {
    // The host answers a pre-stream failure — a missing parameter, an unmounted
    // service — as JSON. Past the first byte it answers NDJSON instead, which is why
    // only this branch parses an envelope.
    unwrap(await envelopeOf(response) as MasterEnvelope<unknown>)
    throw new ApiError('master/unreadable', 'the follow route answered without a body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffered += decoder.decode(value, { stream: true })
      let newline = buffered.indexOf('\n')
      while (newline !== -1) {
        const line = buffered.slice(0, newline).trim()
        buffered = buffered.slice(newline + 1)
        if (line !== '') onRecord(JSON.parse(line) as MasterStreamRecord)
        newline = buffered.indexOf('\n')
      }
    }
    const tail = buffered.trim()
    if (tail !== '') onRecord(JSON.parse(tail) as MasterStreamRecord)
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}
