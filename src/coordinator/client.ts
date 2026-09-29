/**
 * HTTP client for a `dsh-coordinator`.
 *
 * The coordinator is the only component that holds node connections; this plugin is
 * a **management-plane consumer** of it, not a node. Every call here is therefore a
 * plain HTTP request to `/api/*` with the operator token — there is no outbound
 * WebSocket, no listening socket, and no node credential involved.
 *
 * Three rules this module keeps, each because breaking it hides a real failure:
 *
 * 1. **The token never reaches a message.** It is attached to the request and to
 *    nothing else. Errors carry the upstream code, a human line, and `details`,
 *    all of which the coordinator already guarantees are token-free.
 * 2. **A 200 can still be a failure.** The coordinator answers a node's business
 *    error with HTTP 200 plus `{ok:false, error}`. Only the envelope decides.
 * 3. **`follow` is a long stream, not a request.** It is consumed incrementally and
 *    cancelled through the caller's signal, so a closed panel does not leave the
 *    node holding a stream open.
 *
 * @module dsh-master/coordinator/client
 */

import type {
  MasterCoordinatorFacts,
  MasterError,
  MasterNode,
  MasterSession,
} from '../protocol.js'

/** One upstream failure, normalized from either the coordinator or the node. */
export class MasterUpstreamError extends Error {
  /** `coordinator/*` codes are the coordinator's; `node/*` and business codes come from a node. */
  readonly code: string
  readonly details: Readonly<Record<string, unknown>> | undefined

  /**
   * @param error - the normalized error body.
   */
  constructor(error: MasterError) {
    super(error.message)
    this.name = 'MasterUpstreamError'
    this.code = error.code
    this.details = error.details
  }

  /** The error in the shape the HTTP layer emits. */
  toWire(): MasterError {
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    }
  }
}

