import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The store engine is a runtime platform module (not an installed dependency);
// this test supplies the browser's store via props, so the factory is never called.
vi.mock('@deepseek-ai/dsh-client-store', () => ({
  defineStore: () => ({ spec: {}, create: () => ({}) }),
}))

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const react = await import('react')
  const icon = (name: string) => (props: { className?: string }) => react.createElement('i', { 'data-icon': name, className: props.className })
  const stub = (name: string) => () => react.createElement('div', { 'data-stub': name })
  return {
    Button: (props: { icon?: unknown; children?: unknown; 'aria-label'?: string; onClick?: () => void; disabled?: boolean }) => react.createElement(
      'button', { 'aria-label': props['aria-label'], disabled: props.disabled, onClick: props.onClick }, props.icon as never, props.children as never,
    ),
    Tooltip: (props: { children?: unknown }) => react.createElement(react.Fragment, null, props.children as never),
    Menu: stub('menu'),
    Modal: (props: { open?: boolean; children?: unknown; footer?: unknown }) => (
      props.open === true ? react.createElement('div', { 'data-modal': '' }, props.footer as never, props.children as never) : null
    ),
    StateDot: icon('state'),
    relativeTime: () => ({ unit: 'minutes', n: 1 }),
    IconArchiveOutlineRegular: icon('archive'),
    IconCloseFillRegular: icon('close'),
    IconPersonalizationOutlineRegular: icon('personalization'),
    IconProjectAddOutlineRegular: icon('project-add'),
    IconSearchOutlineRegular: icon('search'),
    IconFolderCloseRegular: icon('folder-closed'),
    IconPlusOutlineRegular: icon('plus'),
  }
})

import { WorkspaceBrowser } from '../src/workspace/rows/WorkspaceBrowser.js'

/** A hook over one immutable snapshot. */
function hook<T>(snapshot: T) {
  return <S,>(selector: (state: T) => S): S => selector(snapshot)
}

const SESSIONS = { ids: [], byId: {}, current: undefined, phase: 'ready' }
const WORKSPACES = { items: [], phase: 'ready', archivedSessionIds: [] }
const VIEW_STORE = {
  browseScope: { kind: 'local' },
  groupBy: 'workspace',
  orderBy: 'updated',
  groupExpansion: {},
  sessionOrderByAccount: {},
  sessionUpdatedAtByAccount: {},
  localExpanded: true,
  remoteExpanded: true,
  remoteNodeExpansion: {},
  remoteWorkspaceExpansion: {},
  following: [],
}

/** The browser's injected actions; only the ones the initial render reads matter. */
const ACTIONS = new Proxy({}, { get: () => () => undefined }) as Record<string, () => void>

function browserProps(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    wide: true,
    expandSidebar: () => undefined,
    useSessions: hook(SESSIONS),
    useSessionPendingInteraction: hook(new Map()),
    useWorkspaces: hook(WORKSPACES),
    useStore: hook(VIEW_STORE),
    actions: ACTIONS,
    startSession: () => undefined,
    open: () => undefined,
    openArchivedSession: () => undefined,
    openRemoteSession: () => undefined,
    renameSession: async () => undefined,
    forkSession: () => undefined,
    renameWorkspace: async () => undefined,
    deleteWorkspace: async () => undefined,
    insertWorkspaceBefore: async () => undefined,
    archiveSession: async () => undefined,
    unarchiveSession: async () => undefined,
    insertSessionBefore: async () => undefined,
    createWorkspace: async () => ({ workspaceId: 'ws', title: 'ws', path: '/ws', createdAt: '', sessionIds: [] }),
    renderRemoteSection: () => null,
    searchSessions: async () => ({ items: [], hasMore: false }),
    searchResultLimit: 20,
    // No composed directory picker: the add affordance must survive that.
    useDirectoryFlow: hook(false),
    useHostInfo: hook({ home: 'C:\\Users\\test' }),
    renderSlot: () => null,
    t: (key: string) => key,
    ...overrides,
  }
}

function renderBrowser(overrides: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(createElement(
    WorkspaceBrowser as unknown as (props: never) => ReactElement,
    browserProps(overrides) as never,
  ) as unknown as ReactElement)
}

describe('the local workspace header', () => {
  it('puts the add-workspace control immediately left of the search control', () => {
    const markup = renderBrowser()
    const add = markup.indexOf('aria-label="workspace.add"')
    const search = markup.indexOf('aria-label="search.sessions.aria"')
    expect(add).toBeGreaterThan(-1)
    expect(search).toBeGreaterThan(-1)
    expect(add).toBeLessThan(search)
  })

  it('keeps the add control without a composed directory picker', () => {
    const withoutFlow = renderBrowser({ useDirectoryFlow: hook(false) })
    const withFlow = renderBrowser({ useDirectoryFlow: hook(true) })
    for (const markup of [withoutFlow, withFlow]) {
      expect(markup).toContain('aria-label="workspace.add"')
    }
  })

  it('offers the archived entry in the local scope only', () => {
    const local = renderBrowser()
    expect(local).toContain('aria-label="archived.entry"')
    expect(local).toContain('aria-pressed="false"')
    const remote = renderBrowser({
      useStore: hook({ ...VIEW_STORE, browseScope: { kind: 'remote', nodeId: 'node-a' } }),
    })
    expect(remote).not.toContain('aria-label="archived.entry"')
    expect(remote).not.toContain('aria-label="workspace.add"')
  })

  it('picks the scroll contract from the shell capability, not from a build string', () => {
    // No capability (0.1.x host, or a server render): the legacy column contract,
    // where each list scrolls itself inside a definite-height slot.
    const legacy = renderBrowser()
    expect(legacy).toContain('data-dsh-section="column"')
    expect(legacy).toContain('data-dsh-section-body')

    // 0.2.x hosts hand the section their viewport scroller.
    const viewport = renderBrowser({
      useSectionScroller: () => ({ bindScrollerRef: () => undefined }),
      renderRemoteSection: () => createElement('div', { 'data-fake-remote': '' }),
    })
    expect(viewport).toContain('data-dsh-section="viewport"')
    // Local rows and the remote section share that one scroller instead of being
    // siblings that each carry their own scroll region.
    const body = viewport.indexOf('data-dsh-section-body')
    expect(body).toBeGreaterThan(-1)
    expect(viewport.indexOf('data-dsh-local-list')).toBeGreaterThan(body)
    expect(viewport.indexOf('data-fake-remote')).toBeGreaterThan(body)
  })
})
