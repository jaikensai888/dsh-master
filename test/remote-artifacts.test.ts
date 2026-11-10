/**
 * Delivered artifacts: dedupe, cards, and the download URL.
 *
 * The card is rendered from node metadata, never from text parsing, and the URL
 * carries identity only — these tests pin both properties.
 */

import { createElement } from 'react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const React = await import('react')
  return {
    Button: ({ children }: { children?: ReactNode }) => React.createElement('button', { type: 'button' }, children),
    IconChevronDownOutlineRegular: () => React.createElement('span'),
    IconChevronRightOutlineRegular: () => React.createElement('span'),
    IconPlusOutlineRegular: () => React.createElement('span'),
    IconSendOutlineRegular: () => React.createElement('span'),
    IconWarningOutlineRegular: () => React.createElement('span'),
    MarkdownText: ({ text }: { text: string }) => React.createElement('span', null, text),
    Pill: ({ children }: { children?: ReactNode }) => React.createElement('button', { type: 'button' }, children),
    StateDot: () => React.createElement('span'),
  }
})

import { ArtifactCard, ArtifactList, mergeArtifacts } from '../src/client/ArtifactCard.js'
import { downloadArtifactUrl } from '../src/client/api.js'
import { formatBytes, formatDateTime } from '../src/client/copy.js'
import type { FileSupportState } from '../src/client/file-support.js'
import type { FileArtifact, FileDescribe, FileLimits } from '../src/files-protocol.js'

const NODE = 'node-1'
const SESSION = 'session-11111111-1111-4111-8111-111111111111'

const LIMITS: FileLimits = {
  maxFileBytes: 20 * 1024 * 1024,
  maxAttachmentsPerMessage: 5,
  maxActiveUploads: 2,
  storageLimitBytes: 1024 * 1024 * 1024,
  chunkBytes: 256 * 1024,
  retentionMs: 7 * 24 * 60 * 60 * 1000,
  incompleteUploadTtlMs: 60 * 60 * 1000,
}

function support(deliveryTool: FileDescribe['deliveryTool'] = 'available'): FileSupportState {
  return { status: 'supported', describe: { protocolVersion: 1, limits: LIMITS, deliveryTool } }
}

function failure(reason: 'protocol-unsupported' | 'network' | 'permission'): FileSupportState {
  return {
    status: 'error',
    reason,
    code: reason === 'protocol-unsupported'
      ? 'coordinator/capability-unavailable'
      : reason === 'network' ? 'coordinator/node-offline' : 'coordinator/auth-rejected',
    message: 'upstream diagnostic',
    retryable: reason !== 'permission',
  }
}

function artifact(patch: Partial<FileArtifact> = {}): FileArtifact {
  return {
    artifactId: 'artifact-1',
    nodeId: NODE,
    sessionId: SESSION,
    name: '结果 清单.docx',
    size: 2048,
    sha256: 'a'.repeat(64),
    createdAt: '2026-10-29T03:00:00.000Z',
    expiresAt: '2026-11-05T03:00:00.000Z',
    state: 'ready',
    ...patch,
  }
}

describe('mergeArtifacts', () => {
  it('deduplicates by artifactId across polls', () => {
    const first = mergeArtifacts([], [artifact()])
    const second = mergeArtifacts(first, [artifact({ name: '结果 清单 v2.docx' })])
    expect(second).toHaveLength(1)
    expect(second[0]?.name).toBe('结果 清单 v2.docx')
  })

  it('keeps a persisted card when a later poll omits it', () => {
    const first = mergeArtifacts([], [artifact()])
    const second = mergeArtifacts(first, [])
    expect(second).toHaveLength(1)
  })

  it('sorts by creation time and survives an invalid timestamp', () => {
    const older = artifact({ artifactId: 'a', createdAt: '2026-10-28T03:00:00.000Z' })
    const newer = artifact({ artifactId: 'b', createdAt: '2026-10-30T03:00:00.000Z' })
    const invalid = artifact({ artifactId: 'c', createdAt: 'not-a-date' })
    expect(mergeArtifacts([newer, invalid], [older]).map(row => row.artifactId)).toEqual(['a', 'b', 'c'])
  })
})

