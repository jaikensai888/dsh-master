import { createElement } from 'react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children }: { children?: ReactNode }) => createElement('button', null, children),
  IconChevronDownOutline14: () => createElement('span'),
  IconChevronRightOutline14: () => createElement('span'),
  IconPlusOutline16: () => createElement('span'),
  IconSendOutline14: () => createElement('span'),
  IconWarningOutline16: () => createElement('span'),
  MarkdownText: ({ text }: { text: string }) => createElement('span', null, text),
  Pill: ({ children }: { children?: ReactNode }) => createElement('button', null, children),
  StateDot: () => createElement('span'),
}))

import { buildQuestionAnswer, RemoteQuestionForm } from '../src/client/SessionView.js'
import type { MasterPendingQuestionRequest } from '../src/protocol.js'

const request: MasterPendingQuestionRequest = {
  requestId: 'request-1',
  sessionId: 'session-1',
  questions: [
    {
      id: 'q1',
      header: '方案',
      question: '选择发布方式',
      detail: '可以多选',
      multiSelect: true,
      options: [
        { label: '灰度', description: '先放一部分流量' },
        { label: '全量' },
      ],
    },
    { id: 'q2', question: '补充说明', options: [{ label: '继续' }, { label: '暂停' }] },
  ],
}

describe('remote question form', () => {
  it('renders one question at a time with a footer pager', () => {
    const html = renderToStaticMarkup(createElement(RemoteQuestionForm, {
      request,
      disabled: false,
      onAnswer: () => undefined,
      onCancel: () => undefined,
    }))

    expect(html).toContain('选择发布方式')
    expect(html).not.toContain('补充说明')
    expect(html).toContain('先放一部分流量')
    expect(html).toContain('灰度')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('1 / 2')
    expect(html).toContain('aria-label="上一题"')
    expect(html).toContain('aria-label="下一题"')
    expect(html).toContain('自定义回答')
    expect(html).toContain('下一题')
    expect(html).toContain('取消')
    expect(html).toMatch(/<form\b[^>]*class="[^"]*\bdsh-master-composer\b/u)
    expect(html).not.toContain('dsh-master-composer-input')
  })

  it('returns every original question ID and selected label with optional custom text', () => {
    expect(buildQuestionAnswer(request.questions, {
      q1: ['全量', '灰度'],
    }, {
      q2: '今晚发布',
    })).toEqual({
      answers: [
        { id: 'q1', selected: ['全量', '灰度'] },
        { id: 'q2', selected: [], custom: '今晚发布' },
      ],
    })
  })
})
