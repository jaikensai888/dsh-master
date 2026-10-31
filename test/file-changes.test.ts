/**
 * Remote native file cards: what the wire keeps and what the card draws.
 *
 * The samples here are **synthetic** and shaped after the real events recorded in
 * `docs/reviews/message-card-gap/2026-10-30/evidence/live-snapshot-summary.json`
 * (`tool/result.data.meta` keys `["path","diffs"]` / `["operation","path","diffs"]`).
 * They are not a replay of a user session and prove parsing rules, not deployment.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FileChangeCard, TurnChangesCard } from '../src/client/FileChangeCard.js'
import { lineDelta, readResultDiffs, turnChanges } from '../src/client/file-changes.js'
import {
  conversationItems,
  mergeRows,
  mergeTurnEvents,
  readEvent,
  readSnapshot,
  type ConversationRow,
  type TurnEvent,
} from '../src/client/wire.js'

/** One live wire envelope. */
function frame(seq: number, type: string, data: unknown): unknown {
  return { type: 'event', event: { seq, type, data, time: seq * 1000 } }
}

/** A `tool/result` result message, as a node reports it. */
function resultMessage(callId: string, text: string, isError = false): Record<string, unknown> {
  return {
    id: `r-${callId}`,
    role: 'tool',
    source: { kind: 'tool', callId },
    toolCallId: callId,
    content: [{ type: 'text', text }],
    isError,
  }
}

/** A settled file tool result. */
function fileResult(seq: number, callId: string, meta: unknown, isError = false, turn = 1): unknown {
  return frame(seq, 'tool/result', {
    turn,
    step: 1,
    message: resultMessage(callId, isError ? 'edit failed' : 'The file has been updated successfully.', isError),
    ...(meta === undefined ? {} : { meta }),
  })
}

/** Fold one event list the way the live tail does. */
function replay(records: readonly unknown[]): { rows: ConversationRow[]; events: TurnEvent[] } {
  let rows: ConversationRow[] = []
  let events: TurnEvent[] = []
  for (const record of records) {
    const contribution = readEvent(record)
    if (contribution === undefined) continue
    rows = mergeRows(rows, contribution.rows)
    events = mergeTurnEvents(events, contribution.turnEvents)
  }
  return { rows, events }
}

const EDIT_CALL = frame(2, 'tool/call', {
  turn: 1,
  step: 1,
  callId: 'c1',
  name: 'edit',
  arguments: JSON.stringify({ file_path: 'src/a.ts', old_string: 'before', new_string: 'after' }),
})

const EDIT_META = {
  path: 'C:\\work\\src\\a.ts',
  diffs: [{ path: 'C:\\work\\src\\a.ts', oldText: 'a\nbefore\nb', newText: 'a\nafter\nb' }],
}

