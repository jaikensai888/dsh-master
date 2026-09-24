/**
 * Map a session snapshot onto the shape the forked browser reads — if it is not
 * already in that shape.
 *
 * The fork is 0.1.2-rc.1 code and the runtime is 0.1.5-rc.2, so the two were expected
 * to disagree about where a session's display facts live. They do not, at the layer
 * that matters:
 *
 * - the **wire** summary (host → browser, `session/list`) nests them under
 *   `projections.values` and names the id `sessionId`;
 * - the **client projection** (`dsh-api-session-controller/lib/client.js`,
 *   `projectList()`) flattens exactly those back into `id` / `displayTitle` /
 *   `completed` / `projectionValues` — the 0.1.2 shape the fork reads — because the
 *   shipped 0.1.5 browser reads the same field names.
 *
 * The first version of this file assumed the client handed over the wire shape and
 * mapped it unconditionally. It does not, so every row came out with an empty title and
 * a zero timestamp: a correct tree of blank sessions. Hence the pass-through below —
 * when a row is already in the expected shape, **nothing is touched**, because any
 * transformation here can only lose information.
 *
 * ## Why a `WeakMap`
 *
 * The adapted snapshot must be referentially stable: React's `useSyncExternalStore`
 * compares a selector's result by identity, so a selector like `s => s` returning a
 * freshly built object every render is the documented way to produce an infinite
 * re-render loop. The runtime's list snapshot is itself stable between mutations, so
 * caching per source object gives exactly the stability required.
 *
 * ## What this deliberately does not do
 *
 * Derive `completed`. It is present in the runtime's projection and absent from the
 * wire summary; guessing it from timestamps would produce a "finished while you were
 * away" dot that appears and never clears.
 *
 * @module dsh-master/workspace/adapt
 */

import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'

/** Narrow an unknown value to a plain record. */
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Read a string field, or `undefined`. */
function str(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * Whether one row is already in the shape the fork reads.
 *
 * `id` and `displayTitle` together are the signature: the wire summary has neither
 * (it names the id `sessionId` and keeps the title under `projections.values`).
 *
 * @param row - a row from the snapshot's `byId`.
 * @returns true when the row needs no mapping.
 */
function isProjectedRow(row: unknown): boolean {
  const entry = record(row)
  return entry !== undefined
    && typeof entry['id'] === 'string'
    && typeof entry['displayTitle'] === 'string'
}

/**
 * Translate one session row that is **not** already projected.
 *
 * @param row - a wire-shaped summary.
 * @param fallbackId - the key the row was stored under.
 * @returns the fork-shaped summary.
 */
function adaptWireSummary(row: Record<string, unknown>, fallbackId: string): SessionSummary {
  const projections = record(row['projections'])
  const values = record(projections?.['values'])
  const title = values === undefined ? undefined : str(values, 'title')
  const schedule = values?.['schedule']
  const origin = row['origin'] === 'subagent' ? 'subagent' as const : undefined
  const parentId = typeof row['parentSessionId'] === 'string' ? row['parentSessionId'] : undefined
  const cwd = str(row, 'cwd')
  return {
    id: typeof row['sessionId'] === 'string' ? row['sessionId'] : fallbackId,
    displayTitle: title ?? '',
    blank: row['blank'] === true,
    running: row['running'] === true,
    updatedAt: typeof row['updatedAt'] === 'number' ? row['updatedAt'] : 0,
    ...(origin === undefined ? {} : { origin }),
    ...(parentId === undefined ? {} : { parentId }),
    ...(cwd === undefined ? {} : { cwd }),
    projectionValues: {
      ...(title === undefined || title === null ? {} : { title }),
      ...(Array.isArray(schedule) ? { schedule } : {}),
    },
  }
}

/** Adapted snapshots, keyed by the runtime snapshot they came from. */
const adapted = new WeakMap<object, SessionListState>()

/** An empty list, for a source that is not a snapshot at all. */
const EMPTY: SessionListState = { ids: [], byId: {}, current: undefined }

/**
 * Build a list snapshot by mapping rows that need it.
 *
 * @param source - the runtime snapshot.
 * @param rawById - its row map.
 * @returns the fork-shaped snapshot.
 */
function buildList(source: Record<string, unknown>, rawById: Record<string, unknown>): SessionListState {
  const byId: Record<string, SessionSummary> = {}
  for (const [id, row] of Object.entries(rawById)) {
    const entry = record(row)
    if (entry !== undefined && isProjectedRow(entry)) {
      byId[id] = entry as unknown as SessionSummary
    } else if (entry !== undefined) {
      byId[id] = adaptWireSummary(entry, id)
    } else {
      byId[id] = { id, displayTitle: '', blank: false, running: false, updatedAt: 0 }
    }
  }

  // `ids` drives row order; when the runtime omits it, the row map's own keys keep
  // every row visible rather than silently dropping the list to empty.
  const rawIds = source['ids']
  const ids = Array.isArray(rawIds)
    ? rawIds.filter((id): id is string => typeof id === 'string')
    : Object.keys(byId)

  const phase = str(source, 'phase')
  return {
    ids,
    byId,
    current: str(source, 'current'),
    ...(phase === undefined ? {} : { phase }),
  }
}

/**
 * Adapt one list snapshot, memoized by its identity.
 *
 * @param state - the runtime's `sessions.list` snapshot.
 * @returns the fork-shaped snapshot, stable for as long as the input is.
 */
export function adaptSessionList(state: unknown): SessionListState {
  const source = record(state)
  if (source === undefined) return EMPTY
  const cached = adapted.get(source)
  if (cached !== undefined) return cached

  const rawById = record(source['byId']) ?? {}
  const alreadyProjected = Array.isArray(source['ids'])
    && Object.values(rawById).every(isProjectedRow)

  // Nothing to do: keep the runtime's own object, so every downstream identity
  // comparison — and every field this adapter does not know about — survives intact.
  const result = alreadyProjected
    ? source as unknown as SessionListState
    : buildList(source, rawById)

  adapted.set(source, result)
  return result
}

/**
 * Wrap a raw session-list hook so its selectors see the adapted snapshot.
 *
 * A factory rather than a hook, so the caller can adapt a hook it receives as a prop
 * (`useSessions`) without itself having to become one — the browser destructures the
 * hook from its props and calls it in a dozen places.
 *
 * @param raw - the runtime's `useSessions` standard hook.
 * @returns a hook with the same contract over the adapted snapshot.
 */
export function adaptSessionsHook(
  raw: SnapshotSelectorHook<unknown>,
): SnapshotSelectorHook<SessionListState> {
  return <S>(selector: (state: SessionListState) => S, equals?: (a: S, b: S) => boolean): S =>
    raw((state: unknown) => selector(adaptSessionList(state)), equals)
}
