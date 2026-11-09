/** Remote permissions use the same menu and explicit acknowledgement as local sessions. */
import { Menu, RiskConfirmation } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { ACCESS_COPY } from './copy.js'
import { isFullAccess, type AccessState, type SessionAccessController } from './session-access.js'
import type { PermissionOption } from '../session-access-protocol.js'

export function permissionName(option: PermissionOption): string {
  if (isFullAccess(option)) return ACCESS_COPY.full
  if (option.value === 'workspace-write' && option.name === option.value) return ACCESS_COPY.workspace
  if (option.value === 'read-only' && option.name === option.value) return ACCESS_COPY.readOnly
  return option.name
}

export interface AccessControlProps {
  readonly state: AccessState
  readonly controller: SessionAccessController | undefined
  readonly enabled: boolean
}

export function RemotePermissionSelect({ state, controller, enabled, title, nodeId, sessionId }: AccessControlProps & {
  readonly title: string; readonly nodeId: string; readonly sessionId: string
}): ReactElement {
  const [open, setOpen] = useState(false)
  const current = state.access?.options.find(option => option.value === state.access?.currentValue)
  const label = state.unsupported ? ACCESS_COPY.unsupported : state.access === undefined ? ACCESS_COPY.loading
    : current === undefined ? state.access.currentValue : permissionName(current)
  const locked = !enabled || state.busy || state.unsupported || state.access === undefined
  const anchor = <button type="button" data-control="permission" className="dsh-master-toolbar-select"
    aria-label={`${ACCESS_COPY.label}：${label}`} title={label} disabled={locked}
    onClick={() => { setOpen(!open) }}>{label}<span aria-hidden="true">⌄</span></button>
  if (state.access === undefined || state.unsupported) return anchor
  return <Menu open={open && !locked} side="top" selectedId={state.access.currentValue} anchor={anchor}
      items={state.access.options.filter(option => option.value !== 'custom').map(option => ({ id: option.value, label: permissionName(option) }))}
      onClose={() => { setOpen(false) }} onSelect={id => { setOpen(false); void controller?.choose(id) }} />
}

/** Keep confirmation mounted even when a structured question replaces the composer. */
export function RemoteAccessConfirmation({ state, controller, enabled, title, nodeId, sessionId }: AccessControlProps & {
  readonly title: string; readonly nodeId: string; readonly sessionId: string
}): ReactElement | null {
  const [acknowledged, setAcknowledged] = useState(false)
  useEffect(() => { setAcknowledged(false) }, [state.confirmation])
  const confirmation = state.confirmation
  if (confirmation === undefined) return null
  const details = confirmation.requests.map(request => `${request.toolName}${request.reason === undefined ? '' : `：${request.reason}`}`).join('\n')
  return <RiskConfirmation open title={ACCESS_COPY.confirmTitle}
      description={`${nodeId} / ${title} (${sessionId})\n${ACCESS_COPY.description}\n${ACCESS_COPY.confirmRequests(confirmation.requests.length)}\n${details}`}
      acknowledgeLabel={ACCESS_COPY.acknowledge} cancelLabel={ACCESS_COPY.cancel} closeLabel={ACCESS_COPY.cancel}
      confirmLabel={confirmation.requests.length > 0 ? ACCESS_COPY.enable : ACCESS_COPY.confirm}
      acknowledged={acknowledged} disabled={!enabled || state.busy}
      onAcknowledgedChange={setAcknowledged} onCancel={() => { controller?.cancelConfirmation() }}
      onConfirm={() => { if (acknowledged) void controller?.confirm() }} />
}
