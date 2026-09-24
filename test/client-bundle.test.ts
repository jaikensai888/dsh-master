import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * The frozen module table the shell seeds into every client bundle.
 *
 * This is `PLATFORM_MODULES` of `@deepseek-ai/dsh-client-modules`. A bundle that
 * `require()`s anything else fails when the page materialises the factory, and DSH
 * logs nothing when that happens — the plugin runs on the host and simply never
 * appears in the browser. `dsh-node` lost a footer row to this.
 */
const PLATFORM_MODULES = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

/**
 * Read the built client bundle.
 *
 * `pnpm build` is a prerequisite: `lib/` is git-ignored, and a bundle check that
 * silently skips when the artifact is missing is worse than no check at all — it
 * passes on exactly the machine where the bundle was never produced.
 *
 * @returns the bundle source.
 */
async function readClientBundle(): Promise<string> {
  const path = join(ROOT, 'lib/client.js')
  try {
    return await readFile(path, 'utf8')
  } catch {
    throw new Error('lib/client.js is missing — run `pnpm build` before `pnpm test`')
  }
}

describe('the built client bundle', () => {
  it('is a __ModuleLoader__ registration keyed by the package name', async () => {
    const source = await readClientBundle()
    expect(source.startsWith('window.__ModuleLoader__.load({ id: "dsh-master", factory: (require) => {')).toBe(true)
    // The factory must only *register*; component code runs at materialisation.
    // The trailing source-map comment is appended after the footer, so it is stripped
    // rather than asserted around.
    const withoutMap = source.replace(/\n\/\/# sourceMappingURL=.*\s*$/u, '')
    expect(withoutMap.trimEnd().endsWith('return module.exports; } });')).toBe(true)
  })

  it('requires nothing outside the frozen platform table', async () => {
    const source = await readClientBundle()
    const specifiers = [...source.matchAll(/require\("([^"]+)"\)/gu)].map(match => match[1])
    expect(specifiers.length).toBeGreaterThan(0)
    expect(specifiers.filter(specifier => !PLATFORM_MODULES.has(String(specifier)))).toEqual([])
  })

  it('registers the sidebar entry and the panel under one id', async () => {
    const source = await readClientBundle()
    expect(source).not.toContain('sidebar.panellist')
    expect(source).toContain('"main"')
    expect(source).toContain('"dsh-master"')
  })

  it('declares its service dependencies and applies cleanly', async () => {
    // The failure this guards is the quiet one: a bundle that loads but whose `apply`
    // throws — or registers into the wrong slot — leaves the host healthy and the
    // browser without a panel, and DSH reports nothing. So the bundle is materialised
    // here the way the page does it: through `window.__ModuleLoader__`, with a
    // `require` that answers **only** from the frozen platform table.
    const source = await readClientBundle()
    const registrations: { options: Record<string, unknown> }[] = []
    const injected: string[] = []
    const provided: Record<string, unknown> = {}
    const selectedPanels: string[] = []
    const storeDefinitions: unknown[] = []

    /**
     * A no-op **function expression**.
     *
     * Not an arrow function: the bundle declares `class UiWorkspaceService extends
     * Service`, and an arrow is not constructible. It returns nothing on purpose — a
     * base class whose `super()` returned an object would replace `this`, and the
     * subclass's own prototype methods would vanish with "this.watchNavigation is not
     * a function".
     */
    const noop = function stub(): void { /* no-op */ }

    /**
     * Stubs shaped by what the bundle actually reads.
     *
     * Enumerating the exports by hand does not work: the bundle reaches each module
     * through the bundler's CJS interop, which copies **own enumerable properties**, so
     * a `Proxy` that answers every `get` still yields `undefined` for `Service` — the
     * copy sees no keys. Reading the property names out of the emitted code gives a
     * stub that covers exactly what is used, and it fails loudly if the bundle starts
     * depending on something outside the table.
     */
    const stubs = new Map<string, Record<string, unknown>>()
    for (const match of source.matchAll(/let (\w+) = require\("([^"]+)"\);/gu)) {
      const [, binding, id] = match as unknown as [string, string, string]
      if (!PLATFORM_MODULES.has(id)) {
        throw new Error(`bundle required "${id}", which is outside the platform table`)
      }
      const props: Record<string, unknown> = {}
      for (const use of source.matchAll(new RegExp(`\\b${binding}\\.(\\w+)`, 'gu'))) {
        props[String(use[1])] = noop
      }
      stubs.set(id, props)
    }
    expect(stubs.size).toBeGreaterThan(0)

    /** The two stubs whose *return value* the plugin consumes. */
    const returns: Record<string, (...args: unknown[]) => unknown> = {
      defineStore: (definition: unknown) => {
        storeDefinitions.push(definition)
        return { spec: {}, create: () => ({}) }
      },
    }
    const requireFromTable = (id: string): unknown => {
      const props = stubs.get(id)
      if (props === undefined) throw new Error(`bundle required "${id}", which is outside the platform table`)
      const module: Record<string, unknown> = { __esModule: true, default: noop }
      for (const [name, value] of Object.entries(props)) module[name] = returns[name] ?? value
      return module
    }

    let exports: { apply?: (ctx: unknown) => void; inject?: readonly string[] } | undefined
    const globals = globalThis as { window?: unknown }
    const previous = globals.window
    globals.window = {
      __ModuleLoader__: {
        load: (entry: { id: string; factory: (require: (id: string) => unknown) => unknown }) => {
          expect(entry.id).toBe('dsh-master')
          exports = entry.factory(requireFromTable) as typeof exports
        },
      },
    }

    try {
      // eslint-disable-next-line no-new-func -- the bundle is a classic script, not a module.
      new Function(source)()
    } finally {
      globals.window = previous
    }

    expect(exports?.inject).toEqual([
      'slots',
      'layout',
      'sessions',
      'workspaces',
      'locale',
      'remote',
      'remote.directoryPicker',
    ])
    expect(typeof exports?.apply).toBe('function')

    /** A snapshot source with nothing in it, plus a working unsubscribe. */
    const emptySource = (snapshot: unknown): unknown => ({
      getSnapshot: () => snapshot,
      subscribe: () => () => undefined,
    })

    /** The context the plugin is applied to. */
    const self: Record<string, unknown> = {
      // `ctx.effect` returns the disposer so the registrations are observable here.
      effect: (callback: () => (() => void) | undefined) => callback(),
      on: () => () => undefined,
      get: (key: string) => provided[key],
      provide: (key: string, value: unknown) => { provided[key] = value },
      slots: {
        register: (options: Record<string, unknown>) => {
          registrations.push({ options })
          return () => undefined
        },
        inject: (key: string, callback: () => () => void) => {
          injected.push(key)
          return callback()
        },
        provideRoot: () => () => undefined,
        entries: () => [],
        subscribe: () => () => undefined,
      },
      layout: { selectPanel: (id: string) => { selectedPanels.push(id) } },
      locale: { register: () => () => undefined },
      remote: { $host: {}, directoryPicker: {} },
      sessions: {
        list: emptySource({ ids: [], byId: {}, current: undefined, phase: 'ready' }),
        searchResultLimit: 20,
        open: () => undefined,
        clear: () => undefined,
        binding: () => undefined,
        create: () => Promise.resolve(''),
        search: () => Promise.resolve({ ok: true, value: { items: [], hasMore: false } }),
        fork: () => Promise.resolve(''),
      },
      workspaces: {
        list: emptySource({ items: [], phase: 'ready', archivedSessionIds: [] }),
        create: () => Promise.resolve({}),
        rename: () => Promise.resolve(),
        delete: () => Promise.resolve(),
        archiveSession: () => Promise.resolve(),
        insertBefore: () => Promise.resolve(),
        insertSessionBefore: () => Promise.resolve(),
      },
    }

    exports?.apply?.(self)

    const browserOptions = registrations[0]?.options
    const browserInject = browserOptions?.['inject']
    expect(typeof browserInject).toBe('function')
    const browserProps = (browserInject as () => Record<string, unknown>)()
    const openRemoteSession = browserProps['openRemoteSession']
    expect(typeof openRemoteSession).toBe('function')
    ;(openRemoteSession as (
      nodeId: string,
      sessionId: string,
      nodeName: string,
      sessionTitle: string,
    ) => void)('node-1', 'session-1', 'my-desktop', 'plugin design')
    expect(selectedPanels).toEqual(['dsh-master'])

    // Order matters: the workspace surfaces are claimed before the plugin's own panel.
    expect(injected).toEqual([
      'sidebar.workspaces',
      'conversation.hero.workspace',
      'main',
    ])
    expect(registrations.map(entry => entry.options)).toEqual([
      {
        name: 'sidebar.workspaces',
        // Declaring the directory-flow hole is what keeps "Add workspace…" working
        // once the shipped ui-workspace entry is disabled.
        children: { 'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' } },
        store: expect.anything(),
        inject: expect.any(Function),
        locale: 'workspace',
      },
      {
        name: 'conversation.hero.workspace',
        children: { 'conversation.hero.workspace.directoryFlow': { kind: 'single', scope: 'root' } },
        inject: expect.any(Function),
        locale: 'workspace',
      },
      { name: 'main', key: 'dsh-master', registrant: 'dsh-master' },
    ])

    const viewStore = storeDefinitions[0] as {
      init: () => Record<string, unknown>
      actions: Record<string, unknown>
    } | undefined
    expect(viewStore).toBeDefined()
    if (viewStore === undefined) return
    const state = viewStore.init()
    expect(state['localExpanded']).toBe(true)
    const setLocalExpanded = viewStore.actions['setLocalExpanded']
    expect(typeof setLocalExpanded).toBe('function')
    if (typeof setLocalExpanded !== 'function') return
    ;(setLocalExpanded as (draft: Record<string, unknown>, expanded: boolean) => void)(state, false)
    expect(state['localExpanded']).toBe(false)
  })
})
