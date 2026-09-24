import { describe, expect, it } from 'vitest'
import type { IncomingHttpHeaders } from 'node:http'
import { isLoopbackHostname, isTrustedMasterRequest } from '../src/net/trust-fence.js'

/** Build request facts from a plain header map. */
function request(headers: Record<string, string>): { headers: IncomingHttpHeaders } {
  return { headers }
}

describe('isLoopbackHostname', () => {
  it('accepts the loopback spellings a browser may produce', () => {
    expect(isLoopbackHostname('localhost')).toBe(true)
    expect(isLoopbackHostname('[::1]')).toBe(true)
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
  })

  it('refuses anything else, including near-miss addresses', () => {
    expect(isLoopbackHostname('evil.example')).toBe(false)
    expect(isLoopbackHostname('127.0.0.1.evil.example')).toBe(false)
    expect(isLoopbackHostname('127.0.0.256')).toBe(false)
    expect(isLoopbackHostname('10.0.0.1')).toBe(false)
  })
})

describe('isTrustedMasterRequest', () => {
  it('admits the app window on loopback', () => {
    expect(isTrustedMasterRequest(request({ host: '127.0.0.1:43120' }), [])).toBe(true)
    expect(isTrustedMasterRequest(request({ host: 'localhost:43120' }), [])).toBe(true)
  })

  it('refuses a rebound hostname even though it resolves to loopback', () => {
    // The whole point of the fence: the browser sends this Host for a page served
    // from evil.example whose DNS answer is 127.0.0.1.
    expect(isTrustedMasterRequest(request({ host: 'evil.example' }), [])).toBe(false)
  })

  it('refuses cross-site markers', () => {
    expect(isTrustedMasterRequest(request({ host: '127.0.0.1', 'sec-fetch-site': 'cross-site' }), [])).toBe(false)
  })

  it('refuses a mismatched Origin and the opaque null Origin', () => {
    expect(isTrustedMasterRequest(request({ host: '127.0.0.1', origin: 'http://evil.example' }), [])).toBe(false)
    expect(isTrustedMasterRequest(request({ host: '127.0.0.1', origin: 'null' }), [])).toBe(false)
    expect(isTrustedMasterRequest(request({ host: '127.0.0.1', origin: 'http://127.0.0.1:43120' }), [])).toBe(true)
  })

  it('admits a declared authority, with and without a port', () => {
    expect(isTrustedMasterRequest(request({ host: 'box.lan:43120' }), ['box.lan'])).toBe(true)
    expect(isTrustedMasterRequest(request({ host: 'box.lan:9999' }), ['box.lan:9999'])).toBe(true)
    expect(isTrustedMasterRequest(request({ host: 'box.lan:43120' }), ['box.lan:9999'])).toBe(false)
  })

  it('refuses a request with no Host at all', () => {
    expect(isTrustedMasterRequest(request({}), [])).toBe(false)
  })
})
