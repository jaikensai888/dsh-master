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
  IconChevronRightOutline14,
  IconPlusOutline16,
  IconSendOutline14,
  IconWarningOutline16,
  MarkdownText,
  Pill,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import {
  ApiError,
  answerRemoteQuestion,
  cancelRemoteQuestion,
  fetchPendingQuestions,
  followSession,
  sendPrompt,
} from './api.js'
import { COPY, MARKDOWN_LABELS } from './copy.js'
import {
  hasPendingUserQuestion,
  mergeRows,
  readEvent,
  readSnapshot,
  readStreamFrame,
  type ConversationRow,
} from './wire.js'
import type { MasterQuestion, MasterQuestionAnswer, MasterPendingQuestionRequest } from '../protocol.js'

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

type QuestionSelections = Readonly<Record<string, readonly string[]>>
type QuestionCustomAnswers = Readonly<Record<string, string>>

/** Keep every original question ID and only include custom text when supplied. */
export function buildQuestionAnswer(
  questions: readonly MasterQuestion[],
  selected: QuestionSelections,
  custom: QuestionCustomAnswers,
): MasterQuestionAnswer {
  return {
    answers: questions.map(question => {
      const customText = custom[question.id]?.trim()
      return {
        id: question.id,
        selected: [...(selected[question.id] ?? [])],
        ...(customText === undefined || customText === '' ? {} : { custom: customText }),
      }
    }),
  }
}