describe('wire file changes', () => {
  it('parses a long write argument in full while keeping the display preview short', () => {
    const content = 'x'.repeat(1_200)
    const contribution = readEvent(frame(1, 'tool/call', {
      turn: 1, step: 1, callId: 'w1', name: 'write',
      arguments: JSON.stringify({ file_path: 'notes/big.txt', content }),
    }))!
    const row = contribution.rows[0]!
    expect(row.change).toMatchObject({ tool: 'write', path: 'notes/big.txt', phase: 'intent' })
    expect(row.change?.diffs[0]?.newText).toHaveLength(1_200)
    expect(row.detail?.length).toBe(801)
    expect(row.detail?.endsWith('…')).toBe(true)
  })

  it('applies settled hunks and maps the recorded canonical path back to the call path', () => {
    const { rows } = replay([
      frame(1, 'turn/start', { turn: 1 }),
      EDIT_CALL,
      fileResult(3, 'c1', EDIT_META),
      frame(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      key: 'tool-call:c1',
      kind: 'tool-call',
      text: 'edit',
      output: 'The file has been updated successfully.',
    })
    expect(rows[0]?.change?.phase).toBe('applied')
    expect(rows[0]?.change?.diffs[0]?.path).toBe('src/a.ts')
  })

  it('keeps the argument diff for a write whose applied metadata is empty', () => {
    const { rows } = replay([
      frame(1, 'tool/call', {
        turn: 1, step: 1, callId: 'w1', name: 'write',
        arguments: JSON.stringify({ file_path: 'notes/new.txt', content: 'hello\n' }),
      }),
      fileResult(2, 'w1', { operation: 'create', path: 'C:\\work\\notes\\new.txt', diffs: [] }),
    ])
    expect(rows[0]?.change).toMatchObject({ tool: 'write', phase: 'applied', path: 'notes/new.txt' })
    expect(rows[0]?.change?.diffs[0]?.newText).toBe('hello\n')
  })

  it('drops an edit intention when the settled result published no hunks', () => {
    const { rows } = replay([EDIT_CALL, fileResult(3, 'c1', undefined)])
    expect(rows[0]?.change).toBeUndefined()
    expect(rows[0]?.output).toBeDefined()
  })

  it('never turns a failed result into a change', () => {
    const { rows } = replay([EDIT_CALL, fileResult(3, 'c1', EDIT_META, true)])
    expect(rows[0]?.failed).toBe(true)
    expect(rows[0]?.change).toBeUndefined()
  })

  it('leaves a settled str_replace_editor call on the generic row', () => {
    const { rows } = replay([
      frame(1, 'tool/call', {
        turn: 1, step: 1, callId: 's1', name: 'str_replace_editor',
        arguments: JSON.stringify({ command: 'str_replace', path: 'src/a.ts', old_str: 'a', new_str: 'b' }),
      }),
      fileResult(2, 's1', { path: 'C:\\work\\src\\a.ts', diffs: [{ path: 'C:\\work\\src\\a.ts', oldText: 'a', newText: 'b' }] }),
    ])
    expect(rows[0]?.change).toBeUndefined()
  })

  it('ignores malformed metadata instead of guessing at a diff', () => {
    const { rows } = replay([EDIT_CALL, fileResult(3, 'c1', { diffs: [{ path: 1, oldText: null, newText: 'x' }] })])
    expect(rows[0]?.change).toBeUndefined()
    expect(readResultDiffs({ diffs: [{ path: 1, oldText: null, newText: 'x' }] })).toBeUndefined()
    expect(readResultDiffs({ diffs: [] })).toEqual({ kind: 'empty' })
    expect(readResultDiffs({ path: 'C:\\a' })).toBeUndefined()
  })

  it('does not read a non-file tool result as a change card', () => {
    const { rows } = replay([
      frame(1, 'tool/call', { turn: 1, step: 1, callId: 'r1', name: 'read', arguments: '{"file_path":"src/a.ts"}' }),
      fileResult(2, 'r1', { diffs: [{ path: 'src/a.ts', oldText: 'a', newText: 'b' }] }),
    ])
    expect(rows[0]?.change).toBeUndefined()
  })

  it('pairs a result that arrived before its call', () => {
    const { rows } = replay([fileResult(2, 'c1', EDIT_META), EDIT_CALL])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('tool-call')
    expect(rows[0]?.change?.phase).toBe('applied')
    expect(rows[0]?.output).toBeDefined()
  })

  it('does not double the change when the same frames replay', () => {
    const records = [
      frame(1, 'turn/start', { turn: 1 }),
      EDIT_CALL,
      fileResult(3, 'c1', EDIT_META),
      frame(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    const { rows, events } = replay([...records, ...records])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.change?.phase).toBe('applied')
    const group = conversationItems(rows, events)[0]!
    if (group.kind !== 'turn-group') throw new Error('missing turn')
    expect(group.changes).toMatchObject({ total: 1, added: 1, deleted: 1 })
  })

  it('produces the same summary from a snapshot and from the live tail', () => {
    const records = [
      frame(1, 'turn/start', { turn: 1 }),
      EDIT_CALL,
      fileResult(3, 'c1', EDIT_META),
      frame(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    const snapshot = readSnapshot(snapshotFrame(records))!
    const live = replay(records)
    expect(conversationItems(live.rows, live.events)).toEqual(conversationItems(snapshot.rows, snapshot.turnEvents))
  })
})

/** Build a `snapshot` frame around the given records. */
function snapshotFrame(records: readonly unknown[], extra: Record<string, unknown> = {}): unknown {
  return {
    type: 'snapshot',
    header: { version: 3, id: 's-1', createdAt: 1, isSeeded: false, cwd: 'C:\\work' },
    cursor: 3,
    records,
    hasMore: false,
    projections: { asOfSeq: 3, values: {} },
    ...extra,
  }
}

describe('line counting and turn aggregation', () => {
  it('counts net lines after stripping the shared hunk context', () => {
    expect(lineDelta('a\nb\nc\nd', 'a\nB\nc\nd')).toEqual({ added: 1, deleted: 1 })
    expect(lineDelta(null, 'one\ntwo\n')).toEqual({ added: 2, deleted: 0 })
    expect(lineDelta('one\ntwo\n', '')).toEqual({ added: 0, deleted: 2 })
    expect(lineDelta('same\n', 'same\n')).toEqual({ added: 0, deleted: 0 })
  })

  it('collapses the same file across one turn and adds its lines up', () => {
    const summary = turnChanges(1, [
      {
        tool: 'edit', path: 'src/a.ts', phase: 'applied',
        diffs: [{ path: 'src/a.ts', oldText: 'a\nb', newText: 'a\nB' }],
      },
      {
        tool: 'edit', path: 'src/a.ts', phase: 'applied',
        diffs: [{ path: 'src/a.ts', oldText: 'c\nd', newText: 'c\nD\nE' }],
      },
    ])
    expect(summary).toEqual({
      turn: 1,
      files: [{ path: 'src/a.ts', added: 3, deleted: 2 }],
      total: 1,
      added: 3,
      deleted: 2,
    })
  })

  it('excludes running intentions and keeps turns isolated', () => {
    expect(turnChanges(1, [{
      tool: 'edit', path: 'src/a.ts', phase: 'intent',
      diffs: [{ path: 'src/a.ts', oldText: 'a', newText: 'b' }],
    }])).toBeUndefined()

    const { rows, events } = replay([
      frame(1, 'turn/start', { turn: 1 }),
      EDIT_CALL,
      fileResult(3, 'c1', EDIT_META),
      frame(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
      frame(5, 'turn/start', { turn: 2 }),
      frame(6, 'tool/call', {
        turn: 2, step: 1, callId: 'c2', name: 'edit',
        arguments: JSON.stringify({ file_path: 'src/b.ts', old_string: 'x', new_string: 'y' }),
      }),
      fileResult(7, 'c2', {
        path: 'C:\\work\\src\\b.ts',
        diffs: [{ path: 'C:\\work\\src\\b.ts', oldText: 'x\ny', newText: 'x\nY\nZ' }],
      }, false, 2),
      frame(8, 'turn/end', { turn: 2, reason: { kind: 'completed' } }),
    ])
    const groups = conversationItems(rows, events).filter(item => item.kind === 'turn-group')
    expect(groups.map(group => group.kind === 'turn-group' ? group.changes : undefined)).toEqual([
      { turn: 1, files: [{ path: 'src/a.ts', added: 1, deleted: 1 }], total: 1, added: 1, deleted: 1 },
      { turn: 2, files: [{ path: 'src/b.ts', added: 2, deleted: 1 }], total: 1, added: 2, deleted: 1 },
    ])
  })

  it('does not count a running call or a failed call as a modification', () => {
    const { rows, events } = replay([
      frame(1, 'turn/start', { turn: 1 }),
      frame(2, 'tool/call', {
        turn: 1, step: 1, callId: 'c1', name: 'edit',
        arguments: JSON.stringify({ file_path: 'src/a.ts', old_string: 'a', new_string: 'b' }),
      }),
      frame(3, 'tool/call', {
        turn: 1, step: 1, callId: 'c2', name: 'edit',
        arguments: JSON.stringify({ file_path: 'src/b.ts', old_string: 'x', new_string: 'y' }),
      }),
      fileResult(4, 'c2', { diffs: [{ path: 'src/b.ts', oldText: 'x', newText: 'y' }] }, true),
      frame(5, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])
    const group = conversationItems(rows, events)[0]!
    if (group.kind !== 'turn-group') throw new Error('missing turn')
    expect(group.changes).toBeUndefined()
  })

  it('withholds counts for a hunk too large to compare', () => {
    const huge = Array.from({ length: 600 }, (_, index) => `line-${String(index)}`).join('\n')
    const hugeChanged = Array.from({ length: 600 }, (_, index) => `changed-${String(index)}`).join('\n')
    const summary = turnChanges(1, [{
      tool: 'edit', path: 'src/huge.ts', phase: 'applied',
      diffs: [{ path: 'src/huge.ts', oldText: huge, newText: hugeChanged }],
    }])
    expect(summary).toEqual({
      turn: 1,
      files: [{ path: 'src/huge.ts', added: 0, deleted: 0, oversized: true }],
      total: 1,
      added: 0,
      deleted: 0,
    })
  })
})

describe('file-change cards', () => {
  const change = {
    tool: 'edit',
    path: 'src/a.ts',
    phase: 'applied' as const,
    diffs: [{ path: 'src/a.ts', oldText: 'a\nbefore\nb', newText: 'a\nafter\nb' }],
  }

  it('draws one call as a compact card with its own counts', () => {
    const html = renderToStaticMarkup(createElement(FileChangeCard, { change }))
    expect(html).toContain('class="dsh-master-change"')
    expect(html).toContain('编辑')
    expect(html).toContain('src/a.ts')
    expect(html).toContain('+1')
    expect(html).toContain('-1')
    expect(html).toContain('data-kind="del"')
    expect(html).toContain('data-kind="add"')
    expect(html).toContain('data-kind="del">before<')
    expect(html).toContain('data-kind="add">after<')
    expect(html).not.toContain('download')
  })

  it('marks a running intention instead of claiming an applied diff', () => {
    const html = renderToStaticMarkup(createElement(FileChangeCard, { change: { ...change, phase: 'intent' } }))
    expect(html).toContain('data-phase="intent"')
    expect(html).toContain('运行中…')
  })

  it('shortens a recorded canonical path against the session root', () => {
    const html = renderToStaticMarkup(createElement(FileChangeCard, {
      change: { ...change, path: 'C:\\work\\src\\a.ts', diffs: [{ path: 'C:\\work\\src\\a.ts', oldText: 'a', newText: 'b' }] },
      cwd: 'C:\\work',
    }))
    expect(html).toContain('src\\a.ts')
    expect(html).not.toContain('C:\\work\\src')
  })

  it('draws the multi-file roll-up with totals and one row per file', () => {
    const summary = {
      turn: 1,
      files: [
        { path: 'src/a.ts', added: 2, deleted: 1 },
        { path: 'src/b.ts', added: 1, deleted: 0 },
      ],
      total: 2,
      added: 3,
      deleted: 1,
    }
    const html = renderToStaticMarkup(createElement(TurnChangesCard, { summary }))
    expect(html).toContain('已编辑 2 个文件')
    expect(html).toContain('+3')
    expect(html).toContain('-1')
    expect(html).toContain('src/a.ts')
    expect(html).toContain('src/b.ts')
    expect(html).not.toContain('dsh-master-changes-toggle')
  })

  it('folds more than four files behind a labelled button', () => {
    const files = Array.from({ length: 6 }, (_, index) => ({ path: `src/f${String(index)}.ts`, added: 1, deleted: 0 }))
    const html = renderToStaticMarkup(createElement(TurnChangesCard, {
      summary: { turn: 1, files, total: 6, added: 6, deleted: 0 },
    }))
    expect(html).toContain('已编辑 6 个文件')
    expect(html).toContain('全部 6 个文件')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-controls=')
    expect(html).toContain('src/f3.ts')
    expect(html).not.toContain('src/f4.ts')
  })

  it('uses only the header for a single changed file', () => {
    const html = renderToStaticMarkup(createElement(TurnChangesCard, {
      summary: { turn: 1, files: [{ path: 'src/a.ts', added: 1, deleted: 1 }], total: 1, added: 1, deleted: 1 },
    }))
    expect(html).toContain('已编辑 a.ts')
    expect(html).not.toContain('dsh-master-changes-list')
    expect(html).not.toContain('dsh-master-changes-toggle')
  })
})
