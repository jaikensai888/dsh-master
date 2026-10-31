/**
 * Remote attachments: selection, transfer, and the composer gate.
 *
 * The upload conversation is exercised against a stubbed `fetch` with the exact
 * envelope shape the host emits, so the test proves the sequence and the
 * idempotent offsets rather than a mock that agrees with itself.
 */

import { createHash } from 'node:crypto'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const React = await import('react')
  return {
    Button: ({ 'aria-label': ariaLabel, className, disabled, title }: {
      'aria-label'?: string
      className?: string
      disabled?: boolean
      title?: string
    }) => React.createElement('button', { 'aria-label': ariaLabel, className, disabled, title, type: 'button' }),
    IconChevronDownOutlineRegular: () => React.createElement('span', { 'aria-hidden': true }),
    IconChevronRightOutlineRegular: () => React.createElement('span', { 'aria-hidden': true }),
    IconPlusOutlineRegular: () => React.createElement('span', { 'aria-hidden': true }),
    IconSendOutlineRegular: () => React.createElement('span', { 'aria-hidden': true }),
    IconWarningOutlineRegular: () => React.createElement('span', { 'aria-hidden': true }),
    MarkdownText: ({ text }: { text: string }) => React.createElement('span', null, text),
    Pill: ({ active, children, className, onClick }: {
      active?: boolean
      children?: ReactNode
      className?: string
      onClick?: (() => void) | undefined
    }) => React.createElement('button', { 'aria-pressed': active, className, disabled: onClick === undefined, type: 'button' }, children),
    StateDot: () => React.createElement('span', { 'aria-hidden': true }),
  }
})

import { AttachmentPicker } from '../src/client/AttachmentPicker.js'
import { SessionView } from '../src/client/SessionView.js'
import {
  attachmentIds,
  bytesToBase64,
  canSubmit,
  isUncertainPromptFailure,
  newLocalAttachment,
  selectFiles,
  sha256Hex,
  uploadAttachment,
  type LocalAttachment,
} from '../src/client/attachments.js'
import { ApiError } from '../src/client/api.js'
import type { FileDescribe, FileLimits } from '../src/files-protocol.js'

const NODE = 'node-1'
const SESSION = 'session-11111111-1111-4111-8111-111111111111'

const LIMITS: FileLimits = {
  maxFileBytes: 20 * 1024 * 1024,
  maxAttachmentsPerMessage: 5,
  maxActiveUploads: 2,
  storageLimitBytes: 1024 * 1024 * 1024,
  chunkBytes: 2,
  retentionMs: 7 * 24 * 60 * 60 * 1000,
  incompleteUploadTtlMs: 60 * 60 * 1000,
}

const DESCRIBE: FileDescribe = { protocolVersion: 1, limits: LIMITS, deliveryTool: 'available' }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** A local attachment row for render tests. */
function row(name: string, status: LocalAttachment['status'], received = 0, size = 6): LocalAttachment {
  const file = new File([new Uint8Array(size)], name)
  return {
    ...newLocalAttachment(NODE, SESSION, file),
    name,
    size,
    status,
    received,
    ...(status === 'ready'
      ? {
        attachment: {
          attachmentId: `a-${name}`,
          nodeId: NODE,
          sessionId: SESSION,
          name,
          size,
          sha256: 'a'.repeat(64),
          createdAt: '2026-10-29T03:00:00.000Z',
          expiresAt: '2026-11-05T03:00:00.000Z',
        },
      }
      : {}),
  }
}

describe('selection rules', () => {
  it('accepts files within the limits and explains each rejection', () => {
    const files = [
      new File([new Uint8Array(4)], 'a.bin'),
      new File([new Uint8Array(5)], 'b.bin'),
      new File([new Uint8Array(1)], 'c.bin'),
    ]
    const result = selectFiles(files, 0, { ...LIMITS, maxFileBytes: 4, maxAttachmentsPerMessage: 2 })
    expect(result.accepted.map(file => file.name)).toEqual(['a.bin', 'c.bin'])
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0]?.reason).toContain('上限')
  })

  it('counts already-selected rows against the message limit', () => {
    const files = [new File(['x'], 'x.txt'), new File(['y'], 'y.txt')]
    const result = selectFiles(files, 4, { ...LIMITS, maxAttachmentsPerMessage: 5 })
    expect(result.accepted.map(file => file.name)).toEqual(['x.txt'])
    expect(result.rejected[0]?.reason).toContain('5')
  })

  it('allows a zero-byte file', () => {
    const result = selectFiles([new File([], 'empty.txt')], 0, LIMITS)
    expect(result.accepted).toHaveLength(1)
  })
})

