/**
 * One delivered artifact card.
 *
 * This is **not** a host-native message and does not parse file paths out of
 * assistant text. It is rendered from the node's artifact metadata, keyed by
 * `artifactId`, so a refresh or a node restart shows the same persisted card.
 *
 * The download is a plain anchor to the host route, which sets
 * `Content-Disposition: attachment`. That keeps the browser's own download UI
 * (including "ask where to save") as the only save path; the page never learns
 * a remote path or a local write target.
 *
 * @module dsh-master/client/ArtifactCard
 */

import type { ReactElement } from 'react'
import { downloadArtifactUrl } from './api.js'
import { COPY, FILE_SUPPORT_TEXT, formatBytes, formatDateTime } from './copy.js'
import type { FileSupportState } from './file-support.js'
import type { FileArtifact } from '../files-protocol.js'

/** Props for {@link ArtifactCard}. */
export interface ArtifactCardProps {
  readonly artifact: FileArtifact
  /** Node/session are the card's identity, not the artifact's own copy. */
  readonly nodeId: string
  readonly sessionId: string
}

/** The state line for an artifact that cannot be downloaded. */
export function artifactStateText(artifact: FileArtifact): string | undefined {
  switch (artifact.state) {
    case 'ready': return undefined
    case 'expired': return COPY.artifactExpired
    case 'missing': return COPY.artifactMissing
  }
}

/**
 * Merge one poll result into the cards already shown.
 *
 * Keyed by `artifactId` and sorted by creation time: a repeated poll must not
 * duplicate a card, and a refresh must not reorder the list.
 * @param previous - cards currently rendered.
 * @param next - the node's latest list.
 * @returns the merged, ordered list.
 */
export function mergeArtifacts(
  previous: readonly FileArtifact[],
  next: readonly FileArtifact[],
): FileArtifact[] {
  const byId = new Map(previous.map(artifact => [artifact.artifactId, artifact]))
  for (const artifact of next) byId.set(artifact.artifactId, artifact)
  return [...byId.values()].sort((left, right) => {
    const delta = Date.parse(left.createdAt) - Date.parse(right.createdAt)
    return Number.isFinite(delta) && delta !== 0 ? delta : left.artifactId.localeCompare(right.artifactId)
  })
}

/**
 * Render one card.
 * @param props - artifact plus the session that owns it.
 * @returns the card.
 */
export function ArtifactCard(props: ArtifactCardProps): ReactElement {
  const { artifact } = props
  const stateText = artifactStateText(artifact)
  const href = downloadArtifactUrl(props.nodeId, props.sessionId, artifact.artifactId)
  return (
    <div className="dsh-master-artifact" data-artifact-id={artifact.artifactId} data-state={artifact.state}>
      <div className="dsh-master-artifact-main">
        <span className="dsh-master-artifact-name" title={artifact.name}>{artifact.name}</span>
        <span className="dsh-master-artifact-meta">
          {formatBytes(artifact.size)}
          {artifact.expiresAt === '' ? '' : ` · ${COPY.artifactExpires} ${formatDateTime(artifact.expiresAt)}`}
        </span>
        {stateText === undefined ? null : <span className="dsh-master-artifact-state">{stateText}</span>}
      </div>
      {artifact.state === 'ready' ? (
        <a
          className="dsh-master-artifact-download"
          href={href}
          // No `download` attribute: the server's Content-Disposition carries the
          // real (possibly non-ASCII) name, and an attribute would replace it.
          rel="noreferrer"
        >
          {COPY.artifactDownload}
        </a>
      ) : (
        <span className="dsh-master-artifact-download" aria-disabled="true">{COPY.artifactUnavailable}</span>
      )}
    </div>
  )
}

/** One capability problem, rendered here and only here. */
function CapabilityNotice(props: {
  readonly state: FileSupportState
  readonly onRetry?: (() => void) | undefined
}): ReactElement | null {
  const { state } = props
  if (state.status === 'loading') return null
  if (state.status === 'supported') {
    if (state.describe.deliveryTool !== 'unavailable') return null
    return (
      <div className="dsh-master-hint" role="status" data-capability="tool-unavailable">
        <span>{COPY.artifactDeliveryUnavailable}</span>
        {props.onRetry === undefined ? null : (
          <button type="button" className="dsh-master-toolbar-select" onClick={props.onRetry}>
            {COPY.fileSupportRetry}
          </button>
        )}
      </div>
    )
  }
  const text = FILE_SUPPORT_TEXT[state.reason]
  return (
    <div className="dsh-master-hint" role="status" data-capability={state.reason}>
      <div>{text.title}。</div>
      <div className="dsh-master-meta">{text.detail}</div>
      {state.retryable && props.onRetry !== undefined ? (
        <button type="button" className="dsh-master-toolbar-select" onClick={props.onRetry}>
          {COPY.fileSupportRetry}
        </button>
      ) : null}
      <details className="dsh-master-context">
        <summary>{COPY.fileSupportDiagnostics}</summary>
        <div className="dsh-master-context-body">
          <code>{state.code}</code>
          {state.message === '' ? null : <div className="dsh-master-meta">{state.message}</div>}
        </div>
      </details>
    </div>
  )
}

/** The artifacts section for one session. */
export function ArtifactList(props: {
  readonly artifacts: readonly FileArtifact[]
  readonly nodeId: string
  readonly sessionId: string
  readonly support: FileSupportState
  readonly onRetrySupport?: (() => void) | undefined
}): ReactElement | null {
  const { support } = props
  const hasArtifacts = props.artifacts.length > 0
  // Before the probe settles there is no honest statement to make about files.
  if (!hasArtifacts && support.status === 'loading') return null
  const unavailable = support.status === 'supported' && support.describe.deliveryTool === 'unavailable'
  const emptySupported = support.status === 'supported' && !unavailable && !hasArtifacts
  if (emptySupported) {
    return (
      <details className="dsh-master-artifacts dsh-master-artifacts-empty">
        <summary>{COPY.artifactSection}</summary>
        <div className="dsh-master-hint">{COPY.artifactEmpty}</div>
      </details>
    )
  }
  return (
    <section className="dsh-master-artifacts" data-empty={hasArtifacts ? undefined : 'true'} aria-label={COPY.artifactSection}>
      <div className="dsh-master-artifacts-title">{COPY.artifactSection}</div>
      <CapabilityNotice state={support} onRetry={props.onRetrySupport} />
      {props.artifacts.map(artifact => (
        <ArtifactCard
          key={artifact.artifactId}
          artifact={artifact}
          nodeId={props.nodeId}
          sessionId={props.sessionId}
        />
      ))}
    </section>
  )
}
