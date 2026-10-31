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
  IconChevronDownOutlineRegular as IconChevronDownOutline14,
  IconChevronRightOutlineRegular as IconChevronRightOutline14,
  IconSendOutlineRegular as IconSendOutline14,
  IconWarningOutlineRegular as IconWarningOutline16,
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
  fetchArtifacts,
  fetchFileSupport,
  fetchPendingQuestions,
  followSession,
  sendPrompt,
} from './api.js'
import { AttachmentPicker } from './AttachmentPicker.js'
import { ArtifactList, mergeArtifacts } from './ArtifactCard.js'
import { FileChangeCard, TurnChangesCard } from './FileChangeCard.js'
import {
  attachmentIds,
  canSubmit,
  isUncertainPromptFailure,
  newLocalAttachment,
  removeAttachment as removeAttachmentRow,
  selectFiles,
  updateAttachment,
  uploadAttachment,
  type LocalAttachment,
} from './attachments.js'
import { COPY, MARKDOWN_LABELS } from './copy.js'
import { observeConversationWidth } from './conversation-width.js'
import {
  conversationItems,
  hasPendingUserQuestion,
  mergeRows,
  mergeTurnEvents,
  readEvent,
  readSnapshot,
  readStreamFrame,
  type ConversationRow,
  type TurnEvent,
  type TurnGroup,
} from './wire.js'
import type { FileArtifact, FileDescribe } from '../files-protocol.js'
import type { MasterQuestion, MasterQuestionAnswer, MasterPendingQuestionRequest } from '../protocol.js'

/** What the view needs to open one session. */
export interface SessionViewProps {
  readonly nodeId: string
  readonly sessionId: string
  readonly title: string
  /** Whether the deployment enabled sending prompts. */
  readonly promptEnabled: boolean
  /**
   * Test/inspection override for the file-support probe. Production leaves it
   * undefined and the view asks the node when it opens the session.
   */
  readonly fileSupportOverride?: FileSupportState | undefined
}

/** The node's answer to "can this session carry files?". */
export type FileSupportState = 'loading' | 'unsupported' | 'error' | FileDescribe

/** How the follow stream is doing, for the header chip. */
type Phase = 'connecting' | 'live' | 'ended' | 'failed'

/** Describe one row for its role label. */
function roleLabel(row: ConversationRow): string {
  switch (row.kind) {
    case 'user': return COPY.roleUser
    case 'assistant': return COPY.roleAssistant
    case 'reasoning': return '思考过程'
    case 'context': return COPY.contextInjection
    case 'tool-call': return COPY.roleToolCall
    case 'tool-result': return COPY.roleToolResult
    case 'notice': return COPY.roleNotice
  }
}

/**
 * Render one conversation row.
 *
 * Assistant and user bodies go through `MarkdownText`; tool calls follow the Web UI's
 * compact disclosure row and reveal their input/output only when expanded. A
 * `write`/`edit` call that carried structured diffs renders the file-change card
 * instead, so what it changed is visible without opening the raw argument JSON.
 *
 * @param row - the row.
 * @param hideRole - whether the row belongs to a turn's final answer.
 * @param cwd - the session workspace root, used to shorten recorded paths.
 * @returns the row element.
 */
function Row({ row, hideRole = false, cwd }: {
  readonly row: ConversationRow
  readonly hideRole?: boolean
  readonly cwd?: string | undefined
}): ReactElement {
  if (row.kind === 'tool-call' && row.change !== undefined) {
    return <FileChangeCard change={row.change} cwd={cwd} />
  }
  if (row.kind === 'context') {
    return (
      <details className="dsh-master-context">
        <summary>{COPY.contextInjection} · {row.text}</summary>
        {row.detail === undefined ? null : (
          <div className="dsh-master-context-body">
            <MarkdownText text={row.detail} labels={MARKDOWN_LABELS} />
          </div>
        )}
      </details>
    )
  }
  if (row.kind === 'reasoning') {
    return (
      <details className="dsh-master-reasoning">
        <summary>思考过程</summary>
        <MarkdownText text={row.text} labels={MARKDOWN_LABELS} />
      </details>
    )
  }
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
      <div className={row.failed === true ? 'dsh-master-error' : 'dsh-master-notice'}>
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
      {hideRole ? null : <div className="dsh-master-role">
        {roleLabel(row)}
        {row.detail === undefined ? '' : ` ${row.detail}`}
      </div>}
      <div className="dsh-master-text">
        <MarkdownText text={row.text} labels={MARKDOWN_LABELS} />
      </div>
    </div>
  )
}

