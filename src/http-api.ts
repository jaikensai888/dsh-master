/**
 * The `/dsh-master/api/*` routes.
 *
 * Design constraints, each of which decides something below:
 *
 * - **The prefix is not authenticated.** DSH serves plugin prefixes outside the
 *   browser-session cookie, so every request passes the trust fence first. The fence
 *   is a rebinding defense, not auth; what it protects is a read-only mirror plus one
 *   opt-in action.
 * - **One error vocabulary.** Failures answer `{ok:false, error:{code,message,details}}`
 *   with `master/*` for our own refusals and the upstream code preserved for the
 *   coordinator's and the node's. `dsh-node`'s `nodeAdmin/*` codes and the coordinator's
 *   `session/*` codes both survive intact, so a caller can tell "you asked wrong" from
 *   "the remote refused".
 * - **The stream route is NDJSON, not a socket.** The browser reads it with `fetch` and
 *   a stream reader. A WebSocket would need `registerUpgrade` and an exact pathname, and
 *   would buy nothing: the traffic is one-directional.
 * - **Nothing here is cached.** A roster is a live fact; a cached one shows a machine
 *   that has already gone offline.
 *
 * @module dsh-master/http-api
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { isTrustedMasterRequest } from './net/trust-fence.js'
import { ROUTE_PREFIX, type MasterError, type MasterStreamRecord } from './protocol.js'
import type { MasterService } from './service.js'

/** Largest prompt body accepted, in bytes. A prompt is text; anything larger is a mistake. */
export const MAX_PROMPT_BODY_BYTES = 256 * 1024

/** Everything the route handler reads from its host. */
export interface MasterRouteDeps {
  /** The service the routes call. Read through a getter so a remount is picked up. */
  readonly service: () => MasterService | undefined
  /** Extra authorities whose pages may call these routes. */
  readonly trustedHosts: () => readonly string[]
}

/** One failure, ready to serialize. */
function failure(code: string, message: string, details?: Readonly<Record<string, unknown>>): MasterError {
  return { code, message, ...(details === undefined ? {} : { details }) }
}

/**
 * Write a JSON envelope and end the response.
 * @param response - the response to write.
 * @param status - HTTP status.
 * @param body - the envelope.
 */
function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.writableEnded) return
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(payload)),
    'cache-control': 'no-store',
  })
  response.end(payload)
}

/**
 * Write one failure and end the response.
 * @param response - the response to write.
 * @param status - HTTP status.
 * @param error - the normalized failure.
 */
function sendFailure(response: ServerResponse, status: number, error: MasterError): void {
  sendJson(response, status, { ok: false, error })
}

/**
 * Map a thrown value to an HTTP status and a wire error.
 *
 * Codes that begin with `master/` are ours and have a fixed status. Anything else came
 * from the coordinator or a node, where `401`-class refusals surface as
 * `coordinator/auth-rejected` and an unroutable node as `coordinator/node-offline`; both
 * are reported as `502` because from this plugin's point of view the upstream is what
 * failed, and the code is what tells the caller which part.
 *
 * @param error - the thrown value.
 * @returns the status and the wire error.
 */
function classify(error: unknown): { status: number; error: MasterError } {
  if (error instanceof Error && 'toWire' in error && typeof error.toWire === 'function') {
    const wire = (error as { toWire: () => MasterError }).toWire()
    return { status: wire.code.startsWith('master/') ? 502 : 200, error: wire }
  }
  const message = error instanceof Error ? error.message : 'unknown failure'
  return { status: 502, error: failure('master/internal', message) }
}

/** Read a required, non-empty query parameter. */
function requiredQuery(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)
  return value === null || value.trim() === '' ? undefined : value
}

/**
 * Read a bounded JSON request body.
 * @param request - the incoming request.
 * @returns the parsed body.
 * @throws {Error} `master/too-large` when the body exceeds the cap, `master/invalid-arguments` when it is not a JSON object.
 */
async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = chunk as Buffer
    size += buffer.byteLength
    if (size > MAX_PROMPT_BODY_BYTES) {
      const error = new Error(`request body exceeds ${String(MAX_PROMPT_BODY_BYTES)} bytes`)
      error.name = 'master/too-large'
      throw error
    }
    chunks.push(buffer)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    const error = new Error('request body is not JSON')
    error.name = 'master/invalid-arguments'
    throw error
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    const error = new Error('request body must be a JSON object')
    error.name = 'master/invalid-arguments'
    throw error
  }
  return parsed as Record<string, unknown>
}