describe('ArtifactCard', () => {
  it('shows the name, size, expiry and a download link for a ready artifact', () => {
    const html = renderToStaticMarkup(createElement(ArtifactCard, {
      artifact: artifact(),
      nodeId: NODE,
      sessionId: SESSION,
    }))
    expect(html).toContain('结果 清单.docx')
    expect(html).toContain('2.0 KiB')
    expect(html).toContain('保存到本地')
    expect(html).toContain('data-artifact-id="artifact-1"')
    expect(html).toContain('/dsh-master/api/files/download?')
    expect(html).toContain(`nodeId=${NODE}`)
    expect(html).toContain(`artifactId=artifact-1`)
    expect(html).not.toContain('remotePath')
  })

  it('explains an expired artifact and offers no link', () => {
    const html = renderToStaticMarkup(createElement(ArtifactCard, {
      artifact: artifact({ state: 'expired' }),
      nodeId: NODE,
      sessionId: SESSION,
    }))
    expect(html).toContain('已过期')
    expect(html).toContain('data-state="expired"')
    expect(html).not.toContain('<a ')
    expect(html).toContain('不可下载')
  })

  it('explains a missing artifact', () => {
    const html = renderToStaticMarkup(createElement(ArtifactCard, {
      artifact: artifact({ state: 'missing' }),
      nodeId: NODE,
      sessionId: SESSION,
    }))
    expect(html).toContain('文件已失效')
  })

  it('renders nothing before the capability probe settles', () => {
    expect(renderToStaticMarkup(createElement(ArtifactList, {
      artifacts: [],
      nodeId: NODE,
      sessionId: SESSION,
      support: { status: 'loading' },
    }))).toBe('')
  })

  it('renders one card per artifact', () => {
    const html = renderToStaticMarkup(createElement(ArtifactList, {
      artifacts: [artifact({ artifactId: 'a' }), artifact({ artifactId: 'b', name: '第二个.zip' })],
      nodeId: NODE,
      sessionId: SESSION,
      support: support(),
    }))
    expect(html).toContain('data-artifact-id="a"')
    expect(html).toContain('data-artifact-id="b"')
    expect(html).toContain('第二个.zip')
  })

  it('shows the delivery entry and instructions before the first artifact exists', () => {
    const html = renderToStaticMarkup(createElement(ArtifactList, {
      artifacts: [], nodeId: NODE, sessionId: SESSION, support: support(),
    }))
    expect(html).toMatch(/^<details class="dsh-master-artifacts dsh-master-artifacts-empty">/u)
    expect(html).toContain('本次会话的交付文件')
    expect(html).toContain('请生成并交付一个可下载的文件')
    expect(html).not.toContain('<a ')
  })

  it('distinguishes an unregistered tool from a missing protocol', () => {
    const html = renderToStaticMarkup(createElement(ArtifactList, {
      artifacts: [],
      nodeId: NODE,
      sessionId: SESSION,
      support: support('unavailable'),
      onRetrySupport: () => undefined,
    }))
    expect(html).toContain('未注册 deliver_file 工具')
    expect(html).not.toContain('未提供远程文件接口')
    expect(html).toContain('重新检查')
  })

  it('shows one capability notice with a retry and an expandable diagnostic', () => {
    const html = renderToStaticMarkup(createElement(ArtifactList, {
      artifacts: [], nodeId: NODE, sessionId: SESSION, support: failure('protocol-unsupported'),
    }))
    expect(html).toContain('未提供远程文件接口')
    expect(html).toContain('普通文本对话不受影响')
    expect(html).toContain('重新检查')
    expect(html).toContain('诊断信息')
    expect(html).toContain('coordinator/capability-unavailable')
    expect([...html.matchAll(/未提供远程文件接口/gu)]).toHaveLength(1)
    expect(html).not.toContain('版本较旧')
  })

  it('offers retry for a network failure but not for a permission failure', () => {
    const network = renderToStaticMarkup(createElement(ArtifactList, {
      artifacts: [], nodeId: NODE, sessionId: SESSION, support: failure('network'),
    }))
    expect(network).toContain('无法连接远程节点')
    expect(network).toContain('重新检查')

    const permission = renderToStaticMarkup(createElement(ArtifactList, {
      artifacts: [], nodeId: NODE, sessionId: SESSION, support: failure('permission'),
    }))
    expect(permission).toContain('无权使用远程文件能力')
    expect(permission).not.toContain('重新检查')
  })
})

describe('download URL', () => {
  it('contains identity only and encodes each parameter', () => {
    const url = downloadArtifactUrl('node/../1', 'session 1', 'artifact&2')
    expect(url.startsWith('/dsh-master/api/files/download?')).toBe(true)
    const query = new URL(url, 'http://localhost').searchParams
    expect(query.get('nodeId')).toBe('node/../1')
    expect(query.get('sessionId')).toBe('session 1')
    expect(query.get('artifactId')).toBe('artifact&2')
    expect(query.get('path')).toBeNull()
    expect(url).not.toContain('remotePath')
  })
})

describe('formatting', () => {
  it('uses binary units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1.0 KiB')
    expect(formatBytes(20 * 1024 * 1024)).toBe('20 MiB')
  })

  it('formats an ISO timestamp and keeps an invalid one visible', () => {
    expect(formatDateTime('2026-11-05T03:00:00.000Z')).toMatch(/^2026-11-05 \d{2}:\d{2}$/u)
    expect(formatDateTime('nope')).toBe('nope')
  })
})
