/** Live approval actions operate on the original host request ids. */
import type { ReactElement } from 'react'
import { IconWarningOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccessControlProps } from './RemotePermissionSelect.js'
import { ACCESS_COPY } from './copy.js'
import { isFullAccess } from './session-access.js'

// Native shell approvals encode the requested sandbox scope in the reason.
const SANDBOX_REASON = /^escalate sandbox to (danger-full-access|workspace-write): (.+)$/s

export function RemoteApprovalPanel({ state, controller, enabled }: AccessControlProps): ReactElement | null {
  const pending = state.forwardedApprovals ?? state.access?.pendingApprovals ?? []
  const full = state.access?.options.find(isFullAccess)
  const disabled = !enabled || state.busy || (state.unsupported && state.forwardedApprovals === undefined)
  if (pending.length === 0 && state.error === undefined) return null
  return <section className="dsh-master-access-panel" aria-label={ACCESS_COPY.waiting}>
    {state.error === undefined ? null : <div className="dsh-master-error" role="alert">{state.error}
      <button type="button" className="dsh-master-toolbar-select" disabled={state.busy} onClick={() => { void controller?.refresh() }}>{ACCESS_COPY.retry}</button>
    </div>}
    {pending.length === 0 ? null : <>
      <div className="dsh-master-access-heading">
        <span className="dsh-master-access-icon" aria-hidden="true"><IconWarningOutlineRegular size={16} /></span>
        <strong>{ACCESS_COPY.waiting}</strong>
        {pending.length > 1 && <span className="dsh-master-access-count">{ACCESS_COPY.pendingCount(pending.length)}</span>}
      </div>
      <ul className="dsh-master-access-list">
        {pending.map(request => {
          const escalation = request.reason?.match(SANDBOX_REASON)
          const reason = escalation?.[2] ?? request.reason
          return <li className="dsh-master-access-request" key={request.requestId}>
            <div className="dsh-master-access-detail">
              <div className="dsh-master-access-meta">
                <code>{request.toolName}</code>
                {escalation && <span>{escalation[1] === 'danger-full-access' ? ACCESS_COPY.approvalFull : ACCESS_COPY.approvalWorkspace}</span>}
              </div>
              {reason && <p>{reason}</p>}
            </div>
            <div className="dsh-master-access-actions" role="group" aria-label={request.toolName}>
              <button type="button" disabled={disabled}
                onClick={() => { void controller?.decide(request.requestId, 'rejected') }}>{ACCESS_COPY.reject}</button>
              <button type="button" className="dsh-master-access-allow" disabled={disabled}
                onClick={() => { void controller?.decide(request.requestId, 'allowed-once') }}>{ACCESS_COPY.allow}</button>
            </div>
          </li>
        })}
      </ul>
      {full === undefined || state.access?.supportsResumePending !== true ? null : <button type="button" className="dsh-master-toolbar-select" disabled={disabled}
        onClick={() => { void controller?.choose(full.value) }}>{ACCESS_COPY.enable}</button>}
    </>}
  </section>
}
