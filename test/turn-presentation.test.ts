import { describe, expect, it } from 'vitest'
import fixture from './fixtures/message-card-turn.json' with { type: 'json' }
import { conversationItems, mergeRows, mergeTurnEvents, readEvent, readSnapshot } from '../src/client/wire.js'

function frame(seq: number, type: string, data: unknown, time = seq * 1000): unknown {
  return { type: 'event', event: { seq, type, data, time } }
}

describe('official turn process presentation', () => {
  it('keeps the last step response separate from the process, with real elapsed time', () => {
    const view = readSnapshot(fixture)!
    const turn = conversationItems(view.rows, view.turnEvents).find(item => item.kind === 'turn-group')!
    expect(turn).toMatchObject({ kind: 'turn-group', status: 'completed', durationMs: 58_998 })
    if (turn.kind !== 'turn-group') throw new Error('missing turn')
    expect(turn.answer.map(row => row.text)).toEqual(['已提交，仅包含当前项目的改动。'])
    expect(turn.process.some(row => row.kind === 'reasoning')).toBe(true)
    expect(turn.process.some(row => row.kind === 'tool-call')).toBe(true)
    expect(turn.process).not.toContainEqual(turn.answer[0])
  })

  it('gives live events the same grouping as a snapshot and does not mark stream end as completion', () => {
    let rows = [] as NonNullable<ReturnType<typeof readSnapshot>>['rows']
    let events = [] as NonNullable<ReturnType<typeof readSnapshot>>['turnEvents']
    for (const record of fixture.records) {
      const value = readEvent(record)!
      rows = mergeRows(rows, value.rows)
      events = mergeTurnEvents(events, value.turnEvents)
    }
    const snapshot = readSnapshot(fixture)!
    expect(conversationItems(rows, events)).toEqual(conversationItems(snapshot.rows, snapshot.turnEvents))
    expect(conversationItems(rows, events.filter(event => event.type !== 'turn/end')))
      .toContainEqual(expect.objectContaining({ kind: 'turn-group', status: 'running', answer: [] }))
  })

  it('never mistakes an earlier text-only step for the final answer when a later tool step exists', () => {
    const value = readSnapshot({ ...fixture, records: [
      frame(1, 'turn/start', { turn: 1 }),
      frame(2, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: '准备运行' }] } }),
      frame(3, 'tool/call', { turn: 1, step: 2, callId: 'c', name: 'pwsh', arguments: '{}' }),
      frame(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ] })!
    expect(conversationItems(value.rows, value.turnEvents)).toContainEqual(expect.objectContaining({ answer: [] }))
  })

  it('keeps failed tools, approval notices and unanswered questions outside the collapsed process', () => {
    const value = readSnapshot({ ...fixture, records: [
      frame(1, 'turn/start', { turn: 1 }),
      frame(2, 'tool/call', { turn: 1, step: 1, callId: 'bad', name: 'read', arguments: '{}' }),
      frame(3, 'tool/result', { turn: 1, step: 1, message: { source: { callId: 'bad' }, isError: true, content: [{ type: 'text', text: '找不到文件' }] } }),
      frame(4, 'approval/asked', { turn: 1, toolName: 'pwsh' }),
      frame(5, 'tool/call', { turn: 1, step: 2, callId: 'ask', name: 'ask_user_question', arguments: '{}' }),
      frame(6, 'turn/end', { turn: 1, reason: { kind: 'error', error: { message: '请求失败' } } }),
    ] })!
    const group = conversationItems(value.rows, value.turnEvents)[0]!
    if (group.kind !== 'turn-group') throw new Error('missing turn')
    expect(group.status).toBe('error')
    expect(group.visible.some(row => row.failed === true)).toBe(true)
    expect(group.visible.some(row => row.kind === 'notice')).toBe(true)
    expect(group.visible.some(row => row.text === 'ask_user_question')).toBe(true)
    expect(group.failure).toBe('请求失败')
  })

  it('separates reasoning by block type and leaves unclassified old-node messages visible', () => {
    const value = readSnapshot({ ...fixture, records: [frame(1, 'assistant/message', {
      message: { content: [{ type: 'reasoning', text: '思考内容' }, { type: 'text', text: 'Answer in any language' }] },
    })] })!
    expect(value.rows.map(row => [row.kind, row.text])).toEqual([
      ['reasoning', '思考内容'], ['assistant', 'Answer in any language'],
    ])
    expect(conversationItems(value.rows, value.turnEvents)).toEqual(value.rows)
  })

  it('does not invent elapsed time when the history starts partway through a turn', () => {
    const value = readSnapshot({ ...fixture, records: fixture.records.filter(record => record.event.type !== 'turn/start') })!
    const group = conversationItems(value.rows, value.turnEvents).find(item => item.kind === 'turn-group')!
    expect(group).toMatchObject({ status: 'completed' })
    expect(group).not.toHaveProperty('durationMs')
  })

  it('shows a failure that happens before any assistant output', () => {
    const value = readSnapshot({ ...fixture, records: [
      frame(1, 'turn/start', { turn: 1 }),
      frame(2, 'turn/end', { turn: 1, reason: { kind: 'error', error: { message: '模型不可用' } } }),
    ] })!
    expect(conversationItems(value.rows, value.turnEvents)).toContainEqual(expect.objectContaining({ status: 'error', failure: '模型不可用' }))
  })

  it('does not classify a final answer when a tool event lacks its step', () => {
    const value = readSnapshot({ ...fixture, records: [
      frame(1, 'turn/start', { turn: 1 }),
      frame(2, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: '准备运行' }] } }),
      frame(3, 'tool/call', { turn: 1, callId: 'c', name: 'pwsh', arguments: '{}' }),
      frame(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ] })!
    expect(conversationItems(value.rows, value.turnEvents)).toContainEqual(expect.objectContaining({ answer: [], compatibility: expect.any(String) }))
  })

  it('keeps a steer message before the later reply rather than moving it after the entire turn', () => {
    const value = readSnapshot({ ...fixture, records: [
      frame(1, 'turn/start', { turn: 1 }),
      frame(2, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: '执行前检查' }] } }),
      frame(3, 'user/message', { content: [{ type: 'text', text: '追加要求' }] }),
      frame(4, 'assistant/message', { turn: 1, step: 2, message: { content: [{ type: 'text', text: '最终回复' }] } }),
      frame(5, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ] })!
    const items = conversationItems(value.rows, value.turnEvents)
    expect(items.map(item => item.kind === 'turn-group' ? 'group' : item.text)).toEqual([
      expect.stringContaining('追加消息'), '执行前检查', '追加要求', '最终回复',
    ])
  })

  it('does not let DSH-injected context split the turn it arrives inside', () => {
    const value = readSnapshot({ ...fixture, records: [
      frame(1, 'turn/start', { turn: 1 }),
      frame(2, 'user/message', { source: { kind: 'user', rpcId: 'r1' }, content: [{ type: 'text', text: 'git commit' }] }),
      frame(3, 'user/message', {
        source: { kind: 'time-context', form: 'snapshot' },
        content: [{ type: 'text', text: 'Time sampled while preparing turn 1, step 1' }],
      }),
      frame(4, 'assistant/message', {
        turn: 1,
        step: 1,
        message: { content: [{ type: 'reasoning', text: '先看清楚工作区' }, { type: 'tool-call', id: 'c1', name: 'pwsh', arguments: '{}' }] },
      }),
      frame(5, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'pwsh', arguments: '{}' }),
      frame(6, 'tool/result', { turn: 1, step: 1, message: { source: { callId: 'c1' }, content: [{ type: 'text', text: 'ok' }] } }),
      frame(7, 'user/message', {
        source: { kind: 'agent-instructions', form: 'instructions', changes: [{ action: 'replace', path: 'xingliu\\AGENTS.md' }] },
        content: [{ type: 'text', text: '<system-reminder>Updated instructions</system-reminder>' }],
      }),
      frame(8, 'assistant/message', { turn: 1, step: 2, message: { content: [{ type: 'text', text: '已提交。' }] } }),
      frame(9, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ] })!
    expect(value.rows.map(row => row.kind)).toEqual(['user', 'context', 'reasoning', 'tool-call', 'context', 'assistant'])
    const items = conversationItems(value.rows, value.turnEvents)
    expect(items.map(item => item.kind === 'turn-group' ? 'group' : `${item.kind}:${item.text}`)).toEqual([
      'user:git commit', 'context:时间上下文', 'group', 'context:xingliu\\AGENTS.md',
    ])
    const group = items[2]
    if (group?.kind !== 'turn-group') throw new Error('the turn was split into rows instead of collapsed')
    expect(group.status).toBe('completed')
    expect(group.answer.map(row => row.text)).toEqual(['已提交。'])
    expect(group.process.map(row => row.kind)).toEqual(['reasoning', 'tool-call'])
  })
})
