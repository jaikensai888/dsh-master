/** Own one remote access controller per mounted node/session, including StrictMode cleanup. */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { SessionAccessController, type AccessState } from './session-access.js'

const EMPTY: AccessState = { unsupported: false, busy: false }
const emptySnapshot = (): AccessState => EMPTY
const emptySubscribe = (): (() => void) => () => {}

export function useSessionAccess(nodeId: string, sessionId: string, enabled: boolean): {
  readonly controller: SessionAccessController | undefined
  readonly state: AccessState
} {
  const [owned, setOwned] = useState<SessionAccessController>()
  const controller = owned?.nodeId === nodeId && owned.sessionId === sessionId ? owned : undefined
  useEffect(() => {
    const current = new SessionAccessController(nodeId, sessionId, enabled)
    setOwned(current)
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const poll = async (): Promise<void> => {
      await current.refresh()
      if (!stopped) timer = setTimeout(() => { void poll() }, 5_000)
    }
    void poll()
    return () => { stopped = true; if (timer !== undefined) clearTimeout(timer); current.dispose() }
  }, [nodeId, sessionId])
  useEffect(() => { controller?.setEnabled(enabled) }, [controller, enabled])
  const state = useSyncExternalStore(controller?.subscribe ?? emptySubscribe, controller?.getSnapshot ?? emptySnapshot, emptySnapshot)
  return { controller, state }
}
