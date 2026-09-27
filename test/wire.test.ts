import { describe, expect, it } from 'vitest'
import { readEvent, readSnapshot, readStreamFrame, truncate } from '../src/client/wire.js'

/** Wrap one event as the wire envelope both the snapshot window and the live tail use. */
function entry(seq: number, type: string, data: unknown): unknown {
  return { type: 'event', event: { type, seq, time: 1_700_000_000_000 + seq, data } }
}

/** Build a `snapshot` frame around the given records. */
function snapshot(records: readonly unknown[], extra: Record<string, unknown> = {}): unknown {
  return {
    type: 'snapshot',
    header: { version: 3, id: 's-1', createdAt: 1, isSeeded: false },
    cursor: 3,
    records,
    hasMore: false,
    projections: { asOfSeq: 3, values: {} },
    ...extra,
  }
}

describe('readSnapshot', () => {
  it('reads the header and the projection title', () => {
    const view = readSnapshot(snapshot([], {
      header: { version: 3, id: 's-1', createdAt: 1, isSeeded: false, cwd: 'C:\\work' },
      projections: { asOfSeq: 3, values: { title: '构建失败排查' } },
      hasMore: true,
    }))
    expect(view?.cwd).toBe('C:\\work')
    expect(view?.title).toBe('构建失败排查')
    expect(view?.hasMore).toBe(true)
  })

  it('renders a user message from its content blocks', () => {
    const view = readSnapshot(snapshot([
      entry(1, 'user/message', { id: 'm1', role: 'user', content: [{ type: 'text', text: '看一下类型错误' }] }),
    ]))
    expect(view?.rows).toEqual([{ key: 'user/message:1', kind: 'user', text: '看一下类型错误' }])
    expect(view?.unrendered).toBe(0)
  })

  it('counts events it cannot render rather than dropping them silently', () => {
    const view = readSnapshot(snapshot([
      entry(1, 'turn/start', { turn: 1 }),
      entry(2, 'compaction/summary', { compactionId: 'c1' }),
    ]))
    expect(view?.rows).toEqual([])
    expect(view?.unrendered).toBe(2)
  })

  it('returns undefined for anything that is not a snapshot', () => {
    expect(readSnapshot({ type: 'event', event: {} })).toBeUndefined()
    expect(readSnapshot(null)).toBeUndefined()
    expect(readSnapshot('snapshot')).toBeUndefined()
  })

  it('reports a missing title as absent, not as an empty string', () => {
    const view = readSnapshot(snapshot([], { projections: { asOfSeq: 0, values: { title: '   ' } } }))
    expect(view?.title).toBeUndefined()
  })
})

