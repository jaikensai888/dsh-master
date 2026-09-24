import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.js'

describe('resolveConfig', () => {
  it('falls back to a loopback coordinator and a disabled composer', () => {
    const config = resolveConfig(undefined)
    expect(config.coordinatorUrl).toBe('http://127.0.0.1:39472')
    expect(config.apiToken).toBeUndefined()
    expect(config.trustedHosts).toEqual([])
    // The default that matters most: installing the plugin must not, by itself,
    // allow prompts to run on other machines.
    expect(config.allowPrompt).toBe(false)
    expect(config.requestTimeoutMs).toBe(30_000)
  })

  it('strips trailing slashes so an appended path cannot double up', () => {
    expect(resolveConfig({ coordinatorUrl: 'http://10.0.0.5:39472///' }).coordinatorUrl)
      .toBe('http://10.0.0.5:39472')
  })

  it('treats an empty token as absent rather than as a credential', () => {
    expect(resolveConfig({ apiToken: '' }).apiToken).toBeUndefined()
    expect(resolveConfig({ apiToken: 'secret' }).apiToken).toBe('secret')
  })

  it('keeps unknown keys from breaking the mount', () => {
    // schemastery is non-strict, and a patch written against a newer plugin must not
    // fail to mount on an older one.
    expect(() => resolveConfig({ fromTheFuture: { nested: true } })).not.toThrow()
  })

  it('drops non-string trusted hosts instead of trusting them', () => {
    expect(resolveConfig({ trustedHosts: ['example.test', 7, null] }).trustedHosts).toEqual(['example.test'])
  })

  it('ignores a non-positive timeout rather than disabling the deadline', () => {
    expect(resolveConfig({ requestTimeoutMs: 0 }).requestTimeoutMs).toBe(30_000)
    expect(resolveConfig({ requestTimeoutMs: 1500 }).requestTimeoutMs).toBe(1500)
  })

  it('only enables prompting on an explicit true', () => {
    expect(resolveConfig({ allowPrompt: 'yes' }).allowPrompt).toBe(false)
    expect(resolveConfig({ allowPrompt: true }).allowPrompt).toBe(true)
  })
})
