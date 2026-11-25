import { readSessionAccess, readApprovalResult, readForwardedApprovals, readForwardedApprovalAccepted, type SessionAccess, type ApprovalDecision, type ApprovalResult, type ForwardedApprovals, type ForwardedApprovalAccepted } from '../session-access-protocol.js'
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
  MasterCancelSessionValue,
  MasterCoordinatorFacts,
  MasterCreateSessionValue,
  MasterCreateWorkspaceValue,
  MasterError,
  MasterModel,
  MasterModelCatalog,
  MasterModelGroup,
  MasterModelSelection,
  MasterNode,
  MasterPendingQuestionsValue,
  MasterQuestion,
  MasterQuestionAccepted,
  MasterQuestionAnswer,
  MasterQuestionOption,
  MasterRenameSessionValue,
  MasterSelectModelValue,
  MasterSessionPageValue,
  MasterSession,
  MasterWorkspace,
  MasterWorkspaceSnapshot,
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
  /** Read the active endpoint so a settings change applies without remounting. */
  readonly getBaseUrl?: () => string
  /** Resolve the active token per request; credential values are never cached. */
  readonly resolveApiToken?: () => Promise<string | undefined>
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

/** Parse a JSON question defensively; malformed remote data is not safe to render. */
function readQuestion(value: unknown): MasterQuestion | undefined {
  const row = asRecord(value)
  const id = row === undefined ? undefined : str(row, 'id')
  const question = row === undefined ? undefined : str(row, 'question')
  if (row === undefined || id === undefined || id.trim() === '' || question === undefined || question.trim() === '') return undefined
  const detail = str(row, 'detail')
  const header = str(row, 'header')
  const multiSelect = bool(row, 'multiSelect')
  const rawIntent = asRecord(row['intent'])
  const intent = rawIntent?.['kind'] === 'plan-review' && typeof rawIntent['approve'] === 'string'
    ? { kind: 'plan-review' as const, approve: rawIntent['approve'] }
    : undefined
  const rawOptions = row['options']
  let options: MasterQuestionOption[] | undefined
  if (rawOptions !== undefined) {
    if (!Array.isArray(rawOptions)) return undefined
    options = []
    for (const rawOption of rawOptions) {
      const option = asRecord(rawOption)
      const label = option === undefined ? undefined : str(option, 'label')
      const description = option === undefined ? undefined : str(option, 'description')
      if (option === undefined || label === undefined || label.trim() === '') return undefined
      options.push({ label, ...(description === undefined ? {} : { description }) })
    }
  }
  return {
    id,
    question,
    ...(detail === undefined ? {} : { detail }),
    ...(header === undefined ? {} : { header }),
    ...(options === undefined ? {} : { options }),
    ...(multiSelect === undefined ? {} : { multiSelect }),
    ...(intent === undefined ? {} : { intent }),
  }
}

/** Parse the `pending()` payload and ensure it cannot cross the requested session. */
function readPendingQuestions(value: unknown, sessionId: string): MasterPendingQuestionsValue {
  const record = asRecord(value)
  const requests = record?.['requests']
  if (!Array.isArray(requests)) {
    throw new MasterUpstreamError(toMasterError('master/coordinator-unreadable', 'nodeQuestions/pending did not return a requests array'))
  }
  const parsed = requests.map((value) => {
    const row = asRecord(value)
    const requestId = row === undefined ? undefined : str(row, 'requestId')
    const owner = row === undefined ? undefined : str(row, 'sessionId')
    const questions = row?.['questions']
    if (row === undefined || requestId === undefined || requestId.trim() === '' || owner !== sessionId || !Array.isArray(questions)) return undefined
    const parsedQuestions = questions.map(readQuestion)
    if (parsedQuestions.some(question => question === undefined)) return undefined
    const validQuestions = parsedQuestions as MasterQuestion[]
    if (new Set(validQuestions.map(question => question.id)).size !== validQuestions.length) return undefined
    return { requestId, sessionId: owner, questions: validQuestions }
  })
  if (parsed.some(request => request === undefined)) {
    throw new MasterUpstreamError(toMasterError('master/coordinator-unreadable', 'nodeQuestions/pending returned an invalid or cross-session request'))
  }
  const validRequests = parsed as MasterPendingQuestionsValue['requests']
  if (new Set(validRequests.map(request => request.requestId)).size !== validRequests.length) {
    throw new MasterUpstreamError(toMasterError('master/coordinator-unreadable', 'nodeQuestions/pending returned duplicate request IDs'))
  }
  return { requests: validRequests }
}

