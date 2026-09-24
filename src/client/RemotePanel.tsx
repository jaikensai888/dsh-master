/**
 * The remote conversation panel. Remote node/session navigation lives in the app's
 * left workspace sidebar; this panel renders only the selected remote conversation.
 *
 * It occupies the layout's `main` keyed slot under the id `dsh-master`. Remote-session
 * selection in the workspace tree calls `ctx.layout.selectPanel('dsh-master')`, so the
 * panel needs no route or URL.
 *
 * Controls, status dots, icons and row geometry all come from
 * `@deepseek-ai/dsh-client-ui-primitives` and the `--dsw-*` tokens, so the panel reads
 * as part of the app rather than as a second design language bolted next to it.
 *
 * @module dsh-master/client/RemotePanel
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { PANEL_ID, type MasterStatus } from '../protocol.js'
import { fetchStatus } from './api.js'
import { COPY } from './copy.js'
import { getRemoteSelection, subscribeRemoteSelection } from './selection.js'
import { SessionView } from './SessionView.js'

/**
 * Render the selected remote conversation. The left workspace sidebar is the only
 * remote node/session browser; status is read here solely to honor prompt permissions.
 *
 * @returns the panel.
 */
export function RemotePanel(): ReactElement {
  const selection = useSyncExternalStore(
    subscribeRemoteSelection,
    getRemoteSelection,
    getRemoteSelection,
  )
  const [status, setStatus] = useState<MasterStatus | undefined>(undefined)
  useEffect(() => {
    let active = true
    void fetchStatus()
      .then(nextStatus => { if (active) setStatus(nextStatus) })
      .catch(() => undefined)
    return () => { active = false }
  }, [])

  return (
    <div className="dsh-master-root" data-panel={PANEL_ID}>
      {selection === undefined
        ? <div className="dsh-master-empty">{COPY.pickSomething}</div>
        : (
          <SessionView
            key={`${selection.nodeId}/${selection.sessionId}`}
            nodeId={selection.nodeId}
            sessionId={selection.sessionId}
            title={`${selection.nodeName ?? selection.nodeId} · ${selection.sessionTitle ?? selection.sessionId}`}
            promptEnabled={status?.promptEnabled === true}
          />
        )}
    </div>
  )
}