/** Construction options; `fetchImpl` exists so tests need no network. */
export interface CoordinatorClientOptions {
  /** Coordinator origin, already stripped of a trailing slash. */
  readonly baseUrl: string
  readonly apiToken?: string
  readonly requestTimeoutMs: number
  /** Injected in tests. Defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch
}

/** One `{ok:true,value}` / `{ok:false,error}` envelope, as far as this client reads it. */
interface Envelope {
  readonly ok?: unknown
  readonly value?: unknown
  readonly error?: unknown
}

/** Narrow an unknown JSON value to a plain record. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Read a string field, or `undefined`. */
function str(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' ? value : undefined
}

/** Read a finite number field, or `undefined`. */
function num(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Read a boolean field, or `undefined`. */
function bool(source: Record<string, unknown>, key: string): boolean | undefined {
  const value = source[key]
  return typeof value === 'boolean' ? value : undefined
}

/**
 * Reduce an unknown error body to the three fields the plugin is allowed to carry.
 *
 * A body that is not the expected shape still becomes an error: silently returning
 * `ok` for a malformed response is how a broken coordinator turns into an empty
 * panel with no explanation.
 */
function toMasterError(code: string, message: string, details?: unknown): MasterError {
  const record = asRecord(details)
  return {
    code,
    message,
    ...(record === undefined ? {} : { details: record }),
  }
}

/**
 * Build the display title for a session row.
 *
 * The node projects `title` into `projections.values`; a session that has never been
 * titled falls back to a short id so a row is still addressable rather than blank.
 */
function sessionTitle(row: Record<string, unknown>, sessionId: string): string {
  const projections = asRecord(row['projections'])
  const values = asRecord(projections?.['values'])
  const title = values === undefined ? undefined : str(values, 'title')
  if (title !== undefined && title.trim() !== '') return title
  return sessionId.length > 12 ? `${sessionId.slice(0, 8)}…` : sessionId
}

/**
 * The coordinator connection.
 *
 * One instance per plugin mount. Stateless apart from configuration: node and
 * session facts are read on demand rather than cached, because a stale roster in a
 * management UI is worse than a slightly slower one — the coordinator already
 * expires an offline node, and a cache here would undo that.
 */
export class CoordinatorClient {
  readonly #baseUrl: string
  readonly #apiToken: string | undefined
  readonly #timeoutMs: number
  readonly #fetch: typeof fetch

  /**
   * @param options - endpoint, credential, deadline, and the fetch implementation.
   */
  constructor(options: CoordinatorClientOptions) {
    this.#baseUrl = options.baseUrl
    this.#apiToken = options.apiToken
    this.#timeoutMs = options.requestTimeoutMs
    this.#fetch = options.fetchImpl ?? globalThis.fetch
  }

  /** The origin this client talks to. Safe to display; carries no credential. */
  get baseUrl(): string {
    return this.#baseUrl
  }

  /** Request headers. The one place the token is attached. */
  #headers(extra?: Record<string, string>): Record<string, string> {
    return {
      accept: 'application/json',
      ...(this.#apiToken === undefined ? {} : { authorization: `Bearer ${this.#apiToken}` }),
      ...extra,
    }
  }

  /**
   * Combine the caller's signal with this call's deadline.
   * @param signal - caller cancellation, if any.
   * @returns a signal that aborts on either.
   */
  #deadline(signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.#timeoutMs)
    return signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  }

  /**
   * Send one request and unwrap the envelope.
   *
   * @param path - coordinator path, e.g. `/api/nodes`.
   * @param init - request init; `headers` is filled in here.
   * @param signal - caller cancellation.
   * @returns the envelope's `value`.
   * @throws {MasterUpstreamError} on a transport failure, a failure envelope, or a non-JSON body.
   */
  async #call(path: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
    let response: Response
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        ...init,
        headers: this.#headers(init.headers as Record<string, string> | undefined),
        signal: this.#deadline(signal),
      })
    } catch (error) {
      // The message of a fetch failure can include the URL but never a header, so
      // this string is safe to surface. It is the most common failure by far: the
      // coordinator simply is not running.
      const detail = error instanceof Error ? error.message : String(error)
      throw new MasterUpstreamError(toMasterError('master/coordinator-unreachable', detail))
    }

    let parsed: unknown
    try {
      parsed = await response.json()
    } catch {
      throw new MasterUpstreamError(toMasterError(
        'master/coordinator-unreadable',
        `coordinator answered ${String(response.status)} with a body that is not JSON`,
        { status: response.status },
      ))
    }

    const envelope = asRecord(parsed) as Envelope | undefined
    if (envelope === undefined) {
      throw new MasterUpstreamError(toMasterError(
        'master/coordinator-unreadable',
        'coordinator answered with a JSON value that is not an envelope',
        { status: response.status },
      ))
    }

    if (envelope.ok === true) return envelope.value

    const failure = asRecord(envelope.error)
    const code = failure === undefined ? undefined : str(failure, 'code')
    const message = failure === undefined ? undefined : str(failure, 'message')
    throw new MasterUpstreamError(toMasterError(
      code ?? 'master/coordinator-refused',
      message ?? `coordinator answered HTTP ${String(response.status)} without an error body`,
      failure?.['details'],
    ))
  }

  /**
   * Ask whether the coordinator answers at all, without throwing.
   *
   * `GET /api/health` reports only that the HTTP listener has an address — it says
   * nothing about any node. That is exactly the fact the panel needs in order to
   * distinguish "no nodes registered" from "coordinator not running".
   *
   * @returns reachability plus a token-free reason when it failed.
   */
  async probe(): Promise<MasterCoordinatorFacts> {
    try {
      await this.#call('/api/health', { method: 'GET' })
      return { url: this.#baseUrl, reachable: true }
    } catch (error) {
      const message = error instanceof MasterUpstreamError ? error.message : 'unknown failure'
      return { url: this.#baseUrl, reachable: false, error: message }
    }
  }

  /**
   * List registered nodes with their live connection state.
   *
   * @param signal - caller cancellation.
   * @returns one entry per registered node, in the coordinator's order.
   */
  async listNodes(signal?: AbortSignal): Promise<MasterNode[]> {
    const value = await this.#call('/api/nodes', { method: 'GET' }, signal)
    if (!Array.isArray(value)) {
      throw new MasterUpstreamError(toMasterError(
        'master/coordinator-unreadable',
        '/api/nodes did not return an array',
      ))
    }
    return value.flatMap((entry): MasterNode[] => {
      const row = asRecord(entry)
      const nodeId = row === undefined ? undefined : str(row, 'nodeId')
      if (row === undefined || nodeId === undefined) return []
      const nodeName = str(row, 'nodeName')
      const role = str(row, 'role')
      const capabilityCount = num(row, 'capabilityCount')
      const inFlightRequests = num(row, 'inFlightRequests')
      const activeStreams = num(row, 'activeStreams')
      const revoked = bool(row, 'revoked')
      return [{
        nodeId,
        ...(nodeName === undefined ? {} : { nodeName }),
        ...(role === undefined ? {} : { role }),
        state: str(row, 'state') ?? 'unknown',
        ...(capabilityCount === undefined ? {} : { capabilityCount }),
        ...(inFlightRequests === undefined ? {} : { inFlightRequests }),
        ...(activeStreams === undefined ? {} : { activeStreams }),
        ...(revoked === undefined ? {} : { revoked }),
      }]
    })
  }

  /**
   * List one node's sessions.
   *
   * The coordinator wraps `session/list`, whose result is
   * `{ items: SessionSummary[] }`. Rows are reduced to what the tree renders; the
   * original fields are not carried further, so a change in the node's summary shape
   * degrades this to a missing title rather than a broken panel.
   *
   * @param nodeId - target node.
   * @param signal - caller cancellation.
   * @returns session rows, newest first as the node ordered them.
   */
  async listSessions(nodeId: string, signal?: AbortSignal): Promise<MasterSession[]> {
    const value = await this.#call('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId }),
    }, signal)
    const record = asRecord(value)
    const items = record?.['items']
    if (!Array.isArray(items)) {
      throw new MasterUpstreamError(toMasterError(
        'master/coordinator-unreadable',
        'session/list did not return an items array',
      ))
    }
    return items.flatMap((entry): MasterSession[] => {
      const row = asRecord(entry)
      const sessionId = row === undefined ? undefined : str(row, 'sessionId')
      if (row === undefined || sessionId === undefined) return []
      const cwd = str(row, 'cwd')
      return [{
        sessionId,
        title: sessionTitle(row, sessionId),
        updatedAt: num(row, 'updatedAt') ?? 0,
        running: bool(row, 'running') ?? false,
        blank: bool(row, 'blank') ?? false,
        ...(cwd === undefined ? {} : { cwd }),
      }]
    })
  }

  /**
   * Read the node's durable archive set from the first workspace follow baseline.
   * The stream is cancelled immediately after that baseline; no long-lived follow is
   * left attached to the node just to hydrate the sidebar.
   * @param nodeId - target node.
   * @param signal - caller cancellation.
   * @returns the complete archived session ID set.
   */
  async workspaceArchiveIds(nodeId: string, signal?: AbortSignal): Promise<string[]> {
    for await (const frame of this.#followWorkspace(nodeId, signal)) {
      const record = asRecord(frame)
      if (str(record ?? {}, 'type') !== 'baseline') {
        throw new MasterUpstreamError(toMasterError(
          'master/coordinator-unreadable',
          'workspace/follow did not begin with a baseline',
        ))
      }
      return readArchivedSessionIds(asRecord(record?.['value']))
    }
    throw new MasterUpstreamError(toMasterError(
      'master/coordinator-unreadable',
      'workspace/follow ended before its baseline',
    ))
  }

  /** Archive one remote session using the node's workspace Remote. */
  async archiveSession(nodeId: string, sessionId: string, signal?: AbortSignal): Promise<string[]> {
    const value = await this.#call('/api/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nodeId,
        endpoint: 'workspace/archiveSession',
        args: { request: { sessionId } },
      }),
    }, signal)
    return readArchivedSessionIds(asRecord(value))
  }

  async *#followWorkspace(nodeId: string, signal?: AbortSignal): AsyncGenerator<unknown> {
    let response: Response
    try {
      response = await this.#fetch(`${this.#baseUrl}/api/stream`, {
        method: 'POST',
        headers: this.#headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          nodeId,
          endpoint: 'workspace/follow',
          args: {},
          timeoutMs: this.#timeoutMs,
        }),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new MasterUpstreamError(toMasterError('master/coordinator-unreachable', detail))
    }
    yield* readCoordinatorStream(response, 'workspace/follow')
  }

  /**
   * Follow one session, yielding the raw frames the node emits.
   *
   * The coordinator's `session/follow` is a long NDJSON stream whose records are
   * `open` → `data`… → `end`, or `error`. `data.value` is a `SessionFollowFrame`
   * produced by a node whose DSH version is not necessarily ours, so values cross
   * this boundary **un-modelled**: the panel reads the fields it knows and renders
   * what it does not, instead of a strict schema turning a version skew into an
   * empty conversation.
   *
   * @param nodeId - target node.
   * @param sessionId - target session on that node.
   * @param signal - cancellation; aborting releases the stream on the node.
   * @yields each `data` record's value, in order.
   * @throws {MasterUpstreamError} when the coordinator or the node reports a failure.
   */
  async *follow(nodeId: string, sessionId: string, signal?: AbortSignal): AsyncGenerator<unknown> {
    let response: Response
    try {
      response = await this.#fetch(`${this.#baseUrl}/api/session/follow`, {
        method: 'POST',
        headers: this.#headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ nodeId, sessionId, assistantStream: true }),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new MasterUpstreamError(toMasterError('master/coordinator-unreachable', detail))
    }

    yield* readCoordinatorStream(response, 'session/follow')
  }

  /**
   * Send a prompt to one remote session.
   *
   * **This runs a real agent turn on another machine.** It can edit files and execute
   * tools there. The route above this method is gated on `allowPrompt`, and the gate
   * is checked once, at the HTTP layer, so this method stays a plain call.
   *
   * @param nodeId - target node.
   * @param sessionId - target session.
   * @param text - prompt text.
   * @param mode - `queue` (default) appends to the inbox; `steer` interrupts.
   * @param signal - caller cancellation.
   */
  async prompt(
    nodeId: string,
    sessionId: string,
    text: string,
    mode: 'queue' | 'steer' = 'queue',
    signal?: AbortSignal,
  ): Promise<void> {
    await this.#call('/api/session/prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId, sessionId, text, mode }),
    }, signal)
  }
}

