/**
 * `dsh-master` — host half.
 *
 * The plugin is a **management-plane consumer of a dsh-coordinator**. It opens no
 * listening socket of its own, spawns nothing, and holds no node credential; it
 * reaches the coordinator's HTTP API with an operator token and mirrors what comes
 * back into the local web GUI. `dsh-node` occupies the opposite position — outbound
 * WebSocket, node token, one machine.
 *
 * ## What this half does
 *
 * 1. Builds the coordinator client from configuration.
 * 2. Publishes {@link MasterService} as `ctx.dshMaster`, so the routes and any other
 *    plugin reach the roster the same way.
 * 3. Registers `/dsh-master/api/*` on the host's web server, **if** this profile has
 *    one.
 *
 * ## Why `webServer` is not in `inject`
 *
 * The routes exist for one consumer — the panel — so a hard dependency would stop the
 * plugin mounting in a profile with no web server, which is a legitimate headless
 * deployment. `ctx.inject` asks for the service and runs the callback whenever it
 * appears, so the service half works everywhere and the UI half appears wherever
 * there is a server to serve it.
 *
 * @module dsh-master
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Config, resolveConfig } from './config.js'
import { CoordinatorClient } from './coordinator/client.js'
import { createMasterRouteHandler } from './http-api.js'
import { cordisLogSink, createMasterLogger } from './log.js'
import { ROUTE_PREFIX } from './protocol.js'
import { MASTER_SERVICE_KEY, MasterService } from './service.js'

/** The package name; the Loader requires this to equal `package.json`'s `name`. */
export const name = 'dsh-master'

/**
 * No hard service dependencies.
 *
 * `webServer` is requested softly in {@link apply} instead, so a profile without a
 * web server still gets a mounted service rather than a plugin that never activates.
 */
export const inject = [] as const

export { Config, resolveConfig } from './config.js'
export type { MasterConfig } from './config.js'
export * from './protocol.js'
export { MasterService, MASTER_SERVICE_KEY } from './service.js'
export { CoordinatorClient, MasterUpstreamError } from './coordinator/client.js'
export type { CoordinatorClientOptions } from './coordinator/client.js'
export { createMasterRouteHandler, MAX_PROMPT_BODY_BYTES } from './http-api.js'
export type { MasterRouteDeps } from './http-api.js'
export { isLoopbackHostname, isTrustedMasterRequest } from './net/trust-fence.js'
export { cordisLogSink, createMasterLogger, REDACTED } from './log.js'
export type { MasterLogger, MasterLogLevel, MasterLogSink } from './log.js'

/**
 * The slice of `@deepseek-ai/dsh-host-webserver` this plugin uses.
 *
 * Structural on purpose: this plugin is out of tree, and assuming an official package
 * is resolvable next to it at runtime is how a plugin stops loading without saying so.
 */
interface WebServerLike {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void
  }): () => void
}

/**
 * Read the extra authorities this deployment serves, if it declared any.
 *
 * `webRuntime` is optional and only exists where the host serves more than loopback,
 * so it is read structurally and its absence is normal rather than an error.
 *
 * @param ctx - host context.
 * @returns the declared authorities, or `undefined` when the service is absent.
 */
function readRuntimeTrustedHosts(ctx: Context): readonly string[] | undefined {
  const runtime = (ctx.get as unknown as (key: string, strict?: boolean) => unknown)('webRuntime', false)
  const hosts = (runtime as { trustedHosts?: unknown } | undefined)?.trustedHosts
  if (!Array.isArray(hosts)) return undefined
  return hosts.filter((entry): entry is string => typeof entry === 'string')
}

/**
 * Mount the plugin.
 *
 * @param ctx - host context.
 * @param config - raw Loader configuration; validated permissively by {@link resolveConfig}.
 */
export function apply(ctx: Context, config?: unknown): void {
  const resolved = resolveConfig(config)
  const sink = cordisLogSink((ctx as unknown as { logger?: unknown }).logger)
  const logger = createMasterLogger({
    ...(resolved.apiToken === undefined ? {} : { secrets: [resolved.apiToken] }),
    // Absent rather than `undefined`: the logger's option type distinguishes them.
    ...(sink === undefined ? {} : { sink }),
  })

  const client = new CoordinatorClient({
    baseUrl: resolved.coordinatorUrl,
    ...(resolved.apiToken === undefined ? {} : { apiToken: resolved.apiToken }),
    requestTimeoutMs: resolved.requestTimeoutMs,
  })
  const service = new MasterService(client, resolved.allowPrompt)
  ctx.provide(MASTER_SERVICE_KEY, service)

  // No network call here. Mounting must not depend on another process being up, and
  // the panel's first `GET /api/status` is a better place to report unreachability:
  // it has somewhere to show the answer.
  logger.info('dsh-master/mounted', {
    coordinatorUrl: resolved.coordinatorUrl,
    credentialPresent: resolved.apiToken !== undefined,
    promptEnabled: resolved.allowPrompt,
  })

  ctx.inject(['webServer'], (scoped) => {
    const webServer = (scoped as unknown as { webServer?: WebServerLike }).webServer
    if (webServer === undefined) return

    scoped.effect(() => webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: createMasterRouteHandler({
        // Read through the mount-time closure: the service has no per-request state,
        // and rebuilding it would drop the coordinator client for no reason.
        service: () => service,
        trustedHosts: () => readRuntimeTrustedHosts(ctx) ?? resolved.trustedHosts,
      }),
    }))
  })
}
