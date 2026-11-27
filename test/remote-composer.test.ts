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
    IconChevronDownOutlineRegular: () => React.createElement('span', { 'aria-hidden': true }),
    IconPlusOutlineRegular: () => React.createElement('span', { 'aria-hidden': true }),
    IconSendOutlineRegular: () => React.createElement('span', { 'aria-hidden': true }),
    IconWarningOutlineRegular: () => React.createElement('span', { 'aria-hidden': true }),
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

import { SessionView, sendsOnEnter } from '../src/client/SessionView.js'
import { SkillMenu } from '../src/client/SkillMenu.js'
import { COPY } from '../src/client/copy.js'
import { completeSkill, filterSkills, skillFailureKind, skillTrigger } from '../src/client/skill-picker.js'

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
    expect([...html.matchAll(/<button\b(?=[^>]*data-control="attachment")(?=[^>]*disabled="")/gu)]).toHaveLength(1)
    // The model chip is a real control now: it waits for the node's catalog and
    // stays disabled until that read lands.
    expect(html).toContain('data-control="model"')
    expect(html).toContain('读取模型…')
  })

  it('sends on Enter, keeps Shift+Enter and IME composition for the draft', () => {
    expect(sendsOnEnter({ key: 'Enter', shiftKey: false })).toBe(true)
    expect(sendsOnEnter({ key: 'Enter', shiftKey: true })).toBe(false)
    expect(sendsOnEnter({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false)
    expect(sendsOnEnter({ key: 'a', shiftKey: false })).toBe(false)
  })

  it('disables text entry when remote prompting is unavailable', () => {
    const html = renderSession(false)

    expect(html).toMatch(/<textarea\b(?=[^>]*disabled="")/u)
    expect(html).toContain('发送已被配置关闭（allowPrompt: false）')
  })
})

describe('remote skill picker draft rules', () => {
  it('opens only for a leading slash token and reads its prefix', () => {
    expect(skillTrigger('/')).toEqual({ prefix: '', tokenEnd: 1 })
    expect(skillTrigger('/rev')).toEqual({ prefix: 'rev', tokenEnd: 4 })
    expect(skillTrigger('/Rev 检查改动')).toEqual({ prefix: 'rev', tokenEnd: 4 })
    expect(skillTrigger('/review')).toEqual({ prefix: 'review', tokenEnd: 7 })
    expect(skillTrigger('请看 /rev')).toBeUndefined()
    expect(skillTrigger('/usr/bin')).toBeUndefined()
    expect(skillTrigger('ordinary text')).toBeUndefined()
    expect(skillTrigger('')).toBeUndefined()
  })

  it('completes the chosen skill without losing the arguments', () => {
    expect(completeSkill('/rev 检查改动', 'review')).toBe('/review 检查改动')
    expect(completeSkill('/rev', 'review')).toBe('/review ')
    expect(completeSkill('/', 'review')).toBe('/review ')
    expect(completeSkill('/review\targs', 'review')).toBe('/review args')
    expect(completeSkill('请看 /rev', 'review')).toBe('请看 /rev')
  })

  it('filters by prefix, case-insensitively, and keeps an empty catalog honest', () => {
    const skills = [
      { name: 'review', description: 'Review', modelInvocable: false },
      { name: 'deploy', description: 'Deploy', modelInvocable: true },
      { name: 'revert', description: 'Revert', modelInvocable: true },
    ]
    expect(filterSkills(skills, '').map(skill => skill.name)).toEqual(['review', 'deploy', 'revert'])
    expect(filterSkills(skills, 'rev').map(skill => skill.name)).toEqual(['review', 'revert'])
    expect(filterSkills(skills, 'REV').map(skill => skill.name)).toEqual(['review', 'revert'])
    expect(filterSkills(skills, 'zzz')).toEqual([])
    expect(filterSkills([], '')).toEqual([])
  })

  it('separates a missing capability from a transient failure', () => {
    expect(skillFailureKind('node/capability-unavailable')).toBe('unsupported')
    expect(skillFailureKind('gateway/method-unavailable')).toBe('unsupported')
    expect(skillFailureKind('master/coordinator-unreachable')).toBe('error')
    expect(skillFailureKind(undefined)).toBe('error')
  })
})

describe('remote skill menu markup', () => {
  const skills = [
    { name: 'review', description: 'Review a change', whenToUse: 'before merging', modelInvocable: false },
    { name: 'deploy', description: 'Deploy it', modelInvocable: true },
  ]

  it('paints the filtered entries as an accessible listbox', () => {
    const html = renderToStaticMarkup(createElement(SkillMenu, {
      id: 'menu', status: 'ready', skills, activeIndex: 1, onChoose: () => undefined, onHover: () => undefined,
    }))
    expect(html).toContain('role="listbox"')
    expect(html).toContain(`aria-label="${COPY.skillMenuTitle}"`)
    expect((html.match(/role="option"/gu) ?? []).length).toBe(2)
    expect(html).toContain('/review')
    expect(html).toContain('before merging')
    const active = html.indexOf('aria-selected="true"')
    expect(active).toBeGreaterThan(html.indexOf('/review'))
    expect(active).toBeLessThan(html.indexOf('/deploy'))
  })

  it('shows loading, empty, no-match, failure and unsupported states', () => {
    const render = (status: 'loading' | 'ready' | 'empty' | 'error' | 'unsupported', list = skills): string =>
      renderToStaticMarkup(createElement(SkillMenu, {
        id: 'menu', status, skills: list, activeIndex: 0, onChoose: () => undefined, onHover: () => undefined,
      }))
    expect(render('loading')).toContain(COPY.skillLoading)
    expect(render('empty', [])).toContain(COPY.skillEmpty)
    expect(render('ready', [])).toContain(COPY.skillNoMatch)
    expect(render('error', [])).toContain(COPY.skillLoadFailed)
    expect(render('unsupported', [])).toContain(COPY.skillUnsupported)
  })
})
