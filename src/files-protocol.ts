/**
 * The browser-facing half of the session-file contract.
 *
 * These types mirror `dsh-node/src/files/types.ts` and the coordinator's
 * `files-api.ts`, with one deliberate omission: **no `remotePath`**. The node
 * returns it so this host can append an attachment list to the prompt, but it is
 * stripped before any response reaches a browser.
 *
 * @module dsh-master/files-protocol
 */

/** Version of the `sessionFiles` contract this plugin speaks. */
export const FILES_PROTOCOL_VERSION = 1

/** Largest upload accepted by one message, mirrored from the node. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024

/** Most attachments one prompt may carry. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 5

/** Raw bytes per upload chunk. */
export const UPLOAD_CHUNK_BYTES = 256 * 1024

/** Bytes requested per artifact chunk while downloading. */
export const ARTIFACT_CHUNK_BYTES = 256 * 1024

/** Largest JSON body the master accepts on a file operation. */
export const MAX_FILE_BODY_BYTES = 1024 * 1024

/** The node-authoritative limits. */
export interface FileLimits {
  readonly maxFileBytes: number
  readonly maxAttachmentsPerMessage: number
  readonly maxActiveUploads: number
  readonly storageLimitBytes: number
  readonly chunkBytes: number
  readonly retentionMs: number
  readonly incompleteUploadTtlMs: number
}

/** `sessionFiles/describe`, as the browser may see it. */
export interface FileDescribe {
  readonly protocolVersion: number
  readonly limits: FileLimits
  readonly deliveryTool: 'available' | 'unavailable'
}

/** One attachment, without its node-side path. */
export interface FileAttachment {
  readonly attachmentId: string
  readonly nodeId: string
  readonly sessionId: string
  readonly name: string
  readonly size: number
  readonly sha256: string
  readonly createdAt: string
  readonly expiresAt: string
}

/** Why an artifact cannot be downloaded. */
export type FileArtifactState = 'ready' | 'expired' | 'missing'

/** One delivered artifact, without its node-side path. */
export interface FileArtifact {
  readonly artifactId: string
  readonly nodeId: string
  readonly sessionId: string
  readonly name: string
  readonly size: number
  readonly sha256: string
  readonly createdAt: string
  readonly expiresAt: string
  readonly state: FileArtifactState
}

/** `beginUpload` result. */
export interface FileBeginUpload {
  readonly uploadId: string
  readonly chunkBytes: number
  readonly received: number
}

/** `writeChunk` result. */
export interface FileWriteChunk {
  readonly nextOffset: number
  readonly received: number
}

/** `abortUpload` result. */
export interface FileAbortUpload {
  readonly accepted: true
}

/** One artifacts list. */
export interface FileArtifactList {
  readonly artifacts: readonly FileArtifact[]
}

/** Operations the master proxies to the browser. */
export const FILE_PROXY_OPERATIONS = [
  'describe',
  'beginUpload',
  'writeChunk',
  'commitUpload',
  'abortUpload',
  'listArtifacts',
] as const

/** One operation name. */
export type FileProxyOperation = (typeof FILE_PROXY_OPERATIONS)[number]

/** Operations the master host calls for itself, never through a browser route. */
export const FILE_INTERNAL_OPERATIONS = ['resolveAttachments', 'readArtifactChunk'] as const

/** Whether a string is a browser-facing operation. */
export function isFileProxyOperation(value: string): value is FileProxyOperation {
  return (FILE_PROXY_OPERATIONS as readonly string[]).includes(value)
}