describe('send gate', () => {
  it('requires text, prompts enabled, and every attachment ready', () => {
    const ready = row('a.txt', 'ready')
    const uploading = row('b.txt', 'uploading')
    const failed = row('c.txt', 'failed')
    expect(canSubmit('', [ready], true)).toBe(false)
    expect(canSubmit('hello', [], true)).toBe(true)
    expect(canSubmit('hello', [ready], true)).toBe(true)
    expect(canSubmit('hello', [ready, uploading], true)).toBe(false)
    expect(canSubmit('hello', [ready, failed], true)).toBe(false)
    expect(canSubmit('hello', [ready], false)).toBe(false)
  })

  it('collects only committed ids in selection order', () => {
    expect(attachmentIds([row('a', 'ready'), row('b', 'failed'), row('c', 'ready')]))
      .toEqual(['a-a', 'a-c'])
  })

  it('treats an envelope failure as refused and a transport failure as uncertain', () => {
    expect(isUncertainPromptFailure(new ApiError('master/invalid-arguments', 'bad'))).toBe(false)
    expect(isUncertainPromptFailure(new TypeError('Failed to fetch'))).toBe(true)
    expect(isUncertainPromptFailure(new DOMException('aborted', 'AbortError'))).toBe(true)
  })

  it('keeps upstream transport and timeout envelopes uncertain', () => {
    for (const code of ['master/coordinator-unreachable', 'master/coordinator-unreadable',
      'master/unreadable', 'master/internal', 'coordinator/request-timeout',
      'coordinator/request-aborted', 'coordinator/connection-lost']) {
      expect(isUncertainPromptFailure(new ApiError(code, 'response lost')), code).toBe(true)
    }
    expect(isUncertainPromptFailure(new ApiError('master/prompt-disabled', 'disabled'))).toBe(false)
  })

  it('blocks resending an uncertain prompt until the user acknowledges it', () => {
    expect(canSubmit('hello', [row('a', 'ready')], true, true)).toBe(false)
    expect(canSubmit('hello', [row('a', 'ready')], true, false)).toBe(true)
  })
})

describe('hash and base64', () => {
  it('hashes exactly like the node', async () => {
    const bytes = new TextEncoder().encode('hello world!!')
    const expected = createHash('sha256').update(bytes).digest('hex')
    expect(await sha256Hex(bytes.buffer)).toBe(expected)
  })

  it('encodes arbitrary bytes without a stack overflow', () => {
    const bytes = new Uint8Array(70_000)
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251
    const base64 = bytesToBase64(bytes)
    expect(Buffer.from(base64, 'base64').equals(Buffer.from(bytes))).toBe(true)
  })
})

