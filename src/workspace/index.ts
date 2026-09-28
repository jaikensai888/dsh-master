/**
 * Register the forked workspace browser in place of the shipped one.
 *
 * ## Why this is a replacement, not a shadow
 *
 * `sidebar.workspaces` is a `single` slot: a second entry at a lower priority would
 * hide the shipped browser without removing it, and the shipped entry is what declares
 * the `sidebar.workspaces.directoryFlow` child that the directory picker fills. Two
 * facts make shadowing a dead end:
 *
 * - `renderSlot` is bound **per entry** and refuses any key outside that entry's own
 *   `children` (`ui-renderer`, `boundRenderSlot`);
 * - `ctx.slots.renderSlot(key, owner)` — the only non-entry route — throws for every
 *   key except `'root'`.
 *
 * So a shadowing entry can neither declare the hole (the shipped entry declared it
 * first, and declaring twice throws) nor render it. "Add workspace…" would silently
 * disappear. The way to keep it is to **take the shipped plugin out of the tree** and
 * register both surfaces ourselves, which is what this module does — and which is why
 * the deployment disables the `ui-workspace` loader entry (its host half is an empty
 * `apply()`, so nothing else is lost).
 *
 * ## What this provides, mirroring the shipped `apply`
 *
 * 1. the `uiWorkspace` service (forked `navigation.ts`), which the conversation shell
 *    injects to open and fork sessions;
 * 2. the global `useWorkspaces` seat (`provideRoot`), which every workspace-aware
 *    surface reads;
 * 3. the `workspace` locale namespace;
 * 4. the two registrations, each declaring its own directory-flow hole.
 *
 * ## Degrading instead of throwing
 *
 * If `uiWorkspace` is already provided, the shipped plugin is still enabled. Providing
 * it again would throw inside `apply` and take the whole plugin — panel included —
 * down with it, so that case is detected and the directory-flow holes are left
 * undeclared. The browser is then correct but cannot add a workspace, and says so once
 * in the log instead of failing at boot.
 *
 * @module dsh-master/workspace
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { HostObservable, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { createElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { openLocalSession, type PanelNavigation } from '../client/selection.js'
import { en, zh, type WorkspaceKey } from './locales.js'
import { UiWorkspaceService } from './navigation.js'
import { RemoteSection } from './RemoteSection.js'
import type { RemoteSectionProps } from './contract/slots.js'
import { WorkspacePicker } from './WorkspacePicker.js'
import { WorkspaceBrowser } from './rows/WorkspaceBrowser.js'
import { createWorkspaceViewStore } from './stores.js'

/** The dictionary namespace this registration claims. */
const NS = 'workspace'

/**
 * The two directory-flow holes.
 *
 * Declared here because this plugin now owns both parent registrations. A flow package's
 * client half registers its one component into both, which is how the native chooser or
 * the in-app browser reaches these surfaces without either side knowing the other.
 */
const SIDEBAR_FLOW = 'sidebar.workspaces.directoryFlow'
const HERO_FLOW = 'conversation.hero.workspace.directoryFlow'

/** The slice of the slot registry this module uses. */
interface SlotsService {
  provideRoot(contribution: { hooks?: Record<string, HostObservable<unknown>> }): () => void
  inject(key: string, callback: () => () => void): () => void
  register(options: Record<string, unknown>, component: (props: never) => ReactElement): () => void
  entries(key: string): readonly unknown[]
  subscribe(key: string, listener: () => void): () => void
}

/** The slice of the locale service this module uses. */
interface LocaleService {
  register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void
}

/** The client services the browser drives, and the ones it only reads. */
interface WorkspaceContext {
  readonly slots: SlotsService
  readonly locale: LocaleService
  readonly remote: ClientRemote
  readonly sessions: ISessions
  readonly workspaces: IWorkspaces
  get(key: string, strict?: boolean): unknown
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The browsing region, its rows and its dialogs. */
    workspace: WorkspaceKey
  }
}

/** Owner share of a directory-flow hole, as the occupant receives it. */
interface DirectoryFlowOwnerProps {
  readonly open: boolean
  readonly busy: boolean
  readonly onPicked: (path: string) => void
  readonly onCancel: () => void
  readonly onError: (message: string) => void
}

/**
 * Whether a slot key currently has an occupant.
 *
 * The framework binds an `inject` hook compartment entry into a selector hook, so the
 * shape here is an observable rather than a value: occupancy changes while the browser
 * is mounted (a picker plugin loading or unloading), and the "Add workspace…" entry has
 * to follow it.
 *
 * @param slots - the slot registry.
 * @param key - the slot key to observe.
 * @returns an observable of occupancy.
 */
function occupancy(slots: SlotsService, key: string): HostObservable<boolean> {
  return {
    getSnapshot: () => slots.entries(key).length > 0,
    subscribe: listener => slots.subscribe(key, listener),
  }
}

/**
 * Register the forked browser and picker.
 *
 * @param ctx - client root context.
 * @param log - sink for the one diagnostic this module emits.
 * @returns a disposer that unregisters both surfaces.
 */
