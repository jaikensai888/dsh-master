import { describe, expect, it } from 'vitest'
import { conversationWidth } from '../src/client/conversation-width.js'

describe('official conversation width', () => {
  it('uses the measured panel width, not the absent local-conversation ancestor variable', () => {
    expect(conversationWidth(1570, null)).toBe(920)
    expect(conversationWidth(1200, null)).toBe(768)
    expect(conversationWidth(600, null)).toBe(680) // CSS width:100% caps narrow columns.
  })
  it('respects the official saved preference and edge budget without trusting invalid storage', () => {
    expect(conversationWidth(1570, '1004')).toBe(1004)
    expect(conversationWidth(1000, '1004')).toBe(824)
    expect(conversationWidth(1000, 'broken')).toBe(680)
    expect(conversationWidth(1570, '0')).toBe(920)
  })
})
