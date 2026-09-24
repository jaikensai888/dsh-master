/**
 * A logger that cannot print the operator token.
 *
 * The coordinator's operator token can prompt sessions on every registered machine.
 * The realistic way such a secret escapes is not a missing guard at one call site —
 * it is a field added carelessly to a log call six months from now. So the redaction
 * lives **inside** the logger: every string that passes through, message or field
 * value, at any depth, is rewritten before it reaches a sink.
 *
 * Cordis's logger is *callable* (`ctx.logger('subsystem')` returns a named facade),
 * so the structural probe accepts functions as well as objects. Guarding on `object`
 * alone silently rejects the real thing and falls back to `console`.
 *
 * @module dsh-master/log
 */

/** Severity, matching Cordis's vocabulary. */
export type MasterLogLevel = 'debug' | 'info' | 'warn' | 'error'

/** Structured fields attached to one line. */
export type MasterLogFields = Readonly<Record<string, unknown>>

/** Where one scrubbed line goes. */
export type MasterLogSink = (level: MasterLogLevel, message: string, fields: MasterLogFields) => void

/** The logger call sites use. */
export interface MasterLogger {
  debug(message: string, fields?: MasterLogFields): void
  info(message: string, fields?: MasterLogFields): void
  warn(message: string, fields?: MasterLogFields): void
  error(message: string, fields?: MasterLogFields): void
}

/** The shape a Cordis logger is probed for. */
interface CordisLoggerLike {
  readonly info?: unknown
  readonly debug?: unknown
  readonly warn?: unknown
  readonly error?: unknown
}

/** What a redacted occurrence is replaced with. */
export const REDACTED = '<redacted>'

/**
 * Adapt a Cordis logger into a sink.
 *
 * @param logger - the value of `ctx.logger`, if any.
 * @returns a sink, or `undefined` when the value is not a usable logger.
 */
export function cordisLogSink(logger: unknown): MasterLogSink | undefined {
  const objectLike = (typeof logger === 'object' && logger !== null) || typeof logger === 'function'
  if (!objectLike) return undefined
  const candidate = logger as CordisLoggerLike
  if (typeof candidate.info !== 'function') return undefined
  return (level, message, fields) => {
    const write = candidate[level]
    if (typeof write !== 'function') return
    const target = write as (this: unknown, text: string, ...rest: unknown[]) => void
    const keys = Object.keys(fields)
    if (keys.length === 0) target.call(candidate, message)
    else target.call(candidate, `${message} %o`, fields)
  }
}

/** Fall back to the console, which is what an unmounted host has. */
const consoleSink: MasterLogSink = (level, message, fields) => {
  const keys = Object.keys(fields)
  const line = keys.length === 0 ? message : `${message} ${JSON.stringify(fields)}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

/**
 * Rewrite every occurrence of a secret inside one string.
 * @param text - the string to scrub.
 * @param secrets - non-empty secrets to remove.
 * @returns the scrubbed string.
 */
function scrubText(text: string, secrets: readonly string[]): string {
  let result = text
  for (const secret of secrets) {
    if (secret !== '') result = result.split(secret).join(REDACTED)
  }
  return result
}

/**
 * Scrub a field value at any depth.
 *
 * Objects and arrays are walked rather than stringified-then-scrubbed so a nested
 * value stays structured in the log output. `seen` breaks cycles: a logger that
 * overflows the stack on a self-referencing field turns a debugging aid into an
 * outage, and the whole point of this module is that logging stays safe.
 *
 * @param value - the value to scrub.
 * @param secrets - non-empty secrets to remove.
 * @param seen - objects already visited on this path.
 * @returns the scrubbed value.
 */
function scrubValue(value: unknown, secrets: readonly string[], seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') return scrubText(value, secrets)
  if (typeof value !== 'object' || value === null) return value
  if (seen.has(value)) return '<cycle>'
  seen.add(value)
  if (Array.isArray(value)) return value.map(entry => scrubValue(entry, secrets, seen))
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    result[scrubText(key, secrets)] = scrubValue(entry, secrets, seen)
  }
  return result
}

/** Options for {@link createMasterLogger}. */
export interface MasterLoggerOptions {
  /** Secrets that must never appear. Empty strings are ignored. */
  readonly secrets?: readonly string[]
  /** Destination. Defaults to `console`. */
  readonly sink?: MasterLogSink
}

/**
 * Build a redacting logger.
 *
 * @param options - secrets and destination.
 * @returns the logger.
 */
export function createMasterLogger(options: MasterLoggerOptions = {}): MasterLogger {
  const secrets = (options.secrets ?? []).filter(secret => secret !== '')
  const sink = options.sink ?? consoleSink
  const emit = (level: MasterLogLevel, message: string, fields: MasterLogFields): void => {
    sink(level, scrubText(message, secrets), scrubValue(fields, secrets) as MasterLogFields)
  }
  return {
    debug: (message, fields = {}) => { emit('debug', message, fields) },
    info: (message, fields = {}) => { emit('info', message, fields) },
    warn: (message, fields = {}) => { emit('warn', message, fields) },
    error: (message, fields = {}) => { emit('error', message, fields) },
  }
}
