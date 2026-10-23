/*
 * FORKED from @deepseek-ai/dsh-client-ui-workspace (MIT, Copyright (c) 2026 DeepSeek).
 * Upstream: packages/client/ui-workspace/client/navigation.ts @ 0.1.2-rc.1
 * Regenerate the mechanical part with: node tools/import-fork.mjs
 * Local edits are expected and preserved — the --check mode compares only the
 * rewritten import header, never the body.
 */
/** Workspace archive and directory UI capability. */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { ClientRemote, DirectoryListing, RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  ISessions,
  SessionListState,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  IWorkspaces, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { openLocalSession, type PanelNavigation } from '../client/selection.js'
import { adaptSessionList } from './adapt.js'

interface ConnectOptions { agentPreset?: string }
interface StartOptions extends ConnectOptions { prompt?: string; clearPreviousDraft?: boolean }
interface ArchiveOptions { stopActivity?: boolean }

/** Run an injected session action from either the shipped void API or this fork's Promise API. */
export function runSessionAction(action: () => void | Promise<void>, onError: (reason: unknown) => void): void {
  try {
    const result = action()
    if (result !== undefined) void result.catch(onError)
  } catch (reason) {
    onError(reason)
  }
}

/** Workspace archive and directory operations consumed by Client UI domains. */
export interface UiWorkspace {
  /**
   * Resolve the reusable or newly created blank Session for a Workspace.
   * @param workspaceId - target Workspace.
   * @returns a Session already addressable through the Session Controller.
   */
  connectWorkspace(workspaceId: WorkspaceId, options?: ConnectOptions): Promise<SessionId>
  /**
   * Start a New Session flow and navigate to its Session.
   * @param workspaceId - explicit target; absent inherits the current or most recent Workspace.
   */
  startSession(workspaceId?: WorkspaceId, options?: StartOptions): Promise<void>
  openSession(sessionId: SessionId): void
  openWorkspace(workspaceId: WorkspaceId, beforeOpen?: (id: string) => void, options?: ConnectOptions): Promise<void>
  forkSession(sessionId: SessionId, onCreated?: (id: string) => void, options?: { allowMigration?: boolean }): Promise<SessionId>
  /**
   * Archive a Session and clear it when it is the current selection.
   * @param sessionId - Session to archive.
   */
  archiveSession(sessionId: SessionId, options?: ArchiveOptions): Promise<void>
  unarchiveSession(sessionId: SessionId): Promise<void>
  pinSession(sessionId: SessionId): Promise<void>
  unpinSession(sessionId: SessionId): Promise<void>
  /**
   * Open the Host-native directory picker.
   * @returns the selected directory, or null when cancelled.
   */
  pickDirectory(): Promise<string | null>
  /**
   * List one Host directory level.
   * @param path - directory path; absent selects the Host home.
   * @param signal - cancellation for a superseded scan.
   * @returns directory entries and breadcrumb ancestry.
   */
  listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
  /**
   * Create a child directory.
   * @param path - existing parent directory.
   * @param name - child directory name.
   * @returns created absolute path.
   */
  createDirectory(path: string, name: string): Promise<string>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Cross-Controller Workspace navigation and directory UI capability. */
    uiWorkspace: UiWorkspace
  }
}

/** Structured directory failure exposed to directory UI consumers. */
export class DirectoryBrowseError extends Error {
  override readonly name = 'DirectoryBrowseError'

  /** @param rpcError - Host directory business failure. */
  constructor(readonly rpcError: RemoteFailure) {
    super(`directory browse failed: ${rpcError.code}: ${rpcError.message}`)
  }
}

/** Implements Workspace archive and directory UI operations. */
class UiWorkspaceService extends Service implements UiWorkspace {
  private readonly connecting = new Map<string, Promise<SessionId>>()
  private mainReference: { sessionId: string; release(): void } | undefined
  private disposed = false

  /**
   * @param ctx - Client root Context.
   * @param directoryPicker - the directory-picking Remote namespace.
   * @param workspaces - pure Workspace Controller.
   * @param sessions - pure Session Controller.
   * @param layout - the main-panel navigation API.
   */
  constructor(
    ctx: Context,
    private readonly directoryPicker: ClientRemote['directoryPicker'],
    private readonly workspaces: IWorkspaces,
    private readonly sessions: ISessions,
    private readonly layout: PanelNavigation,
  ) {
    super(ctx, 'uiWorkspace')
    ctx.effect(() => {
      let stop: () => void
      if (this.sessions.retain === undefined) {
        stop = this.watchNavigation()
      } else {
        // Restoring mainView before the controller is active permanently retires the host composer.
        const ready = ctx.inject(['conversation'], () => this.watchNavigation())
        stop = () => { void ready.dispose() }
      }
      return () => {
        this.disposed = true
        stop()
        this.mainReference?.release()
        this.mainReference = undefined
      }
    }, 'ui-workspace: Workspace navigation policy')
  }

