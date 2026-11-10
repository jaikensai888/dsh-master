/**
 * The one-line preview a tool row shows: what the call was asked to do.
 *
 * The transcript shows one compact row per tool call, and that row is the only place
 * a reader decides whether to open it. It used to show the **first line of the
 * result**, which is not a summary of anything: a `bash` call surfaced a fragment of
 * its own output (`=== uv ===`), and a `grep` over a minified bundle surfaced a wall
 * of hex. The preview therefore comes from the call's own arguments — the command,
 * the path, the pattern — so the row answers "what ran here?" at a glance, and the
 * output stays one click away in the row's body.
 *
 * Arguments arrive as the model wrote them: normally a JSON object, sometimes a bare
 * string, and sometimes already cut to the display limit, which makes the JSON
 * unparsable. The first shape is read as a field, the last through a tolerant field
 * scan. A call whose arguments carry none of these fields gets no preview at all
 * rather than a dump of its JSON.
 *
 * Pure and dependency-free so the preview rules are testable without a DOM.
 *
 * @module dsh-master/client/tool-preview
 */

import { inline, truncate } from './wire.js'

/** Longest preview a tool row carries before CSS ellipsis takes over. */
export const TOOL_PREVIEW_LIMIT = 160

/**
 * Fields that describe a call, in the order a reader wants to see them.
 *
 * A path comes first because the tools that carry both a path and a `command` use that
 * field for an operation name (`str_replace`), not for a command line. The first match
 * wins: a `bash` call has only `command`, while a `write` has only `file_path`, so one
 * list serves every tool without a per-tool table that would silently miss a name the
 * node introduces later.
 */
const PREVIEW_FIELDS = [
  'file_path',
  'path',
  'filename',
  'command',
  'cmd',
  'script',
  'pattern',
  'query',
  'url',
  'description',
  'prompt',
] as const

/** Parse one argument string as a JSON object, or `undefined` for every other shape. */
function parseObject(raw: string): Record<string, unknown> | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Decode the body of one JSON string literal, falling back to the text as written. */
function decodeString(body: string): string {
  try {
    const value: unknown = JSON.parse(`"${body}"`)
    return typeof value === 'string' ? value : body
  } catch {
    return body
  }
}

/** Read the first usable field out of a parsed argument object. */
function fieldPreview(args: Record<string, unknown>): string | undefined {
  for (const field of PREVIEW_FIELDS) {
    const value = args[field]
    if (typeof value !== 'string') continue
    const text = inline(value)
    if (text !== '') return text
  }
  return undefined
}

/**
 * Scan arguments that are not valid JSON: truncated JSON, a bare command string.
 *
 * A truncated object still carries its field names and the beginning of their
 * values, and quoting is what a scan can rely on; the string body stops at the
 * truncation the same way the display preview does.
 */
function scanPreview(raw: string): string | undefined {
  for (const field of PREVIEW_FIELDS) {
    const match = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`, 'u').exec(raw)
    if (match === null) continue
    const text = inline(decodeString(match[1] ?? ''))
    if (text !== '') return text
  }
  // Neither JSON nor a field scan: the arguments are the text (a bare command line).
  const bare = inline(raw)
  return bare === '' ? undefined : bare
}

/**
 * Preview one tool call from the arguments the node reported.
 *
 * @param raw - the call's `arguments` string, already cut to the display limit.
 * @returns one collapsed, length-capped line, or `undefined` when nothing describes the call.
 */
export function toolPreview(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  if (raw.trim() === '') return undefined
  const args = parseObject(raw)
  const text = args === undefined ? scanPreview(raw) : fieldPreview(args)
  return text === undefined ? undefined : truncate(text, TOOL_PREVIEW_LIMIT)
}

/**
 * Preview a row that has no call to describe it — a result without its call.
 *
 * @param text - the result body.
 * @returns the collapsed first line, length-capped, or `undefined` when it is blank.
 */
export function resultPreview(text: string): string | undefined {
  const first = text.split(/\r?\n/u, 1)[0] ?? ''
  const collapsed = inline(first)
  return collapsed === '' ? undefined : truncate(collapsed, TOOL_PREVIEW_LIMIT)
}
