/**
 * The panel's view of a node's file capability.
 *
 * Before this module the view had two buckets — `unsupported` and `error` — so a
 * missing protocol, a missing endpoint, an unregistered tool, a network failure and
 * a permission refusal all rendered the same "upgrade the node" line. That is why a
 * single failed probe could be reported as two independent problems.
 *
 * The classification here is deliberately evidence-based:
 *
 * - only `describe.deliveryTool === 'unavailable'` means the tool is *explicitly*
 *   unregistered;
 * - `coordinator/capability-unavailable` means the node does not advertise the
 *   `sessionFiles` namespace at all — not that any particular tool is missing, and
 *   not that the node's build is old;
 * - `node/capability-unavailable` is an endpoint-level miss, kept separate from a
 *   missing namespace;
 * - transport, permission and version failures keep their own identity and their
 *   original code, so the UI can offer the right retry.
 *
 * Pure: no React, no fetch. The view supplies the loader and renders the result.
 *
 * @module dsh-master/client/file-support
 */

import { ApiError } from './api.js'
import { FILES_PROTOCOL_VERSION, type FileDescribe } from '../files-protocol.js'

/** Why the node cannot offer the file surface, as far as the evidence allows. */
export type FileCapabilityReason =
  /** The node advertises no `sessionFiles` namespace. The cause is not provable here. */
  | 'protocol-unsupported'
  /** The namespace is advertised but the endpoint/operation is not registered. */
  | 'endpoint-missing'
  /** The advertised protocol version is not the one this plugin speaks. */
  | 'capability-mismatch'
  /** The coordinator or the node could not be reached, or the call timed out. */
  | 'network'
  /** The caller is not allowed to use the file surface. */
  | 'permission'
  /** Anything else; the raw code is kept for diagnosis. */
  | 'unknown'

/** A failed capability probe. */
export interface FileSupportFailure {
  readonly status: 'error'
  readonly reason: FileCapabilityReason
  /** The upstream code when there was one; never a credential. */
  readonly code: string
  /** A sanitized diagnostic line, safe to keep collapsed in the UI. */
  readonly message: string
  readonly retryable: boolean
}

/** What the panel knows about file support right now. */
export type FileSupportState =
  | { readonly status: 'loading' }
  | { readonly status: 'supported'; readonly describe: FileDescribe }
  | FileSupportFailure

const NETWORK_CODES: ReadonlySet<string> = new Set([
  'coordinator/node-offline',
  'coordinator/request-timeout',
  'coordinator/request-aborted',
  'coordinator/connection-lost',
  'master/coordinator-unreachable',
])

const PERMISSION_CODES: ReadonlySet<string> = new Set([
  'coordinator/auth-required',
  'coordinator/auth-rejected',
  'coordinator/auth-invalid-request',
  'coordinator/auth-rate-limited',
  'master/forbidden',
  'master/credential-unavailable',
  'files/forbidden',
  'gateway/forbidden',
])

/** Remove credential-shaped values from an upstream message before it is stored. */
export function sanitizeDiagnostic(message: string): string {
  return message
    .replace(/Bearer\s+[^\s,;]+/giu, 'Bearer [redacted]')
    .replace(
      /((?:^|[\s?&])(?:token|api[_-]?key|access[_-]?token|authorization)=)[^\s&,;]+/giu,
      '$1[redacted]',
    )
}

/**
 * Map one failed probe to a reason, preserving the upstream code.
 *
 * @param cause - whatever the loader threw.
 * @returns a failure state; never throws.
 */
export function classifyFileSupportError(cause: unknown): FileSupportFailure {
  const code = cause instanceof ApiError ? cause.code : 'master/internal'
  const rawMessage = cause instanceof Error ? cause.message : String(cause)
  const message = sanitizeDiagnostic(rawMessage)

  switch (code) {
    case 'coordinator/capability-unavailable':
      return { status: 'error', reason: 'protocol-unsupported', code, message, retryable: true }
    case 'coordinator/endpoint-not-found':
    case 'node/capability-unavailable':
      return { status: 'error', reason: 'endpoint-missing', code, message, retryable: true }
    case 'coordinator/capability-mismatch':
      return { status: 'error', reason: 'capability-mismatch', code, message, retryable: false }
    default:
      if (NETWORK_CODES.has(code)) {
        return { status: 'error', reason: 'network', code, message, retryable: true }
      }
      if (PERMISSION_CODES.has(code)) {
        return { status: 'error', reason: 'permission', code, message, retryable: false }
      }
      return { status: 'error', reason: 'unknown', code, message, retryable: true }
  }
}

/**
 * Accept a `describe` payload only when it is the contract this plugin speaks.
 *
 * A version this build does not know is a mismatch, not a missing tool: refusing it
 * here keeps the panel from guessing whether delivery would work.
 *
 * @param describe - the node's validated payload.
 * @returns a supported state, or a mismatch failure.
 */
export function describeFileSupport(describe: FileDescribe): FileSupportState {
  if (describe.protocolVersion !== FILES_PROTOCOL_VERSION) {
    return {
      status: 'error',
      reason: 'capability-mismatch',
      code: 'master/files-protocol-mismatch',
      message: `节点报告文件协议版本 ${String(describe.protocolVersion)}，本插件支持 ${String(FILES_PROTOCOL_VERSION)}`,
      retryable: false,
    }
  }
  return { status: 'supported', describe }
}

/**
 * Run one capability probe without letting it reject.
 * @param load - caller-owned request, including its cancellation.
 * @returns the classified state.
 */
export async function probeFileSupport(load: () => Promise<FileDescribe>): Promise<FileSupportState> {
  try {
    return describeFileSupport(await load())
  } catch (cause) {
    return classifyFileSupportError(cause)
  }
}

/**
 * Whether a stream reopen should re-probe an unavailable capability.
 *
 * The first open follows the mount probe and must not duplicate it. A later open
 * means the node reconnected, which is exactly when a restart or upgrade can have
 * changed the answer.
 *
 * @param state - the capability state at the moment the stream opened.
 * @param openedBefore - whether this view has already seen an `open` for the session.
 * @returns true when a fresh probe is warranted.
 */
export function shouldRefreshFileSupport(state: FileSupportState, openedBefore: boolean): boolean {
  if (!openedBefore) return false
  // Any failed probe is worth repeating after a reconnect: credentials, node
  // builds and loaded plugins can all change while the socket was down, even when
  // the failure is one the user cannot retry from the panel.
  if (state.status === 'error') return true
  return state.status === 'supported' && state.describe.deliveryTool === 'unavailable'
}