/** Read a non-empty string field from a parsed body. */
function bodyText(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/**
 * Stream one session's frames as NDJSON.
 *
 * The `open` record is written before the first upstream frame arrives, so the client
 * can distinguish "connected, waiting" from "no answer yet" without a timeout. Once
 * the first byte is out the status is fixed, which is why a later failure is written
 * as an `error` record rather than as a status code — the same rule the coordinator
 * follows.
 *
 * @param request - the incoming request, used only for disconnect.
 * @param response - the response to stream into.
 * @param deps - route dependencies.
 * @param url - the parsed request URL.
 */
async function streamFollow(
  request: IncomingMessage,
  response: ServerResponse,
  deps: MasterRouteDeps,
  url: URL,
): Promise<void> {
  const nodeId = requiredQuery(url, 'nodeId')
  const sessionId = requiredQuery(url, 'sessionId')
  if (nodeId === undefined || sessionId === undefined) {
    sendFailure(response, 400, failure('master/invalid-arguments', 'nodeId and sessionId are required'))
    return
  }
  const service = deps.service()
  if (service === undefined) {
    sendFailure(response, 503, failure('master/unavailable', 'the master service is not mounted'))
    return
  }

  response.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    // Tells a buffering reverse proxy to pass chunks through; without it the whole
    // point of a streaming route is lost behind nginx.
    'x-accel-buffering': 'no',
  })

  // A closed panel must release the stream on the node; the coordinator cancels the
  // upstream stream when its own client disconnects, so aborting here is enough.
  const controller = new AbortController()
  response.on('close', () => { controller.abort() })

  const write = (record: MasterStreamRecord): void => {
    if (response.writableEnded) return
    response.write(`${JSON.stringify(record)}\n`)
  }

  write({ type: 'open', nodeId, sessionId })
  let count = 0
  try {
    for await (const value of service.follow(nodeId, sessionId, controller.signal)) {
      count += 1
      write({ type: 'data', value })
    }
    write({ type: 'end', count })
  } catch (error) {
    if (controller.signal.aborted) {
      // The client went away. There is nobody to tell, and the upstream is already
      // released, so this is a normal end rather than a failure to report.
      response.end()
      return
    }
    write({ type: 'error', error: classify(error).error, count })
  }
  response.end()
}

/**
 * Build the request handler for the `/dsh-master` prefix.
 *
 * @param deps - route dependencies.
 * @returns a handler for `webServer.register({kind:'prefix', path:'/dsh-master', …})`.
 */