function readAccepted(value: unknown, endpoint: string): MasterQuestionAccepted {
  if (asRecord(value)?.['accepted'] !== true) {
    throw new MasterUpstreamError(toMasterError('master/coordinator-unreadable', `${endpoint} did not confirm acceptance`))
  }
  return { accepted: true }
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
  readonly #getBaseUrl: (() => string) | undefined
  readonly #resolveApiToken: (() => Promise<string | undefined>) | undefined
  readonly #timeoutMs: number
  readonly #fetch: typeof fetch
  /**
   * Per-node knowledge of whether `session/page` accepts a turn-window hint.
   *
   * The hint is a newer field: a node whose DSH predates it rejects the whole
   * request as invalid input, so the first refusal teaches us to leave it out
   * for that node from then on.
   */
  readonly #pageWindows = new Map<string, boolean>()

  /**
   * @param options - endpoint, credential, deadline, and the fetch implementation.
   */
  constructor(options: CoordinatorClientOptions) {
    this.#baseUrl = options.baseUrl
    this.#apiToken = options.apiToken
    this.#getBaseUrl = options.getBaseUrl
    this.#resolveApiToken = options.resolveApiToken
    this.#timeoutMs = options.requestTimeoutMs
    this.#fetch = options.fetchImpl ?? globalThis.fetch
  }

  /** The origin this client talks to. Safe to display; carries no credential. */
  get baseUrl(): string {
    return this.#getBaseUrl?.() ?? this.#baseUrl
  }

  /** Request headers. The one place the token is attached. */
  async #headers(extra?: Record<string, string>): Promise<Record<string, string>> {
    let token: string | undefined
    try {
      token = this.#resolveApiToken === undefined
        ? this.#apiToken
        : await this.#resolveApiToken()
    } catch {
      throw new MasterUpstreamError(toMasterError(
        'master/credential-unavailable',
        'The coordinator credential could not be resolved',
      ))
    }
    return {
      accept: 'application/json',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
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
      response = await this.#fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: await this.#headers(init.headers as Record<string, string> | undefined),
        signal: this.#deadline(signal),
      })
    } catch (error) {
      if (error instanceof MasterUpstreamError) throw error
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
      return { url: this.baseUrl, reachable: true }
    } catch (error) {
      const message = error instanceof MasterUpstreamError ? error.message : 'unknown failure'
      return { url: this.baseUrl, reachable: false, error: message }
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
    return [...(await this.workspaceSnapshot(nodeId, signal)).archivedSessionIds]
  }

  /** Read registered directories and archive state from one short-lived baseline stream. */
  async workspaceSnapshot(nodeId: string, signal?: AbortSignal): Promise<MasterWorkspaceSnapshot> {
    for await (const frame of this.#followWorkspace(nodeId, signal)) {
      const record = asRecord(frame)
      if (str(record ?? {}, 'type') !== 'baseline') {
        throw new MasterUpstreamError(toMasterError(
          'master/coordinator-unreadable',
          'workspace/follow did not begin with a baseline',
        ))
      }
      const value = asRecord(record?.['value'])
      const archivedSessionIds = readArchivedSessionIds(value)
      try {
        return { workspaces: readWorkspaces(value), archivedSessionIds }
      } catch (cause) {
        if (!(cause instanceof MasterUpstreamError)) throw cause
        return { workspaces: [], archivedSessionIds, workspaceError: cause.toWire() }
      }
    }
    throw new MasterUpstreamError(toMasterError(
      'master/coordinator-unreadable',
      'workspace/follow ended before its baseline',
    ))
  }

  /** Archive one remote session using the node's workspace Remote. */
  async archiveSession(nodeId: string, sessionId: string, signal?: AbortSignal): Promise<string[]> {
    const value = await this.#invokeNode(nodeId, 'workspace/archiveSession', { request: { sessionId } }, signal)
    return readArchivedSessionIds(asRecord(value))
  }

  /**
   * Restore one archived session to the node's workspace grouping surfaces.
   *
   * The node keeps the transcript and the workspace accounting intact while a
   * session is archived, so this only rewrites the archive set; it returns the
   * complete resulting set rather than a diff, which is what the tree installs.
   *
   * @param nodeId - target node.
   * @param sessionId - the session to unarchive on that node.
   * @param signal - caller cancellation.
   * @returns the complete archive set after the write.
   */
  async unarchiveSession(nodeId: string, sessionId: string, signal?: AbortSignal): Promise<string[]> {
    const value = await this.#invokeNode(nodeId, 'workspace/unarchiveSession', { request: { sessionId } }, signal)
    return readArchivedSessionIds(asRecord(value))
  }

  /**
   * Register one existing directory as a workspace on the target node.
   *
   * The node canonicalizes and validates the path against its own filesystem, so
   * a stale or relative path fails there rather than becoming a phantom row here.
   * Registering a known directory is idempotent: the node answers with the
   * existing registry row and `created: false`.
   *
   * @param nodeId - target node.
   * @param path - absolute directory path on that node.
   * @param signal - caller cancellation.
   * @returns the registry row and whether this call created it.
   */
  async createWorkspace(nodeId: string, path: string, signal?: AbortSignal): Promise<MasterCreateWorkspaceValue> {
    const value = await this.#invokeNode(nodeId, 'workspace/create', { request: { path } }, signal)
    const record = asRecord(value)
    const workspace = record === undefined ? undefined : readWorkspaceRow(record['workspace'])
    if (record === undefined || workspace === undefined) {
      throw new MasterUpstreamError(toMasterError(
        'master/coordinator-unreadable',
        'workspace/create did not return a workspace row',
      ))
    }
    return { workspace, created: bool(record, 'created') ?? false }
  }

  /**
   * Rename one remote session's title.
   *
   * The node resumes the session, then appends a user-sourced `session/title`
   * event, which also supersedes automatic title generation on that machine. The
   * accepted title is the node's normalized copy (trimmed, control characters
   * removed, byte-budget truncated), so callers must display it verbatim rather
   * than their own draft.
   *
   * @param nodeId - target node.
   * @param sessionId - target session on that node.
   * @param title - proposed title; the node normalizes it.
   * @param signal - caller cancellation.
   * @returns the session identity and the accepted title.
   */
  async renameSession(
    nodeId: string,
    sessionId: string,
    title: string,
    signal?: AbortSignal,
  ): Promise<MasterRenameSessionValue> {
    const value = await this.#invokeNode(nodeId, 'session/rename', { request: { sessionId, title } }, signal)
    const row = asRecord(value)
    const accepted = row === undefined ? undefined : str(row, 'title')
    if (accepted === undefined || accepted.trim() === '') {
      throw new MasterUpstreamError(toMasterError(
        'master/coordinator-unreadable',
        'session/rename did not return an accepted title',
      ))
    }
    return { sessionId, title: accepted }
  }

  /**
   * Read the target node's model catalog.
   *
   * The catalog belongs to that machine's LLM registry, so it is fetched per
   * node and never merged across nodes. It is host-wide (no session identity),
   * which is why one read serves every session on the node.
   *
   * @param nodeId - target node.
   * @param signal - caller cancellation.
   * @returns provider-grouped models, unreadable provider groups and the node default.
   */
  async fetchModelCatalog(nodeId: string, signal?: AbortSignal): Promise<MasterModelCatalog> {
    const value = await this.#invokeNode(nodeId, 'session/modelCatalog', {}, signal)
    return readModelCatalog(value)
  }

  /**
   * Select one session's model on its node.
   *
   * The node resumes the session when needed and answers with the selection it
   * installed, which is the value callers must display — provider ids and
   * effort ids are the node's, not ours.
   *
   * @param nodeId - target node.
   * @param sessionId - target session on that node.
   * @param selection - provider, model, and optional reasoning effort.
   * @param signal - caller cancellation.
   * @returns the selection the node installed.
   */
  async selectSessionModel(
    nodeId: string,
    sessionId: string,
    selection: MasterModelSelection,
    signal?: AbortSignal,
  ): Promise<MasterSelectModelValue> {
    const value = await this.#invokeNode(nodeId, 'session/selectModel', {
      request: {
        sessionId,
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
      },
    }, signal)
    const row = asRecord(value)
    const selected = row === undefined ? undefined : readModelSelection(row['selected'])
    if (selected === undefined) {
      throw new MasterUpstreamError(toMasterError(
        'master/coordinator-unreadable',
        'session/selectModel did not return the installed selection',
      ))
    }
    return { selected }
  }

  /**
   * Read one backwards page of a session log.
   *
   * The page is asked for in message units and, where the node supports it,
   * snapped to a turn boundary so a page never ends in the middle of a turn.
   * `throughSeq` is the inclusive cut the open window was read at; older nodes
   * require it, newer ones treat it as optional. A node that predates
   * `turnWindow` refuses the whole request as invalid input, so that one refusal
   * switches this node to the plain form for every later page.
   *
   * Records are forwarded verbatim: the browser's own reader parses them, and
   * modelling node events here would break the "unknown fields survive" rule the
   * rest of this client keeps.
   *
   * @param nodeId - target node.
   * @param sessionId - target session on that node.
   * @param options - exclusive `beforeSeq`, inclusive `throughSeq`, message budget.
   * @param signal - caller cancellation.
   * @returns the raw records plus whether older ones remain.
   */
  async fetchSessionPage(
    nodeId: string,
    sessionId: string,
    options: { readonly beforeSeq?: number; readonly throughSeq?: number; readonly maxMessages: number },
    signal?: AbortSignal,
  ): Promise<MasterSessionPageValue> {
    const supportsWindow = this.#pageWindows.get(nodeId) !== false
    const args = (turnWindow: boolean): Readonly<Record<string, unknown>> => ({
      request: {
        address: { kind: 'session', sessionId },
        ...(options.throughSeq === undefined ? {} : { throughSeq: options.throughSeq }),
        ...(options.beforeSeq === undefined ? {} : { beforeSeq: options.beforeSeq }),
        maxMessages: options.maxMessages,
        ...(turnWindow
          ? { turnWindow: { minMessages: Math.min(options.maxMessages, 20), minTurns: 1 } }
          : {}),
      },
    })
    let value: unknown
    try {
      value = await this.#invokeNode(nodeId, 'session/page', args(supportsWindow), signal)
    } catch (error) {
      const refused = error instanceof MasterUpstreamError
        && (error.code === 'gateway/input-invalid' || error.code === 'gateway/bad-request')
      if (!supportsWindow || !refused) throw error
      // This node predates the turn window: remember it and ask again without it.
      this.#pageWindows.set(nodeId, false)
      value = await this.#invokeNode(nodeId, 'session/page', args(false), signal)
    }
    if (supportsWindow) this.#pageWindows.set(nodeId, true)
    const row = asRecord(value)
    const records = row?.['records']
    if (row === undefined || !Array.isArray(records) || typeof row['hasMore'] !== 'boolean') {
      throw new MasterUpstreamError(toMasterError(
        'master/coordinator-unreadable',
        'session/page did not return a record page',
      ))
    }
    return { records, hasMore: row['hasMore'] }
  }

  /**
   * Stop the turn currently running on one session.
   *
   * The node admits the cancellation to the live agent and answers `accepted`;
   * the durable `turn/end` (with its stop reason) is what proves the turn really
   * ended, so callers must not treat this receipt as "stopped".
   *
   * @param nodeId - target node.
   * @param sessionId - target session on that node.
   * @param signal - caller cancellation.
   * @returns the node's admission receipt.
   */
  async cancelSession(nodeId: string, sessionId: string, signal?: AbortSignal): Promise<MasterCancelSessionValue> {
    const value = await this.#invokeNode(nodeId, 'session/cancel', { request: { sessionId } }, signal)
    const row = asRecord(value)
    if (row === undefined || row['accepted'] !== true) {
      throw new MasterUpstreamError(toMasterError(
        'master/coordinator-unreadable',
        'session/cancel was not acknowledged',
      ))
    }
    return { accepted: true }
  }

  /**
   * Create or reuse a blank session inside one registered remote workspace.
   *
   * The node validates `workspaceId` against its own registry and performs the
   * workspace attach; the browser never supplies a `cwd`. Passing `sessionId`
   * asks the node to reuse that blank session when it is still reusable — the
   * node mints a new identity otherwise and returns it here.
   *
   * @param nodeId - target node.
   * @param workspaceId - a workspace registered on that node.
   * @param sessionId - optional existing blank session to reuse.
   * @param signal - caller cancellation.
   * @returns the created or reused identity.
   */
  async createSession(
    nodeId: string,
    workspaceId: string,
    sessionId?: string,
    signal?: AbortSignal,
  ): Promise<MasterCreateSessionValue> {
    const value = await this.#call('/api/session/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nodeId,
        workspaceId,
        ...(sessionId === undefined ? {} : { sessionId }),
      }),
    }, signal)
    const row = asRecord(value)
    const created = row === undefined ? undefined : str(row, 'sessionId')
    if (created === undefined || created.trim() === '') {
      throw new MasterUpstreamError(toMasterError(
        'master/coordinator-unreadable',
        'session/create did not return a sessionId',
      ))
    }
    const agentPreset = row === undefined ? undefined : str(row, 'agentPreset')
    return {
      sessionId: created,
      ...(agentPreset === undefined || agentPreset === '' ? {} : { agentPreset }),
    }
  }

  /** Read the remote session's authoritative permissions and active approvals. */
  async fetchSessionAccess(nodeId: string, sessionId: string, signal?: AbortSignal, interactive = false): Promise<SessionAccess> {
    return readSessionAccess(await this.#invokeNode(nodeId, 'nodeSessionAccess/get', { sessionId, interactive }, signal))
  }

  /** Set one preset using the revision that the user actually reviewed. */
  async setSessionAccess(nodeId: string, sessionId: string, preset: string, expectedRevision: string, operationId: string, signal?: AbortSignal): Promise<SessionAccess> {
    return readSessionAccess(await this.#invokeNode(nodeId, 'nodeSessionAccess/set', { sessionId, preset, expectedRevision, operationId }, signal))
  }

  /** Resolve the original approval without submitting another prompt. */
  async decideSessionApproval(nodeId: string, sessionId: string, requestId: string, outcome: ApprovalDecision, operationId: string, signal?: AbortSignal): Promise<ApprovalResult> {
    return readApprovalResult(await this.#invokeNode(nodeId, 'nodeSessionAccess/decide', { sessionId, requestId, outcome, operationId }, signal))
  }

  async pendingForwardedApprovals(nodeId: string, sessionId: string, interactive: boolean, signal?: AbortSignal): Promise<ForwardedApprovals> {
    return readForwardedApprovals(await this.#invokeNode(nodeId, 'nodeApprovals/pending', { sessionId, interactive }, signal))
  }

  async decideForwardedApproval(nodeId: string, sessionId: string, requestId: string, outcome: ApprovalDecision, signal?: AbortSignal): Promise<ForwardedApprovalAccepted> {
    return readForwardedApprovalAccepted(await this.#invokeNode(nodeId, 'nodeApprovals/decide', { sessionId, requestId, outcome }, signal))
  }

  /** List outstanding ask_user_question requests for one remote session. */
  async pendingQuestions(nodeId: string, sessionId: string, signal?: AbortSignal): Promise<MasterPendingQuestionsValue> {
    const value = await this.#invokeNode(nodeId, 'nodeQuestions/pending', { sessionId }, signal)
    return readPendingQuestions(value, sessionId)
  }

  /** Return the structured answer to the node's original waiting tool call. */
  async answerQuestion(
    nodeId: string,
    sessionId: string,
    requestId: string,
    answer: MasterQuestionAnswer,
    signal?: AbortSignal,
  ): Promise<MasterQuestionAccepted> {
    const value = await this.#invokeNode(nodeId, 'nodeQuestions/answer', { sessionId, requestId, answer }, signal)
    return readAccepted(value, 'nodeQuestions/answer')
  }

  /** Cancel one outstanding question without sending a new session prompt. */
  async cancelQuestion(
    nodeId: string,
    sessionId: string,
    requestId: string,
    signal?: AbortSignal,
  ): Promise<MasterQuestionAccepted> {
    const value = await this.#invokeNode(nodeId, 'nodeQuestions/cancel', { sessionId, requestId }, signal)
    return readAccepted(value, 'nodeQuestions/cancel')
  }

  async #invokeNode(
    nodeId: string,
    endpoint: string,
    args: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.#call('/api/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId, endpoint, args }),
    }, signal)
  }

  /**
   * Call one operation on the coordinator's **closed** file route.
   *
   * Not `/api/invoke`: the coordinator maps the operation name to one
   * `sessionFiles/*` endpoint and validates every field. That is what keeps a
   * browser from reaching an arbitrary node endpoint through this client.
   *
   * @param nodeId - target node.
   * @param operation - one of the coordinator's file operations.
   * @param args - operation arguments; `nodeId` is added here.
   * @param signal - caller cancellation.
   * @returns the node's value.
   */
  async fileOperation(
    nodeId: string,
    operation: string,
    args: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.#call(`/api/files/${encodeURIComponent(operation)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId, ...args }),
    }, signal)
  }

  async *#followWorkspace(nodeId: string, signal?: AbortSignal): AsyncGenerator<unknown> {
    let response: Response
    try {
      response = await this.#fetch(`${this.baseUrl}/api/stream`, {
        method: 'POST',
        headers: await this.#headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          nodeId,
          endpoint: 'workspace/follow',
          args: {},
          timeoutMs: this.#timeoutMs,
        }),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      if (error instanceof MasterUpstreamError) throw error
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
      response = await this.#fetch(`${this.baseUrl}/api/session/follow`, {
        method: 'POST',
        headers: await this.#headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ nodeId, sessionId, assistantStream: true }),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      if (error instanceof MasterUpstreamError) throw error
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

