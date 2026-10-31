/**
 * Browser-side upload state and transfer.
 *
 * The state machine is deliberately separated from React: an upload is a
 * sequential conversation with the host (`beginUpload → writeChunk… →
 * commitUpload`), and the panel only mirrors its progress. That keeps the
 * retry/idempotency rules testable without a DOM.
 *
 * Nothing here computes a remote path. The browser sends a file and gets back
 * an `attachmentId`; the host resolves the path that goes into the prompt.
 *
 * @module dsh-master/client/attachments
 */

import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_FILE_BYTES,
  UPLOAD_CHUNK_BYTES,
  type FileAttachment,
  type FileDescribe,
  type FileLimits,
} from '../files-protocol.js'
import {
  abortUpload,
  ApiError,
  beginUpload,
  commitUpload,
  writeUploadChunk,
} from './api.js'

/** The lifecycle of one selected file. */
export type LocalAttachmentStatus = 'selected' | 'uploading' | 'ready' | 'failed'

/** One file the user picked, plus its upload progress. */
export interface LocalAttachment {
  /** Browser-only identity; never sent. */
  readonly localId: string
  readonly nodeId: string
  readonly sessionId: string
  readonly file: File
  readonly name: string
  readonly size: number
  readonly status: LocalAttachmentStatus
  /** Bytes the node has confirmed. */
  readonly received: number
  /** Set only after a confirmed commit. */
  readonly attachment?: FileAttachment | undefined
  readonly error?: string | undefined
}

/** One rejected selection, with a reason fit for the user. */
export interface RejectedSelection {
  readonly name: string
  readonly reason: string
}

/** Fraction of the file the node has confirmed, in `[0, 1]`. */
export function uploadProgress(attachment: LocalAttachment): number {
  if (attachment.size === 0) return attachment.status === 'ready' ? 1 : 0
  return Math.min(1, attachment.received / attachment.size)
}

/** Whether every selected file is committed and the text is non-empty. */
export function canSubmit(text: string, attachments: readonly LocalAttachment[], promptEnabled: boolean, sendUncertain = false): boolean {
  if (!promptEnabled || sendUncertain || text.trim() === '') return false
  return attachments.every(attachment => attachment.status === 'ready')
}

/** The ids to send with a prompt; empty when nothing is attached. */
export function attachmentIds(attachments: readonly LocalAttachment[]): string[] {
  return attachments.flatMap(attachment => (attachment.attachment === undefined ? [] : [attachment.attachment.attachmentId]))
}

/**
 * Filter a selection against the node's limits.
 *
 * Rejection is per file and never silently drops the rest: the user sees which
 * file was refused and why, while the others still upload.
 * @param files - files from the input element.
 * @param existingCount - attachments already selected.
 * @param limits - node limits, or the conservative defaults while loading.
 * @returns accepted files plus one reason per rejected file.
 */
export function selectFiles(
  files: readonly File[],
  existingCount: number,
  limits: FileLimits | undefined,
): { accepted: File[]; rejected: RejectedSelection[] } {
  const maxFileBytes = limits?.maxFileBytes ?? MAX_FILE_BYTES
  const maxCount = limits?.maxAttachmentsPerMessage ?? MAX_ATTACHMENTS_PER_MESSAGE
  const accepted: File[] = []
  const rejected: RejectedSelection[] = []
  let room = Math.max(0, maxCount - existingCount)
  for (const file of files) {
    if (file.size > maxFileBytes) {
      rejected.push({ name: file.name, reason: `超过单文件上限 ${String(maxFileBytes)} 字节` })
      continue
    }
    if (room <= 0) {
      rejected.push({ name: file.name, reason: `每条消息最多 ${String(maxCount)} 个附件` })
      continue
    }
    room -= 1
    accepted.push(file)
  }
  return { accepted, rejected }
}