export function applyWorkspaceBrowser(
  ctx: Context,
  log: (message: string) => void,
  layout: PanelNavigation,
  openRemoteSession: (nodeId: string, sessionId: string, nodeName: string, sessionTitle: string) => void,
): () => void {
  const scoped = ctx as unknown as WorkspaceContext
  const sessions = scoped.sessions
  const workspaces = scoped.workspaces

  // `uiWorkspace` is provided by constructing the service, so "already there" is
  // exactly "the shipped plugin is still enabled". See the module note.
  const existingUiWorkspace = scoped.get('uiWorkspace', false) as {
    startSession(workspaceId?: string): void | Promise<void>
    archiveSession(sessionId: string): Promise<void>
  } | undefined
  const shipped = existingUiWorkspace !== undefined
  const uiWorkspace = existingUiWorkspace
    ?? new UiWorkspaceService(ctx, scoped.remote.directoryPicker, workspaces, sessions, layout)
  if (shipped) {
    log('dsh-master: ui-workspace is still enabled; the remote sidebar keeps its own tree, but "Add workspace…" stays with the shipped picker')
  }

  // The global seat every workspace-aware surface reads, including the conversation
  // hero's picker.
  const disposeRoot = scoped.slots.provideRoot({ hooks: { workspaces: workspaces.list } })
  const disposeLocale = scoped.locale.register(NS, { zh, en })

  const hostInfo: HostObservable<unknown> = {
    getSnapshot: () => scoped.remote.$host,
    subscribe: listener => ctx.on('connection/reset', listener),
  }

  const searchSessions = async (
    query: string,
    signal: AbortSignal,
  ): Promise<{ items: readonly unknown[]; hasMore: boolean }> => {
    const result = await sessions.search(query, signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.value as { items: readonly unknown[]; hasMore: boolean }
  }

  const browserInjected = (): Record<string, unknown> => ({
    hooks: {
      // Undeclared holes report empty, which is exactly the documented "no picking
      // affordance composed" state the flow already handles.
      directoryFlow: shipped ? { getSnapshot: () => false, subscribe: () => () => undefined } : occupancy(scoped.slots, SIDEBAR_FLOW),
      hostInfo,
    },
    startSession: (workspaceId?: string) => uiWorkspace.startSession(workspaceId),
    open: (sessionId: string) => { openLocalSession(layout, sessions, sessionId) },
    openRemoteSession,
    renderRemoteSection: (props: RemoteSectionProps) => createElement(RemoteSection, props),
    searchSessions,
    searchResultLimit: sessions.searchResultLimit,
    renameSession: async (sessionId: string, title: string) => {
      const binding = sessions.binding(sessionId)
      if (binding === undefined) throw new Error(`unknown session "${sessionId}"`)
      const result = await binding.session.rename(title)
      if (!result.ok) throw new Error(result.error?.message ?? 'rename failed')
    },
    forkSession: (sessionId: string) => {
      void sessions.fork({ sessionId, increaseTitle: true })
        .then((childId) => { openLocalSession(layout, sessions, childId) })
        .catch(() => undefined)
    },
    renameWorkspace: (workspaceId: string, title: string) => workspaces.rename(workspaceId, title),
    deleteWorkspace: (workspaceId: string) => workspaces.delete(workspaceId),
    insertWorkspaceBefore: (workspaceId: string, before?: string) => workspaces.insertBefore(workspaceId, before),
    archiveSession: (sessionId: string) => uiWorkspace.archiveSession(sessionId),
    insertSessionBefore: (workspaceId: string, sessionId: string, before?: string) =>
      workspaces.insertSessionBefore(workspaceId, sessionId, before),
    createWorkspace: (input: { path: string }) => workspaces.create(input),
  })

  const pickerInjected = (): Record<string, unknown> => ({
    hooks: {
      directoryFlow: shipped ? { getSnapshot: () => false, subscribe: () => () => undefined } : occupancy(scoped.slots, HERO_FLOW),
    },
    createWorkspace: (input: { path: string }) => workspaces.create(input),
  })

  const disposers = [
    scoped.slots.inject('sidebar.workspaces', () => scoped.slots.register({
      name: 'sidebar.workspaces',
      // In replacement mode the shipped entry is gone and priority is irrelevant. In
      // degraded mode the shipped entry is still registered into this `single` slot at
      // priority 0, and a second entry at the same priority **throws** — so this one
      // steps in front of it instead, which is the documented way to shadow.
      ...(shipped ? { priority: -1 } : {}),
      // Declaring is claiming: this is what keeps "Add workspace…" alive once the
      // shipped entry is gone.
      ...(shipped ? {} : { children: { [SIDEBAR_FLOW]: { kind: 'single', scope: 'root' } } }),
      store: createWorkspaceViewStore(),
      inject: browserInjected,
      locale: NS,
    }, WorkspaceBrowser as unknown as (props: never) => ReactElement)),
    scoped.slots.inject('conversation.hero.workspace', () => scoped.slots.register({
      name: 'conversation.hero.workspace',
      ...(shipped ? { priority: -1 } : {}),
      ...(shipped ? {} : { children: { [HERO_FLOW]: { kind: 'single', scope: 'root' } } }),
      inject: pickerInjected,
      locale: NS,
    }, WorkspacePicker as unknown as (props: never) => ReactElement)),
  ]

  return () => {
    for (const dispose of disposers) dispose()
    disposeLocale()
    disposeRoot()
  }
}

/** Re-exported so the client half can type its own props against the same contract. */
export type { DirectoryFlowOwnerProps, SnapshotSelectorHook, ReactNode }
