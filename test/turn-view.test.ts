import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import fixture from './fixtures/message-card-turn.json' with { type: 'json' }

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const React = await import('react')
  return {
    MarkdownText: ({ text }: { text: string }) => React.createElement('p', null, text),
    StateDot: () => React.createElement('span', { 'data-running': '' }),
    IconChevronDownOutlineRegular: () => React.createElement('svg'),
    IconWarningOutlineRegular: () => React.createElement('span', { 'data-warning': '' }),
  }
})

import { ConversationLog } from '../src/client/SessionView.js'
import { readSnapshot } from '../src/client/wire.js'

/** One live wire envelope. */
function frame(seq: number, type: string, data: unknown): unknown {
  return { type: 'event', event: { type, seq, time: seq * 1000, data } }
}

describe('remote turn disclosure', () => {
  it('defaults a completed process to collapsed, with its final answer after the process', () => {
    const view = readSnapshot(fixture)!
    const html = renderToStaticMarkup(createElement(ConversationLog, { rows: view.rows, events: view.turnEvents }))
    expect(html).toContain('已完成，用时 58 秒')
    expect(html).toMatch(/<details class="dsh-master-process">/u)
    expect(html).not.toMatch(/<details class="dsh-master-process"[^>]*open/u)
    expect(html.indexOf('data-turn-answer')).toBeGreaterThan(html.lastIndexOf('</details>'))
    expect(html).toContain('已提交，仅包含当前项目的改动。')
  })

  it('places a turn’s changed-files card after the answer, outside the collapsed process', () => {
    const records = [
      frame(1, 'turn/start', { turn: 4 }),
      frame(2, 'tool/call', {
        turn: 4, step: 1, callId: 'c1', name: 'edit',
        arguments: JSON.stringify({ file_path: 'src/a.ts', old_string: 'before', new_string: 'after' }),
      }),
      frame(3, 'tool/result', {
        turn: 4,
        step: 1,
        message: {
          role: 'tool',
          source: { kind: 'tool', callId: 'c1' },
          content: [{ type: 'text', text: 'The file src/a.ts has been updated successfully.' }],
          isError: false,
        },
        meta: { path: 'C:\\work\\src\\a.ts', diffs: [{ path: 'C:\\work\\src\\a.ts', oldText: 'before', newText: 'after' }] },
      }),
      frame(4, 'assistant/message', { turn: 4, step: 2, message: { content: [{ type: 'text', text: '改好了。' }] } }),
      frame(5, 'turn/end', { turn: 4, reason: { kind: 'completed' } }),
    ]
    const view = readSnapshot({
      type: 'snapshot',
      header: { version: 3, id: 's-1', createdAt: 1, isSeeded: false, cwd: 'C:\\work' },
      cursor: 5,
      records,
      hasMore: false,
      projections: { asOfSeq: 5, values: {} },
    })!
    const html = renderToStaticMarkup(createElement(ConversationLog, {
      rows: view.rows,
      events: view.turnEvents,
      cwd: view.cwd,
    }))
    expect(html).toContain('data-changes')
    expect(html).toContain('已编辑 a.ts')
    expect(html).toContain('+1')
    expect(html).toContain('-1')
    // The per-call card stays inside the process disclosure, which precedes the answer…
    expect(html.indexOf('data-tool="edit"')).toBeGreaterThan(-1)
    expect(html.indexOf('data-tool="edit"')).toBeLessThan(html.indexOf('data-turn-answer'))
    // …and the turn roll-up is drawn after the answer.
    expect(html.indexOf('data-changes')).toBeGreaterThan(html.indexOf('data-turn-answer'))
    expect(html).not.toContain('download')
  })

  it('summarizes a tool row with the command it ran and drops the repeated assistant label', () => {
    const records = [
      frame(1, 'turn/start', { turn: 7 }),
      frame(2, 'assistant/message', {
        turn: 7, step: 1, message: { content: [{ type: 'text', text: '先确认 uv 版本。' }] },
      }),
      frame(3, 'tool/call', {
        turn: 7, step: 2, callId: 'c9', name: 'bash',
        arguments: JSON.stringify({ command: 'grep -o "0x[0-9a-f]*" frontend/creation/script.js | head' }),
      }),
      frame(4, 'tool/result', {
        turn: 7,
        step: 2,
        message: {
          role: 'tool',
          source: { kind: 'tool', callId: 'c9' },
          content: [{ type: 'text', text: '2057015745573a5700577572a5700577572a5700577572a5700577572a5700577572' }],
          isError: false,
        },
      }),
      frame(5, 'turn/end', { turn: 7, reason: { kind: 'completed' } }),
    ]
    const view = readSnapshot({
      type: 'snapshot',
      header: { version: 3, id: 's-1', createdAt: 1, isSeeded: false },
      cursor: 5,
      records,
      hasMore: false,
      projections: { asOfSeq: 5, values: {} },
    })!
    const html = renderToStaticMarkup(createElement(ConversationLog, { rows: view.rows, events: view.turnEvents }))
    const summary = html.match(/<span class="dsh-master-tool-summary">([\s\S]*?)<\/span>/u)?.[1]

    // The row answers "what ran here?"; the output fragment stays in the body.
    expect(summary).toContain('grep -o')
    expect(summary).toContain('frontend/creation/script.js')
    expect(summary).not.toContain('2057015745573a')
    // Assistant narration is left-aligned body text; a label above every block was noise.
    expect(html).toContain('先确认 uv 版本。')
    expect(html).not.toContain('>助手<')
  })

  it('keeps the roll-up off a turn that is still running', () => {
    // Same edit, but the turn has not ended: the per-call card is visible and the
    // "已编辑 N 个文件" heading is not claimed yet.
    const records = [
      frame(1, 'turn/start', { turn: 5 }),
      frame(2, 'tool/call', {
        turn: 5, step: 1, callId: 'c1', name: 'edit',
        arguments: JSON.stringify({ file_path: 'src/a.ts', old_string: 'before', new_string: 'after' }),
      }),
      frame(3, 'tool/result', {
        turn: 5,
        step: 1,
        message: {
          role: 'tool',
          source: { kind: 'tool', callId: 'c1' },
          content: [{ type: 'text', text: 'updated' }],
          isError: false,
        },
        meta: { diffs: [{ path: 'src/a.ts', oldText: 'before', newText: 'after' }] },
      }),
    ]
    const view = readSnapshot({
      type: 'snapshot',
      header: { version: 3, id: 's-1', createdAt: 1, isSeeded: false },
      cursor: 3,
      records,
      hasMore: false,
      projections: { asOfSeq: 3, values: {} },
    })!
    const html = renderToStaticMarkup(createElement(ConversationLog, { rows: view.rows, events: view.turnEvents }))
    expect(html).toContain('data-tool="edit"')
    expect(html).not.toContain('data-changes')
    expect(html).not.toContain('已编辑')
  })

  it('keeps narration between compact tool summaries, with live progress after the latest activity', () => {
    const view = readSnapshot({ ...fixture, records: [
      frame(1, 'user/message', { content: [{ type: 'text', text: '帮我刷机' }] }),
      frame(2, 'turn/start', { turn: 1 }),
      frame(3, 'user/message', {
        source: { kind: 'time-context', form: 'snapshot' },
        content: [{ type: 'text', text: 'Time sampled while preparing the turn' }],
      }),
      frame(4, 'tool/call', { turn: 1, step: 1, callId: 'read', name: 'read', arguments: '{}' }),
      frame(5, 'tool/result', { turn: 1, step: 1, message: { source: { callId: 'read' }, content: [{ type: 'text', text: '设备列表' }] } }),
      frame(6, 'tool/call', { turn: 1, step: 1, callId: 'check', name: 'pwsh', arguments: '{"command":"list ports"}' }),
      frame(7, 'tool/result', { turn: 1, step: 1, message: { source: { callId: 'check' }, content: [{ type: 'text', text: 'COM5' }] } }),
      frame(8, 'assistant/message', { turn: 1, step: 2, message: { content: [{ type: 'text', text: 'COM5 已就绪。' }] } }),
      frame(9, 'tool/call', { turn: 1, step: 2, callId: 'flash', name: 'pwsh', arguments: '{"command":"flash"}' }),
    ] })!
    const html = renderToStaticMarkup(createElement(ConversationLog, { rows: view.rows, events: view.turnEvents }))

    expect(html).toMatch(/<details class="dsh-master-step">/u)
    expect(html).toContain('已读取文件，执行了命令')
    expect(html).toContain('正在运行命令')
    expect(html.indexOf('执行了命令')).toBeLessThan(html.indexOf('COM5 已就绪。'))
    expect(html.indexOf('COM5 已就绪。')).toBeLessThan(html.indexOf('正在运行命令'))
    expect(html.indexOf('正在运行命令')).toBeLessThan(html.indexOf('正在处理'))
    expect(html).not.toContain('dsh-master-process"')
    expect(html).toContain('<time dateTime="1970-01-01T00:00:01.000Z"')
    expect(html).toMatch(/<details class="dsh-master-context dsh-master-transcript-info">[\s\S]*?Time sampled/u)

    const disconnected = renderToStaticMarkup(createElement(ConversationLog, {
      rows: view.rows, events: view.turnEvents, connected: false,
    }))
    expect(disconnected).not.toContain('正在处理')
    expect(disconnected).not.toContain('正在运行命令')
    expect(disconnected).toContain('data-state="unknown"')
  })
})