/** One fresh local row, before any network call. */
export function newLocalAttachment(nodeId: string, sessionId: string, file: File): LocalAttachment {
  return {
    localId: newId(),
    nodeId,
    sessionId,
    file,
    name: file.name === '' ? 'file' : file.name,
    size: file.size,
    status: 'selected',
    received: 0,
  }
}

/** Replace one row by `localId`, leaving the others untouched. */
export function updateAttachment(
  list: readonly LocalAttachment[],
  localId: string,
  patch: Partial<LocalAttachment>,
): LocalAttachment[] {
  return list.map(attachment => (attachment.localId === localId ? { ...attachment, ...patch } : attachment))
}

/** Remove one row by `localId`. */
export function removeAttachment(list: readonly LocalAttachment[], localId: string): LocalAttachment[] {
  return list.filter(attachment => attachment.localId !== localId)
}

/** Options for {@link uploadAttachment}. */
export interface UploadAttachmentOptions {
  /** Node limits from `describe`. */
  readonly limits: FileLimits
  /** Cancellation; aborting also aborts the server-side staging file. */
  readonly signal?: AbortSignal
  /** Confirmed-byte progress. */
  readonly onProgress?: (received: number, total: number) => void
  /** Upload identity; tests may pin it. */
  readonly clientUploadId?: string
  /** Chunk size; defaults to the node's `chunkBytes`. */
  readonly chunkBytes?: number
}

/**
 * Upload one file and return the host's committed row.
 *
 * Split out so tests can drive the transfer with a stubbed transport without
 * changing the state machine.
 * @param nodeId - target node.
 * @param sessionId - target session.
 * @param file - file to send.
 * @param options - limits and cancellation.
 * @returns the committed attachment row.
 */
export async function uploadAttachment(
  nodeId: string,
  sessionId: string,
  file: File,
  options: UploadAttachmentOptions,
): Promise<FileAttachment> {
  if (file.size > options.limits.maxFileBytes) {
    throw new ApiError('master/too-large', `文件超过 ${String(options.limits.maxFileBytes)} 字节上限`)
  }
  const name = file.name === '' ? 'file' : file.name
  const buffer = await file.arrayBuffer()
  const sha256 = await sha256Hex(buffer)
  const clientUploadId = options.clientUploadId ?? newId()
  const chunkBytes = Math.min(options.chunkBytes ?? options.limits.chunkBytes, UPLOAD_CHUNK_BYTES)
  const signal = options.signal
  throwIfAborted(signal)
  const begun = await retryTransport(
    () => beginUpload(nodeId, sessionId, name, file.size, clientUploadId, signal),
    signal,
  )
  options.onProgress?.(begun.received, file.size)
  let offset = begun.received
  let committed = false
  try {
    while (offset < file.size) {
      throwIfAborted(signal)
      const slice = new Uint8Array(
        await file.slice(offset, Math.min(offset + chunkBytes, file.size)).arrayBuffer(),
      )
      const written = await retryTransport(
        () => writeUploadChunk(nodeId, sessionId, begun.uploadId, offset, bytesToBase64(slice), signal),
        signal,
      )
      if (written.nextOffset <= offset) {
        throw new ApiError('master/upload-stalled', '节点没有确认新的字节，上传已停止')
      }
      offset = written.nextOffset
      options.onProgress?.(offset, file.size)
    }
    throwIfAborted(signal)
    const record = await retryTransport(
      () => commitUpload(nodeId, sessionId, begun.uploadId, file.size, sha256, signal),
      signal,
    ) as Record<string, unknown> | undefined
    committed = true
    return readCommitted(record, { nodeId, sessionId, name, size: file.size, sha256 })
  } finally {
    if (!committed) await abortUpload(nodeId, sessionId, begun.uploadId).catch(() => undefined)
  }
}