  async connectWorkspace(workspaceId: WorkspaceId, options: ConnectOptions = {}): Promise<SessionId> {
    return this.connectBlank(workspaceId, options)
  }

  private async connectBlank(workspaceId: WorkspaceId, options: ConnectOptions | undefined): Promise<SessionId> {
    const workspace = this.workspaces.list.getSnapshot().items
      .find(item => item.workspaceId === workspaceId)
    if (workspace === undefined) {
      throw new Error(`uiWorkspace.connectWorkspace: unknown workspace ${workspaceId}`)
    }
    if (options === undefined) return this.sessions.create({ workspaceId })
    const key = JSON.stringify([workspaceId, options.agentPreset])
    const inflight = this.connecting.get(key)
    if (inflight !== undefined) return inflight

    const archived = this.workspaces.list.getSnapshot().archivedSessionIds
    const sessions = adaptSessionList(this.sessions.list.getSnapshot())
    let blank: string | undefined
    for (const id of sessions.ids) {
      const summary = sessions.byId[id]
      if (summary !== undefined && summary.blank && summary.cwd === workspace.path
        && workspace.sessionIds.includes(summary.id)
        && !archived.includes(summary.id)) {
        if (this.sessions.retain === undefined) return summary.id
        blank = summary.id
        break
      }
    }

    const attempt = this.sessions.create({ workspaceId, ...(blank === undefined ? {} : { sessionId: blank }), ...options })
      .finally(() => { this.connecting.delete(key) })
    this.connecting.set(key, attempt)
    return attempt
  }

  async startSession(workspaceId?: WorkspaceId, options?: StartOptions): Promise<void> {
    const workspace = this.workspaces.list.getSnapshot()
    const sessions = adaptSessionList(this.sessions.list.getSnapshot())
    const current = this.mainReference?.sessionId ?? sessions.current
    const currentWorkspaceId = current === undefined
      ? undefined
      : workspace.items.find(item => item.sessionIds.includes(current))?.workspaceId
    const recent = workspace.phase === 'ready' && sessions.phase === 'ready'
      ? recentWorkspace(workspace.items, sessions.byId)
      : undefined
    const target = workspaceId ?? currentWorkspaceId ?? recent
    if (target === undefined) {
      this.clearMain()
      return
    }
    await this.openWorkspaceSession(target, options === undefined ? undefined : (id) => {
      if (options.prompt === undefined && options.clearPreviousDraft !== true) return
      const conversation = this.ctx.get('conversation') as { input?: { requestDraftInitialization(binding: unknown, options: StartOptions): string } } | undefined
      const binding = this.sessions.binding(id)
      if (binding === undefined || conversation?.input === undefined
        || conversation.input.requestDraftInitialization(binding, options) === 'blocked') {
        throw new Error('uiWorkspace: draft initialization failed')
      }
    }, options === undefined ? undefined : options.agentPreset === undefined ? {} : { agentPreset: options.agentPreset })
  }

  openSession(sessionId: SessionId): void {
    this.revealSession(sessionId)
  }

  async openWorkspace(workspaceId: WorkspaceId, beforeOpen?: (id: string) => void, options: ConnectOptions = {}): Promise<void> {
    await this.openWorkspaceSession(workspaceId, beforeOpen, options)
  }

  private async openWorkspaceSession(workspaceId: WorkspaceId, beforeOpen: ((id: string) => void) | undefined, options: ConnectOptions | undefined): Promise<void> {
    const signal = this.layout.beginNavigation?.()
    const sessionId = await this.connectBlank(workspaceId, options)
    if (this.disposed || signal?.aborted) return
    this.revealSession(sessionId, beforeOpen)
  }

  forkSession(sessionId: SessionId, onCreated?: (id: string) => void, options?: { allowMigration?: boolean }): Promise<SessionId> {
    return this.sessions.fork({ sessionId, increaseTitle: true,
      ...(onCreated === undefined ? {} : { onCreated }), ...options })
  }

  async archiveSession(sessionId: SessionId, options?: ArchiveOptions): Promise<void> {
    await this.workspaces.archiveSession(sessionId, options)
    if (this.mainReference?.sessionId === sessionId) this.clearMain()
  }

