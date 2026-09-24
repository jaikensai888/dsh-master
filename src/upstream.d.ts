/*
 * The contracts this plugin assumes with packages that ship no types.
 *
 * `@deepseek-ai/*` publishes **zero `.d.ts`** in 0.1.5-rc.2 — the `files` field lists
 * `lib/types/**\/*.d.ts`, but no declaration file is in the installed tree. TypeScript
 * would therefore reject every import below, and reaching for `any` would erase the one
 * thing that catches a wrong call to a service we do not own.
 *
 * So this file declares, in one place, exactly the surface this plugin uses:
 *
 * - the **slot type system** the forked browser is written against (`SlotMap`,
 *   `PropsRuntime`, `PropsRenderSlots`, `PropsStore`, `PropsHooks`, `PropsLocale`),
 *   transcribed from `deepseek-harness/packages/client/ui-slots/src/index.ts` @ 0.1.2-rc.1;
 * - the **store contracts** (`defineStore`, `StoreHandle`, `PropsStore`),
 *   transcribed from `deepseek-harness/packages/client/store/src/contract.ts` @ 0.1.2-rc.1;
 * - the **client services** the plugin drives (`sessions`, `workspaces`, `remote`);
 * - the **data shapes** the forked tree consumes, which are the *0.1.2* shapes — the
 *   adapter in `src/workspace/adapt.ts` maps the running 0.1.5 snapshots onto them, and
 *   that mapping is why this file describes an older contract than the runtime.
 *
 * Two deliberate loosenings, both documented where they appear: `SessionId` and
 * `WorkspaceId` are plain `string` rather than branded types (more permissive, so a
 * brand mismatch cannot fail a build over a value the runtime treats as a string), and
 * `Translate` accepts any key (the fork's dictionaries are its own).
 *
 * Keep this in step with the running DSH. A field that moves upstream fails to compile
 * here — which is the point — but only for the fields listed; nothing checks the rest.
 */

/** The client session list, as the forked tree reads it (0.1.2 shape). */
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  /** A session identity. Plain `string`: the runtime brands it, and a brand mismatch here would fail a build over nothing. */
  export type SessionId = string

  /** One row's worth of session facts, in the shape the forked tree consumes. */
  export interface SessionSummary {
    readonly id: SessionId
    /** Stored display title; the renderer substitutes the localized New Session label for blank rows. */
    readonly displayTitle: string
    readonly blank: boolean
    readonly running: boolean
    /** Finished running while not selected and not yet opened (the green "done" reminder dot). */
    readonly completed?: boolean
    readonly updatedAt: number
    readonly origin?: 'subagent'
    readonly parentId?: SessionId
    /** The session's working directory; `connectWorkspace` reuses a blank session by matching it. */
    readonly cwd?: string
    /**
     * List projection values the sidebar reads directly.
     *
     * 0.1.2 carried these flat on the summary; 0.1.5 moved them under
     * `projections.values`, which `adapt.ts` folds back here.
     */
    readonly projectionValues?: {
      readonly schedule?: readonly unknown[]
      readonly title?: string | null
    }
  }

  /** The list snapshot: order, rows, and the current selection. */
  export interface SessionListState {
    readonly ids: readonly SessionId[]
    readonly byId: Readonly<Record<SessionId, SessionSummary>>
    readonly current: SessionId | undefined
    readonly phase?: string
  }

  /** One content-search hit. */
  export interface SessionSearchResultItem {
    readonly sessionId: SessionId
    readonly title?: string
    readonly snippet?: string
  }

  /** The client session service, narrowed to the verbs this plugin calls. */
  export interface ISessions {
    readonly list: { getSnapshot(): SessionListState; subscribe(listener: () => void): () => void }
    readonly searchResultLimit: number
    open(id: SessionId): void
    /** Clear the current selection (the New Session view state). */
    clear(): void
    /** Create a session, reusing the workspace's blank one on the host side. */
    create(options?: { workspaceId?: string; cwd?: string }): Promise<SessionId>
    binding(id: SessionId): { readonly session: ISessionBinding } | undefined
    search(query: string, signal: AbortSignal): Promise<
      { ok: true; value: { items: readonly SessionSearchResultItem[]; hasMore: boolean } }
      | { ok: false; error: { message: string } }
    >
    fork(options: { sessionId: SessionId; increaseTitle?: boolean }): Promise<SessionId>
  }

  /** The per-session face the browser renames through. */
  export interface ISessionBinding {
    rename(title: string): Promise<{ ok: boolean; error?: { message: string } }>
  }
}

