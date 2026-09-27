/**
 * One remote conversation.
 *
 * It follows a session for as long as it is mounted and renders what the node sends.
 * The panel does **not** reuse the official conversation components: those read a
 * root-scoped single `sessions` service bound to the local host, that service cannot be
 * replaced by a plugin, and `slots.installScope('session')` is boot-once — so a remote
 * session cannot be handed to them. This is the documented consequence of choosing the
 * panel route, not an oversight.
 *
 * What it *does* reuse is the rendering layer: `MarkdownText` for message bodies and
 * the `--dsw-*` tokens for everything else, so a message looks like a message from the
 * local conversation instead of plain text in a foreign frame.
 *
 * @module dsh-master/client/SessionView
 */

import {
  Button,
  IconChevronDownOutline14,
  IconPlusOutline16,
  IconSendOutline14,
  IconWarningOutline16,
  MarkdownText,
  Pill,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { ApiError, followSession, sendPrompt } from './api.js'
import { COPY, MARKDOWN_LABELS } from './copy.js'
import { mergeRows, readEvent, readSnapshot, readStreamFrame, type ConversationRow } from './wire.js'

/** What the view needs to open one session. */
export interface SessionViewProps {
  readonly nodeId: string
  readonly sessionId: string
  readonly title: string
  /** Whether the deployment enabled sending prompts. */
  readonly promptEnabled: boolean
}

/** How the follow stream is doing, for the header chip. */
type Phase = 'connecting' | 'live' | 'ended' | 'failed'

/** Describe one row for its role label. */
function roleLabel(row: ConversationRow): string {
  switch (row.kind) {
    case 'user': return COPY.roleUser
    case 'assistant': return COPY.roleAssistant
    case 'tool-call': return COPY.roleToolCall
    case 'tool-result': return COPY.roleToolResult
    case 'notice': return COPY.roleNotice
  }
}

/**
 * Render one conversation row.
 *
 * Assistant and user bodies go through `MarkdownText`; tool calls follow the Web UI's
 * compact disclosure row and reveal their input/output only when expanded.
 *
 * @param row - the row.
 * @returns the row element.
 */
function Row({ row }: { readonly row: ConversationRow }): ReactElement {
  if (row.kind === 'tool-call' || row.kind === 'tool-result') {
    const isCall = row.kind === 'tool-call'
    const output = isCall ? row.output : row.text
    const running = isCall && output === undefined
    const state = row.failed === true ? 'error' : running ? 'running' : 'ok'
    const summary = output?.split(/\r?\n/u, 1)[0] ?? COPY.toolRunning
    const expandable = row.detail !== undefined || output !== undefined
    return (
      <details className="dsh-master-tool" data-state={state} data-expandable={expandable || undefined}>
        <summary className="dsh-master-tool-row">
          <span className="dsh-master-tool-marker" aria-hidden="true">
            {row.failed === true
              ? <IconWarningOutline16 />
              : running ? <StateDot state="ongoing" /> : <span className="dsh-master-tool-dot" />}
          </span>
          <span className="dsh-master-tool-title">{isCall ? row.text : COPY.roleToolResult}</span>
          <span className="dsh-master-tool-separator" aria-hidden="true" />
          <span className="dsh-master-tool-summary">{summary}</span>
        </summary>
        {expandable ? (
          <div className="dsh-master-tool-body">
            {row.detail === undefined ? null : (
              <div className="dsh-master-tool-section">
                <span className="dsh-master-tool-caption">{COPY.toolInput}</span>
                <pre className="dsh-master-tool-content">{row.detail}</pre>
              </div>
            )}
            {output === undefined ? null : (
              <div className="dsh-master-tool-section">
                <span className="dsh-master-tool-caption">{COPY.toolOutput}</span>
                <pre className="dsh-master-tool-content" data-error={row.failed === true || undefined}>{output}</pre>
              </div>
            )}
          </div>
        ) : null}
      </details>
    )
  }
  if (row.kind === 'notice') {
    return (
      <div className="dsh-master-notice">
        <span>{roleLabel(row)}</span>
        <span>·</span>
        <span>{row.text}</span>
        {row.detail === undefined ? null : <span>— {row.detail}</span>}
      </div>
    )
  }
  if (row.kind === 'user') {
    return (
      <div className="dsh-master-turn" data-role="user">
        <div className="dsh-master-role">{roleLabel(row)}</div>
        <div className="dsh-master-bubble">{row.text}</div>
      </div>
    )
  }
  return (
    <div className="dsh-master-turn">
      <div className="dsh-master-role">
        {roleLabel(row)}
        {row.detail === undefined ? '' : ` ${row.detail}`}
      </div>
      <div className="dsh-master-text">
        <MarkdownText text={row.text} labels={MARKDOWN_LABELS} />
      </div>
    </div>
  )
}

/**
 * Follow and render one session.
 * @param props - the session to open, plus whether prompting is enabled.
 * @returns the conversation view.
 */
export function SessionView(props: SessionViewProps): ReactElement {
  const { nodeId, sessionId, promptEnabled } = props
  const [rows, setRows] = useState<readonly ConversationRow[]>([])
  const [unrendered, setUnrendered] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [cwd, setCwd] = useState<string | undefined>(undefined)
  const [streaming, setStreaming] = useState(false)
  const [phase, setPhase] = useState<Phase>('connecting')
  const [error, setError] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const [mode, setMode] = useState<'queue' | 'steer'>('queue')
  const [sending, setSending] = useState(false)
  const logRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setRows([])
    setUnrendered(0)
    setHasMore(false)
    setCwd(undefined)
    setStreaming(false)
    setError(undefined)
    setPhase('connecting')

    followSession(nodeId, sessionId, controller.signal, (record) => {
      switch (record.type) {
        case 'open':
          setPhase('live')
          return
        case 'data': {
          const snapshot = readSnapshot(record.value)
          if (snapshot !== undefined) {
            setRows(snapshot.rows)
            setUnrendered(snapshot.unrendered)
            setHasMore(snapshot.hasMore)
            setCwd(snapshot.cwd)
            return
          }
          const contribution = readEvent(record.value)
          if (contribution !== undefined) {
            setRows(previous => mergeRows(previous, contribution.rows))
            setUnrendered(count => count + contribution.unrendered)
            return
          }
          const frame = readStreamFrame(record.value)
          if (frame === 'started') setStreaming(true)
          else if (frame === 'settled') setStreaming(false)
          return
        }
        case 'end':
          setStreaming(false)
          setPhase('ended')
          return
        case 'error':
          setStreaming(false)
          setPhase('failed')
          setError(`${record.error.code}: ${record.error.message}`)
          return
      }
    }).catch((cause: unknown) => {
      // An abort is this effect being cleaned up, not a failure to report.
      if (controller.signal.aborted) return
      setPhase('failed')
      setError(cause instanceof Error ? cause.message : String(cause))
    })

    return () => { controller.abort() }
  }, [nodeId, sessionId])

  useEffect(() => {
    const log = logRef.current
    if (log !== null) log.scrollTop = log.scrollHeight
  }, [rows, streaming])

  const submit = useCallback((): void => {
    const text = draft.trim()
    if (text === '' || sending) return
    setSending(true)
    setError(undefined)
    void sendPrompt(nodeId, sessionId, text, mode)
      .then(() => { setDraft('') })
      .catch((cause: unknown) => {
        setError(cause instanceof ApiError ? `${cause.code}: ${cause.message}` : String(cause))
      })
      .finally(() => { setSending(false) })
  }, [draft, mode, nodeId, sending, sessionId])

  const phaseText = streaming
    ? COPY.streaming
    : phase === 'live' ? COPY.live
      : phase === 'ended' ? COPY.ended
        : phase === 'failed' ? COPY.failed
          : COPY.connecting

  return (
    <div className="dsh-master-body">
      <div className="dsh-master-head">
        <span className="dsh-master-label" title={props.title}>{props.title}</span>
        {cwd === undefined ? null : <span className="dsh-master-meta">{cwd}</span>}
        {streaming ? <StateDot state="ongoing" /> : null}
        <span className="dsh-master-meta">{phaseText}</span>
      </div>

      {error === undefined ? null : <div className="dsh-master-error">{error}</div>}

      <div className="dsh-master-log" ref={logRef}>
        <div className="dsh-master-log-column">
          {hasMore ? <div className="dsh-master-hint">{COPY.loadOlderPending}</div> : null}
          {rows.length === 0
            ? <div className="dsh-master-hint">{COPY.emptyConversation}</div>
            : rows.map(row => <Row key={row.key} row={row} />)}
          {unrendered === 0 ? null : (
            <div className="dsh-master-hint">另有 {unrendered} 条事件本版本未渲染（例如思考块、压缩、子代理等）。</div>
          )}
        </div>
      </div>

      <div className="dsh-master-composer">
        <textarea
          className="dsh-master-composer-input"
          value={draft}
          placeholder={promptEnabled ? COPY.composerPlaceholder : COPY.composerDisabled}
          disabled={!promptEnabled || sending}
          onChange={(event) => { setDraft(event.currentTarget.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <div className="dsh-master-composer-toolbar">
          <div className="dsh-master-composer-leading">
            <div className="dsh-master-attachment-controls">
              <button
                type="button"
                className="dsh-master-toolbar-icon"
                data-control="attachment"
                aria-label={COPY.attachmentUnavailable}
                title={COPY.attachmentUnavailable}
                disabled
              >
                <IconPlusOutline16 />
              </button>
              <button
                type="button"
                className="dsh-master-toolbar-icon"
                data-control="attachment"
                aria-label={COPY.attachmentUnavailable}
                title={COPY.attachmentUnavailable}
                disabled
              >
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none">
                  <path d="M5.5 8.75 9.9 4.3a2.15 2.15 0 0 1 3.05 3.04L7.2 13.1a3.45 3.45 0 0 1-4.88-4.88l6.1-6.1" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
            <button
              type="button"
              className="dsh-master-toolbar-select"
              data-control="permission"
              aria-label={COPY.permissionUnavailable}
              title={COPY.permissionUnavailable}
              disabled
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none">
                <path d="M8 1.6 13 3.5v3.7c0 3.2-2.1 5.6-5 7.2-2.9-1.6-5-4-5-7.2V3.5L8 1.6Z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
                <path d="m6.1 7.9 1.25 1.25L10 6.45" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{COPY.unavailableShort}</span>
              <IconChevronDownOutline14 />
            </button>
            <span className="dsh-master-modes">
              <Pill
                active={mode === 'queue'}
                className="dsh-master-mode-pill"
                onClick={promptEnabled ? () => { setMode('queue') } : undefined}
              >
                {COPY.queue}
              </Pill>
              <Pill
                active={mode === 'steer'}
                className="dsh-master-mode-pill"
                onClick={promptEnabled ? () => { setMode('steer') } : undefined}
              >
                {COPY.steer}
              </Pill>
            </span>
          </div>
          <div className="dsh-master-composer-trailing">
            <span className="dsh-master-label dsh-master-meta dsh-master-send-hint">{COPY.sendHint}</span>
            <button
              type="button"
              className="dsh-master-toolbar-select dsh-master-model-select"
              data-control="model"
              aria-label={COPY.modelUnavailable}
              title={COPY.modelUnavailable}
              disabled
            >
              <span>{COPY.unavailableShort}</span>
              <IconChevronDownOutline14 />
            </button>
            {streaming ? <StateDot state="ongoing" /> : null}
            <Button
              className="dsh-master-send"
              variant="primary"
              icon={<IconSendOutline14 />}
              aria-label={sending ? COPY.sending : COPY.send}
              title={sending ? COPY.sending : COPY.send}
              disabled={!promptEnabled || sending || draft.trim() === ''}
              onClick={submit}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
