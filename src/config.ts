/**
 * Deployment configuration for the host half.
 *
 * ## Why the schema is deliberately permissive
 *
 * `schemastery` is non-strict: unknown keys survive validation and reach
 * `apply()`. That is the load-bearing property here — a `cordis.patch.yml` written
 * against a newer `dsh-master` must not fail to mount on an older one, because a
 * plugin that throws in `apply()` takes the whole profile entry down with it.
 *
 * ## The token
 *
 * `apiToken` is the coordinator's **operator** token, not a node token. It is the
 * credential that can prompt sessions on every registered machine, so:
 *
 * - it is read from config only and is never surfaced on any route;
 * - no error message, log line, or `MasterError.details` may include it;
 * - `test/credential-hygiene.test.ts` fails the build if a source file other than
 *   this one mentions it alongside a log call.
 *
 * @module dsh-master/config
 */

import z from 'schemastery'

/** Resolved configuration, after defaults. */
export interface MasterConfig {
  /** Coordinator origin, e.g. `http://127.0.0.1:39472`. No trailing path. */
  coordinatorUrl: string
  /** Operator API token. Absent means every coordinator call will be rejected with 401. */
  apiToken?: string
  /**
   * Extra authorities whose pages may call `/dsh-master/api/*`.
   *
   * The routes are not behind the browser-session cookie, so the trust fence is the
   * only thing between them and a hostile page. A `Host` of `evil.example` that
   * resolves to loopback is exactly the attack this list does *not* widen.
   */
  trustedHosts: string[]
  /**
   * Whether the panel's composer may send prompts.
   *
   * Off by default. A prompt runs a real agent turn on a remote machine — it can
   * edit files and execute tools there — so enabling it must be a deliberate act by
   * whoever deployed this plugin, not a side effect of installing it.
   */
  allowPrompt: boolean
  /** Deadline for one coordinator unary call. */
  requestTimeoutMs: number
}

/** The schema the Loader validates a `cordis.patch.yml` config against. */
export const Config = z.object({
  coordinatorUrl: z.string().default('http://127.0.0.1:39472'),
  apiToken: z.string(),
  trustedHosts: z.array(z.string()).default([]),
  allowPrompt: z.boolean().default(false),
  requestTimeoutMs: z.natural().default(30_000),
})

/**
 * Fold raw Loader config into the shape the rest of the plugin reads.
 *
 * Written by hand rather than trusting the schema's output so the defaults live in
 * one readable place, and so an explicit `undefined` (which `exactOptionalPropertyTypes`
 * distinguishes from an absent key) is normalized rather than leaking inward.
 *
 * @param raw - whatever the Loader handed `apply()`.
 * @returns the resolved configuration.
 */
export function resolveConfig(raw: unknown): MasterConfig {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const url = typeof source['coordinatorUrl'] === 'string' && source['coordinatorUrl'] !== ''
    ? source['coordinatorUrl']
    : 'http://127.0.0.1:39472'
  const token = typeof source['apiToken'] === 'string' && source['apiToken'] !== '' ? source['apiToken'] : undefined
  const hosts = Array.isArray(source['trustedHosts'])
    ? source['trustedHosts'].filter((entry): entry is string => typeof entry === 'string')
    : []
  const timeout = typeof source['requestTimeoutMs'] === 'number' && source['requestTimeoutMs'] > 0
    ? source['requestTimeoutMs']
    : 30_000
  const allowPrompt = source['allowPrompt'] === true
  return {
    // A trailing slash would double up once a path is appended.
    coordinatorUrl: url.replace(/\/+$/u, ''),
    ...(token === undefined ? {} : { apiToken: token }),
    trustedHosts: hosts,
    allowPrompt,
    requestTimeoutMs: timeout,
  }
}
