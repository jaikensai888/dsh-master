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

/** An authoritative workspace registered on one remote node. */
export interface MasterWorkspace {
  readonly workspaceId: string
  readonly title: string
  readonly path: string
  readonly sessionIds: readonly string[]
}

/** One node's complete workspace registry baseline. */
export interface MasterWorkspaceSnapshot {
  readonly workspaces: readonly MasterWorkspace[]
  readonly archivedSessionIds: readonly string[]
  readonly workspaceError?: MasterError
}

/** Host-confirmed archive state returned alongside a remote session list. */
export interface MasterArchiveValue {
  readonly archivedSessionIds: readonly string[]
}

/**
 * Longest directory path accepted by the workspace-create route, in characters.
 *
 * The node owns canonicalization and existence checks; this bound only keeps an
 * obviously malformed payload out of the coordinator round trip. Windows allows
 * paths up to 32k characters with the long-path prefix, so this picks the
 * conservative POSIX `PATH_MAX`-scale bound rather than a UI-sized one.
 */
export const MAX_WORKSPACE_PATH_LENGTH = 4096

/**
 * `POST /dsh-master/api/workspace/create`.
 *
 * Registers an **existing** directory on the target node. The browser never
 * invents a workspace identity: the node resolves the path against its own
 * filesystem and answers with the registry row it now knows. Registering a path
 * that is already a workspace is idempotent — the node returns the existing row
 * with `created: false`, which is what lets the sidebar "locate" it instead of
 * creating a duplicate.
 */
export interface MasterCreateWorkspaceRequest {
  readonly nodeId: string
  readonly path: string
}

/** The workspace the node registered or resolved, plus whether this call created it. */
export interface MasterCreateWorkspaceValue {
  readonly workspace: MasterWorkspace
  readonly created: boolean
}

/** `POST /dsh-master/api/session/unarchive`. */
export interface MasterUnarchiveSessionRequest {
  readonly nodeId: string
  readonly sessionId: string
}

/**
 * Upper bound this host accepts for a session title.
 *
 * DSH normalizes and truncates a title to its own UTF-8 byte budget, so this is
 * only a guard rail on what a browser may submit; the node's accepted title is
 * what the panel then displays.
 */
export const MAX_SESSION_TITLE_LENGTH = 200

/**
 * `POST /dsh-master/api/session/rename`.
 *
 * Renaming appends a user-sourced `session/title` event on the remote host and
 * supersedes automatic title generation there. Nothing else about the session —
 * its workspace, transcript, or `cwd` — is touched.
 */
export interface MasterRenameSessionRequest {
  readonly nodeId: string
  readonly sessionId: string
  readonly title: string
}

/** The title the node accepted after its own normalization. */
export interface MasterRenameSessionValue {
  readonly sessionId: string
  readonly title: string
}

/** One adapter-provided reasoning effort of a remote model route. */
export interface MasterModelEffort {
  readonly id: string
  readonly name: string
}

/**
 * One model the target node currently advertises.
 *
 * The catalog is the node's own LLM registry, so it describes what that machine
 * can run — not what this browser is configured with.
 */
export interface MasterModel {
  readonly id: string
  readonly name: string
  /** Present when the route supports explicit reasoning efforts. */
  readonly efforts?: readonly MasterModelEffort[]
  readonly defaultEffort?: string
}

/** One provider group of the node's model catalog. */
export interface MasterModelGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly MasterModel[]
}

/** Provider, model, and optional reasoning effort selecting what a remote step runs. */
export interface MasterModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** `GET /dsh-master/api/session/models?nodeId=…`. */
export interface MasterModelCatalog {
  readonly groups: readonly MasterModelGroup[]
  /** Provider groups whose catalog read failed on the node; they offer nothing to pick. */
  readonly failures: readonly { readonly id: string; readonly message: string }[]
  /** Deployment default the node uses for sessions that never selected a model. */
  readonly default?: MasterModelSelection
}

/** `POST /dsh-master/api/session/model`. */
export interface MasterSelectModelRequest extends MasterModelSelection {
  readonly nodeId: string
  readonly sessionId: string
}

/** The normalized selection the node installed for the session. */
export interface MasterSelectModelValue {
  readonly selected: MasterModelSelection
}

/** `POST /dsh-master/api/session/cancel`. */
export interface MasterCancelSessionRequest {
  readonly nodeId: string
  readonly sessionId: string
}

/** The node admitted the cancellation request to the live agent. */
export interface MasterCancelSessionValue {
  readonly accepted: true
}

/** Largest message budget one backwards page may ask for. */
export const MAX_SESSION_PAGE_MESSAGES = 100

/** `POST /dsh-master/api/session/page`. */
export interface MasterSessionPageRequest {
  readonly nodeId: string
  readonly sessionId: string
  /** Page records older than this seq; omitted pages from the log end. */
  readonly beforeSeq?: number
  /** Inclusive cut the open window was read at; older nodes require it. */
  readonly throughSeq?: number
  /** Message budget for this page; the host bounds it. */
  readonly maxMessages?: number
}

/** One backwards page of a session log, raw records included. */
export interface MasterSessionPageValue {
  readonly records: readonly unknown[]
  readonly hasMore: boolean
}

/** `POST /dsh-master/api/session/create`. */
export interface MasterCreateSessionRequest {
  readonly nodeId: string
  /** A directory registered on the target node; the node validates it. */
  readonly workspaceId: string
  /** An existing blank session to reuse; absent means the node mints a new one. */
  readonly sessionId?: string
}

/** The identity the target node created or reused. */
export interface MasterCreateSessionValue {
  readonly sessionId: string
  readonly agentPreset?: string
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
  readonly workspaces: readonly MasterWorkspace[]
  readonly archivedSessionIds: readonly string[]
  /** The registry could not be read; sessions remain accessible under Ungrouped. */
  readonly workspaceError?: MasterError
  /** Present when the node can list sessions but does not expose workspace archive state. */
  readonly archiveError?: MasterError
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
  /**
   * Attachments already confirmed by the target node. The host resolves them
   * again before sending; the browser cannot supply a remote path.
   */
  readonly attachmentIds?: readonly string[]
}

/** One option exposed by the remote `ask_user_question` tool. */
export interface MasterQuestionOption {
  readonly label: string
  readonly description?: string
}

/** One structured question waiting for an answer from this session. */
export interface MasterQuestion {
  readonly id: string
  readonly question: string
  readonly detail?: string
  readonly header?: string
  readonly options?: readonly MasterQuestionOption[]
  readonly multiSelect?: boolean
  readonly intent?: { readonly kind: 'plan-review'; readonly approve: string }
}

/** One answer preserving the question ID and selected option labels. */
export interface MasterQuestionAnswerItem {
  readonly id: string
  readonly selected: readonly string[]
  readonly custom?: string
}

/** The structured value returned to the original waiting tool call. */
export interface MasterQuestionAnswer {
  readonly answers: readonly MasterQuestionAnswerItem[]
}

/** One pending question group owned by a remote session. */
export interface MasterPendingQuestionRequest {
  readonly requestId: string
  readonly sessionId: string
  readonly questions: readonly MasterQuestion[]
}

/** `GET /dsh-master/api/session/questions`. */
export interface MasterPendingQuestionsValue {
  readonly requests: readonly MasterPendingQuestionRequest[]
}

/** Success returned after a question answer or cancellation is accepted. */
export interface MasterQuestionAccepted {
  readonly accepted: true
}

/** `POST /dsh-master/api/session/prompt` success value. */
export interface MasterPromptValue {
  readonly accepted: true
}
