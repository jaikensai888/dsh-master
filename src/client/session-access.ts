/** Session-scoped permission mutations, with no automatic replay of approval grants. */
import { decideSessionApproval, fetchSessionAccess, setSessionAccess, fetchForwardedApprovals, decideForwardedApproval } from './api.js'
import type { ApprovalDecision, PendingApproval, PermissionOption, SessionAccess } from '../session-access-protocol.js'
import { ACCESS_COPY } from './copy.js'

export interface AccessState {
  readonly access?: SessionAccess
  readonly forwardedApprovals?: readonly PendingApproval[]
  readonly error?: string
  readonly unsupported: boolean
  readonly busy: boolean
  readonly confirmation?: { readonly preset: string; readonly revision: string; readonly requests: readonly PendingApproval[] }
}
interface Transport {
  read: typeof fetchSessionAccess
  set: typeof setSessionAccess
  decide: typeof decideSessionApproval
  pending?: typeof fetchForwardedApprovals
  decideForwarded?: typeof decideForwardedApproval
}

const isUnsupported = (cause: unknown): boolean => {
  const code = cause !== null && typeof cause === 'object' && 'code' in cause ? String(cause.code) : ''
  return /\/(?:unsupported|capability-unavailable|capability-mismatch|invocation-unavailable|method-unavailable|service-unavailable|definition-unavailable|endpoint-not-found)$/.test(code)
}
/** Identify full access by its real bundle, including custom-named presets. */
export function isFullAccess(option: PermissionOption): boolean {
  return option.sandbox === 'danger-full-access' && option.approval === 'never'
}

/** One controller belongs to one node/session pair for its entire lifetime. */
export class SessionAccessController {
  #state: AccessState = { unsupported: false, busy: false }
  readonly #listeners = new Set<() => void>()
  readonly #abort = new AbortController()
  #generation = 0
  #mutationError = false
  constructor(readonly nodeId: string, readonly sessionId: string, private enabled: boolean,
    private readonly api: Transport = { read: fetchSessionAccess, set: setSessionAccess, decide: decideSessionApproval,
      pending: fetchForwardedApprovals, decideForwarded: decideForwardedApproval }) {}

