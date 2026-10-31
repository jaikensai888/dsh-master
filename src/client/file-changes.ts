/**
 * File-change cards for the remote conversation: which files a `write`/`edit` call
 * touched, what it changed, and the per-turn roll-up the panel draws above it.
 *
 * Everything here is **pure** and derived from two wire facts only:
 *
 * - `tool/call.data.name` + `.arguments` — the model-facing call, parsed from the
 *   **original** argument string (never the 800-character display preview);
 * - `tool/result.data.meta.diffs` — the tool-owned hunk list the fs tools persist
 *   with their result (see `dsh-tool-fs`'s `presentationMeta`).
 *
 * A remote node is not necessarily this DSH version, so the shape below is read
 * defensively and mirrors the installed `dsh-client-ui-tool` derivation rather than
 * re-inventing it:
 *
 * - a settled `write` with valid empty metadata falls back to the whole-file diff from
 *   its own arguments (create / identical overwrite), while a settled `edit` without
 *   valid hunks falls back to the generic row — call arguments are an intention, not
 *   proof that a file changed;
 * - a failed result never becomes a change card;
 * - `str_replace_editor` settles through the generic row, matching the shipped model;
 * - persisted hunks carry the backend's canonical path (`meta.path`), so the recorded
 *   path is mapped back to the call's `file_path` when the two refer to one file.
 *
 * The turn roll-up is **not** the local `workspace/changes` summary: that one is
 * recorded by a Host-side git snapshot service and only its `turn` number crosses the
 * wire. This module therefore derives the same *card shape* from the diffs the tools
 * did publish, with the aggregation rules stated on {@link turnChanges}.
 *
 * @module dsh-master/client/file-changes
 */

/** One file change, in the shape the fs tools publish in result metadata. */
export interface FileDiffHunk {
  /** Path recorded by the tool (the backend's canonical path when persisted). */
  readonly path: string
  /** Text before the change, or `null` for a new file / nothing on the removed side. */
  readonly oldText: string | null
  /** Text after the change. */
  readonly newText: string
}

/**
 * Result metadata after narrowing but **before** it is resolved against its call.
 *
 * It stays on the transient `tool/result` row only; {@link settleChange} turns it
 * into a renderable change once the paired call (and therefore the tool name and the
 * model-facing path) is known.
 */
export type ResultDiffs =
  | { readonly kind: 'hunks'; readonly diffs: readonly FileDiffHunk[]; readonly recordedPath?: string }
  | { readonly kind: 'empty' }

/** A renderable file change for one call. */
export interface FileChange {
  /** Wire tool name (`write`, `edit`, `str_replace_editor`). */
  readonly tool: string
  /** Model-facing path from the call arguments; what the card displays. */
  readonly path: string
  /** One entry per hunk, in file order. */
  readonly diffs: readonly FileDiffHunk[]
  /**
   * `intent` — the call has not settled; the diff is what it intends to write.
   * `applied` — a settled, non-error result published these hunks (or a `write`
   * fell back to its arguments because nothing changed on disk).
   */
  readonly phase: 'intent' | 'applied'
}

/** One changed file in a turn roll-up. */
export interface ChangedFile {
  readonly path: string
  readonly added: number
  readonly deleted: number
  /** The hunk was too large to line-compare within budget; counts are withheld. */
  readonly oversized?: true
}

/** What one turn changed, in the shape the compact card renders. */
export interface FileChangeSummary {
  readonly turn: number
  /** Distinct paths, sorted for a stable order across replays. */
  readonly files: readonly ChangedFile[]
  /** Number of distinct files (not number of hunks). */
  readonly total: number
  readonly added: number
  readonly deleted: number
}

/** Line cells a single hunk may spend on the line comparison before it is "oversized". */
export const LINE_DIFF_BUDGET = 250_000

/** Narrow an unknown JSON value to a plain record. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Parse one argument string; anything but a JSON object is unusable. */
function parseArguments(raw: string): Record<string, unknown> | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  return asRecord(value)
}

/** Validate one persisted hunk; a single malformed entry invalidates the list. */
function isHunk(value: unknown): value is FileDiffHunk {
  const hunk = asRecord(value)
  if (hunk === undefined) return false
  const { path, oldText, newText } = hunk
  return typeof path === 'string'
    && (oldText === null || typeof oldText === 'string')
    && typeof newText === 'string'
}

/**
 * Narrow `meta.diffs` from a settled tool result.
 *
 * @param meta - the opaque `tool/result.data.meta`.
 * @returns the narrowed hunks, `'empty'` for a present but empty list, or `undefined`
 *   when the payload is absent, not an array, or malformed.
 */
