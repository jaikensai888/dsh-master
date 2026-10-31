/**
 * Turn the node's session frames into something a panel can draw.
 *
 * This module is **pure** — no React, no fetch — for one reason: the wire is produced
 * by a DSH version that is not necessarily ours, so the parsing is where a version
 * skew would go wrong, and it is the part worth testing without a browser. Everything
 * here reads defensively and reports what it could not read rather than throwing;
 * a conversation that silently drops a row is worse than one that admits to it.
 *
 * Token-level `assistant-stream` chunks remain provider-shaped: show a generation
 * indicator and wait for durable `assistant/message` instead of guessing deltas.
 * Reasoning blocks remain separate from response text. Turn/step facts determine
 * process grouping; message wording is never used to identify a final answer.
 *
 * File changes are recognised the same way the shipped client recognises them: from
 * the tool name, the **original** argument string, the settled result status and
 * `data.meta.diffs` — never from paths mentioned in prose, and never from the
 * truncated argument preview kept for display. {@link ./file-changes} owns those rules.
 *
 * @module dsh-master/client/wire
 */

import {
  intentChange,
  readResultDiffs,
  settleChange,
  turnChanges,
  type FileChange,
  type FileChangeSummary,
  type ResultDiffs,
} from './file-changes.js'

/** One line in the remote conversation. */
export interface ConversationRow {
  /** Stable React key; tool lifecycle rows use callId so results update their call. */
  readonly key: string
  /**
   * `context` is a message DSH injected on its own (`time-context`, `agent-instructions`,
   * …). It is logged with `role: user`, but it is not something the human typed, so it
   * must neither look like a user bubble nor split the turn it belongs to.
   */
  readonly kind: 'user' | 'assistant' | 'reasoning' | 'tool-call' | 'tool-result' | 'notice' | 'context'
  /** The line's main text. */
  readonly text: string
  /** Secondary text — tool arguments, a note. */
  readonly detail?: string
  /** Tool output, joined to its call by call id. */
  readonly output?: string
  /** Set on a failed tool result, so the panel can mark it without parsing text. */
  readonly failed?: boolean
  /**
   * Structured file change for a supported `write`/`edit` call, derived from the raw
   * arguments while it runs and from `meta.diffs` once it settles. Absent for every
   * other tool, for an unreadable call, and for a settled edit that published no
   * hunks — those keep the generic tool row rather than inventing a diff.
   */
  readonly change?: FileChange
  /**
   * Narrowed `meta.diffs` of a settled result, kept only on the transient
   * `tool/result` row so {@link mergeRows} can resolve it against its call.
   */
  readonly resultDiffs?: ResultDiffs
}

/** What one opening `snapshot` frame tells the panel. */
export interface SnapshotView {
  readonly cwd?: string
  readonly title?: string
  readonly rows: readonly ConversationRow[]
  readonly turnEvents: readonly TurnEvent[]
  /** Events in the window this module could not render. */
  readonly unrendered: number
  /** Whether the node holds older records the panel has not asked for. */
  readonly hasMore: boolean
}

/** What one appended frame contributes. */
export interface EventContribution {
  readonly rows: readonly ConversationRow[]
  readonly turnEvents: readonly TurnEvent[]
  readonly unrendered: number
}

/** Narrow an unknown JSON value to a plain record. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Read a string field, or `undefined`. */
function str(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' ? value : undefined
}