  getSnapshot = (): AccessState => this.#state
  subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener) } }
  #publish(state: AccessState): void {
    if (this.#abort.signal.aborted) return
    this.#state = state
    for (const listener of this.#listeners) listener()
  }
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled && this.#state.confirmation !== undefined) this.cancelConfirmation()
  }
  cancelConfirmation(): void {
    const { confirmation: _confirmation, ...state } = this.#state
    this.#publish(state)
  }
  async refresh(): Promise<void> {
    if (this.#state.busy || this.#abort.signal.aborted) return
    const generation = ++this.#generation
    if (this.#state.forwardedApprovals !== undefined) {
      await this.#readForwarded(generation)
      return
    }
    try {
      const access = await this.api.read(this.nodeId, this.sessionId, this.#abort.signal)
      if (generation === this.#generation) {
        const { error: _error, ...state } = this.#state
        const keepWarning = this.#mutationError && access.pendingApprovals.length > 0
        this.#publish({ ...(keepWarning ? this.#state : state), access, unsupported: false })
        if (!keepWarning) this.#mutationError = false
      }
    } catch (error) {
      if (generation !== this.#generation || this.#abort.signal.aborted) return
      const unsupported = isUnsupported(error)
      if (unsupported && this.api.pending !== undefined && this.api.decideForwarded !== undefined) {
        await this.#readForwarded(generation)
        return
      }
      this.#mutationError = false
      this.#publish({ ...this.#state, unsupported, error: unsupported ? ACCESS_COPY.unsupported : String(error instanceof Error ? error.message : error) })
    }
  }
  async #readForwarded(generation: number, preserveError = false): Promise<void> {
    if (this.api.pending === undefined || this.#abort.signal.aborted) return
    try {
      const result = await this.api.pending(this.nodeId, this.sessionId, this.#abort.signal)
      if (generation !== this.#generation) return
      const message = preserveError ? this.#state.error : undefined
      this.#publish({ unsupported: true, busy: this.#state.busy, forwardedApprovals: result.requests,
        ...(message === undefined ? {} : { error: message }) })
    } catch (cause) {
      if (generation !== this.#generation || this.#abort.signal.aborted) return
      const unavailable = isUnsupported(cause)
      this.#publish({ unsupported: true, busy: this.#state.busy,
        ...(!unavailable ? { error: `${ACCESS_COPY.forwardingFailed}${cause instanceof Error ? cause.message : String(cause)}` } : {}) })
    }
  }
  async choose(preset: string): Promise<void> {
    const state = this.#state, access = state.access
    if (!this.enabled || this.#abort.signal.aborted || state.busy || state.unsupported || access === undefined) return
    const option = access.options.find(item => item.value === preset && item.value !== 'custom')
    if (option === undefined) return
    if (isFullAccess(option)) {
      this.#publish({ access, busy: false, unsupported: false, confirmation: { preset, revision: access.revision, requests: access.supportsResumePending ? [...access.pendingApprovals] : [] } })
    } else if (preset !== access.currentValue) {
      await this.#switch(preset, access.revision, [])
    }
  }
  async confirm(): Promise<void> {
    const confirmation = this.#state.confirmation
    if (!this.enabled || this.#abort.signal.aborted || this.#state.busy || confirmation === undefined) return
    await this.#switch(confirmation.preset, confirmation.revision, confirmation.requests)
  }
  async #switch(preset: string, revision: string, requests: readonly PendingApproval[]): Promise<void> {
    ++this.#generation
    const { confirmation: _confirmation, error: _error, ...before } = this.#state
    this.#mutationError = false
    this.#publish({ ...before, busy: true })
    let switched = false
    try {
      const value = await this.api.set(this.nodeId, this.sessionId, preset, revision, crypto.randomUUID(), this.#abort.signal)
      switched = true
      this.#publish({ ...this.#state, access: value })
      const authoritative = await this.api.read(this.nodeId, this.sessionId, this.#abort.signal)
      this.#publish({ ...this.#state, access: authoritative })
      if (authoritative.currentValue !== preset) throw new Error(ACCESS_COPY.changed)
      const option = authoritative.options.find(item => item.value === preset)
      if (requests.length > 0 && (option === undefined || !isFullAccess(option))) throw new Error(ACCESS_COPY.changed)
      const failures: string[] = []
      for (const request of requests) {
        if (this.#abort.signal.aborted) return
        if (!authoritative.pendingApprovals.some(item => item.requestId === request.requestId)) continue
        try {
          const result = await this.api.decide(this.nodeId, this.sessionId, request.requestId, 'allowed-once', crypto.randomUUID(), this.#abort.signal)
          if (result.outcome !== 'allowed-once') failures.push(request.toolName)
        } catch { failures.push(request.toolName) }
      }
      if (failures.length > 0) throw new Error(ACCESS_COPY.remaining(failures.length))
    } catch (error) {
      this.#mutationError = true
      this.#publish({ ...this.#state, error: `${switched ? ACCESS_COPY.partial : ''}${error instanceof Error ? error.message : String(error)}` })
    } finally {
      await this.#readAfterMutation()
    }
  }
  async decide(requestId: string, outcome: ApprovalDecision): Promise<void> {
    if (!this.enabled || this.#state.busy || this.#abort.signal.aborted) return
    const forwarded = this.#state.forwardedApprovals
    const decideForwarded = this.api.decideForwarded
    if (forwarded !== undefined && (decideForwarded === undefined || !forwarded.some(request => request.requestId === requestId))) return
    const generation = ++this.#generation
    const { error: _error, ...state } = this.#state
    this.#mutationError = false
    this.#publish({ ...state, busy: true })
    try {
      if (forwarded !== undefined && decideForwarded !== undefined) {
        await decideForwarded(this.nodeId, this.sessionId, requestId, outcome, this.#abort.signal)
      } else {
        await this.api.decide(this.nodeId, this.sessionId, requestId, outcome, crypto.randomUUID(), this.#abort.signal)
      }
    } catch (error) {
      this.#mutationError = true
      this.#publish({ ...this.#state, error: error instanceof Error ? error.message : String(error) })
    } finally {
      if (forwarded === undefined) await this.#readAfterMutation()
      else {
        await this.#readForwarded(generation, true)
        this.#publish({ ...this.#state, busy: false })
      }
    }
  }
  async #readAfterMutation(): Promise<void> {
    try {
      const access = await this.api.read(this.nodeId, this.sessionId, this.#abort.signal)
      this.#publish({ ...this.#state, access })
    } catch (error) {
      this.#publish({ ...this.#state, error: this.#state.error ?? String(error instanceof Error ? error.message : error) })
    } finally { this.#publish({ ...this.#state, busy: false }) }
  }
  dispose(): void { ++this.#generation; this.#abort.abort(); this.#listeners.clear() }
}