/**
 * Read one workspace row from a node answer.
 *
 * `workspace/create` answers with the registry row it now knows. `sessionIds`
 * is defaulted to empty rather than required: an older node may omit the field
 * on a freshly created workspace whose accounting has no members yet, and the
 * create result is only used to locate and expand that row — membership arrives
 * with the next `workspace/follow` baseline.
 */
function readWorkspaceRow(value: unknown): MasterWorkspace | undefined {
  const row = asRecord(value)
  const workspaceId = row === undefined ? undefined : str(row, 'workspaceId')
  const title = row === undefined ? undefined : str(row, 'title')
  const path = row === undefined ? undefined : str(row, 'path')
  const rawSessionIds = row?.['sessionIds']
  if (row === undefined || workspaceId === undefined || workspaceId.length === 0
    || title === undefined || path === undefined) return undefined
  if (rawSessionIds !== undefined
    && (!Array.isArray(rawSessionIds) || !rawSessionIds.every(id => typeof id === 'string'))) return undefined
  return { workspaceId, title, path, sessionIds: (rawSessionIds ?? []) as string[] }
}

/** Validate the registry before using its identities or session membership. */
function readWorkspaces(value: Record<string, unknown> | undefined): MasterWorkspace[] {
  const items = value?.['items']
  const seen = new Set<string>()
  if (Array.isArray(items)) {
    const workspaces: MasterWorkspace[] = []
    for (const item of items) {
      const row = asRecord(item)
      const workspaceId = row === undefined ? undefined : str(row, 'workspaceId')
      const title = row === undefined ? undefined : str(row, 'title')
      const path = row === undefined ? undefined : str(row, 'path')
      const sessionIds = row?.['sessionIds']
      if (workspaceId === undefined || workspaceId.length === 0 || seen.has(workspaceId)
        || title === undefined || path === undefined || !Array.isArray(sessionIds)
        || !sessionIds.every(id => typeof id === 'string')) break
      seen.add(workspaceId)
      workspaces.push({ workspaceId, title, path, sessionIds })
    }
    if (workspaces.length === items.length) return workspaces
  }
  throw new MasterUpstreamError(toMasterError(
    'master/coordinator-unreadable', 'workspace/follow did not contain a valid workspace registry',
  ))
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

/**
 * Read one provider/model/effort selection.
 *
 * Provider and model ids are opaque strings owned by the node; an empty id is
 * the only invalid form this reader rejects.
 */
function readModelSelection(value: unknown): MasterModelSelection | undefined {
  const row = asRecord(value)
  const provider = row === undefined ? undefined : str(row, 'provider')
  const model = row === undefined ? undefined : str(row, 'model')
  if (provider === undefined || provider === '' || model === undefined || model === '') return undefined
  const effort = row === undefined ? undefined : str(row, 'reasoningEffort')
  return { provider, model, ...(effort === undefined || effort === '' ? {} : { reasoningEffort: effort }) }
}

/** Read one catalog model, keeping its reasoning efforts only when the route advertises them. */
function readCatalogModel(value: unknown): MasterModel | undefined {
  const row = asRecord(value)
  const id = row === undefined ? undefined : str(row, 'id')
  const name = row === undefined ? undefined : str(row, 'name')
  if (id === undefined || id === '' || name === undefined || name === '') return undefined
  const reasoning = row === undefined ? undefined : asRecord(row['reasoning'])
  const efforts: { id: string; name: string }[] = []
  const rawEfforts = reasoning?.['efforts']
  if (Array.isArray(rawEfforts)) {
    for (const raw of rawEfforts) {
      const effort = asRecord(raw)
      const effortId = effort === undefined ? undefined : str(effort, 'id')
      const effortName = effort === undefined ? undefined : str(effort, 'name')
      if (effortId === undefined || effortId === '' || effortName === undefined || effortName === '') continue
      efforts.push({ id: effortId, name: effortName })
    }
  }
  const defaultEffort = reasoning === undefined ? undefined : str(reasoning, 'defaultEffort')
  return {
    id,
    name,
    ...(efforts.length === 0 ? {} : { efforts }),
    ...(defaultEffort === undefined || defaultEffort === '' ? {} : { defaultEffort }),
  }
}

/**
 * Validate one node's model catalog at the trust boundary.
 *
 * Groups and failures are both optional on the wire, but an answer with neither
 * is not a catalog: it means the node replied with something else entirely, and
 * showing an empty selector over it would hide a real breakage.
 */
function readModelCatalog(value: unknown): MasterModelCatalog {
  const row = asRecord(value)
  if (row === undefined) {
    throw new MasterUpstreamError(toMasterError(
      'master/coordinator-unreadable', 'session/modelCatalog did not return a catalog',
    ))
  }
  const groups: MasterModelGroup[] = []
  const rawGroups = row['groups']
  if (Array.isArray(rawGroups)) {
    for (const raw of rawGroups) {
      const group = asRecord(raw)
      const id = group === undefined ? undefined : str(group, 'id')
      const name = group === undefined ? undefined : str(group, 'name')
      if (id === undefined || id === '' || name === undefined) continue
      const models: MasterModel[] = []
      const rawModels = group?.['models']
      if (Array.isArray(rawModels)) {
        for (const rawModel of rawModels) {
          const model = readCatalogModel(rawModel)
          if (model !== undefined) models.push(model)
        }
      }
      groups.push({ id, name, models })
    }
  }
  const failures: { id: string; message: string }[] = []
  const rawFailures = row['failures']
  if (Array.isArray(rawFailures)) {
    for (const raw of rawFailures) {
      const failure = asRecord(raw)
      const id = failure === undefined ? undefined : str(failure, 'id')
      const message = failure === undefined ? undefined : str(failure, 'message')
      if (id === undefined || message === undefined) continue
      failures.push({ id, message })
    }
  }
  if (groups.length === 0 && failures.length === 0) {
    throw new MasterUpstreamError(toMasterError(
      'master/coordinator-unreadable', 'session/modelCatalog returned no provider groups',
    ))
  }
  const fallback = readModelSelection(row['default'])
  return { groups, failures, ...(fallback === undefined ? {} : { default: fallback }) }
}