describe('readEvent', () => {
  it('reads an assistant message', () => {
    const contribution = readEvent(entry(4, 'assistant/message', {
      turn: 1,
      step: 1,
      message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '改好了' }] },
    }))
    expect(contribution?.rows[0]).toMatchObject({ kind: 'assistant', text: '改好了' })
  })

  it('marks an interrupted assistant message', () => {
    const contribution = readEvent(entry(5, 'assistant/message', {
      turn: 1,
      step: 1,
      message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '部分输出' }] },
      interrupted: true,
    }))
    expect(contribution?.rows[0]?.detail).toBe('（已中断）')
  })

  it('joins several text blocks', () => {
    const contribution = readEvent(entry(6, 'assistant/message', {
      turn: 1,
      step: 1,
      message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '一' }, { type: 'text', text: '二' }] },
    }))
    expect(contribution?.rows[0]?.text).toBe('一\n\n二')
  })

  it('keeps tool-call protocol blocks out of assistant prose', () => {
    const contribution = readEvent(entry(6, 'assistant/message', {
      turn: 1,
      step: 1,
      message: {
        id: 'a1',
        role: 'assistant',
        content: [
          { type: 'text', text: '开始执行' },
          { type: 'tool-call', id: 'c1', name: 'todo_write', arguments: '{"todos":[]}' },
        ],
      },
    }))
    expect(contribution?.rows).toEqual([{ key: 'assistant/message:6', kind: 'assistant', text: '开始执行' }])
  })

  it('groups a tool call and its result into one snapshot row', () => {
    const view = readSnapshot(snapshot([
      entry(1, 'assistant/message', {
        turn: 1,
        step: 1,
        message: {
          id: 'a1',
          role: 'assistant',
          content: [{ type: 'tool-call', id: 'c1', name: 'todo_write', arguments: '{"todos":[]}' }],
        },
      }),
      entry(2, 'tool/call', {
        turn: 1, step: 1, callId: 'c1', name: 'todo_write', arguments: '{"todos":[]}',
      }),
      entry(3, 'tool/result', {
        turn: 1,
        step: 1,
        message: {
          id: 'r1',
          role: 'tool',
          source: { kind: 'tool', callId: 'c1' },
          content: [{ type: 'text', text: 'Updated todo list' }],
        },
      }),
    ]))
    expect(view?.rows).toEqual([{
      key: 'tool-call:c1',
      kind: 'tool-call',
      text: 'todo_write',
      detail: '{"todos":[]}',
      output: 'Updated todo list',
    }])
    expect(view?.unrendered).toBe(0)
  })

  it('keeps an unknown content block as JSON instead of dropping it', () => {
    const contribution = readEvent(entry(7, 'assistant/message', {
      turn: 1,
      step: 1,
      message: { id: 'a1', role: 'assistant', content: [{ type: 'video', uri: 'x' }] },
    }))
    expect(contribution?.rows[0]?.text).toContain('"type":"video"')
  })

  it('reads a tool call with its raw arguments', () => {
    const contribution = readEvent(entry(8, 'tool/call', {
      turn: 1, step: 1, callId: 'c1', name: 'pwsh', arguments: '{"command":"node -v"}',
    }))
    expect(contribution?.rows[0]).toMatchObject({ kind: 'tool-call', text: 'pwsh' })
    expect(contribution?.rows[0]?.detail).toContain('node -v')
  })

  it('marks a failed tool result and keeps the error code', () => {
    const contribution = readEvent(entry(9, 'tool/result', {
      turn: 1,
      step: 1,
      message: { id: 'r1', role: 'tool', content: [{ type: 'text', text: 'permission denied' }] },
      error: { name: 'SandboxDenied', code: 'sandbox/denied' },
    }))
    expect(contribution?.rows[0]?.failed).toBe(true)
    expect(contribution?.rows[0]?.text).toContain('SandboxDenied')
    expect(contribution?.rows[0]?.text).toContain('sandbox/denied')
    expect(contribution?.rows[0]?.text).toContain('permission denied')
  })

  it('reads an approval request as a notice', () => {
    const contribution = readEvent(entry(10, 'approval/asked', { id: 'ap1', toolName: 'pwsh', reason: 'wider access' }))
    expect(contribution?.rows[0]).toMatchObject({ kind: 'notice', text: '等待授权：pwsh', detail: 'wider access' })
  })

  it('returns undefined for a frame that is not an event', () => {
    expect(readEvent({ type: 'assistant-stream', frame: { type: 'chunk' } })).toBeUndefined()
    expect(readEvent(undefined)).toBeUndefined()
  })

  it('counts a malformed event envelope as unrendered', () => {
    expect(readEvent({ type: 'event' })?.unrendered).toBe(1)
  })
})

describe('readStreamFrame', () => {
  it('classifies start and chunk as started, end as settled', () => {
    expect(readStreamFrame({ type: 'assistant-stream', frame: { type: 'start' } })).toBe('started')
    expect(readStreamFrame({ type: 'assistant-stream', frame: { type: 'chunk' } })).toBe('started')
    expect(readStreamFrame({ type: 'assistant-stream', frame: { type: 'end' } })).toBe('settled')
  })

  it('returns undefined for anything else', () => {
    expect(readStreamFrame({ type: 'event', event: {} })).toBeUndefined()
    expect(readStreamFrame({ type: 'assistant-stream' })).toBeUndefined()
  })
})

describe('truncate', () => {
  it('leaves a short string alone and marks a cut', () => {
    expect(truncate('abc', 5)).toBe('abc')
    expect(truncate('abcdef', 3)).toBe('abc…')
  })
})
