import { describe, expect, it } from 'vitest'
import { adaptSessionList, adaptSessionsHook } from '../src/workspace/adapt.js'

/**
 * A row as the **client** projects it.
 *
 * Transcribed from `dsh-api-session-controller/lib/client.js`, `projectList()`: the
 * client flattens the host's nested projection back into these flat names, which is
 * exactly the shape the 0.1.2 fork reads.
 */
function projectedRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'session-1',
    displayTitle: '排查构建失败',
    running: false,
    blank: false,
    updatedAt: 1_790_000_000_000,
    cwd: 'C:\\work',
    ...overrides,
  }
}

/** A row as the **host** sends it over `session/list`. */
function wireRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: 'session-2',
    running: true,
    blank: false,
    updatedAt: 1_790_000_111_111,
    cwd: 'C:\\work',
    projections: { asOfSeq: 9, values: { title: '线上排查' } },
    ...overrides,
  }
}

/** One list snapshot around the given rows. */
function list(rows: Record<string, Record<string, unknown>>, extra: Record<string, unknown> = {}): unknown {
  return {
    ids: Object.keys(rows),
    byId: rows,
    current: undefined,
    phase: 'ready',
    ...extra,
  }
}

describe('adaptSessionList', () => {
  it('passes an already-projected snapshot through untouched', () => {
    // The regression this guards: mapping the projected shape as if it were the wire
    // shape blanks every title and zeroes every timestamp, so the sidebar renders a
    // correct tree of empty rows.
    const source = list({ 'session-1': projectedRow() })
    const adapted = adaptSessionList(source)
    expect(adapted.byId['session-1']?.displayTitle).toBe('排查构建失败')
    expect(adapted.byId['session-1']?.updatedAt).toBe(1_790_000_000_000)
    // Identity, not a copy: nothing downstream can be surprised by a lost field.
    expect(adapted).toBe(source)
  })

  it('keeps fields it does not know about', () => {
    const source = list({ 'session-1': projectedRow({ fromTheFuture: 42 }) })
    const row = adaptSessionList(source).byId['session-1'] as unknown as Record<string, unknown>
    expect(row['fromTheFuture']).toBe(42)
  })

  it('maps the wire shape when that is what it is given', () => {
    const adapted = adaptSessionList(list({ 'session-2': wireRow() }))
    expect(adapted.byId['session-2']).toMatchObject({
      id: 'session-2',
      displayTitle: '线上排查',
      running: true,
      blank: false,
      updatedAt: 1_790_000_111_111,
      cwd: 'C:\\work',
    })
  })

  it('maps a mixed snapshot per row', () => {
    const adapted = adaptSessionList(list({
      'session-1': projectedRow(),
      'session-2': wireRow(),
    }))
    expect(adapted.byId['session-1']?.displayTitle).toBe('排查构建失败')
    expect(adapted.byId['session-2']?.displayTitle).toBe('线上排查')
  })

  it('carries the wire title into projectionValues as the schedule channel expects', () => {
    const adapted = adaptSessionList(list({ 'session-2': wireRow() }))
    const values = (adapted.byId['session-2'] as unknown as { projectionValues?: { title?: string } }).projectionValues
    expect(values?.title).toBe('线上排查')
  })

  it('returns a stable object for the same snapshot and a new one after a change', () => {
    // React's useSyncExternalStore compares by identity; rebuilding per render is the
    // documented path to an infinite loop.
    const first = list({ 'session-1': projectedRow() })
    expect(adaptSessionList(first)).toBe(adaptSessionList(first))
    const second = list({ 'session-1': projectedRow({ updatedAt: 1 }) })
    expect(adaptSessionList(second)).not.toBe(adaptSessionList(first))
  })

  it('keeps every row visible when the runtime omits the id order', () => {
    const adapted = adaptSessionList({
      byId: { 'session-1': wireRow({ sessionId: 'session-1' }) },
      current: undefined,
    })
    expect(adapted.ids).toEqual(['session-1'])
  })

  it('answers an empty list for a value that is not a snapshot', () => {
    expect(adaptSessionList(undefined).ids).toEqual([])
    expect(adaptSessionList('nope').ids).toEqual([])
  })
})

describe('adaptSessionsHook', () => {
  it('hands the selector the adapted snapshot', () => {
    const raw = <S>(selector: (state: unknown) => S): S =>
      selector(list({ 'session-2': wireRow() }))
    const useSessions = adaptSessionsHook(raw as never)
    expect(useSessions(state => state.byId['session-2']?.displayTitle)).toBe('线上排查')
  })

  it('forwards the equality argument', () => {
    const seen: unknown[] = []
    const raw = <S>(selector: (state: unknown) => S, equals?: (a: S, b: S) => boolean): S => {
      seen.push(equals)
      return selector(list({}))
    }
    const equals = (a: unknown, b: unknown): boolean => a === b
    adaptSessionsHook(raw as never)(state => state.ids, equals)
    expect(seen[0]).toBe(equals)
  })
})