/** Host facts and the remote surface the picker drives. */
declare module '@deepseek-ai/dsh-api-remotes/client' {
  import type { DirectoryPicker } from '@deepseek-ai/dsh-api-workspace-controller/client'

  /** Fixed host facts. Only these two exist: there is no host list and no host identity. */
  export interface RemoteHostFacts {
    readonly home?: string
    readonly isLoopback?: boolean
  }

  /** One directory entry returned by the picker's host listing. */
  export interface DirectoryListing {
    readonly path: string
    readonly entries?: readonly { readonly name: string; readonly directory: boolean }[]
  }

  /** A failed remote call, as the connection layer reports it. */
  export interface RemoteFailure {
    readonly code: string
    readonly message: string
  }

  /** The client remote surface, narrowed to what the plugin touches. */
  export interface ClientRemote {
    readonly $host: RemoteHostFacts
    readonly directoryPicker: DirectoryPicker
  }
}

/** The workspace registry the browser groups by. */
declare module '@deepseek-ai/dsh-api-workspace-controller/client' {
  import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'

  /** A workspace identity. Plain `string`, for the same reason as `SessionId`. */
  export type WorkspaceId = string

  /** One registered workspace. */
  export interface WorkspaceView {
    readonly workspaceId: WorkspaceId
    readonly title: string
    readonly path: string
    readonly createdAt: string
    readonly sessionIds: readonly string[]
  }

  /** The workspace snapshot: rows, load phase, and the registry-global archive set. */
  export interface WorkspaceSnapshot {
    readonly items: readonly WorkspaceView[]
    readonly phase: 'pending' | 'ready' | string
    readonly archivedSessionIds: readonly string[]
  }

  /** The client workspace service, narrowed to the verbs this plugin calls. */
  export interface IWorkspaces {
    readonly list: { getSnapshot(): WorkspaceSnapshot; subscribe(listener: () => void): () => void }
    create(input: { path: string }): Promise<WorkspaceView>
    rename(workspaceId: WorkspaceId, title: string): Promise<void>
    delete(workspaceId: WorkspaceId): Promise<void>
    /** Hide a session from every grouping surface without deleting its log. */
    archiveSession(sessionId: string): Promise<void>
    insertBefore(workspaceId: WorkspaceId, beforeWorkspaceId?: WorkspaceId): Promise<void>
    insertSessionBefore(workspaceId: WorkspaceId, sessionId: string, beforeSessionId?: string): Promise<void>
  }

  /**
   * One directory-picker call's outcome.
   *
   * The failure arm is `RemoteFailure`, matching what upstream's own
   * `DirectoryBrowseError(rpcError: RemoteFailure)` accepts — the picker runs over the
   * same connection layer, so its failures carry the same shape.
   */
  export type PickerResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: RemoteFailure }

  /** The host-side directory picker the add-workspace flow drives. */
  export interface DirectoryPicker {
    pick(): Promise<PickerResult<string>>
    list(path?: string, signal?: AbortSignal): Promise<PickerResult<DirectoryListing>>
    createDirectory(path: string, name: string): Promise<PickerResult<string>>
  }
}

/** The React-free store engine the browser's view options persist through. */
declare module '@deepseek-ai/dsh-client-store' {
  /** Minimal observable snapshot source. */
  export interface ObservableSnapshot<T> {
    getSnapshot(): T
    subscribe(listener: () => void): () => void
  }

  /** Typed selector hook over a snapshot source. */
  export type SnapshotSelectorHook<T> = <S>(selector: (state: T) => S, equals?: (a: S, b: S) => boolean) => S

  /** Pure draft transforms over the store state: the store's complete write set. */
  export type ActionsDecl<T> = Record<string, (draft: T, ...params: never[]) => void>

  /** Draft-stripped callback form: what components receive. */
  export type BakedActions<T, A extends ActionsDecl<T>> = {
    [K in keyof A]: A[K] extends (draft: T, ...params: infer P) => void ? (...params: P) => void : never
  }

