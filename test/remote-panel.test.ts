import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => {
  const PrimitiveStub = (): null => null
  return {
    Button: PrimitiveStub,
    IconChevronDownOutline14: PrimitiveStub,
    IconChevronRightOutline14: PrimitiveStub,
    IconRefreshOutline14: PrimitiveStub,
    IconPlusOutline16: PrimitiveStub,
    IconSendOutline14: PrimitiveStub,
    IconWarningOutline16: PrimitiveStub,
    MarkdownText: PrimitiveStub,
    Pill: PrimitiveStub,
    StateDot: PrimitiveStub,
  }
})

import { RemotePanel } from '../src/client/RemotePanel.js'
import { setRemoteSelection } from '../src/client/selection.js'

afterEach(() => { setRemoteSelection(undefined) })

describe('remote session panel', () => {
  it('shows only the selected conversation, without a duplicate remote workspace tree', () => {
    setRemoteSelection({
      nodeId: 'node-1',
      sessionId: 'session-1',
      nodeName: 'my-desktop',
      sessionTitle: 'dsh-master 插件设计',
    })

    const markup = renderToStaticMarkup(createElement(RemotePanel))

    expect(markup).not.toContain('dsh-master-tree')
    expect(markup).not.toContain('远程工作区')
    expect(markup).toContain('my-desktop · dsh-master 插件设计')
    expect(markup).toContain('class="dsh-master-body"')
  })

  it('keeps the scroll viewport full-width while grouping conversation content in a centered column', () => {
    setRemoteSelection({
      nodeId: 'node-1',
      sessionId: 'session-1',
      nodeName: 'my-desktop',
      sessionTitle: 'dsh-master 插件设计',
    })

    const markup = renderToStaticMarkup(createElement(RemotePanel))

    expect(markup).toContain('<div class="dsh-master-log"><div class="dsh-master-log-column">')
    expect(markup).toContain('</div></div><div class="dsh-master-composer">')
  })

  it('prompts the user to choose a remote session from the sidebar when none is selected', () => {
    setRemoteSelection(undefined)

    const markup = renderToStaticMarkup(createElement(RemotePanel))

    expect(markup).toContain('从左侧远程工作区选择一个会话。')
    expect(markup).not.toContain('dsh-master-tree')
  })
})