export function createMasterRouteHandler(
  deps: MasterRouteDeps,
): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    void (async (): Promise<void> => {
      if (!isTrustedMasterRequest(request, deps.trustedHosts())) {
        sendFailure(response, 403, failure('master/forbidden', 'the request is not from a trusted page'))
        return
      }

      const url = new URL(request.url ?? '/', 'http://localhost')
      const route = url.pathname.startsWith(ROUTE_PREFIX)
        ? url.pathname.slice(ROUTE_PREFIX.length)
        : url.pathname
      const method = request.method ?? 'GET'

      if (route === '/api/status') {
        if (method !== 'GET' && method !== 'HEAD') {
          response.setHeader('allow', 'GET, HEAD')
          sendFailure(response, 405, failure('master/method-not-allowed', `${method} is not allowed here`))
          return
        }
        const service = deps.service()
        if (service === undefined) {
          sendFailure(response, 503, failure('master/unavailable', 'the master service is not mounted'))
          return
        }
        sendJson(response, 200, { ok: true, value: await service.status() })
        return
      }

      if (route === '/api/nodes') {
        if (method !== 'GET' && method !== 'HEAD') {
          response.setHeader('allow', 'GET, HEAD')
          sendFailure(response, 405, failure('master/method-not-allowed', `${method} is not allowed here`))
          return
        }
        const service = deps.service()
        if (service === undefined) {
          sendFailure(response, 503, failure('master/unavailable', 'the master service is not mounted'))
          return
        }
        try {
          sendJson(response, 200, { ok: true, value: await service.nodes() })
        } catch (error) {
          const mapped = classify(error)
          sendFailure(response, mapped.status, mapped.error)
        }
        return
      }

      if (route === '/api/sessions') {
        if (method !== 'GET' && method !== 'HEAD') {
          response.setHeader('allow', 'GET, HEAD')
          sendFailure(response, 405, failure('master/method-not-allowed', `${method} is not allowed here`))
          return
        }
        const nodeId = requiredQuery(url, 'nodeId')
        if (nodeId === undefined) {
          sendFailure(response, 400, failure('master/invalid-arguments', 'nodeId is required'))
          return
        }
        const service = deps.service()
        if (service === undefined) {
          sendFailure(response, 503, failure('master/unavailable', 'the master service is not mounted'))
          return
        }
        try {
          sendJson(response, 200, { ok: true, value: await service.sessions(nodeId) })
        } catch (error) {
          const mapped = classify(error)
          sendFailure(response, mapped.status, mapped.error)
        }
        return
      }

      if (route === '/api/session/follow') {
        if (method !== 'GET' && method !== 'HEAD') {
          response.setHeader('allow', 'GET, HEAD')
          sendFailure(response, 405, failure('master/method-not-allowed', `${method} is not allowed here`))
          return
        }
        await streamFollow(request, response, deps, url)
        return
      }

      if (route === '/api/session/archive') {
        if (method !== 'POST') {
          response.setHeader('allow', 'POST')
          sendFailure(response, 405, failure('master/method-not-allowed', `${method} is not allowed here`))
          return
        }
        const service = deps.service()
        if (service === undefined) {
          sendFailure(response, 503, failure('master/unavailable', 'the master service is not mounted'))
          return
        }
        let body: Record<string, unknown>
        try {
          body = await readJsonBody(request)
        } catch (error) {
          const code = error instanceof Error && error.name.startsWith('master/')
            ? error.name
            : 'master/invalid-arguments'
          const message = error instanceof Error ? error.message : 'unreadable request body'
          sendFailure(response, code === 'master/too-large' ? 413 : 400, failure(code, message))
          return
        }
        const nodeId = bodyText(body, 'nodeId')
        const sessionId = bodyText(body, 'sessionId')
        if (nodeId === undefined || sessionId === undefined) {
          sendFailure(response, 400, failure(
            'master/invalid-arguments',
            'nodeId and sessionId are required non-empty strings',
          ))
          return
        }
        try {
          const value = await service.archiveSession(nodeId, sessionId)
          sendJson(response, 200, { ok: true, value })
        } catch (error) {
          const mapped = classify(error)
          sendFailure(response, mapped.status, mapped.error)
        }
        return
      }

      if (route === '/api/session/prompt') {
        if (method !== 'POST') {
          response.setHeader('allow', 'POST')
          sendFailure(response, 405, failure('master/method-not-allowed', `${method} is not allowed here`))
          return
        }
        const service = deps.service()
        if (service === undefined) {
          sendFailure(response, 503, failure('master/unavailable', 'the master service is not mounted'))
          return
        }
        if (!service.promptEnabled) {
          // Refused before the body is read: the deployment's choice is not a function
          // of what the caller sent, and saying so early keeps the reason unambiguous.
          sendFailure(response, 403, failure(
            'master/prompt-disabled',
            'sending prompts is disabled; set allowPrompt in the dsh-master plugin config to enable it',
          ))
          return
        }
        let body: Record<string, unknown>
        try {
          body = await readJsonBody(request)
        } catch (error) {
          const code = error instanceof Error && error.name.startsWith('master/')
            ? error.name
            : 'master/invalid-arguments'
          const message = error instanceof Error ? error.message : 'unreadable request body'
          sendFailure(response, code === 'master/too-large' ? 413 : 400, failure(code, message))
          return
        }
        const nodeId = bodyText(body, 'nodeId')
        const sessionId = bodyText(body, 'sessionId')
        const text = bodyText(body, 'text')
        if (nodeId === undefined || sessionId === undefined || text === undefined) {
          sendFailure(response, 400, failure(
            'master/invalid-arguments',
            'nodeId, sessionId and text are required non-empty strings',
          ))
          return
        }
        const mode = body['mode'] === 'steer' ? 'steer' : 'queue'
        try {
          await service.prompt(nodeId, sessionId, text, mode)
          sendJson(response, 200, { ok: true, value: { accepted: true } })
        } catch (error) {
          const mapped = classify(error)
          sendFailure(response, mapped.status, mapped.error)
        }
        return
      }

      sendFailure(response, 404, failure('master/not-found', `no route for ${route}`))
    })().catch((error: unknown) => {
      // The async wrapper above should never reject — every branch answers. This is
      // the backstop so a bug here becomes a 500 rather than a hung request.
      const message = error instanceof Error ? error.message : 'unknown failure'
      sendFailure(response, 500, failure('master/internal', message))
    })
  }
}