  /** Store declaration: initial-state factory, optional persistence key, actions. */
  export interface StoreSpec<T, A extends ActionsDecl<T>> {
    init: () => T
    persist?: string
    actions: A
  }

  /** A live engine instance. */
  export interface StoreInstance<T, A extends ActionsDecl<T>> {
    readonly actions: BakedActions<T, A>
    getSnapshot(): T
    subscribe(listener: () => void): () => void
    clearPersisted(): void
  }

  /** Spec + types + instance factory in one value. */
  export interface StoreHandle<T, A extends ActionsDecl<T>> {
    readonly spec: StoreSpec<T, A>
    create(scopeKey?: string): StoreInstance<T, A>
  }

  /** The engine-backed handle: the shape a store factory returns. */
  export interface EngineStoreHandle<T, A extends ActionsDecl<T>> extends StoreHandle<T, A> {}

  /** The store props share: a selector hook plus the baked write set. */
  export type PropsStore<H> = H extends StoreHandle<infer T, infer A>
    ? { useStore: SnapshotSelectorHook<T>; actions: BakedActions<T, A> }
    : object

  /** Spec in, handle out. */
  export function defineStore<T, A extends ActionsDecl<T>>(
    spec: StoreSpec<T, A> & { actions: A },
  ): EngineStoreHandle<T, A>
}

/**
 * The slot type system, transcribed from `ui-slots/src/index.ts` @ 0.1.2-rc.1.
 *
 * Simplified in two places the fork does not exercise: `PropsRuntime` omits the
 * session standard kit (the browsing region is root-scoped), and the keyed-hook and
 * chain variants are absent.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  import type { ReactNode, RefObject } from 'react'
  import type { PropsStore, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
  import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
  import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'

  export type { PropsStore, SnapshotSelectorHook }

  /** Slot contract table. Owners extend via declaration merging. */
  export interface SlotMap {}
  /** Locale namespace table. Dictionary owners extend via declaration merging. */
  export interface LocaleNamespaceMap {}
  /** Props every root-scope entry receives, whoever provides them. */
  export interface GlobalStandardProps {}
  /** Owner share of one directory-flow hole. */
  export interface SlotEntryDef {
    readonly kind: 'single' | 'list' | 'keyed' | 'chain'
    readonly scope: 'root' | 'session' | 'session-maybe'
    readonly owner?: unknown
  }

  /** An observable source the renderer binds into a selector hook. */
  export interface HostObservable<T> {
    getSnapshot(): T
    subscribe(listener: () => void): () => void
  }

  /** The owner share declared for a slot key, or `object` when it declares none. */
  export type OwnerOf<K extends keyof SlotMap> =
    SlotMap[K] extends { readonly owner: infer O } ? O : object

  /** Runtime props share for a root-scope slot key. */
  export type PropsRuntime<K extends keyof SlotMap & string> = OwnerOf<K> & GlobalStandardProps

  /** Render one declared child slot. */
  export type RenderSlotFn<S extends string> = (
    key: S,
    owner: unknown,
    options?: unknown,
  ) => ReactNode

  /** The child-render share, narrowed to the keys an entry declared. */
  export type PropsRenderSlots<S extends string> = {
    renderSlot: RenderSlotFn<S>
  }

  /** Selector hooks synthesized from an entry's inject `hooks` compartment. */
  export type PropsHooks<HS extends Record<string, HostObservable<unknown>>> = {
    [N in keyof HS & string as `use${Capitalize<N>}`]:
    SnapshotSelectorHook<HS[N] extends HostObservable<infer T> ? T : never>
  }

  /** The typed translate seat, present on entries that declare `locale:`. */
  export type PropsLocale<N> = N extends keyof LocaleNamespaceMap & string
    ? { t: (key: string, params?: Record<string, unknown>) => string }
    : object

  /** The browsing region's owner share: the shell's two facts. */
  export interface SidebarSectionOwnerProps {
    readonly wide: boolean
    readonly expandSidebar: () => void
  }

  /**
   * The two slot keys this plugin takes over.
   *
   * Upstream declares these in `ui-sidebar` and `ui-conversation`. This plugin disables
   * `ui-workspace` and registers into both, so it also owns the declarations — which is
   * exactly why the directory-flow children below become ours to declare, and why
   * "Add workspace…" keeps working.
   */
  export interface SlotMap {
    'sidebar.workspaces': { kind: 'single'; scope: 'root'; owner: SidebarSectionOwnerProps }
    'conversation.hero.workspace': { kind: 'single'; scope: 'root'; owner: WorkspacePickerOwnerProps }
  }

  /** Owner share of the conversation empty-state workspace picker. */
  export interface WorkspacePickerOwnerProps {
    readonly open: boolean
    /** The anchor button the popover positions against. */
    readonly anchorRef?: RefObject<HTMLElement | null> | undefined
    readonly selectedId?: string | undefined
    readonly onPick: (workspaceId: string) => void
    readonly onClose: () => void
  }

  /** The global seats the browsing region reads. */
  export interface GlobalStandardProps {
    /** Session list, order and current selection. */
    useSessions: SnapshotSelectorHook<SessionListState>
    /** Pending user interaction per session (approval, plan review, question). */
    useSessionPendingInteraction: SnapshotSelectorHook<ReadonlyMap<string, { readonly kind?: string }>>
    /** Workspace registry rows, phase and archive set. */
    useWorkspaces: SnapshotSelectorHook<WorkspaceSnapshot>
  }
}

