import { createElement } from 'react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const React = await import('react')
  return {
    Button: ({
      'aria-label': ariaLabel,
      children,
      className,
      disabled,
      title,
    }: {
      'aria-label'?: string
      children?: ReactNode
      className?: string
      disabled?: boolean
      title?: string
    }) => React.createElement('button', {
      'aria-label': ariaLabel,
      className,
      disabled,
      title,
      type: 'button',
    }, children),
    IconChevronDownOutline14: () => React.createElement('span', { 'aria-hidden': true }),
    IconPlusOutline16: () => React.createElement('span', { 'aria-hidden': true }),
    IconSendOutline14: () => React.createElement('span', { 'aria-hidden': true }),
    IconWarningOutline16: () => React.createElement('span', { 'aria-hidden': true }),
    MarkdownText: ({ text }: { text: string }) => React.createElement('span', null, text),
    Pill: ({ active, children, className, onClick }: {
      active?: boolean
      children?: ReactNode
      className?: string
      onClick?: (() => void) | undefined
    }) => React.createElement('button', {
      'aria-pressed': active,
      className,
      disabled: onClick === undefined,
      type: 'button',
    }, children),
    StateDot: () => React.createElement('span', { 'aria-hidden': true }),
  }
})

import { SessionView } from '../src/client/SessionView.js'

function renderSession(promptEnabled: boolean): string {
  return renderToStaticMarkup(createElement(SessionView, {
    nodeId: 'node-1',
    promptEnabled,
    sessionId: 'session-1',
    title: 'Remote session',
  }))
}

describe('remote session composer', () => {
  it('keeps remote text entry and mode controls available while local-only controls are disabled', () => {
    const html = renderSession(true)

    expect(html).toMatch(/<textarea\b(?=[^>]*class="dsh-master-composer-input")/u)
    expect(html).not.toMatch(/<textarea\b(?=[^>]*disabled="")/u)
    expect(html).toContain('排队')
    expect(html).toContain('插话')

    for (const control of ['attachment', 'permission', 'model']) {
      expect(html).toMatch(new RegExp(`<button\\b(?=[^>]*data-control="${control}")(?=[^>]*disabled="")`, 'u'))
      expect(html).toContain(`data-control="${control}"`)
    }
    expect([...html.matchAll(/<button\b(?=[^>]*data-control="attachment")(?=[^>]*disabled="")/gu)]).toHaveLength(2)
    expect(html).toContain('暂不支持远程会话')
  })

  it('disables text entry when remote prompting is unavailable', () => {
    const html = renderSession(false)

    expect(html).toMatch(/<textarea\b(?=[^>]*disabled="")/u)
    expect(html).toContain('发送已被配置关闭（allowPrompt: false）')
  })
})
