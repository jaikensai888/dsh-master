/**
 * Shared selection between the left remote workspace tree and its main panel.
 *
 * This is deliberately a tiny module store rather than another Cordis service: both
 * React surfaces already live in one client bundle and `useSyncExternalStore` gives
 * them a stable, concurrent-safe subscription boundary.
 *
 * @module dsh-master/client/selection
 */

import { PANEL_ID } from '../protocol.js'

/** The built-in main-panel key that owns local conversation sessions. */
const CONVERSATION_PANEL_ID = 'conversation'

/** The remote identity needed to open a session in the main panel. */
export interface RemoteSessionSelection {
  readonly nodeId: string
  readonly sessionId: string
  readonly nodeName?: string
  readonly sessionTitle?: string
}

/** The layout action required to navigate to the registered panel. */
export interface PanelNavigation {
  selectPanel(id: string): void
}

/** The local session action paired with its main-panel navigation. */
export interface LocalSessionOpener {
  open(sessionId: string): void
}

let selected: RemoteSessionSelection | undefined
const listeners = new Set<() => void>()

/** Read the referentially stable current selection for `useSyncExternalStore`. */
export function getRemoteSelection(): RemoteSessionSelection | undefined {
  return selected
}

/** Subscribe to identity changes; duplicate selections are deliberately silent. */
export function subscribeRemoteSelection(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Return to the built-in conversation panel before opening a local session. */
export function openLocalSession(
  layout: PanelNavigation,
  sessions: LocalSessionOpener,
  sessionId: string,
): void {
  layout.selectPanel(CONVERSATION_PANEL_ID)
  setRemoteSelection(undefined)
  sessions.open(sessionId)
}

/** Update the selected remote session, or clear it. */
export function setRemoteSelection(next: RemoteSessionSelection | undefined): void {
  if (selected?.nodeId === next?.nodeId
    && selected?.sessionId === next?.sessionId
    && selected?.nodeName === next?.nodeName
    && selected?.sessionTitle === next?.sessionTitle) return
  selected = next
  for (const listener of [...listeners]) listener()
}

/** Navigate to the remote panel and then publish the requested session. */
export function openRemoteSession(
  layout: PanelNavigation,
  nodeId: string,
  sessionId: string,
  nodeName: string,
  sessionTitle: string,
): void {
  layout.selectPanel(PANEL_ID)
  setRemoteSelection({ nodeId, sessionId, nodeName, sessionTitle })
}