/** Marks the renderer's Context merge (`ctx.slots`) as loaded. */
declare module '@deepseek-ai/dsh-client-ui-renderer/client' {}

/** Marks the sidebar's SlotMap merge as loaded. */
declare module '@deepseek-ai/dsh-client-ui-sidebar/client' {}

/** Marks the conversation package's SlotMap merge as loaded. */
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {}

/** The session package's pending-interaction vocabulary. */
declare module '@deepseek-ai/dsh-client-ui-session/client' {
  /** One pending interaction as the sidebar row classifies it. */
  export interface SessionPendingInteractionBase {
    readonly kind?: string
  }
}

/** Marks the schedule projection merge as loaded. */
declare module '@deepseek-ai/dsh-schedule/client' {}

/** The locale service, reached as `ctx.locale`. */
declare module '@deepseek-ai/dsh-client-locale/client' {
  /** Registers one dictionary namespace. */
  export interface LocaleService {
    register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void
  }
}

/** The session identity type shared by the client and host halves. */
declare module '@deepseek-ai/dsh-session/types' {
  /** A session identity. Plain `string`, for the same reason as the client declaration. */
  export type SessionId = string
}

/** Marks the connection layer's Context merge as loaded. */
declare module '@deepseek-ai/dsh-client-connection/client' {}