export function readResultDiffs(meta: unknown): ResultDiffs | undefined {
  const record = asRecord(meta)
  const raw = record?.['diffs']
  if (!Array.isArray(raw)) return undefined
  if (raw.length === 0) return { kind: 'empty' }
  if (!raw.every(isHunk)) return undefined
  const recordedPath = record === undefined ? undefined : record['path']
  return {
    kind: 'hunks',
    diffs: raw.map(({ path, oldText, newText }) => ({ path, oldText, newText })),
    ...(typeof recordedPath === 'string' ? { recordedPath } : {}),
  }
}

/**
 * Derive the diff a call intends, from its own arguments.
 *
 * This is the running-state card, so it is deliberately conservative: a tool this
 * model does not support, an unparseable argument string, or a missing/blank path all
 * return `undefined` and leave the generic tool row in place.
 *
 * @param name - wire tool name.
 * @param raw - the call's original `arguments` string (not a truncated preview).
 * @returns the intended change, or `undefined`.
 */
export function intentChange(name: string, raw: string): FileChange | undefined {
  if (name !== 'write' && name !== 'edit' && name !== 'str_replace_editor') return undefined
  const args = parseArguments(raw)
  if (args === undefined) return undefined

  if (name === 'str_replace_editor') {
    const { command, path, file_text: fileText, old_str: oldText, new_str: newText } = args
    if (typeof path !== 'string' || path.trim() === '') return undefined
    if (command === 'create') {
      if (fileText !== undefined && typeof fileText !== 'string') return undefined
      return { tool: name, path, diffs: [{ path, oldText: null, newText: fileText ?? '' }], phase: 'intent' }
    }
    if (command === 'str_replace') {
      if (oldText !== undefined && typeof oldText !== 'string') return undefined
      if (newText !== undefined && typeof newText !== 'string') return undefined
      return { tool: name, path, diffs: [{ path, oldText: oldText ?? null, newText: newText ?? '' }], phase: 'intent' }
    }
    return undefined
  }

  const { file_path: path } = args
  if (typeof path !== 'string' || path.trim() === '') return undefined
  if (name === 'write') {
    const { content } = args
    return typeof content === 'string'
      ? { tool: name, path, diffs: [{ path, oldText: null, newText: content }], phase: 'intent' }
      : undefined
  }
  const { old_string: oldText, new_string: newText, replace_all: replaceAll } = args
  if (typeof oldText !== 'string' || typeof newText !== 'string') return undefined
  if (replaceAll !== undefined && typeof replaceAll !== 'boolean') return undefined
  return { tool: name, path, diffs: [{ path, oldText: oldText === '' ? null : oldText, newText }], phase: 'intent' }
}

/**
 * Resolve a running call's intended change against its settled result.
 *
 * Mirrors the shipped `diffCardModel` decisions:
 * - `str_replace_editor` has no result-time presentation, so it settles as generic;
 * - valid hunks replace the intention, with the recorded canonical path mapped back to
 *   the call's model-facing path;
 * - valid-but-empty metadata (or absent metadata) keeps a `write`'s whole-file diff,
 *   because "nothing on the removed side" is what that tool means, and drops an
 *   `edit`'s intention, because an edit without published hunks did not prove a change.
 *
 * @param change - the running change derived from the call arguments.
 * @param result - the settled result's narrowed diff metadata, if any.
 * @returns the applied change, or `undefined` to fall back to the generic row.
 */
export function settleChange(change: FileChange, result: ResultDiffs | undefined): FileChange | undefined {
  if (change.tool === 'str_replace_editor') return undefined
  if (result?.kind === 'hunks') {
    const recorded = result.recordedPath
    const diffs = recorded === undefined
      ? result.diffs
      : result.diffs.map(hunk => hunk.path === recorded ? { ...hunk, path: change.path } : hunk)
    return { ...change, diffs: [...diffs], phase: 'applied' }
  }
  return change.tool === 'write' ? { ...change, phase: 'applied' } : undefined
}

/** Split one side of a hunk into its content lines, without a terminating newline. */
export function contentLines(text: string | null): string[] {
  if (text === null || text === '') return []
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n')
}

/** Length of the longest common subsequence of two line lists, or `undefined` over budget. */
function commonLineCount(before: readonly string[], after: readonly string[]): number | undefined {
  const rows = before.length
  const columns = after.length
  if (rows === 0 || columns === 0) return 0
  if ((rows + 1) * (columns + 1) > LINE_DIFF_BUDGET) return undefined
  let previous = new Uint32Array(columns + 1)
  let current = new Uint32Array(columns + 1)
  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= columns; column += 1) {
      current[column] = before[row - 1] === after[column - 1]
        ? (previous[column - 1] ?? 0) + 1
        : Math.max(previous[column] ?? 0, current[column - 1] ?? 0)
    }
    const swap = previous
    previous = current
    current = swap
    current.fill(0)
  }
  return previous[columns] ?? 0
}

