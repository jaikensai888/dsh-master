/**
 * The wire contract between `dsh-master`'s two halves.
 *
 * The host half owns the coordinator connection; the client half owns the panel.
 * They only meet here, over `/dsh-master/api/*`, so these types are the one place
 * a change to either side has to be reflected.
 *
 * Two deliberate properties:
 *
 * 1. **Loose where the remote owns the shape.** Session summaries and follow frames
 *    are produced by a `dsh-node` whose DSH version is not ours. Fields we depend
 *    on are typed; the rest stays `unknown` and is passed through untouched rather
 *    than re-modelled and silently dropped.
 * 2. **No credentials, ever.** Nothing in this module can carry the operator token,
 *    so a response shape cannot leak one by accident.
 *
 * @module dsh-master/protocol
 */

/** Every route this plugin serves lives under this prefix. */
export const ROUTE_PREFIX = '/dsh-master'

/** The `main` slot key used to open the remote workspace panel. */
export const PANEL_ID = 'dsh-master'

/** JSON envelope shared by every non-streaming route, mirroring the coordinator's. */
export type MasterEnvelope<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: MasterError }

/** One failure, already normalized to a stable code. */
export interface MasterError {
  /** `master/*` codes are ours; anything else came from the coordinator or the node. */
  readonly code: string
  readonly message: string
  readonly details?: Readonly<Record<string, unknown>>
}

/** One node as the coordinator reports it, reduced to what the panel renders. */
export interface MasterNode {
  readonly nodeId: string
  /** Display metadata only — never an identity, by the coordinator's own contract. */
  readonly nodeName?: string
  readonly role?: string
  /** `ready` means the capability summary is registered and calls may be routed. */
  readonly state: string
  readonly capabilityCount?: number
  readonly inFlightRequests?: number
  readonly activeStreams?: number
  readonly revoked?: boolean
}

/** What this plugin knows about its own upstream. */
export interface MasterCoordinatorFacts {
  /** Origin only — the operator token is never part of any response. */
  readonly url: string
  readonly reachable: boolean
  /** Present when the last probe failed; a human-readable line, no credential. */
  readonly error?: string
}

/** `GET /dsh-master/api/status`. */
export interface MasterStatus {
  readonly coordinator: MasterCoordinatorFacts
  readonly nodeCount: number
  /**
   * Whether `POST /api/session/prompt` is accepted. Sending a prompt runs a real
   * agent turn on someone else's machine, so it is off until the deployment opts in.
   */
  readonly promptEnabled: boolean
}

/** One session row in the remote workspace tree. */
export interface MasterSession {
  readonly sessionId: string
  /** Projected title when the node reports one; otherwise a short id. */
  readonly title: string
  readonly updatedAt: number
  readonly running: boolean
  /**
   * A session created but never prompted. The official sidebar filters these out;
   * the flag crosses the wire so the panel can make the same choice.
   */
  readonly blank: boolean
  readonly cwd?: string
}

/** `GET /dsh-master/api/nodes`. */
export interface MasterNodesValue {
  readonly coordinator: MasterCoordinatorFacts
  readonly nodes: readonly MasterNode[]
}

/** `GET /dsh-master/api/sessions?nodeId=…`. */
export interface MasterSessionsValue {
  readonly nodeId: string
  readonly sessions: readonly MasterSession[]
}

/**
 * `GET /dsh-master/api/session/follow?nodeId=…&sessionId=…`, one JSON object per line.
 *
 * `data.value` is a `SessionFollowFrame` straight from the node: an opening
 * `snapshot`, then `event` / `assistant-stream` frames. The panel reads the fields
 * it understands and shows the rest as-is, which is what keeps this half working
 * across a node whose DSH version differs from ours.
 */
export type MasterStreamRecord =
  | { readonly type: 'open'; readonly nodeId: string; readonly sessionId: string }
  | { readonly type: 'data'; readonly value: unknown }
  | { readonly type: 'end'; readonly count: number }
  | { readonly type: 'error'; readonly error: MasterError; readonly count: number }

/** `POST /dsh-master/api/session/prompt`. */
export interface MasterPromptRequest {
  readonly nodeId: string
  readonly sessionId: string
  readonly text: string
  /** `queue` appends to the inbox; `steer` interrupts the running turn. */
  readonly mode?: 'queue' | 'steer'
}

/** `POST /dsh-master/api/session/prompt` success value. */
export interface MasterPromptValue {
  readonly accepted: true
}
