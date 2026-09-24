import { describe, expect, it, vi } from 'vitest'
import { REDACTED, createMasterLogger, type MasterLogSink } from '../src/log.js'

/**
 * Build a logger whose lines are collected as strings.
 * @returns the logger and the collected lines.
 */
function recording(): { logger: ReturnType<typeof createMasterLogger>; lines: string[] } {
  const lines: string[] = []
  const sink: MasterLogSink = (level, message, fields) => {
    lines.push(`${level} ${message} ${JSON.stringify(fields)}`)
  }
  return { logger: createMasterLogger({ secrets: ['tok-123'], sink }), lines }
}

describe('createMasterLogger', () => {
  it('redacts the operator token from a message', () => {
    const { logger, lines } = recording()
    logger.info('connecting with tok-123')
    expect(lines[0]).not.toContain('tok-123')
    expect(lines[0]).toContain(REDACTED)
  })

  it('redacts inside nested field values and array entries', () => {
    const { logger, lines } = recording()
    logger.warn('probe', {
      headers: { authorization: 'Bearer tok-123' },
      attempts: ['tok-123'],
    })
    expect(lines[0]).not.toContain('tok-123')
    expect(lines[0]?.match(/<redacted>/gu)?.length).toBe(2)
  })

  it('redacts a secret used as a field key', () => {
    const { logger, lines } = recording()
    logger.info('map', { 'tok-123': 'value' })
    expect(lines[0]).not.toContain('tok-123')
  })

  it('leaves other text alone', () => {
    const { logger, lines } = recording()
    logger.info('roster read', { nodes: 2 })
    expect(lines[0]).toContain('roster read')
    expect(lines[0]).toContain('"nodes":2')
  })

  it('ignores empty secrets rather than redacting everything', () => {
    const lines: string[] = []
    // An empty secret would otherwise match between every character.
    const logger = createMasterLogger({ secrets: [''], sink: (_l, message) => { lines.push(message) } })
    logger.info('readable text')
    expect(lines[0]).toBe('readable text')
  })

  it('survives a cyclic field instead of overflowing the stack', () => {
    const { logger, lines } = recording()
    const cyclic: Record<string, unknown> = { token: 'tok-123' }
    cyclic['self'] = cyclic
    expect(() => { logger.info('cyclic', cyclic) }).not.toThrow()
    expect(lines[0]).not.toContain('tok-123')
    expect(lines[0]).toContain('<cycle>')
  })

  it('falls back to console when no sink is supplied', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    createMasterLogger().info('hello')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
