/** Live approval actions operate on the original host request ids. */
import type { ReactElement } from 'react'
import type { AccessControlProps } from './RemotePermissionSelect.js'
import { ACCESS_COPY } from './copy.js'
import { isFullAccess } from './session-access.js'

export function RemoteApprovalPanel({ state, controller, enabled }: AccessControlProps): ReactElement | null {
  const pending = state.access?.pendingApprovals ?? []
  const full = state.access?.options.find(isFullAccess)
  const disabled = !enabled || state.busy || state.unsupported
  if (pending.length === 0 && state.error === undefined) return null
  return <section className="dsh-master-access-panel" aria-label={ACCESS_COPY.waiting}>
    {state.error === undefined ? null : <div className="dsh-master-error" role="alert">{state.error}
      <button type="button" className="dsh-master-toolbar-select" disabled={state.busy} onClick={() => { void controller?.refresh() }}>{ACCESS_COPY.retry}</button>
    </div>}
    {pending.length === 0 ? null : <>
      <strong>{ACCESS_COPY.waiting}</strong>
      {pending.map(request => <div className="dsh-master-access-request" key={request.requestId}>
        <span>{request.toolName}{request.reason === undefined ? '' : `：${request.reason}`}</span>
        <button type="button" className="dsh-master-toolbar-select" disabled={disabled}
          onClick={() => { void controller?.decide(request.requestId, 'allowed-once') }}>{ACCESS_COPY.allow}</button>
        <button type="button" className="dsh-master-toolbar-select" disabled={disabled}
          onClick={() => { void controller?.decide(request.requestId, 'rejected') }}>{ACCESS_COPY.reject}</button>
      </div>)}
      {full === undefined || state.access?.supportsResumePending !== true ? null : <button type="button" className="dsh-master-toolbar-select" disabled={disabled}
        onClick={() => { void controller?.choose(full.value) }}>{ACCESS_COPY.enable}</button>}
    </>}
  </section>
}
