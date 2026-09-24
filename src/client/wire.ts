/**
 * Turn the node's session frames into something a panel can draw.
 *
 * This module is **pure** — no React, no fetch — for one reason: the wire is produced
 * by a DSH version that is not necessarily ours, so the parsing is where a version
 * skew would go wrong, and it is the part worth testing without a browser. Everything
 * here reads defensively and reports what it could not read rather than throwing;
 * a conversation that silently drops a row is worse than one that admits to it.
 *
 * Two shapes are deliberately **not** interpreted:
 *
 * - token-level `assistant-stream` chunks, whose `chunk` payload is provider-shaped —
 *   the panel shows an "in progress" state and waits for the durable
 *   `assistant/message` event instead of guessing at a provider's delta format;
 * - reasoning blocks, which are shown as their own row only when they carry text.
 *
 * @module dsh-master/client/wire
 */

/** One line in the remote conversation. */
export interface ConversationRow {
  /** Stable React key. Derived from the event seq, so it survives an append. */
  readonly key: string
  readonly kind: 'user' | 'assistant' | 'tool-call' | 'tool-result' | 'notice'
  /** The line's main text. */
  readonly text: string
  /** Secondary text — tool arguments, a note. */
  readonly detail?: string
  /** Set on a failed tool result, so the panel can mark it without parsing text. */
  readonly failed?: boolean
}

/** What one opening `snapshot` frame tells the panel. */
export interface SnapshotView {
  readonly cwd?: string
  readonly title?: string
  readonly rows: readonly ConversationRow[]
  /** Events in the window this module could not render. */
  readonly unrendered: number
  /** Whether the node holds older records the panel has not asked for. */
  readonly hasMore: boolean
}

/** What one appended frame contributes. */
export interface EventContribution {
  readonly rows: readonly ConversationRow[]
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
function messageText(message: unknown): string | undefined {
  const record = asRecord(message)
  const content = record?.['content']
  if (!Array.isArray(content)) return undefined
  const parts = content.map(entry => blockText(entry)).filter((entry): entry is string => entry !== undefined)
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
  return { text: body === '' ? '(no output)' : body, failed: false }
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
      if (text.trim() === '') return undefined
      return { key, kind: 'user', text }
    }
    case 'assistant/message': {
      const text = messageText(data['message'])
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
      return {
        key,
        kind: 'tool-call',
        text: name,
        ...(args === undefined || args.trim() === '' ? {} : { detail: truncate(args, 800) }),
      }
    }
    case 'tool/result': {
      const result = toolResult(data)
      return {
        key,
        kind: 'tool-result',
        text: truncate(result.text, 4000),
        ...(result.failed ? { failed: true } : {}),
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
  let unrendered = 0
  if (Array.isArray(records)) {
    for (const entry of records) {
      const contribution = contributionOf(entry)
      rows.push(...contribution.rows)
      unrendered += contribution.unrendered
    }
  }
  const projections = asRecord(record['projections'])
  const values = asRecord(projections?.['values'])
  const title = values === undefined ? undefined : str(values, 'title')
  const cwd = header === undefined ? undefined : str(header, 'cwd')
  return {
    rows,
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
  if (record === undefined || str(record, 'type') !== 'event') return { rows: [], unrendered: 1 }
  const event = asRecord(record['event'])
  if (event === undefined) return { rows: [], unrendered: 1 }
  const row = rowOf(event)
  return row === undefined ? { rows: [], unrendered: 1 } : { rows: [row], unrendered: 0 }
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