/** Render one pending DSH question request as a takeover of the remote composer. */
export function RemoteQuestionForm(props: {
  readonly request: MasterPendingQuestionRequest
  readonly disabled: boolean
  readonly error?: string
  readonly onAnswer: (answer: MasterQuestionAnswer) => void
  readonly onCancel: () => void
}): ReactElement {
  const [selected, setSelected] = useState<QuestionSelections>({})
  const [custom, setCustom] = useState<QuestionCustomAnswers>({})
  const [skipped, setSkipped] = useState<Readonly<Record<string, boolean>>>({})
  const [activeIndex, setActiveIndex] = useState(0)
  const [validationError, setValidationError] = useState<string | undefined>()
  const { request } = props
  const question = request.questions[activeIndex]
  if (question === undefined) return <></>

  const answered = (id: string, selections = selected, customAnswers = custom): boolean =>
    (selections[id]?.length ?? 0) > 0 || (customAnswers[id] ?? '').trim() !== ''

  const submit = (
    nextSkipped = skipped,
    nextSelected = selected,
    nextCustom = custom,
  ): void => {
    const missingIndex = request.questions.findIndex(item =>
      !nextSkipped[item.id] && !answered(item.id, nextSelected, nextCustom))
    if (missingIndex >= 0) {
      setActiveIndex(missingIndex)
      setValidationError(COPY.questionRequired)
      return
    }
    setValidationError(undefined)
    props.onAnswer(buildQuestionAnswer(request.questions, nextSelected, nextCustom))
  }

  const continueFlow = (): void => {
    if (!answered(question.id)) {
      setValidationError(COPY.questionRequired)
      return
    }
    if (activeIndex < request.questions.length - 1) {
      setActiveIndex(activeIndex + 1)
      setValidationError(undefined)
      return
    }
    submit()
  }

  const skipCurrent = (): void => {
    const nextSkipped = { ...skipped, [question.id]: true }
    const nextSelected = { ...selected, [question.id]: [] }
    const nextCustom = { ...custom, [question.id]: '' }
    setSkipped(nextSkipped)
    setSelected(nextSelected)
    setCustom(nextCustom)
    setValidationError(undefined)
    if (activeIndex < request.questions.length - 1) {
      setActiveIndex(activeIndex + 1)
      return
    }
    submit(nextSkipped, nextSelected, nextCustom)
  }

  return (
    <form
      className="dsh-master-composer dsh-master-question-composer dsh-master-question"
      aria-label={COPY.questionHeading}
      onSubmit={(event) => {
        event.preventDefault()
        continueFlow()
      }}
    >
      <div className="dsh-master-question-heading">{COPY.questionHeading}</div>
      <fieldset className="dsh-master-question-item" key={question.id}>
        <legend>{question.question}</legend>
        {question.header === undefined ? null : <div className="dsh-master-question-header">{question.header}</div>}
        {question.detail === undefined ? null : <div className="dsh-master-question-detail">{question.detail}</div>}
        {question.options === undefined ? null : (
          <div className="dsh-master-question-options">
            {question.options.map(option => {
              const values = selected[question.id] ?? []
              const checked = values.includes(option.label)
              return (
                <label className="dsh-master-question-option" key={option.label}>
                  <input
                    type={question.multiSelect === true ? 'checkbox' : 'radio'}
                    name={`${request.requestId}-${question.id}`}
                    value={option.label}
                    checked={checked}
                    disabled={props.disabled}
                    onChange={() => {
                      setValidationError(undefined)
                      setSkipped(previous => ({ ...previous, [question.id]: false }))
                      setSelected(previous => {
                        const current = previous[question.id] ?? []
                        return {
                          ...previous,
                          [question.id]: question.multiSelect === true
                            ? current.includes(option.label)
                              ? current.filter(value => value !== option.label)
                              : [...current, option.label]
                            : [option.label],
                        }
                      })
                      if (question.multiSelect !== true && activeIndex < request.questions.length - 1) {
                        setActiveIndex(activeIndex + 1)
                      }
                      if (question.multiSelect !== true) {
                        setCustom(previous => ({ ...previous, [question.id]: '' }))
                      }
                    }}
                  />
                  <span className="dsh-master-question-option-copy">
                    <span>{option.label}</span>
                    {option.description === undefined ? null : (
                      <span className="dsh-master-question-detail">{option.description}</span>
                    )}
                  </span>
                </label>
              )
            })}
          </div>
        )}
        <label className="dsh-master-question-custom">
          <span>{COPY.questionCustom}</span>
          <textarea
            value={custom[question.id] ?? ''}
            disabled={props.disabled}
            rows={2}
            onChange={event => {
              setValidationError(undefined)
              setSkipped(previous => ({ ...previous, [question.id]: false }))
              setCustom(previous => ({ ...previous, [question.id]: event.currentTarget.value }))
              if (question.multiSelect !== true) {
                setSelected(previous => ({ ...previous, [question.id]: [] }))
              }
            }}
          />
        </label>
      </fieldset>
      <div className="dsh-master-question-footer">
        <nav className="dsh-master-question-pager" aria-label={COPY.questionPager}>
          <button
            className="dsh-master-question-previous"
            type="button"
            aria-label={COPY.questionPrevious}
            disabled={props.disabled || activeIndex === 0}
            onClick={() => { setActiveIndex(activeIndex - 1); setValidationError(undefined) }}
          >
            <IconChevronRightOutline14 />
          </button>
          <span>{activeIndex + 1} / {request.questions.length}</span>
          <button
            type="button"
            aria-label={COPY.questionNext}
            disabled={props.disabled || activeIndex === request.questions.length - 1}
            onClick={() => { setActiveIndex(activeIndex + 1); setValidationError(undefined) }}
          >
            <IconChevronRightOutline14 />
          </button>
        </nav>
        {validationError === undefined && props.error === undefined ? null : (
          <div className="dsh-master-question-error" role="alert">
            {validationError ?? props.error}
          </div>
        )}
        <div className="dsh-master-question-actions">
          <button type="button" disabled={props.disabled} onClick={props.onCancel}>{COPY.questionCancel}</button>
          <button type="button" disabled={props.disabled} onClick={skipCurrent}>{COPY.questionSkip}</button>
          <button
            type="submit"
            disabled={props.disabled || skipped[question.id] === true || !answered(question.id)}
          >
            {props.disabled
              ? COPY.questionSubmitting
              : activeIndex === request.questions.length - 1 ? COPY.questionSubmit : COPY.questionNext}
          </button>
        </div>
      </div>
    </form>
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
  const [questionRequests, setQuestionRequests] = useState<readonly MasterPendingQuestionRequest[]>([])
  const [questionCompatibilityFor, setQuestionCompatibilityFor] = useState<{ nodeId: string; sessionId: string } | undefined>()
  const [questionError, setQuestionError] = useState<string | undefined>()
  const [questionActionId, setQuestionActionId] = useState<string | undefined>()
  const logRef = useRef<HTMLDivElement | null>(null)
  const settledQuestions = useRef(new Set<string>())
  const watchQuestions = hasPendingUserQuestion(rows)

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
          setError(undefined)
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
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let unsupported = false
    setQuestionRequests([])
    settledQuestions.current.clear()
    setQuestionCompatibilityFor(undefined)
    setQuestionError(undefined)

    const poll = async (): Promise<void> => {
      try {
        const value = await fetchPendingQuestions(nodeId, sessionId, controller.signal)
        if (controller.signal.aborted) return
        setQuestionRequests(previous => {
          const activeRequests = value.requests.filter(request => !settledQuestions.current.has(request.requestId))
          const unchanged = previous.length === activeRequests.length
            && previous.every((request, index) => request.requestId === activeRequests[index]?.requestId)
          return unchanged ? previous : activeRequests
        })
        setQuestionError(undefined)
      } catch (cause) {
        if (controller.signal.aborted) return
        const code = cause instanceof ApiError ? cause.code : undefined
        if (code === 'node/capability-unavailable' || code === 'coordinator/endpoint-not-found'
          || code === 'coordinator/capability-unavailable') {
          unsupported = true
          if (watchQuestions) setQuestionCompatibilityFor({ nodeId, sessionId })
          setQuestionRequests([])
          return
        }
        if (watchQuestions) {
          setQuestionError(`${COPY.questionLoadFailed}：${cause instanceof Error ? cause.message : String(cause)}`)
        }
      }
      if (!controller.signal.aborted && !unsupported) {
        timer = setTimeout(() => { void poll() }, watchQuestions ? 1_500 : 5_000)
      }
    }

    void poll()
    return () => {
      controller.abort()
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [nodeId, sessionId, watchQuestions])

  useEffect(() => {
    const log = logRef.current
    if (log !== null) log.scrollTop = log.scrollHeight
  }, [rows, streaming, questionRequests])

  const answerQuestion = useCallback((requestId: string, answer: MasterQuestionAnswer): void => {
    setQuestionActionId(requestId)
    setQuestionError(undefined)
    void answerRemoteQuestion(nodeId, sessionId, requestId, answer)
      .then(() => {
        settledQuestions.current.add(requestId)
        setQuestionRequests(previous => previous.filter(request => request.requestId !== requestId))
      })
      .catch((cause: unknown) => {
        setQuestionError(cause instanceof ApiError ? `${cause.code}: ${cause.message}` : String(cause))
      })
      .finally(() => { setQuestionActionId(undefined) })
  }, [nodeId, sessionId])

  const cancelQuestion = useCallback((requestId: string): void => {
    setQuestionActionId(requestId)
    setQuestionError(undefined)
    void cancelRemoteQuestion(nodeId, sessionId, requestId)
      .then(() => {
        settledQuestions.current.add(requestId)
        setQuestionRequests(previous => previous.filter(request => request.requestId !== requestId))
      })
      .catch((cause: unknown) => {
        setQuestionError(cause instanceof ApiError ? `${cause.code}: ${cause.message}` : String(cause))
      })
      .finally(() => { setQuestionActionId(undefined) })
  }, [nodeId, sessionId])

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
          {questionCompatibilityFor?.nodeId === nodeId && questionCompatibilityFor.sessionId === sessionId ? (
            <div className="dsh-master-question-compatibility" role="status">{COPY.questionCompatibility}</div>
          ) : null}
          {questionError === undefined || questionRequests.length > 0 ? null : (
            <div className="dsh-master-question-error" role="alert">{questionError}</div>
          )}
          {unrendered === 0 ? null : (
            <div className="dsh-master-hint">另有 {unrendered} 条事件本版本未渲染（例如思考块、压缩、子代理等）。</div>
          )}
        </div>
      </div>

      {questionRequests.length > 0
        ? questionRequests.map(request => (
          <RemoteQuestionForm
            key={request.requestId}
            request={request}
            disabled={questionActionId !== undefined}
            {...(questionError === undefined ? {} : { error: questionError })}
            onAnswer={answer => { answerQuestion(request.requestId, answer) }}
            onCancel={() => { cancelQuestion(request.requestId) }}
          />
        ))
        : (
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
        )}
    </div>
  )
}
