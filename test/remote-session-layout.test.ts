import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureStyles } from '../src/client/styles.js'

afterEach(() => { vi.unstubAllGlobals() })

class TestStyleElement {
  id = ''
  dataset: Record<string, string> = {}
  textContent: string | null = ''
}

function declaration(rule: string | undefined, property: string): string | undefined {
  if (rule === undefined) return undefined
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return rule.match(new RegExp(`(?:^|;)\\s*${escaped}\\s*:\\s*([^;]+)`, 'u'))?.[1]?.trim()
}

describe('remote conversation layout', () => {
  it('injects the same responsive content width and centered-column geometry as local chat', () => {
    let inserted: TestStyleElement | undefined
    vi.stubGlobal('HTMLStyleElement', TestStyleElement)
    vi.stubGlobal('document', {
      getElementById: () => null,
      createElement: () => new TestStyleElement(),
      head: { appendChild: (element: TestStyleElement) => { inserted = element } },
    })

    const style = ensureStyles()
    const css = style?.textContent ?? ''
    const rootRule = css.match(/\.dsh-master-root\s*\{([^}]*)\}/u)?.[1]
    const logRule = css.match(/\.dsh-master-log\s*\{([^}]*)\}/u)?.[1]
    const columnRule = css.match(/\.dsh-master-log-column\s*\{([^}]*)\}/u)?.[1]
    const composerRule = css.match(/\.dsh-master-composer\s*\{([^}]*)\}/u)?.[1]
    const questionComposerRule = css.match(/\.dsh-master-question-composer\s*\{([^}]*)\}/u)?.[1]
    const questionItemRule = css.match(/\.dsh-master-question-item\s*\{([^}]*)\}/u)?.[1]
    const mobileComposerRule = css.match(/@media\s*\(max-width:\s*720px\)\s*\{[\s\S]*?\.dsh-master-composer\s*\{([^}]*)\}/u)?.[1]

    expect(inserted).toBe(style)
    expect(declaration(rootRule, '--dsh-chat-content-width')).toBe(
      'var(--dsh-chat-user-width, clamp(680px, calc(var(--dsh-conversation-column-width, 0px) * .64), 920px))',
    )
    expect(declaration(logRule, 'padding')).toBe(
      '16px calc(var(--dsh-composer-side-clearance) + 16px) 8px',
    )
    expect(declaration(columnRule, 'width')).toBe('100%')
    expect(declaration(columnRule, 'max-width')).toBe('var(--dsh-chat-content-width)')
    expect(declaration(columnRule, 'margin')).toBe('0 auto')
    expect(declaration(composerRule, 'width')).toBe('calc(100% - 32px)')
    expect(declaration(composerRule, 'max-width')).toBe('calc(var(--dsh-chat-content-width) + 32px)')
    expect(declaration(questionComposerRule, 'max-height')).toBe('min(60vh, 520px)')
    expect(declaration(questionComposerRule, 'overflow')).toBe('hidden')
    expect(declaration(questionItemRule, 'overflow-y')).toBe('auto')
    expect(declaration(mobileComposerRule, 'width')).toBeUndefined()
  })
})