function TurnProcess({ group, cwd }: { readonly group: TurnGroup; readonly cwd?: string | undefined }): ReactElement {
  const seconds = group.durationMs === undefined ? undefined : Math.max(1, Math.floor(group.durationMs / 1000))
  const label = group.status === 'running' ? '正在处理'
    : group.status === 'error' ? '执行失败'
      : group.status === 'stopped' ? '已中断'
        : group.status === 'unknown' ? '执行记录'
          : seconds === undefined ? '已完成' : `已完成，用时 ${seconds} 秒`
  // A finished turn is a summary line; the process is what it summarizes. While it
  // runs there is nothing else to read yet, so keep the steps in view.
  const showProcess = group.status === 'running' || group.status === 'error' || group.status === 'stopped'
  return (
    <div className="dsh-master-turn-group" data-state={group.status}>
      <details
        key={`${group.key}:${group.status}`}
        className="dsh-master-process"
        open={showProcess}
      >
        <summary className="dsh-master-process-summary">
          {group.status === 'running' ? <StateDot state="ongoing" /> : null}
          <span>{label}</span>
          {group.process.length === 0 ? null : <IconChevronDownOutline14 />}
        </summary>
        <div className="dsh-master-process-body">
          {group.process.length === 0 ? <div className="dsh-master-hint">暂无可展开的过程记录。</div>
            : group.process.map(row => <Row key={row.key} row={row} cwd={cwd} />)}
        </div>
      </details>
      {group.compatibility === undefined ? null : <div className="dsh-master-hint">{group.compatibility}</div>}
      {group.failure === undefined ? null : <div className="dsh-master-error" role="alert">{group.failure}</div>}
      {group.visible.map(row => <Row key={row.key} row={row} cwd={cwd} />)}
      {group.answer.length === 0 ? null : <div className="dsh-master-response" data-turn-answer="">
        {group.answer.map(row => <Row key={row.key} row={row} hideRole cwd={cwd} />)}
      </div>}
      {group.changes === undefined || group.status === 'running' ? null : (
        <TurnChangesCard summary={group.changes} cwd={cwd} />
      )}
    </div>
  )
}

