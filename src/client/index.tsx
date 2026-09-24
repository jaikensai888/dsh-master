/**
 * `dsh-master` — client half.
 *
 * The forked `ui-workspace` keeps local browsing intact and displays remote nodes in a
 * sibling group below it. Remote sessions open in the `dsh-master` main panel.
 *
 * ## Why `slots.inject`
 *
 * `main` is declared by `ui-layout`, in whichever order the loader happens to activate
 * the plugins. `slots.inject(key, cb)`
 * runs `cb` for the lifetime of that declaration, so this half works regardless of
 * order and re-registers if a declaration collapses and returns. Registering an
 * undeclared slot throws; registering directly would be a race.
 *
 * `ctx.effect` ties each registration — and the stylesheet — to the plugin's own
 * lifetime, so a hot reload never leaves a duplicate behind. A duplicate id throws.
 *
 * @module dsh-master/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ReactElement } from 'react'
import { PANEL_ID } from '../protocol.js'
import { applyWorkspaceBrowser } from '../workspace/index.js'
import { disposeWorkspaceStyles, ensureWorkspaceStyles } from '../workspace/styles.generated.js'
import { RemotePanel } from './RemotePanel.js'
import { openRemoteSession, type PanelNavigation } from './selection.js'
import { disposeStyles, ensureStyles } from './styles.js'

/** The slot registry, read structurally: this plugin is out of tree. */
interface SlotsService {
  register(options: Record<string, unknown>, component: (props: never) => ReactElement): () => void
  /** Runs the callback per declaration lifetime of the slot; a no-op while undeclared. */
  inject(key: string, callback: () => () => void): () => void
}

/**
 * Cordis service names, not package names.
 *
 * `slots` is the renderer's registry (`@deepseek-ai/dsh-client-ui-renderer` provides
 * it). The workspace browser reads session, workspace, locale, and remote services;
 * local and remote session navigation also call `layout.selectPanel`. Declare it first.
 */
export const inject = [
  'slots',
  'layout',
  'sessions',
  'workspaces',
  'locale',
  'remote',
  'remote.directoryPicker',
] as const

/** The layout's central-panel slot, dispatched by the selected panel id. */
export const MAIN_SLOT = 'main'

/**
 * Register the panel.
 * @param ctx - client context carrying the slot registry.
 */
export function apply(ctx: Context): void {
  const slots = (ctx as Context & { slots?: SlotsService }).slots
  if (slots === undefined) return
  const layout = (ctx as Context & { layout: PanelNavigation }).layout

  ctx.effect(() => {
    const tag = ensureStyles()
    return () => {
      // Removing the tag the loader does not track is this plugin's job; unloading
      // must not leave rules behind.
      if (tag !== undefined) disposeStyles()
    }
  }, 'dsh-master.styles')

  ctx.effect(() => {
    // The forked browser's own stylesheet, owned the same way: the client-modules
    // loader tracks only the tags its own records created.
    ensureWorkspaceStyles()
    return () => { disposeWorkspaceStyles() }
  }, 'dsh-master.workspace-styles')

  // Take over the sidebar's workspace region. This replaces the shipped
  // `ui-workspace` client half, which the deployment disables — see
  // `src/workspace/index.ts` for why a shadowing entry cannot work.
  //
  // These services are hard dependencies so the browser registers synchronously during
  // apply. Cordis must see `uiWorkspace` before it activates the shell's consumers; a
  // nested `ctx.inject()` callback can run after renderer boot has already been judged.
  // Cordis guards nested service access too; `remote.directoryPicker` is declared in
  // the inject list because the workspace controller reads that capability directly.
  ctx.effect(
    () => applyWorkspaceBrowser(
      ctx,
      (message) => { console.warn(message) },
      layout,
      (nodeId, sessionId, nodeName, sessionTitle) => {
        openRemoteSession(layout, nodeId, sessionId, nodeName, sessionTitle)
      },
    ),
    'dsh-master.workspace-browser',
  )

  ctx.effect(() => slots.inject(MAIN_SLOT, () => slots.register({
    name: MAIN_SLOT,
    key: PANEL_ID,
    registrant: 'dsh-master',
  }, () => <RemotePanel />)), 'dsh-master.main')
}