/**
 * Parse one NDJSON line.
 *
 * A malformed line is a failure, not something to skip: the coordinator writes one
 * JSON object per line, so a line that does not parse means the stream is truncated
 * or the peer is not the coordinator. Skipping it would show a conversation with a
 * silent hole in the middle.
 *
 * @param line - one non-empty line.
 * @param status - the HTTP status, for the message only.
 * @returns the parsed record, or `undefined` for a JSON value that is not an object.
 * @throws {MasterUpstreamError} when the line is not JSON.
 */
function parseNdjsonRecord(line: string, status: number, endpoint: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(line))
  } catch {
    throw new MasterUpstreamError(toMasterError(
      'master/coordinator-unreadable',
      `${endpoint} emitted a line that is not JSON (HTTP ${String(status)})`,
    ))
  }
}

/**
 * Translate one coordinator stream record into zero or one yielded value.
 *
 * Written as a generator so `follow` can both yield and throw from one place, and so
 * an `end` record terminates the loop by returning rather than by a flag the caller
 * has to remember to check.
 *
 * @param record - one parsed NDJSON record.
 * @param status - the HTTP status, used only to describe an unreadable record.
 * @yields the `data` record's value.
 * @throws {MasterUpstreamError} on an `error` record.
 */
function* emitFollowRecord(record: Record<string, unknown>, status: number, endpoint: string): Generator<unknown> {
  const type = str(record, 'type')
  switch (type) {
    case 'open':
      return
    case 'data':
      yield record['value']
      return
    case 'end':
      return
    case 'error': {
      const failure = asRecord(record['error'])
      throw new MasterUpstreamError(toMasterError(
        (failure === undefined ? undefined : str(failure, 'code')) ?? 'master/stream-failed',
        (failure === undefined ? undefined : str(failure, 'message')) ?? 'the node reported a stream failure',
        failure?.['details'],
      ))
    }
    default:
      throw new MasterUpstreamError(toMasterError(
        'master/coordinator-unreadable',
        `${endpoint} emitted an unknown record type (HTTP ${String(status)})`,
      ))
  }
}