/**
 * The shipped atom library.
 *
 * It **is** in the shell's frozen platform module table, so the client bundle may
 * `require` it — but it publishes no types either. Components this plugin's own code
 * calls are declared precisely; the ones only the forked upstream browser calls are
 * declared permissively, because re-deriving 57 KB of upstream JSX's prop shapes by
 * hand would be a second, worse copy of the component library, and every mistake in it
 * would surface as a build error about our shim rather than about our code.
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ReactElement, ReactNode, RefObject } from 'react'

  /** Status marker states. `aria-hidden`; the owner supplies the accessible name. */
  export type StateDotState = 'done' | 'warning' | 'ongoing' | 'error' | 'idle'

  /** Props every icon glyph accepts. */
  export interface IconProps {
    readonly size?: number | undefined
    readonly className?: string | undefined
  }

  /** Clickable control. */
  export interface ButtonProps {
    readonly variant?: 'primary' | 'ghost' | 'outline' | 'toolbar' | undefined
    readonly size?: string | undefined
    readonly icon?: ReactNode
    readonly className?: string | undefined
    readonly children?: ReactNode
    readonly disabled?: boolean | undefined
    readonly title?: string | undefined
    readonly 'aria-label'?: string | undefined
    readonly onClick?: (() => void) | undefined
  }

  /** Capsule chip: interactive with `onClick`, a static span without one. */
  export interface PillProps {
    readonly active?: boolean | undefined
    readonly className?: string | undefined
    readonly children?: ReactNode
    readonly onClick?: (() => void) | undefined
  }

  /** Status marker. */
  export interface StateDotProps {
    readonly state: StateDotState
    readonly size?: number | undefined
    readonly className?: string | undefined
  }

  /** Copy a primitive needs, since the package cannot read the application locale. */
  export interface MarkdownLabels {
    readonly code: {
      readonly copyLabel: string
      readonly copiedLabel: string
    }
    readonly footnotes: string
  }

  /** Untrusted GFM with TeX, behind a link and HTML sanitizer. */
  export interface MarkdownTextProps {
    readonly text: string
    readonly streaming?: boolean | undefined
    readonly labels: MarkdownLabels
  }

  /** One dropdown row: an action, a separator, or a group heading. */
  export interface MenuEntry {
    readonly id: string
    readonly label?: string
    /** Heading text for a group row; the menu renders this instead of `label`. */
    readonly text?: string
    readonly icon?: ReactNode
    readonly disabled?: boolean
    /** Row role: `separator`, `group`, or absent for an ordinary action. */
    readonly type?: string
    readonly danger?: boolean
    readonly children?: readonly MenuEntry[]
  }

  export function Button(props: ButtonProps): ReactElement
  export function Pill(props: PillProps): ReactElement
  export function StateDot(props: StateDotProps): ReactElement
  export function MarkdownText(props: MarkdownTextProps): ReactElement

  /**
   * Menus, overlays and hover surfaces.
   *
   * The props the forked browser passes are declared explicitly, because a permissive
   * signature would make every callback parameter implicitly `any` and every handler
   * body unchecked — `onSelect` in particular. The trailing index signature accepts the
   * remaining presentation options (`align`, `side`, `gap`, …) that upstream documents
   * only in its own JSDoc: enumerating them by trial and error would be a second, worse
   * copy of the component library, and each miss would surface as a build error about
   * this shim rather than about real code.
   */
  export interface MenuProps {
    readonly open?: boolean
    readonly anchor?: unknown
    readonly items?: readonly MenuEntry[]
    readonly footer?: readonly MenuEntry[]
    readonly selectedId?: string | undefined
    /** Multi-select form, used by the two view-option menus. */
    readonly selectedIds?: readonly string[] | undefined
    readonly onSelect?: ((id: string) => void) | undefined
    readonly onClose?: (() => void) | undefined
    readonly side?: 'bottom' | 'top' | 'right' | undefined
    readonly portal?: boolean
    readonly autoFocus?: boolean
    /** Keep the menu open while the pointer crosses the anchor gap. */
    readonly closeOnPointerLeave?: boolean
    readonly className?: string | undefined
    readonly getAnchorRect?: (() => DOMRect | null) | undefined
    readonly [presentationOption: string]: unknown
  }

  export function Menu(props: MenuProps): ReactElement
  export function Modal(props: Record<string, unknown>): ReactElement
  export function Tooltip(props: Record<string, unknown>): ReactElement
  export function HoverCard(props: Record<string, unknown>): ReactElement

  /**
   * Compact relative time as `{unit, n}`, for the caller to localize.
   * @param time - epoch milliseconds.
   * @param now - current epoch milliseconds.
   */
  export function relativeTime(time: number, now: number): { readonly unit: string; readonly n: number }

  /** A host directory's containing directory ref, used by the picker anchors. */
  export type AnchorRef = RefObject<HTMLElement | null>

  export function IconGlobeOutline14(props: IconProps): ReactElement
  export function IconChevronDownOutline14(props: IconProps): ReactElement
  export function IconChevronRightOutline14(props: IconProps): ReactElement
  export function IconRefreshOutline14(props: IconProps): ReactElement
  export function IconSendOutline14(props: IconProps): ReactElement
  export function IconWarningOutline16(props: IconProps): ReactElement
  export function IconAlarmClockOutline16(props: IconProps): ReactElement
  export function IconArchiveOutline20(props: IconProps): ReactElement
  export function IconBranchOutline16(props: IconProps): ReactElement
  export function IconCloseFill14(props: IconProps): ReactElement
  export function IconEditOutline16(props: IconProps): ReactElement
  export function IconEllipsisOutline16(props: IconProps): ReactElement
  export function IconFolderClose16(props: IconProps): ReactElement
  export function IconFolderOpen16(props: IconProps): ReactElement
  export function IconPersonalizationOutline16(props: IconProps): ReactElement
  export function IconPlusOutline16(props: IconProps): ReactElement
  export function IconProjectAddOutline16(props: IconProps): ReactElement
  export function IconSearchOutline16(props: IconProps): ReactElement
  export function IconTrashOutline16(props: IconProps): ReactElement
  export function IconTriangleRightFill14(props: IconProps): ReactElement
}