  async unarchiveSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.unarchiveSession(sessionId)
  }

  async pinSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.pinSession(sessionId)
  }

  async unpinSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.unpinSession(sessionId)
  }

  private revealSession(sessionId: string, beforeOpen?: (id: string) => void): void {
    if (this.disposed) return
    if (this.sessions.retain === undefined) {
      beforeOpen?.(sessionId)
      openLocalSession(this.layout, this.sessions, sessionId)
      return
    }
    openLocalSession(this.layout, { open: (id) => {
      const reference = this.sessions.retain!(id, { source: 'mainView' })
      try { beforeOpen?.(reference.sessionId) } catch (error) { reference.release(); throw error }
      const previous = this.mainReference
      this.mainReference = reference
      this.saveSelection(reference.sessionId)
      previous?.release()
      void reference.ready.catch(reason => { console.warn('local session open failed:', reason) })
    } }, sessionId, null)
  }

  private clearMain(): void {
    const reference = this.mainReference
    this.mainReference = undefined
    this.saveSelection(undefined)
    reference?.release()
    if (this.sessions.retain === undefined) this.sessions.clear()
    else this.layout.selectPanel(null)
  }

  async pickDirectory(): Promise<string | null> {
    const result = await this.directoryPicker.pick()
    if (!result.ok) throw new Error(`directory picker failed: ${result.error.message}`)
    return result.value
  }

  async listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing> {
    const result = await this.directoryPicker.list(path, signal)
    if (!result.ok) throw new DirectoryBrowseError(result.error)
    return result.value
  }

  async createDirectory(path: string, name: string): Promise<string> {
    const result = await this.directoryPicker.createDirectory(path, name)
    if (!result.ok) throw new DirectoryBrowseError(result.error)
    return result.value
  }

  private watchNavigation(): () => void {
    let initial: 'waiting' | 'connecting' | 'done' = 'waiting'
    let disposed = false
    const reconcile = (): void => {
      if (disposed) return
      if (this.clearArchivedCurrent()) return
      if (initial !== 'waiting') return
      const workspace = this.workspaces.list.getSnapshot()
      const sessions = adaptSessionList(this.sessions.list.getSnapshot())
      if (workspace.phase !== 'ready' || sessions.phase !== 'ready') return
      if (sessions.current !== undefined) {
        initial = 'done'
        return
      }
      const saved = this.readSelection()
      if (this.sessions.retain !== undefined && saved !== undefined && sessions.byId[saved] !== undefined
        && !workspace.archivedSessionIds.includes(saved)) {
        initial = 'done'
        this.revealSession(saved)
        return
      }
      const target = recentWorkspace(workspace.items, sessions.byId)
      if (target === undefined) {
        initial = 'done'
        return
      }
      initial = 'connecting'
      const signal = this.layout.beginNavigation?.()
      void this.connectWorkspace(target).then(
        (sessionId) => {
          if (disposed || signal?.aborted) return
          if (this.mainReference === undefined && adaptSessionList(this.sessions.list.getSnapshot()).current === undefined) {
            this.revealSession(sessionId)
          }
          initial = 'done'
        },
        (reason: unknown) => {
          if (disposed) return
          initial = 'waiting'
          console.warn('initial workspace selection failed:', reason)
        },
      )
    }
    const disposeWorkspaces = this.workspaces.list.subscribe(reconcile)
    const disposeSessions = this.sessions.list.subscribe(reconcile)
    reconcile()
    return () => {
      disposed = true
      disposeSessions()
      disposeWorkspaces()
    }
  }

  private readSelection(): string | undefined {
    try {
      if (typeof localStorage === 'undefined') return undefined
      const raw = localStorage.getItem('dsh.sessions.current')
      const saved = raw === null ? undefined : JSON.parse(raw) as { sessionId?: unknown }
      return typeof saved?.sessionId === 'string' ? saved.sessionId : undefined
    } catch { return undefined }
  }

  private saveSelection(sessionId: string | undefined): void {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId }))
    } catch { /* Browsing remains usable when persistence is unavailable. */ }
  }

  /** @returns true when an archived current selection was cleared. */
  private clearArchivedCurrent(): boolean {
    const current = this.mainReference?.sessionId ?? adaptSessionList(this.sessions.list.getSnapshot()).current
    if (current === undefined
      || !this.workspaces.list.getSnapshot().archivedSessionIds.includes(current)) return false
    this.clearMain()
    return true
  }

}

/** Stable tie-breaking follows Host Workspace order. */
function recentWorkspace(
  workspaces: readonly WorkspaceView[],
  sessions: SessionListState['byId'],
): WorkspaceId | undefined {
  let selected: WorkspaceId | undefined
  let selectedTime = Number.NEGATIVE_INFINITY
  for (const workspace of workspaces) {
    let latest = Number.NEGATIVE_INFINITY
    for (const sessionId of workspace.sessionIds) {
      const session = sessions[sessionId]
      if (session !== undefined) latest = Math.max(latest, session.updatedAt)
    }
    if (latest === Number.NEGATIVE_INFINITY) latest = Date.parse(workspace.createdAt)
    if (selected === undefined || latest > selectedTime) {
      selected = workspace.workspaceId
      selectedTime = latest
    }
  }
  return selected
}

export { UiWorkspaceService }