/** Read the complete archive-ID field at the remote trust boundary. */
function readArchivedSessionIds(value: Record<string, unknown> | undefined): string[] {
  const ids = value?.['archivedSessionIds']
  if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) {
    throw new MasterUpstreamError(toMasterError(
      'master/coordinator-unreadable',
      'workspace archive response did not contain a string ID array',
    ))
  }
  return ids
}

/** Consume one coordinator NDJSON stream; returning early cancels its upstream reader. */
async function* readCoordinatorStream(response: Response, endpoint: string): AsyncGenerator<unknown> {
  if (!response.ok) {
    let parsed: unknown
    try {
      parsed = await response.json()
    } catch {
      parsed = undefined
    }
    const envelope = asRecord(parsed)
    const failure = asRecord(envelope?.['error'])
    throw new MasterUpstreamError(toMasterError(
      (failure === undefined ? undefined : str(failure, 'code')) ?? 'master/coordinator-refused',
      (failure === undefined ? undefined : str(failure, 'message'))
        ?? `${endpoint} answered HTTP ${String(response.status)} without an error body`,
      failure?.['details'],
    ))
  }
  if (response.body === null) {
    throw new MasterUpstreamError(toMasterError(
      'master/coordinator-unreadable',
      `${endpoint} answered without a body`,
      { status: response.status },
    ))
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
        if (line !== '') {
          const record = parseNdjsonRecord(line, response.status, endpoint)
          if (record !== undefined) yield* emitFollowRecord(record, response.status, endpoint)
        }
        newline = buffered.indexOf('\n')
      }
    }
    const tail = buffered.trim()
    if (tail !== '') {
      const record = parseNdjsonRecord(tail, response.status, endpoint)
      if (record !== undefined) yield* emitFollowRecord(record, response.status, endpoint)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}
