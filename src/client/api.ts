import { readSessionAccess, readApprovalResult, readForwardedApprovals, readForwardedApprovalAccepted, type SessionAccess, type ApprovalDecision, type ApprovalResult, type ForwardedApprovals, type ForwardedApprovalAccepted } from '../session-access-protocol.js'
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
  type MasterCreateSessionValue,
  type MasterCreateWorkspaceValue,
  type MasterModelCatalog,
  type MasterModelSelection,
  type MasterNodesValue,
  type MasterPendingQuestionsValue,
  type MasterQuestionAccepted,
  type MasterQuestionAnswer,
  type MasterRenameSessionValue,
  type MasterSelectModelValue,
  type MasterSessionPageValue,
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

/**
 * Restore one archived remote session.
 *
 * The owning node answers with the complete resulting archive set, so the caller
 * installs it instead of editing its own copy — the same rule as archiving.
 *
 * @param nodeId - the node that owns the session.
 * @param sessionId - the archived session on that node.
 * @param signal - caller cancellation.
 * @returns the complete archive set after the write.
 */
export async function unarchiveRemoteSession(
  nodeId: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<MasterArchiveValue> {
  const response = await fetch(`${ROUTE_PREFIX}/api/session/unarchive`, init(signal, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ nodeId, sessionId }),
  }))
  return unwrap(await envelopeOf(response) as MasterEnvelope<MasterArchiveValue>)
}

/**
 * Register one existing directory as a workspace on a remote node.
 *
 * Only the path travels; the node canonicalizes it, checks existence, and
 * returns the registry row. A path that is already registered resolves to the
 * same workspace with `created: false`, which is how a repeated pick locates the
 * existing row instead of duplicating it.
 *
 * @param nodeId - target node.
 * @param path - absolute directory path on that node.
 * @param signal - caller cancellation.
 * @returns the registry row and whether this call created it.
 */
export async function createRemoteWorkspace(
  nodeId: string,
  path: string,
  signal?: AbortSignal,
): Promise<MasterCreateWorkspaceValue> {
  const response = await fetch(`${ROUTE_PREFIX}/api/workspace/create`, init(signal, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ nodeId, path }),
  }))
  return unwrap(await envelopeOf(response) as MasterEnvelope<MasterCreateWorkspaceValue>)
}

/**
 * Create or reuse a blank session in one remote workspace.
 *
 * Only a node-registered `workspaceId` is sent; the browser never supplies a
 * remote path. Passing `sessionId` asks the node to reuse that blank session.
 *
 * @param nodeId - target node.
 * @param workspaceId - a workspace registered on that node.
 * @param sessionId - optional existing blank session to reuse.
 * @param signal - caller cancellation.
 * @returns the created or reused identity.
 */
export async function createRemoteSession(
  nodeId: string,
  workspaceId: string,
  sessionId?: string,
  signal?: AbortSignal,
): Promise<MasterCreateSessionValue> {
  const response = await fetch(`${ROUTE_PREFIX}/api/session/create`, init(signal, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      nodeId,
      workspaceId,
      ...(sessionId === undefined ? {} : { sessionId }),
    }),
  }))
  return unwrap(await envelopeOf(response) as MasterEnvelope<MasterCreateSessionValue>)
}

/**
 * Rename one remote session's title.
 *
 * The node normalizes the title (trim, control characters, byte budget), so the
 * returned value — not the draft — is what the panel should display.
 *
 * @param nodeId - target node.
 * @param sessionId - target session on that node.
 * @param title - trimmed display title.
 * @param signal - caller cancellation.
 * @returns the session identity and the accepted title.
 */
export async function renameRemoteSession(
  nodeId: string,
  sessionId: string,
  title: string,
  signal?: AbortSignal,
): Promise<MasterRenameSessionValue> {
  const response = await fetch(`${ROUTE_PREFIX}/api/session/rename`, init(signal, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ nodeId, sessionId, title }),
  }))
  return unwrap(await envelopeOf(response) as MasterEnvelope<MasterRenameSessionValue>)
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
 * Read one node's model catalog.
 *
 * The catalog describes that machine's own providers, so callers key any cache
 * by node and drop it when the node roster changes.
 *
 * @param nodeId - target node.
 * @param signal - caller cancellation.
 */
export async function fetchModelCatalog(
  nodeId: string,
  signal?: AbortSignal,
): Promise<MasterModelCatalog> {
  const query = new URLSearchParams({ nodeId })
  const response = await fetch(`${ROUTE_PREFIX}/api/session/models?${query.toString()}`, init(signal, {
    headers: { accept: 'application/json' },
  }))
  return unwrap(await envelopeOf(response) as MasterEnvelope<MasterModelCatalog>)
}

