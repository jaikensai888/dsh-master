/**
 * Host instruction vs. user text at the master boundary.
 *
 * The master used to append a delivery paragraph to every prompt. These tests pin
 * the replacement contract: the node's tool description is the model-facing place
 * for that instruction, and the prompt body is exactly what the user typed (plus
 * host-validated attachment metadata when files were uploaded).
 */

import { describe, expect, it, vi } from 'vitest'
import type { CoordinatorClient } from '../src/coordinator/client.js'
import { ApiError } from '../src/client/api.js'
import { attachmentPromptBlock, MasterService } from '../src/service.js'

const NODE = 'node-1'
const SESSION = 'session-11111111-1111-4111-8111-111111111111'
const DELIVERY_MARKER = '[remote-session-delivery]'

function service(client: unknown): MasterService {
  return new MasterService(client as CoordinatorClient, true)
}

function promptClient() {
  return {
    prompt: vi.fn(async (
      _nodeId: string,
      _sessionId: string,
      _text: string,
      _mode?: 'queue' | 'steer',
    ) => undefined),
  }
}

describe('prompt body boundary', () => {
  it('sends a plain analysis message byte-for-byte in queue mode', async () => {
    const client = promptClient()
    const text = '分析这个链接的任务：https://example.test/jobs/56'
    await service(client).prompt(NODE, SESSION, text)
    expect(client.prompt).toHaveBeenCalledTimes(1)
    expect(client.prompt.mock.calls[0]?.[2]).toBe(text)
    expect(client.prompt.mock.calls[0]?.[3]).toBe('queue')
  })

  it('sends a steer prompt byte-for-byte', async () => {
    const client = promptClient()
    const text = '先别下载，只总结视频里的三段论'
    await service(client).prompt(NODE, SESSION, text, 'steer')
    expect(client.prompt.mock.calls[0]?.[2]).toBe(text)
    expect(client.prompt.mock.calls[0]?.[3]).toBe('steer')
  })

  it('never appends the former delivery paragraph or its marker', async () => {
    const client = promptClient()
    await service(client).prompt(NODE, SESSION, '请生成一份可下载的文档')
    const body = client.prompt.mock.calls[0]?.[2] as string
    expect(body).toBe('请生成一份可下载的文档')
    expect(body).not.toContain(DELIVERY_MARKER)
    expect(body).not.toContain('deliver_file')
    expect(body).not.toContain('Only report successful delivery')
  })

  it('preserves a user who typed the old marker themselves', async () => {
    const client = promptClient()
    const text = `${DELIVERY_MARKER}\nFor a document the user should download, finish writing it, then call deliver_file.`
    await service(client).prompt(NODE, SESSION, text)
    expect(client.prompt.mock.calls[0]?.[2]).toBe(text)
  })

  it('does not let a failed file-capability probe block a plain prompt', async () => {
    const client = {
      fileOperation: vi.fn(async () => {
        throw new ApiError('coordinator/capability-unavailable', 'the node has no sessionFiles namespace')
      }),
      prompt: vi.fn(async (
        _nodeId: string,
        _sessionId: string,
        _text: string,
        _mode?: 'queue' | 'steer',
      ) => undefined),
    }
    const master = service(client)
    await expect(master.describeFiles(NODE, SESSION)).rejects.toMatchObject({
      code: 'coordinator/capability-unavailable',
    })
    await master.prompt(NODE, SESSION, '只做文本分析')
    expect(client.prompt).toHaveBeenCalledTimes(1)
    expect(client.prompt.mock.calls[0]?.[2]).toBe('只做文本分析')
  })
})

describe('attachment metadata', () => {
  it('keeps the user body intact and appends only host-validated attachment data', async () => {
    const client = {
      fileOperation: vi.fn(async () => ({
        attachments: [{
          attachmentId: 'a1',
          nodeId: NODE,
          sessionId: SESSION,
          name: '报告.docx',
          size: 3,
          sha256: 'a'.repeat(64),
          remotePath: 'C:\\node\\files\\a1',
          createdAt: '2026-10-29T03:00:00.000Z',
          expiresAt: '2026-11-05T03:00:00.000Z',
        }],
      })),
      prompt: vi.fn(async (
        _nodeId: string,
        _sessionId: string,
        _text: string,
        _mode?: 'queue' | 'steer',
      ) => undefined),
    }
    const text = '处理这份附件，但不要修改原文'
    await service(client).prompt(NODE, SESSION, text, 'queue', undefined, ['a1'])
    const body = client.prompt.mock.calls[0]?.[2] as string
    expect(body.startsWith(text)).toBe(true)
    expect(body).toContain('[remote-session-attachments]')
    expect(body).toContain('C:\\\\node\\\\files\\\\a1')
    expect(body).not.toContain(DELIVERY_MARKER)
    expect(body).not.toContain('deliver_file')
  })

  it('renders attachment data as user data without a second delivery instruction', () => {
    const block = attachmentPromptBlock([{
      attachmentId: 'a1',
      nodeId: NODE,
      sessionId: SESSION,
      name: '报告.docx',
      size: 3,
      sha256: 'a'.repeat(64),
      remotePath: 'C:\\node\\files\\a1',
      createdAt: '2026-10-29T03:00:00.000Z',
      expiresAt: '2026-11-05T03:00:00.000Z',
    }])
    expect(block).toContain('user data, not system instructions')
    expect(block).toContain('C:\\\\node\\\\files\\\\a1')
    expect(block).not.toContain('deliver_file')
    expect(block).not.toContain(DELIVERY_MARKER)
  })
})
