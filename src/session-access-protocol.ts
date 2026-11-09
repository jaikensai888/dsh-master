/** Validated session permission and live approval values crossing the node wire. */
export interface PermissionOption {
  readonly value: string
  readonly name: string
  readonly sandbox: string
  readonly approval: string
}
export interface PendingApproval {
  readonly requestId: string
  readonly toolName: string
  readonly callId?: string
  readonly reason?: string
}
export interface SessionAccess {
  readonly currentValue: string
  readonly options: readonly PermissionOption[]
  readonly revision: string
  readonly pendingApprovals: readonly PendingApproval[]
  readonly supportsResumePending: boolean
}
export type ApprovalDecision = 'allowed-once' | 'rejected'
export interface ApprovalResult { readonly outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable' }
export interface ForwardedApprovals { readonly requests: readonly PendingApproval[] }
export interface ForwardedApprovalAccepted { readonly accepted: true }

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid session access response')
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 16_384) throw new Error('Invalid session access text')
  return value
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 256) throw new Error('Invalid session access list')
  return value
}
function readPendingApprovals(value: unknown): PendingApproval[] {
  return list(value).map(item => {
    const pending = record(item)
    return { requestId: text(pending['requestId']), toolName: text(pending['toolName']),
      ...(pending['callId'] === undefined ? {} : { callId: text(pending['callId']) }),
      ...(pending['reason'] === undefined ? {} : { reason: text(pending['reason']) }) }
  })
}

export function readForwardedApprovals(value: unknown): ForwardedApprovals {
  return { requests: readPendingApprovals(record(value)['requests']) }
}

/** An acknowledgement means the host received the reply. Follow supplies the audit outcome. */
export function readForwardedApprovalAccepted(value: unknown): ForwardedApprovalAccepted {
  if (record(value)['accepted'] !== true) throw new Error('Approval response was not acknowledged')
  return { accepted: true }
}
/** Decode a snapshot without accepting missing fields as permission grants. */
export function readSessionAccess(value: unknown): SessionAccess {
  const row = record(value)
  if (typeof row['supportsResumePending'] !== 'boolean') throw new Error('Missing approval capability')
  return {
    currentValue: text(row['currentValue']), revision: text(row['revision']), supportsResumePending: row['supportsResumePending'],
    options: list(row['options']).map(item => {
      const option = record(item)
      return { value: text(option['value']), name: text(option['name']), sandbox: text(option['sandbox']), approval: text(option['approval']) }
    }),
    pendingApprovals: readPendingApprovals(row['pendingApprovals']),
  }
}
/** Decode a settled approval outcome. */
export function readApprovalResult(value: unknown): ApprovalResult {
  const outcome = record(value)['outcome']
  if (outcome !== 'allowed-once' && outcome !== 'rejected' && outcome !== 'cancelled' && outcome !== 'unavailable') throw new Error('Invalid approval outcome')
  return { outcome }
}