/** Read the host's committed attachment, falling back to what the client knows. */
export function readCommitted(
  value: unknown,
  known: { nodeId: string; sessionId: string; name: string; size: number; sha256: string },
): FileAttachment {
  const row = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  const attachmentId = typeof row['attachmentId'] === 'string' ? row['attachmentId'] : ''
  if (attachmentId === '') throw new ApiError('master/unreadable', '节点没有返回已提交附件的 ID')
  return {
    attachmentId,
    nodeId: typeof row['nodeId'] === 'string' ? row['nodeId'] : known.nodeId,
    sessionId: typeof row['sessionId'] === 'string' ? row['sessionId'] : known.sessionId,
    name: typeof row['name'] === 'string' ? row['name'] : known.name,
    size: typeof row['size'] === 'number' ? row['size'] : known.size,
    sha256: typeof row['sha256'] === 'string' ? row['sha256'] : known.sha256,
    createdAt: typeof row['createdAt'] === 'string' ? row['createdAt'] : '',
    expiresAt: typeof row['expiresAt'] === 'string' ? row['expiresAt'] : '',
  }
}

/** Encode bytes without spreading a whole chunk onto the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step))
  }
  return btoa(binary)
}

/** SHA-256 of a whole file, as lower-case hex. */
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Throw the standard abort rejection if the caller cancelled. */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    const error = new Error('the upload was cancelled')
    error.name = 'AbortError'
    throw error
  }
}

/** A browser UUID, with a fallback for a context without `randomUUID`. */
function newId(): string {
  const cryptoValue = globalThis.crypto as { randomUUID?: () => string } | undefined
  if (typeof cryptoValue?.randomUUID === 'function') return cryptoValue.randomUUID()
  return `local-${String(Date.now())}-${Math.random().toString(16).slice(2)}`
}

/** Whether a node supports attaching files at all. */
export function supportsAttachments(describe: FileDescribe | undefined): boolean {
  return describe !== undefined && describe.protocolVersion >= 1
}

/**
 * Retry a transfer call whose response may have been lost.
 *
 * Every step of the upload conversation is idempotent on the node: `beginUpload`
 * by `clientUploadId`, `writeChunk` by offset plus bytes, and `commitUpload` by
 * the verified digest. A missing response is therefore safe to re-send, and
 * re-sending is the only way a flaky but recovered connection finishes the
 * transfer without restarting the file. A host refusal (an `ApiError`) is not
 * retried: nothing about waiting would change it.
 * @param task - one API call.
 * @param signal - caller cancellation.
 * @returns the call's value.
 */
async function retryTransport<T>(task: () => Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  const delays = [0, 150, 400]
  let last: unknown
  for (const [attempt, delayMs] of delays.entries()) {
    if (delayMs > 0) await wait(delayMs, signal)
    throwIfAborted(signal)
    try {
      return await task()
    } catch (error) {
      if (error instanceof ApiError || signal?.aborted === true) throw error
      last = error
      if (attempt === delays.length - 1) break
    }
  }
  throw last
}

/** Wait, but let cancellation end the wait immediately. */
function wait(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted === true) return Promise.resolve()
  return new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    signal?.addEventListener('abort', finish, { once: true })
    timer = setTimeout(finish, delayMs)
  })
}

/**
 * Whether a send failure leaves the accepted state unknown.
 *
 * An envelope can describe a lost upstream response after the node accepted
 * the task. Only known pre-dispatch refusals are safe to retry immediately;
 * unknown errors require the user to check the conversation first.
 * @param cause - the thrown value.
 * @returns true when the user has to check the conversation before retrying.
 */
export function isUncertainPromptFailure(cause: unknown): boolean {
  if (!(cause instanceof ApiError)) return true
  if (cause.code.startsWith('files/')) return false
  return ![
    'master/invalid-arguments', 'master/prompt-disabled', 'master/forbidden',
    'master/credential-unavailable', 'master/unavailable',
    'coordinator/auth-rejected', 'coordinator/invalid-arguments',
    'coordinator/node-offline', 'coordinator/capability-unavailable',
    'coordinator/endpoint-not-found', 'session/not-found',
  ].includes(cause.code)
}