/** Pure transcript surface, also used to verify real event fixtures without starting an agent. */
export function ConversationLog({ rows, events, cwd }: {
  readonly rows: readonly ConversationRow[]
  readonly events: readonly TurnEvent[]
  readonly cwd?: string | undefined
}): ReactElement {
  return <>
    {events.length === 0 && rows.some(row => row.kind === 'assistant') ? (
      <div className="dsh-master-hint">节点未提供回合信息，保留逐条记录。</div>
    ) : null}
    {conversationItems(rows, events).map(item => item.kind === 'turn-group'
      ? <TurnProcess key={item.key} group={item} cwd={cwd} /> : <Row key={item.key} row={item} cwd={cwd} />)}
  </>
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
  const [turnEvents, setTurnEvents] = useState<readonly TurnEvent[]>([])
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
  const [fileSupport, setFileSupport] = useState<FileSupportState>(props.fileSupportOverride ?? 'loading')
  const [attachments, setAttachments] = useState<readonly LocalAttachment[]>([])
  const [attachmentErrors, setAttachmentErrors] = useState<readonly string[]>([])
  const [artifacts, setArtifacts] = useState<readonly FileArtifact[]>([])
  const [artifactError, setArtifactError] = useState<string | undefined>(undefined)
  const [sendUncertain, setSendUncertain] = useState(false)
  const logRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const settledQuestions = useRef(new Set<string>())
  const sessionKey = `${nodeId}\u0000${sessionId}`
  const sessionKeyRef = useRef(sessionKey)
  const uploadControllers = useRef(new Map<string, AbortController>())
  const uploadQueue = useRef<LocalAttachment[]>([])
  const activeUploads = useRef(0)
  useEffect(() => {
    const element = bodyRef.current
    if (element !== null) return observeConversationWidth(element)
  }, [])
  const watchQuestions = hasPendingUserQuestion(rows)

  /** Stop one upload and remove it from the pending queue. */
  const abortUploadFor = useCallback((localId: string): void => {
    uploadControllers.current.get(localId)?.abort()
    uploadControllers.current.delete(localId)
    uploadQueue.current = uploadQueue.current.filter(entry => entry.localId !== localId)
  }, [])

  /** Stop every upload owned by this view instance. */
  const abortAllUploads = useCallback((): void => {
    for (const controller of uploadControllers.current.values()) controller.abort()
    uploadControllers.current.clear()
    uploadQueue.current = []
    activeUploads.current = 0
  }, [])

  useEffect(() => {
    sessionKeyRef.current = sessionKey
    setAttachments([])
    setAttachmentErrors([])
    setArtifacts([])
    setArtifactError(undefined)
    setSendUncertain(false)
    abortAllUploads()

    const override = props.fileSupportOverride
    if (override !== undefined) {
      setFileSupport(override)
      return () => { abortAllUploads() }
    }

    const controller = new AbortController()
    setFileSupport('loading')
    void fetchFileSupport(nodeId, sessionId, controller.signal)
      .then((describe) => {
        if (!controller.signal.aborted) setFileSupport(describe)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        const code = cause instanceof ApiError ? cause.code : undefined
        const unsupported = code === 'coordinator/capability-unavailable'
          || code === 'node/capability-unavailable'
          || code === 'coordinator/endpoint-not-found'
          || code === 'coordinator/capability-mismatch'
        setFileSupport(unsupported ? 'unsupported' : 'error')
      })
    return () => {
      controller.abort()
      abortAllUploads()
    }
  }, [nodeId, sessionId, sessionKey, props.fileSupportOverride, abortAllUploads])

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setInterval> | undefined

    const load = async (): Promise<void> => {
      try {
        const value = await fetchArtifacts(nodeId, sessionId, controller.signal)
        if (controller.signal.aborted) return
        setArtifacts(previous => mergeArtifacts(previous, value.artifacts))
        setArtifactError(undefined)
      } catch (cause) {
        if (controller.signal.aborted) return
        // A session without the capability simply has no artifacts; anything
        // else is worth showing once, next to the cards.
        const code = cause instanceof ApiError ? cause.code : undefined
        if (code !== 'coordinator/capability-unavailable' && code !== 'node/capability-unavailable') {
          setArtifactError(`${COPY.artifactLoadFailed}：${cause instanceof Error ? cause.message : String(cause)}`)
        }
      }
    }

    const stop = (): void => {
      if (timer !== undefined) {
        clearInterval(timer)
        timer = undefined
      }
    }
    const start = (): void => {
      if (timer !== undefined) return
      void load()
      timer = setInterval(() => {
        if (!document.hidden) void load()
      }, 3_000)
    }
    const onVisibility = (): void => {
      if (document.hidden) stop()
      else if (streaming) start()
    }

    if (streaming) start()
    else void load()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      controller.abort()
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [nodeId, sessionId, streaming, phase])

  useEffect(() => {
    const controller = new AbortController()
    setRows([])
    setTurnEvents([])
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
            setTurnEvents(snapshot.turnEvents)
            setUnrendered(snapshot.unrendered)
            setHasMore(snapshot.hasMore)
            setCwd(snapshot.cwd)
            return
          }
          const contribution = readEvent(record.value)
          if (contribution !== undefined) {
            setRows(previous => mergeRows(previous, contribution.rows))
            setTurnEvents(previous => mergeTurnEvents(previous, contribution.turnEvents))
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

  const startUploadRef = useRef<(entry: LocalAttachment) => void>(() => undefined)

  const startUpload = useCallback((entry: LocalAttachment): void => {
    if (typeof fileSupport !== 'object') return
    if (sessionKeyRef.current !== `${entry.nodeId}\u0000${entry.sessionId}`) return
    if (activeUploads.current >= 2) {
      uploadQueue.current.push(entry)
      return
    }
    activeUploads.current += 1
    const controller = new AbortController()
    uploadControllers.current.set(entry.localId, controller)
    setAttachments(previous => updateAttachment(previous, entry.localId, { status: 'uploading' }))
    void uploadAttachment(entry.nodeId, entry.sessionId, entry.file, {
      limits: fileSupport.limits,
      signal: controller.signal,
      onProgress: (received) => {
        if (sessionKeyRef.current !== sessionKey) return
        setAttachments(previous => updateAttachment(previous, entry.localId, { received }))
      },
    })
      .then((record) => {
        if (sessionKeyRef.current !== sessionKey) return
        setAttachments(previous => updateAttachment(previous, entry.localId, {
          status: 'ready',
          received: record.size,
          attachment: record,
        }))
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || sessionKeyRef.current !== sessionKey) return
        setAttachments(previous => updateAttachment(previous, entry.localId, {
          status: 'failed',
          error: cause instanceof ApiError ? `${cause.code}: ${cause.message}` : String(cause),
        }))
      })
      .finally(() => {
        activeUploads.current = Math.max(0, activeUploads.current - 1)
        uploadControllers.current.delete(entry.localId)
        const next = uploadQueue.current.shift()
        if (next !== undefined) startUploadRef.current(next)
      })
  }, [fileSupport, sessionKey])
  startUploadRef.current = startUpload

  const handleSelect = useCallback((files: readonly File[]): void => {
    if (typeof fileSupport !== 'object') return
    const { accepted, rejected } = selectFiles(files, attachments.length, fileSupport.limits)
    setAttachmentErrors(rejected.map(row => `${row.name}：${row.reason}`))
    if (accepted.length === 0) return
    const entries = accepted.map(file => newLocalAttachment(nodeId, sessionId, file))
    setAttachments(previous => [...previous, ...entries])
    for (const entry of entries) startUpload(entry)
  }, [attachments.length, fileSupport, nodeId, sessionId, startUpload])

  const handleRemove = useCallback((localId: string): void => {
    abortUploadFor(localId)
    setAttachments(previous => removeAttachmentRow(previous, localId))
    setAttachmentErrors([])
  }, [abortUploadFor])

  const handleRetry = useCallback((localId: string): void => {
    const entry = attachments.find(attachment => attachment.localId === localId)
    if (entry === undefined) return
    const retried: LocalAttachment = { ...entry, status: 'selected', received: 0, error: undefined }
    setAttachments(previous => updateAttachment(previous, localId, {
      status: 'selected',
      received: 0,
      error: undefined,
    }))
    startUpload(retried)
  }, [attachments, startUpload])

  const submit = useCallback((): void => {
    const text = draft.trim()
    if (text === '' || sending || sendUncertain || !promptEnabled) return
    const ids = attachmentIds(attachments)
    if (attachments.length > 0 && (ids.length !== attachments.length || !attachments.every(row => row.status === 'ready'))) {
      setError(COPY.attachmentNeedReady)
      return
    }
    const key = sessionKeyRef.current
    setSending(true)
    setError(undefined)
    setSendUncertain(false)
    void sendPrompt(nodeId, sessionId, text, mode, undefined, ids.length === 0 ? undefined : ids)
      .then(() => {
        if (sessionKeyRef.current !== key) return
        setDraft('')
        setAttachments([])
        setAttachmentErrors([])
      })
      .catch((cause: unknown) => {
        if (sessionKeyRef.current !== key) return
        if (!isUncertainPromptFailure(cause)) {
          // A known pre-dispatch refusal is safe to correct and retry.
          setError(`${cause instanceof ApiError ? cause.code : 'master/refused'}: ${cause instanceof Error ? cause.message : String(cause)}`)
        } else {
          // The response never arrived. Re-sending could run the turn twice.
          setSendUncertain(true)
          setError(COPY.sendUncertain)
        }
      })
      .finally(() => {
        if (sessionKeyRef.current === key) setSending(false)
      })
  }, [attachments, draft, mode, nodeId, sending, sessionId, sendUncertain, promptEnabled])

  const attachmentsUsable = typeof fileSupport === 'object'
  const attachmentLimit = attachmentsUsable
    ? fileSupport.limits.maxAttachmentsPerMessage
    : 5
  const attachmentDisabledReason = !promptEnabled
    ? COPY.attachmentUploadDisabled
    : fileSupport === 'unsupported'
      ? COPY.attachmentUnsupported
      : fileSupport === 'loading'
        ? COPY.attachmentUnavailable
        : fileSupport === 'error'
          ? COPY.attachmentUnavailable
          : attachments.length >= attachmentLimit ? COPY.attachmentLimit : undefined
  const sendEnabled = promptEnabled
    && !sending
    && (attachments.length === 0 || attachmentsUsable)
    && canSubmit(draft, attachments, promptEnabled, sendUncertain)

  const phaseText = streaming
    ? COPY.streaming
    : phase === 'live' ? COPY.live
      : phase === 'ended' ? COPY.ended
        : phase === 'failed' ? COPY.failed
          : COPY.connecting

  return (
    <div className="dsh-master-body" ref={bodyRef}>
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
          {rows.length === 0 && turnEvents.length === 0
            ? <div className="dsh-master-hint">{COPY.emptyConversation}</div>
            : <ConversationLog rows={rows} events={turnEvents} cwd={cwd} />}
          {questionCompatibilityFor?.nodeId === nodeId && questionCompatibilityFor.sessionId === sessionId ? (
            <div className="dsh-master-question-compatibility" role="status">{COPY.questionCompatibility}</div>
          ) : null}
          {questionError === undefined || questionRequests.length > 0 ? null : (
            <div className="dsh-master-question-error" role="alert">{questionError}</div>
          )}
          {unrendered === 0 ? null : (
            <div className="dsh-master-hint">另有 {unrendered} 条事件本版本未渲染（例如压缩、子代理等）。</div>
          )}
        </div>
      </div>

      <ArtifactList
        artifacts={artifacts}
        nodeId={nodeId}
        sessionId={sessionId}
        deliveryTool={typeof fileSupport === 'object' ? fileSupport.deliveryTool
          : fileSupport === 'unsupported' ? 'unavailable' : undefined}
      />
      {artifactError === undefined ? null : <div className="dsh-master-error">{artifactError}</div>}

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
            {sendUncertain ? (
              <button
                type="button"
                className="dsh-master-toolbar-select"
                onClick={() => { setSendUncertain(false); setError(undefined) }}
              >
                {COPY.confirmPromptRetry}
              </button>
            ) : null}
            {fileSupport === 'unsupported' ? (
              <div className="dsh-master-hint" role="status">{COPY.attachmentUnsupported}</div>
            ) : null}
            {fileSupport === 'error' ? (
              <div className="dsh-master-hint" role="status">{COPY.attachmentCheckFailed}</div>
            ) : null}
            {attachmentErrors.length === 0 ? null : (
              <div className="dsh-master-attachment-errors" role="alert">
                <span>{COPY.attachmentRejected}</span>
                <ul>
                  {attachmentErrors.map(error => <li key={error}>{error}</li>)}
                </ul>
              </div>
            )}
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
                <AttachmentPicker
                  attachments={attachments}
                  disabled={!attachmentsUsable || !promptEnabled}
                  disabledReason={attachmentDisabledReason}
                  canAdd={attachments.length < attachmentLimit}
                  onSelect={handleSelect}
                  onRemove={handleRemove}
                  onRetry={handleRetry}
                />
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
                  disabled={!sendEnabled}
                  onClick={submit}
                />
              </div>
            </div>
          </div>
        )}
    </div>
  )
}