describe('upload conversation', () => {
  it('uploads chunk by chunk, reports progress, and commits', async () => {
    const writes: { offset: number; base64: string }[] = []
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      calls.push(url.pathname)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (url.pathname.endsWith('/beginUpload')) {
        expect(body).toMatchObject({ nodeId: NODE, sessionId: SESSION, name: 'a.bin', size: 6 })
        return json({ ok: true, value: { uploadId: 'u1', chunkBytes: 2, received: 0 } })
      }
      if (url.pathname.endsWith('/writeChunk')) {
        writes.push({ offset: body['offset'] as number, base64: body['base64'] as string })
        return json({ ok: true, value: { nextOffset: (body['offset'] as number) + 2, received: (body['offset'] as number) + 2 } })
      }
      if (url.pathname.endsWith('/commitUpload')) {
        expect(body).toMatchObject({ uploadId: 'u1', size: 6 })
        return json({
          ok: true,
          value: {
            attachmentId: 'a1',
            nodeId: NODE,
            sessionId: SESSION,
            name: 'a.bin',
            size: 6,
            sha256: body['sha256'],
            createdAt: '2026-10-29T03:00:00.000Z',
            expiresAt: '2026-11-05T03:00:00.000Z',
          },
        })
      }
      return json({ ok: false, error: { code: 'master/not-found', message: 'unexpected' } }, 404)
    }))

    const progress: number[] = []
    const file = new File([new TextEncoder().encode('abcdef')], 'a.bin')
    const record = await uploadAttachment(NODE, SESSION, file, {
      limits: LIMITS,
      chunkBytes: 2,
      clientUploadId: 'client-1',
      onProgress: received => progress.push(received),
    })
    expect(record.attachmentId).toBe('a1')
    expect(record.sha256).toBe(await sha256Hex(await file.arrayBuffer()))
    expect(writes.map(write => write.offset)).toEqual([0, 2, 4])
    expect(Buffer.from(writes[0]?.base64 ?? '', 'base64').toString('utf8')).toBe('ab')
    expect(progress).toEqual([0, 2, 4, 6])
    expect(calls.some(path => path.endsWith('/abortUpload'))).toBe(false)
  })

  it('aborts the node upload when a chunk fails', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      calls.push(url.pathname)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (url.pathname.endsWith('/beginUpload')) {
        return json({ ok: true, value: { uploadId: 'u2', chunkBytes: 2, received: 0 } })
      }
      if (url.pathname.endsWith('/writeChunk')) {
        return json({ ok: false, error: { code: 'files/io-error', message: 'disk failed' } })
      }
      if (url.pathname.endsWith('/abortUpload')) {
        return json({ ok: true, value: { accepted: true } })
      }
      return json({ ok: false, error: { code: 'master/not-found', message: 'unexpected' } }, 404)
    }))

    const file = new File([new TextEncoder().encode('abcdef')], 'b.bin')
    await expect(uploadAttachment(NODE, SESSION, file, { limits: LIMITS, chunkBytes: 2 }))
      .rejects.toMatchObject({ code: 'files/io-error' })
    expect(calls.some(path => path.endsWith('/abortUpload'))).toBe(true)
  })

  it('stops on cancellation and aborts the staging upload', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      calls.push(url.pathname)
      if (url.pathname.endsWith('/beginUpload')) {
        return json({ ok: true, value: { uploadId: 'u3', chunkBytes: 2, received: 0 } })
      }
      if (url.pathname.endsWith('/abortUpload')) {
        return json({ ok: true, value: { accepted: true } })
      }
      return json({ ok: true, value: { nextOffset: 2, received: 2 } })
    }))
    const controller = new AbortController()
    const file = new File([new TextEncoder().encode('abcdef')], 'c.bin')
    await expect(uploadAttachment(NODE, SESSION, file, {
      limits: LIMITS,
      chunkBytes: 2,
      signal: controller.signal,
      onProgress: (received) => { if (received === 0) controller.abort() },
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls.some(path => path.endsWith('/abortUpload'))).toBe(true)
  })

  it('retries one lost chunk response without restarting the file', async () => {
    let writes = 0
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      calls.push(url.pathname)
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (url.pathname.endsWith('/beginUpload')) {
        return json({ ok: true, value: { uploadId: 'u4', chunkBytes: 2, received: 0 } })
      }
      if (url.pathname.endsWith('/writeChunk')) {
        writes += 1
        if (writes === 1) throw new TypeError('connection reset')
        return json({ ok: true, value: { nextOffset: (body['offset'] as number) + 2, received: (body['offset'] as number) + 2 } })
      }
      if (url.pathname.endsWith('/commitUpload')) {
        return json({
          ok: true,
          value: {
            attachmentId: 'a4',
            nodeId: NODE,
            sessionId: SESSION,
            name: 'd.bin',
            size: 4,
            sha256: body['sha256'],
            createdAt: '2026-10-29T03:00:00.000Z',
            expiresAt: '2026-11-05T03:00:00.000Z',
          },
        })
      }
      return json({ ok: false, error: { code: 'master/not-found', message: 'unexpected' } }, 404)
    }))

    const file = new File([new TextEncoder().encode('abcd')], 'd.bin')
    const record = await uploadAttachment(NODE, SESSION, file, { limits: LIMITS, chunkBytes: 2 })
    expect(record.attachmentId).toBe('a4')
    // Two chunks, one retry: the first chunk was sent twice, the second once.
    expect(calls.filter(path => path.endsWith('/writeChunk'))).toHaveLength(3)
    expect(calls.some(path => path.endsWith('/abortUpload'))).toBe(false)
  })

  it('does not retry a host refusal', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      calls.push(url.pathname)
      if (url.pathname.endsWith('/beginUpload')) {
        return json({ ok: true, value: { uploadId: 'u5', chunkBytes: 2, received: 0 } })
      }
      if (url.pathname.endsWith('/writeChunk')) {
        return json({ ok: false, error: { code: 'files/offset-conflict', message: 'no' } })
      }
      if (url.pathname.endsWith('/abortUpload')) return json({ ok: true, value: { accepted: true } })
      return json({ ok: false, error: { code: 'master/not-found', message: 'unexpected' } }, 404)
    }))
    const file = new File([new TextEncoder().encode('abcd')], 'e.bin')
    await expect(uploadAttachment(NODE, SESSION, file, { limits: LIMITS, chunkBytes: 2 }))
      .rejects.toMatchObject({ code: 'files/offset-conflict' })
    expect(calls.filter(path => path.endsWith('/writeChunk'))).toHaveLength(1)
  })

  it('refuses a file over the advertised limit without a network call', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const file = new File([new Uint8Array(5)], 'too-big.bin')
    await expect(uploadAttachment(NODE, SESSION, file, {
      limits: { ...LIMITS, maxFileBytes: 4 },
    })).rejects.toMatchObject({ code: 'master/too-large' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('attachment picker markup', () => {
  it('shows two files with their states and a retry for failures', () => {
    const html = renderToStaticMarkup(createElement(AttachmentPicker, {
      attachments: [row('报告.docx', 'uploading', 3), row('失败.zip', 'failed')],
      disabled: false,
      canAdd: true,
      onSelect: () => undefined,
      onRemove: () => undefined,
      onRetry: () => undefined,
    }))
    expect(html).toContain('报告.docx')
    expect(html).toContain('失败.zip')
    expect(html).toContain('data-status="uploading"')
    expect(html).toContain('data-status="failed"')
    expect(html).toContain('重试')
    expect(html).toContain('role="progressbar"')
  })

  it('disables the input when the limit is reached', () => {
    const html = renderToStaticMarkup(createElement(AttachmentPicker, {
      attachments: [row('a', 'ready')],
      disabled: false,
      canAdd: false,
      onSelect: () => undefined,
      onRemove: () => undefined,
      onRetry: () => undefined,
    }))
    expect(html).toMatch(/<button\b(?=[^>]*data-control="attachment")(?=[^>]*disabled="")/u)
  })
})

describe('session view support states', () => {
  it('enables the plus control when the node supports files', () => {
    const html = renderToStaticMarkup(createElement(SessionView, {
      nodeId: NODE,
      sessionId: SESSION,
      title: 'Remote',
      promptEnabled: true,
      fileSupportOverride: DESCRIBE,
    }))
    expect(html).toContain('本次会话的交付文件')
    expect(html).toContain('请生成并交付一个可下载的文件')
    expect(html).toMatch(/<button\b(?=[^>]*data-control="attachment")(?![^>]*disabled="")/u)
    expect(html).toContain('添加附件')
  })

  it('disables only the attachment entry on an old node and keeps text entry', () => {
    const html = renderToStaticMarkup(createElement(SessionView, {
      nodeId: NODE,
      sessionId: SESSION,
      title: 'Remote',
      promptEnabled: true,
      fileSupportOverride: 'unsupported',
    }))
    expect(html).toContain('尚未启用文件交付工具')
    expect(html).toMatch(/<button\b(?=[^>]*data-control="attachment")(?=[^>]*disabled="")/u)
    expect(html).toContain('请升级 dsh-node')
    expect(html).toMatch(/<textarea\b(?![^>]*disabled="")/u)
  })

  it('keeps the attachment entry disabled while prompts are disabled', () => {
    const html = renderToStaticMarkup(createElement(SessionView, {
      nodeId: NODE,
      sessionId: SESSION,
      title: 'Remote',
      promptEnabled: false,
      fileSupportOverride: DESCRIBE,
    }))
    expect(html).toMatch(/<button\b(?=[^>]*data-control="attachment")(?=[^>]*disabled="")/u)
  })
})