/**
 * Select one remote session's model.
 *
 * The node answers with the selection it installed; display that value rather
 * than the one this call sent, because provider and effort ids are its own.
 *
 * @param nodeId - target node.
 * @param sessionId - target session.
 * @param selection - provider, model, and optional reasoning effort.
 * @param signal - caller cancellation.
 */
export async function selectRemoteModel(
  nodeId: string,
  sessionId: string,
  selection: MasterModelSelection,
  signal?: AbortSignal,
): Promise<MasterSelectModelValue> {
  const response = await fetch(`${ROUTE_PREFIX}/api/session/model`, init(signal, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      nodeId,
      sessionId,
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
    }),
  }))
  return unwrap(await envelopeOf(response) as MasterEnvelope<MasterSelectModelValue>)
}

/**
 * Stop the turn running on one remote session.
 *
 * The node's receipt only means it admitted the request to the live agent; the
 * transcript's own `turn/end` is the proof. Callers keep showing "running" until
 * the follow stream reports it.
 *
 * @param nodeId - target node.
 * @param sessionId - target session.
 * @param signal - caller cancellation.
 */
export async function cancelRemoteSession(
  nodeId: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${ROUTE_PREFIX}/api/session/cancel`, init(signal, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ nodeId, sessionId }),
  }))
  unwrap(await envelopeOf(response) as MasterEnvelope<unknown>)
}

/**
 * Read one backwards page of a remote session log.
 *
 * The node answers with raw records and `hasMore`; the browser parses them with
 * the same reader the follow window uses, so a row keeps one shape no matter
 * which page delivered it.
 *
 * @param nodeId - target node.
 * @param sessionId - target session.
 * @param options - exclusive `beforeSeq`, inclusive `throughSeq`, message budget.
 * @param signal - caller cancellation.
 */
export async function fetchSessionPage(
  nodeId: string,
  sessionId: string,
  options: { readonly beforeSeq?: number; readonly throughSeq?: number; readonly maxMessages?: number },
  signal?: AbortSignal,
): Promise<MasterSessionPageValue> {
  const response = await fetch(`${ROUTE_PREFIX}/api/session/page`, init(signal, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      nodeId,
      sessionId,
      ...(options.beforeSeq === undefined ? {} : { beforeSeq: options.beforeSeq }),
      ...(options.throughSeq === undefined ? {} : { throughSeq: options.throughSeq }),
      maxMessages: options.maxMessages ?? 30,
    }),
  }))
  return unwrap(await envelopeOf(response) as MasterEnvelope<MasterSessionPageValue>)
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

/** Read permissions and active approvals for one remote session. */
export async function fetchSessionAccess(nodeId: string, sessionId: string, signal?: AbortSignal): Promise<SessionAccess> {
  const query = new URLSearchParams({ nodeId, sessionId })
  const response = await fetch(`${ROUTE_PREFIX}/api/session/access?${query}`, init(signal))
  return readSessionAccess(unwrap(await envelopeOf(response)))
}

/** Apply a reviewed permission preset. */
export async function setSessionAccess(nodeId: string, sessionId: string, preset: string, expectedRevision: string, operationId: string, signal?: AbortSignal): Promise<SessionAccess> {
  const response = await fetch(`${ROUTE_PREFIX}/api/session/access/set`, init(signal, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nodeId, sessionId, preset, expectedRevision, operationId }),
  }))
  return readSessionAccess(unwrap(await envelopeOf(response)))
}

/** Resolve one live approval, never by sending a message to the agent. */
export async function decideSessionApproval(nodeId: string, sessionId: string, requestId: string, outcome: ApprovalDecision, operationId: string, signal?: AbortSignal): Promise<ApprovalResult> {
  const response = await fetch(`${ROUTE_PREFIX}/api/session/access/decide`, init(signal, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nodeId, sessionId, requestId, outcome, operationId }),
  }))
  return readApprovalResult(unwrap(await envelopeOf(response)))
}

export async function fetchForwardedApprovals(nodeId: string, sessionId: string, signal?: AbortSignal): Promise<ForwardedApprovals> {
  const query = new URLSearchParams({ nodeId, sessionId })
  const response = await fetch(`${ROUTE_PREFIX}/api/session/approvals?${query}`, init(signal))
  return readForwardedApprovals(unwrap(await envelopeOf(response)))
}

export async function decideForwardedApproval(nodeId: string, sessionId: string, requestId: string, outcome: ApprovalDecision, signal?: AbortSignal): Promise<ForwardedApprovalAccepted> {
  const response = await fetch(`${ROUTE_PREFIX}/api/session/approval-decision`, init(signal, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nodeId, sessionId, requestId, outcome }),
  }))
  return readForwardedApprovalAccepted(unwrap(await envelopeOf(response)))
}