/**
 * Count the lines one hunk really adds and removes.
 *
 * Hunks carry three context lines per side, and the two sides repeat their common
 * context, so counting lines directly would report an edited context block as changed.
 * Trimming the shared prefix and suffix first keeps the comparison to the changed
 * region, and the remaining lines get one LCS pass. A hunk beyond
 * {@link LINE_DIFF_BUDGET} returns `oversized` instead of a guess.
 *
 * @param oldText - the removed side, or `null`.
 * @param newText - the added side.
 * @returns the net added/removed line counts, or `oversized` when it cannot be compared.
 */
export function lineDelta(oldText: string | null, newText: string): { added: number; deleted: number; oversized?: true } {
  const before = contentLines(oldText)
  const after = contentLines(newText)
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1
  const removed = before.slice(prefix, before.length - suffix)
  const added = after.slice(prefix, after.length - suffix)
  const common = commonLineCount(removed, added)
  if (common === undefined) return { added: 0, deleted: 0, oversized: true }
  return { added: added.length - common, deleted: removed.length - common }
}

/** Sum one change's hunks for its own card header. */
export function changeStats(change: FileChange): { added: number; deleted: number; oversized?: true } {
  let added = 0
  let deleted = 0
  let oversized = false
  for (const hunk of change.diffs) {
    const delta = lineDelta(hunk.oldText, hunk.newText)
    added += delta.added
    deleted += delta.deleted
    if (delta.oversized === true) oversized = true
  }
  return { added, deleted, ...(oversized ? { oversized: true as const } : {}) }
}

/**
 * Build the turn roll-up from the applied changes of that turn's rows.
 *
 * Rules (stated because the local `workspace/changes` summary they mimic is not on the
 * wire, so this is derived, not copied):
 * - **Scope**: one turn. A conversation item is one turn; no cross-turn accumulation.
 * - **Completed only**: callers pass rows of one turn and this drops every change that
 *   is still an intention, so a running or failed call never counts as a modification.
 * - **One row per path**: repeated modifications of one file in a turn collapse into a
 *   single row, and their added/removed lines add up. The local summary can net a file
 *   against its turn-start snapshot; diffs alone cannot, so summation is the only
 *   honest arithmetic and the row is labelled by the same path.
 * - **Net line counts**: context lines are excluded (see {@link lineDelta}), so a
 *   one-line edit reads `+1 -1` rather than `+4 -4`.
 * - **Oversized hunks**: too large to compare within budget, so that file keeps no
 *   counts and the card shows `过大` instead of a fabricated number.
 *
 * @param turn - the turn number the rows belong to.
 * @param changes - every change the turn's rows carry, applied or not.
 * @returns the summary, or `undefined` when the turn changed nothing.
 */
export function turnChanges(turn: number, changes: readonly FileChange[]): FileChangeSummary | undefined {
  const byPath = new Map<string, { added: number; deleted: number; oversized: boolean }>()
  for (const change of changes) {
    if (change.phase !== 'applied') continue
    for (const hunk of change.diffs) {
      const current = byPath.get(hunk.path) ?? { added: 0, deleted: 0, oversized: false }
      const delta = lineDelta(hunk.oldText, hunk.newText)
      current.added += delta.added
      current.deleted += delta.deleted
      if (delta.oversized === true) current.oversized = true
      byPath.set(hunk.path, current)
    }
  }
  if (byPath.size === 0) return undefined
  const files = [...byPath.entries()]
    .map(([path, counts]): ChangedFile => counts.oversized
      ? { path, added: 0, deleted: 0, oversized: true }
      : { path, added: counts.added, deleted: counts.deleted })
    .sort((left, right) => left.path.localeCompare(right.path))
  return {
    turn,
    files,
    total: files.length,
    added: files.reduce((sum, file) => sum + file.added, 0),
    deleted: files.reduce((sum, file) => sum + file.deleted, 0),
  }
}

/** Trailing path segment, which is what a single-file card titles itself with. */
export function displayName(path: string): string {
  const parts = path.split(/[/\\]/u).filter(part => part !== '')
  return parts[parts.length - 1] ?? path
}

/**
 * Strip the session workspace root from a recorded absolute path.
 *
 * Persisted hunks can name the backend's canonical path, which is the remote machine's
 * layout rather than something this panel should put on screen; the call's
 * `file_path` is preferred, and this is the fallback for a node that sent only the
 * canonical form.
 *
 * @param path - a recorded or model-facing path.
 * @param cwd - the session working directory from the snapshot header, if any.
 * @returns the path relative to `cwd` when it is rooted there, otherwise unchanged.
 */
export function displayPath(path: string, cwd?: string): string {
  if (cwd === undefined || cwd === '') return path
  const root = cwd.replace(/[/\\]+$/u, '')
  if (root === '') return path
  if (path.startsWith(`${root}/`) || path.startsWith(`${root}\\`)) return path.slice(root.length + 1)
  return path
}