/** Read a finite number field, or `undefined`. */
function num(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Collapse whitespace runs so a preview stays one line. */
export function inline(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

/** Cut a string to a preview length, marking the cut. */
export function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

/**
 * Extract the readable text of one content block.
 *
 * Text and reasoning blocks carry `text`; a tool-result block carries its own nested
 * content. Anything else is summarized as JSON rather than dropped, because a block
 * this version does not know is still something that happened.
 *
 * @param block - one entry of a message's `content`.
 * @returns the block's text, or `undefined` when it carries none.
 */
function blockText(block: unknown): string | undefined {
  const record = asRecord(block)
  if (record === undefined) return typeof block === 'string' ? block : undefined
  const type = str(record, 'type')
  if (type === 'tool-call') return undefined
  const text = str(record, 'text')
  if ((type === 'text' || type === 'reasoning') && text !== undefined) return text
  const nested = record['content']
  if (typeof nested === 'string') return nested
  if (Array.isArray(nested)) {
    const parts = nested.map(entry => blockText(entry)).filter((entry): entry is string => entry !== undefined)
    if (parts.length > 0) return parts.join('\n')
  }
  if (type === 'image') return '[image]'
  // Unknown block: keep the fact, not a guess at its meaning.
  return JSON.stringify(record)
}

/**
 * Join the readable text of a message's content blocks.
 * @param message - a message record.
 * @returns the joined text, or `undefined` when there is none.
 */
function messageText(message: unknown, excludeReasoning = false): string | undefined {
  const record = asRecord(message)
  const content = record?.['content']
  if (!Array.isArray(content)) return undefined
  const parts = content.filter(entry => !excludeReasoning || asRecord(entry)?.['type'] !== 'reasoning')
    .map(entry => blockText(entry)).filter((entry): entry is string => entry !== undefined)
  if (parts.length === 0) return undefined
  return parts.join('\n\n')
}

/**
 * Describe one tool result.
 *
 * A failed result reports the error's own name and code when the node sent them, and
 * falls back to the message body otherwise. Both are shown: the code is what a reader
 * acts on, the body is what explains it.
 *
 * @param data - the `tool/result` event data.
 * @returns the summary and whether it failed.
 */
function toolResult(data: Record<string, unknown>): { text: string; failed: boolean } {
  const error = asRecord(data['error'])
  const body = messageText(data['message']) ?? ''
  if (error !== undefined) {
    const name = str(error, 'name') ?? 'error'
    const code = str(error, 'code')
    const label = code === undefined ? name : `${name} (${code})`
    return { text: body === '' ? label : `${label}\n${body}`, failed: true }
  }
  return { text: body === '' ? '(no output)' : body, failed: asRecord(data['message'])?.['isError'] === true }
}

/** Call ids appear directly on calls and on the source of their result message. */
function toolCallId(data: Record<string, unknown>): string | undefined {
  const message = asRecord(data['message'])
  const source = asRecord(message?.['source'])
  const id = str(data, 'callId') ?? (source === undefined ? undefined : str(source, 'callId'))
  return id === '' ? undefined : id
}

/** Join one string field of a source's member list, as the official injection row does. */
function joinField(source: Record<string, unknown>, member: string, field: string): string | undefined {
  const list = source[member]
  if (!Array.isArray(list)) return undefined
  const values = list
    .map(entry => str(asRecord(entry) ?? {}, field))
    .filter((value): value is string => value !== undefined && value !== '')
  return values.length === 0 ? undefined : [...new Set(values)].join('、')
}

/**
 * Classify a logged user-role message by who produced it.
 *
 * DSH writes the context it injects on its own — the per-turn time sample, an
 * `AGENTS.md` refresh, a skill catalog, a recalled session — to the same
 * `user/message` event as typed input; only `source.kind === 'user'` is the human.
 * An absent source stays "typed" so a node too old to send one renders as before.
 *
 * @param data - the `user/message` event data.
 * @returns the injected producer and its label, or `undefined` for typed input.
 */
function injectedSource(data: Record<string, unknown>): { kind: string; label?: string } | undefined {
  const source = asRecord(data['source'])
  const kind = source === undefined ? undefined : str(source, 'kind')
  if (source === undefined || kind === undefined || kind === 'user') return undefined
  const label = kind === 'agent-instructions' ? joinField(source, 'changes', 'path')
    : kind === 'skill-invocation' ? str(source, 'name')
      : kind === 'session-reference' ? joinField(source, 'references', 'label')
        : kind === 'time-context' ? '时间上下文'
          : undefined
  return { kind, ...(label === undefined || label === '' ? {} : { label }) }
}

/**
 * Build the row for one `SessionWireEvent`.
 *
 * @param event - a `SessionWireEvent`.
 * @returns the row, or `undefined` when this event has nothing to draw.
 */
function rowOf(event: Record<string, unknown>): ConversationRow | undefined {
  const type = str(event, 'type')
  const seq = num(event, 'seq') ?? 0
  const data = asRecord(event['data'])
  if (type === undefined || data === undefined) return undefined
  const key = `${type}:${String(seq)}`

  switch (type) {
    case 'user/message': {
      const text = messageText(data) ?? ''
      const injected = injectedSource(data)
      if (injected !== undefined) {
        return {
          key,
          kind: 'context',
          text: injected.label ?? injected.kind,
          ...(text.trim() === '' ? {} : { detail: text }),
        }
      }
      if (text.trim() === '') return undefined
      return { key, kind: 'user', text }
    }
    case 'assistant/message': {
      const text = messageText(data['message'], true)
      if (text === undefined || text.trim() === '') return undefined
      const interrupted = data['interrupted'] === true
      return {
        key,
        kind: 'assistant',
        text,
        ...(interrupted ? { detail: '（已中断）' } : {}),
      }
    }
    case 'tool/call': {
      const name = str(data, 'name') ?? 'tool'
      const args = str(data, 'arguments')
      const callId = toolCallId(data)
      // The preview is truncated for display; the change is parsed from the original
      // string, which is exactly what a long `write` argument exceeds.
      const change = args === undefined ? undefined : intentChange(name, args)
      return {
        key: callId === undefined ? key : `tool-call:${callId}`,
        kind: 'tool-call',
        text: name,
        ...(change === undefined ? {} : { change }),
        ...(args === undefined || args.trim() === '' ? {} : { detail: truncate(args, 800) }),
      }
    }
    case 'tool/result': {
      const result = toolResult(data)
      const callId = toolCallId(data)
      const resultDiffs = readResultDiffs(data['meta'])
      return {
        key: callId === undefined ? key : `tool-call:${callId}`,
        kind: 'tool-result',
        text: truncate(result.text, 4000),
        ...(result.failed ? { failed: true } : {}),
        ...(resultDiffs === undefined ? {} : { resultDiffs }),
      }
    }
    case 'approval/asked': {
      const tool = str(data, 'toolName') ?? 'a tool'
      const reason = str(data, 'reason')
      return {
        key,
        kind: 'notice',
        text: `等待授权：${tool}`,
        ...(reason === undefined ? {} : { detail: reason }),
      }
    }
    case 'approval/decided': {
      return { key, kind: 'notice', text: `授权结果：${str(data, 'outcome') ?? 'unknown'}` }
    }
    case 'command/run': {
      const name = str(data, 'name') ?? 'command'
      const args = str(data, 'args')
      return {
        key,
        kind: 'notice',
        text: `/${name}`,
        ...(args === undefined || args.trim() === '' ? {} : { detail: args }),
      }
    }
    default:
      return undefined
  }
}

/**
 * Read the opening `snapshot` frame of a follow stream.
 *
 * @param value - one `data` record's value.
 * @returns the snapshot view, or `undefined` when this value is not a snapshot.
 */
export function readSnapshot(value: unknown): SnapshotView | undefined {
  const record = asRecord(value)
  if (record === undefined || str(record, 'type') !== 'snapshot') return undefined
  const header = asRecord(record['header'])
  const records = record['records']
  const rows: ConversationRow[] = []
  const turnEvents: TurnEvent[] = []
  let unrendered = 0
  if (Array.isArray(records)) {
    for (const entry of records) {
      const contribution = contributionOf(entry)
      rows.push(...contribution.rows)
      turnEvents.push(...contribution.turnEvents)
      unrendered += contribution.unrendered
    }
  }
  const projections = asRecord(record['projections'])
  const values = asRecord(projections?.['values'])
  const title = values === undefined ? undefined : str(values, 'title')
  const cwd = header === undefined ? undefined : str(header, 'cwd')
  return {
    rows: mergeRows([], rows),
    turnEvents: mergeTurnEvents([], turnEvents),
    unrendered,
    hasMore: record['hasMore'] === true,
    ...(title === undefined || title.trim() === '' ? {} : { title }),
    ...(cwd === undefined || cwd.trim() === '' ? {} : { cwd }),
  }
}

/**
 * Turn a history record or live entry into rows.
 *
 * Both forms are `{type:'event', event}` envelopes, so one reader covers the snapshot
 * window and the live tail — which is what keeps a row from changing shape once the
 * conversation moves from replay to streaming.
 *
 * @param entry - a `SessionEventEntry`.
 * @returns the rows it contributes, plus a count when it contributes none.
 */
function contributionOf(entry: unknown): EventContribution {
  const record = asRecord(entry)
  if (record === undefined || str(record, 'type') !== 'event') return { rows: [], turnEvents: [], unrendered: 1 }
  const event = asRecord(record['event'])
  if (event === undefined) return { rows: [], turnEvents: [], unrendered: 1 }
  const row = rowOf(event)
  const rows: ConversationRow[] = []
  if (event['type'] === 'assistant/message') {
    const content = asRecord(asRecord(event['data'])?.['message'])?.['content']
    if (Array.isArray(content)) {
      const reasoning = content.filter(block => asRecord(block)?.['type'] === 'reasoning')
        .map(blockText).filter((text): text is string => text !== undefined && text.trim() !== '').join('\n\n')
      if (reasoning !== '') rows.push({ key: `reasoning:${String(event['seq'])}`, kind: 'reasoning', text: reasoning })
    }
  }
  if (row !== undefined) rows.push(row)
  const fact = turnEvent(event, rows)
  return {
    rows,
    turnEvents: fact === undefined ? [] : [fact],
    unrendered: rows.length > 0 || toolCallOnlyAssistant(event)
      || fact !== undefined && ['turn/start', 'turn/end', 'step/start', 'step/end'].includes(String(event['type'])) ? 0 : 1,
  }
}

/** Only placement and lifecycle facts, kept apart from the rendered text. */
export interface TurnEvent {
  readonly seq: number
  readonly type: string
  readonly turn: number
  readonly step?: number
  readonly time?: number
  readonly rowKeys: readonly string[]
  readonly replyKeys: readonly string[]
  readonly hasToolCalls: boolean
  readonly interrupted: boolean
  readonly reason?: string
  readonly failure?: string
}

function turnEvent(event: Record<string, unknown>, rows: readonly ConversationRow[]): TurnEvent | undefined {
  const data = asRecord(event['data'])
  const turn = data === undefined ? undefined : num(data, 'turn')
  const seq = num(event, 'seq')
  if (data === undefined || turn === undefined || seq === undefined) return undefined
  const type = str(event, 'type') ?? ''
  const content = asRecord(data['message'])?.['content']
  const reason = asRecord(data['reason'])
  const failure = asRecord(reason?.['error'])
  const step = num(data, 'step')
  const time = num(event, 'time')
  const reasonKind = reason === undefined ? undefined : str(reason, 'kind')
  const failureText = failure === undefined ? undefined : str(failure, 'message')
  return {
    seq, type, turn,
    ...(step === undefined ? {} : { step }),
    ...(time === undefined ? {} : { time }),
    rowKeys: rows.map(row => row.key),
    replyKeys: rows.filter(row => row.kind === 'assistant').map(row => row.key),
    hasToolCalls: type === 'tool/call' || Array.isArray(content) && content.some(block => asRecord(block)?.['type'] === 'tool-call'),
    interrupted: data['interrupted'] === true,
    ...(reasonKind === undefined ? {} : { reason: reasonKind }),
    ...(failureText === undefined ? {} : { failure: failureText }),
  }
}

export function mergeTurnEvents(previous: readonly TurnEvent[], incoming: readonly TurnEvent[]): TurnEvent[] {
  return [...new Map([...previous, ...incoming].map(event => [event.seq, event])).values()].sort((a, b) => a.seq - b.seq)
}

export interface TurnGroup {
  readonly kind: 'turn-group'
  readonly key: string
  readonly status: 'running' | 'completed' | 'error' | 'stopped' | 'unknown'
  readonly process: readonly ConversationRow[]
  readonly answer: readonly ConversationRow[]
  readonly visible: readonly ConversationRow[]
  /** Distinct files this turn applied changes to, or absent when it changed none. */
  readonly changes?: FileChangeSummary
  readonly durationMs?: number
  readonly failure?: string
  readonly compatibility?: string
}

/** Mirrors official latestAnswer: only the latest step without tool calls can answer a completed turn. */
export function conversationItems(rows: readonly ConversationRow[], events: readonly TurnEvent[]): (ConversationRow | TurnGroup)[] {
  const turns = new Map<number, TurnEvent[]>()
  const rowTurns = new Map<string, number>()
  for (const event of events) {
    const members = turns.get(event.turn) ?? []
    members.push(event)
    turns.set(event.turn, members)
    for (const key of event.rowKeys) rowTurns.set(key, event.turn)
  }
  const groups = new Map<number, TurnGroup>()
  for (const [turn, facts] of turns) {
    const start = facts.find(event => event.type === 'turn/start')
    const end = [...facts].reverse().find(event => event.type === 'turn/end')
    const status: TurnGroup['status'] = end === undefined ? start === undefined ? 'unknown' : 'running'
      : end.reason === 'completed' ? 'completed' : end.reason === 'error' ? 'error'
        : end.reason === 'aborted' || end.reason === 'interrupted' ? 'stopped' : 'unknown'
    const members = rows.filter(row => row.kind !== 'user' && rowTurns.get(row.key) === turn)
    const lastStep = Math.max(...facts.map(event => event.step ?? -1))
    const lastReply = [...facts].reverse().find(event => event.type === 'assistant/message' && event.step === lastStep)
    const incomplete = facts.some(event => ['assistant/message', 'tool/call', 'tool/result'].includes(event.type) && event.step === undefined)
    const canAnswer = status === 'completed' && !incomplete && lastReply !== undefined && !lastReply.interrupted
      && !facts.some(event => event.step === lastStep && event.hasToolCalls)
    const answerKeys = new Set(canAnswer ? lastReply.replyKeys : [])
    const visible = members.filter(row => status === 'unknown' || incomplete || row.failed === true || row.kind === 'notice'
      || row.kind === 'tool-call' && row.text === 'ask_user_question' && row.output === undefined)
    const visibleKeys = new Set(visible.map(row => row.key))
    const durationMs = start?.time !== undefined && end?.time !== undefined && end.time >= start.time ? end.time - start.time : undefined
    const changes = turnChanges(turn, members.flatMap(row => row.change === undefined ? [] : [row.change]))
    groups.set(turn, {
      kind: 'turn-group', key: `turn:${turn}`, status,
      process: members.filter(row => !answerKeys.has(row.key) && !visibleKeys.has(row.key)),
      answer: members.filter(row => answerKeys.has(row.key) && !visibleKeys.has(row.key)),
      visible,
      ...(changes === undefined ? {} : { changes }),
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(end?.failure === undefined ? {} : { failure: end.failure }),
      ...(incomplete || status === 'unknown' ? { compatibility: '回合或步骤信息不完整，保留逐条记录。' } : {}),
    })
  }
  const items: (ConversationRow | TurnGroup)[] = []
  const emitted = new Set<number>()
  // A steer can insert a user message within a turn. Preserve chronology instead of
  // moving the later answer ahead of that input by folding the whole range at once.
  const interleaved = new Map<number, number>()
  for (const turn of turns.keys()) {
    const indexes = rows.flatMap((row, index) => row.kind !== 'user' && rowTurns.get(row.key) === turn ? [index] : [])
    const first = indexes[0]
    const last = indexes[indexes.length - 1]
    if (first !== undefined && last !== undefined && rows.slice(first, last).some(row => row.kind === 'user')) interleaved.set(turn, last)
  }
  for (const [index, row] of rows.entries()) {
    const turn = rowTurns.get(row.key)
    if (row.kind === 'user' || turn === undefined) { items.push(row); continue }
    if (interleaved.has(turn)) {
      if (!emitted.has(turn)) items.push({ key: `turn:${turn}:order`, kind: 'notice', text: '本回合含追加消息，按原始事件顺序显示。' })
      emitted.add(turn)
      items.push(row)
      const failure = groups.get(turn)?.failure
      if (index === interleaved.get(turn) && failure !== undefined) items.push({ key: `turn:${turn}:error`, kind: 'notice', text: `执行失败：${failure}`, failed: true })
      continue
    }
    if (!emitted.has(turn)) {
      const group = groups.get(turn)
      if (group !== undefined) items.push(group)
      emitted.add(turn)
    }
  }
  for (const [turn, group] of groups) {
    if (!emitted.has(turn) && (group.status !== 'unknown' || group.failure !== undefined)) items.push(group)
  }
  return items
}

/** The official chat view renders these blocks from the corresponding tool events. */
function toolCallOnlyAssistant(event: Record<string, unknown>): boolean {
  if (str(event, 'type') !== 'assistant/message') return false
  const data = asRecord(event['data'])
  const message = asRecord(data?.['message'])
  const content = message?.['content']
  return Array.isArray(content) && content.length > 0
    && content.every(block => str(asRecord(block) ?? {}, 'type') === 'tool-call')
}

/** Drop the transient file-change fields, keeping everything the row displays. */
function withoutChange(row: ConversationRow): ConversationRow {
  if (row.change === undefined && row.resultDiffs === undefined) return row
  const { change: _change, resultDiffs: _resultDiffs, ...rest } = row
  return rest
}

/**
 * Join a call row with its settled result row.
 *
 * The call owns the tool name and the model-facing path; the result owns the applied
 * hunks and the failure flag. Only an `intent` change is resolved here, so replaying
 * or duplicating a result frame cannot turn an already applied or already discarded
 * diff back into a running intention.
 */
function settleRow(call: ConversationRow, result: ConversationRow): ConversationRow {
  const settled: ConversationRow = {
    ...withoutChange(call),
    output: result.text,
    ...(result.failed === true ? { failed: true } : {}),
  }
  if (result.failed === true || call.change === undefined) return settled
  const change = call.change.phase === 'intent' ? settleChange(call.change, result.resultDiffs) : call.change
  return change === undefined ? settled : { ...settled, change }
}

/** Append rows while folding a tool result into its matching call row. */
export function mergeRows(previous: readonly ConversationRow[], incoming: readonly ConversationRow[]): ConversationRow[] {
  const rows = [...previous]
  const positions = new Map(rows.map((row, index) => [row.key, index]))
  for (const next of incoming) {
    const index = positions.get(next.key)
    if (index === undefined) {
      rows.push(next)
      positions.set(next.key, rows.length - 1)
      continue
    }
    const current = rows[index]
    if (current?.kind === 'tool-call' && next.kind === 'tool-result') {
      rows[index] = settleRow(current, next)
    } else if (current?.kind === 'tool-result' && next.kind === 'tool-call') {
      rows[index] = settleRow(next, current)
    } else if (current !== undefined && current.kind === next.kind && next.kind === 'tool-call') {
      // A repeated call frame must not erase what the earlier one already learned: a
      // second replay of the same history would otherwise drop the settled output and
      // re-open the change card as a running intention.
      rows[index] = {
        ...next,
        ...(current.output === undefined ? {} : { output: current.output }),
        ...(current.failed === true ? { failed: true } : {}),
        ...(current.output === undefined || current.change === undefined ? {} : { change: current.change }),
      }
    } else if (current !== undefined && current.kind === next.kind && next.kind === 'tool-result') {
      rows[index] = {
        ...next,
        ...(next.failed === true || current.failed === true ? { failed: true } : {}),
        ...(next.resultDiffs === undefined && current.resultDiffs !== undefined
          ? { resultDiffs: current.resultDiffs } : {}),
      }
    } else {
      rows[index] = next
    }
  }
  return rows
}

/** Whether the session history still contains an unanswered `ask_user_question` call. */
export function hasPendingUserQuestion(rows: readonly ConversationRow[]): boolean {
  return rows.some(row => row.kind === 'tool-call' && row.text === 'ask_user_question' && row.output === undefined)
}

/**
 * Read one appended follow frame.
 *
 * @param value - one `data` record's value.
 * @returns the rows it contributes, or `undefined` when it is not an event frame.
 */
export function readEvent(value: unknown): EventContribution | undefined {
  const record = asRecord(value)
  if (record === undefined || str(record, 'type') !== 'event') return undefined
  return contributionOf(record)
}

/**
 * Classify one `assistant-stream` frame.
 *
 * The chunk payload is not interpreted — see the module note. What the panel needs is
 * only whether output is currently arriving, which `start`/`chunk` say and `end`
 * settles.
 *
 * @param value - one `data` record's value.
 * @returns `'started'` or `'settled'`, or `undefined` when this is not a stream frame.
 */
export function readStreamFrame(value: unknown): 'started' | 'settled' | undefined {
  const record = asRecord(value)
  if (record === undefined || str(record, 'type') !== 'assistant-stream') return undefined
  const frame = asRecord(record['frame'])
  const kind = frame === undefined ? undefined : str(frame, 'type')
  if (kind === 'start' || kind === 'chunk') return 'started'
  if (kind === 'end') return 'settled'
  return undefined
}
