/**
 * The `ctx.dshMaster` service: this plugin's own surface, for its routes and for any
 * other plugin that wants the remote roster.
 *
 * It is a thin fold over {@link CoordinatorClient}. The value of keeping it separate
 * is that the HTTP layer owns *transport* concerns (status codes, NDJSON framing,
 * the trust fence) while this owns *meaning* — and a future tool or command can call
 * the same methods without going through HTTP at all.
 *
 * @module dsh-master/service
 */

import { MasterUpstreamError, type CoordinatorClient } from './coordinator/client.js'
import type {
  MasterArchiveValue,
  MasterNodesValue,
  MasterPendingQuestionsValue,
  MasterQuestionAccepted,
  MasterQuestionAnswer,
  MasterSessionsValue,
  MasterStatus,
} from './protocol.js'

/** The Cordis service key other plugins resolve. */
export const MASTER_SERVICE_KEY = 'dshMaster'

/**
 * Remote roster and session access over one coordinator connection.
 */
export class MasterService {
  readonly #client: CoordinatorClient
  readonly #allowPrompt: boolean

  /**
   * @param client - the coordinator connection.
   * @param allowPrompt - whether prompts may be sent at all. Off unless the
   * deployment opted in: a prompt runs a real agent turn on a remote machine.
   */
  constructor(client: CoordinatorClient, allowPrompt: boolean) {
    this.#client = client
    this.#allowPrompt = allowPrompt
  }

  /** Whether `prompt()` may be called. Read by the route layer, not by the caller. */
  get promptEnabled(): boolean {
    return this.#allowPrompt
  }

  /**
   * Report the coordinator's reachability and the roster size.
   *
   * Never rejects: this is the one call the panel makes first, and it has to be able
   * to say "the coordinator is not running" rather than fail.
   *
   * @returns the status payload.
   */
  async status(): Promise<MasterStatus> {
    const coordinator = await this.#client.probe()
    if (!coordinator.reachable) {
      return { coordinator, nodeCount: 0, promptEnabled: this.#allowPrompt }
    }
    try {
      const nodes = await this.#client.listNodes()
      return { coordinator, nodeCount: nodes.length, promptEnabled: this.#allowPrompt }
    } catch {
      // Reachable but refusing: an unauthenticated coordinator answers `/api/health`
      // before it checks the token on the calls that matter, so the roster read is
      // where a missing operator token actually shows up.
      return { coordinator, nodeCount: 0, promptEnabled: this.#allowPrompt }
    }
  }

  /**
   * List every registered node.
   * @param signal - caller cancellation.
   * @returns the roster plus the origin it came from.
   */
  async nodes(signal?: AbortSignal): Promise<MasterNodesValue> {
    const [coordinator, nodes] = await Promise.all([
      this.#client.probe(),
      this.#client.listNodes(signal),
    ])
    return { coordinator, nodes }
  }

  /**
   * List one node's sessions.
   * @param nodeId - target node.
   * @param signal - caller cancellation.
   * @returns the session rows.
   */
  async sessions(nodeId: string, signal?: AbortSignal): Promise<MasterSessionsValue> {
    const sessions = await this.#client.listSessions(nodeId, signal)
    try {
      const archivedSessionIds = await this.#client.workspaceArchiveIds(nodeId, signal)
      return { nodeId, sessions, archivedSessionIds }
    } catch (error) {
      if (signal?.aborted === true) throw error
      return {
        nodeId,
        sessions,
        archivedSessionIds: [],
        archiveError: error instanceof MasterUpstreamError
          ? error.toWire()
          : { code: 'master/internal', message: error instanceof Error ? error.message : 'unknown failure' },
      }
    }
  }

  /** Archive one session on its owning remote node. */
  async archiveSession(nodeId: string, sessionId: string, signal?: AbortSignal): Promise<MasterArchiveValue> {
    return { archivedSessionIds: await this.#client.archiveSession(nodeId, sessionId, signal) }
  }

  /** Read pending structured questions for one remote session. */
  pendingQuestions(nodeId: string, sessionId: string, signal?: AbortSignal): Promise<MasterPendingQuestionsValue> {
    return this.#client.pendingQuestions(nodeId, sessionId, signal)
  }

  /** Resolve one pending question using its structured answer. */
  answerQuestion(
    nodeId: string,
    sessionId: string,
    requestId: string,
    answer: MasterQuestionAnswer,
    signal?: AbortSignal,
  ): Promise<MasterQuestionAccepted> {
    return this.#client.answerQuestion(nodeId, sessionId, requestId, answer, signal)
  }

  /** Cancel one pending question without invoking session/prompt. */
  cancelQuestion(
    nodeId: string,
    sessionId: string,
    requestId: string,
    signal?: AbortSignal,
  ): Promise<MasterQuestionAccepted> {
    return this.#client.cancelQuestion(nodeId, sessionId, requestId, signal)
  }

  /**
   * Follow one session's frames.
   * @param nodeId - target node.
   * @param sessionId - target session.
   * @param signal - cancellation; aborting releases the stream on the node.
   * @yields the node's raw `SessionFollowFrame` values.
   */
  follow(nodeId: string, sessionId: string, signal?: AbortSignal): AsyncGenerator<unknown> {
    return this.#client.follow(nodeId, sessionId, signal)
  }

  /**
   * Send a prompt to one remote session.
   *
   * The gate lives in the route, so this method trusts its caller. It stays here
   * rather than in the route because a future command or tool is also a legitimate
   * caller — and it must be just as impossible for one of them to bypass the flag.
   *
   * @param nodeId - target node.
   * @param sessionId - target session.
   * @param text - prompt text.
   * @param mode - `queue` (default) or `steer`.
   * @param signal - caller cancellation.
   */
  async prompt(
    nodeId: string,
    sessionId: string,
    text: string,
    mode: 'queue' | 'steer' = 'queue',
    signal?: AbortSignal,
  ): Promise<void> {
    if (!this.#allowPrompt) {
      throw new Error('dsh-master: prompts are disabled by configuration')
    }
    await this.#client.prompt(nodeId, sessionId, text, mode, signal)
  }
}
