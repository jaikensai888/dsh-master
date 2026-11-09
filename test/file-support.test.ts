/**
 * File-capability probing and failure classification.
 *
 * These tests pin the distinction the panel previously collapsed: "the node has no
 * file protocol", "the node has the protocol but not this endpoint", "the tool is
 * explicitly unregistered", "the network failed", and "we are not allowed" are
 * different diagnoses. They also pin that a failed probe can recover on retry.
 */

import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/client/api.js'
import {
  classifyFileSupportError,
  describeFileSupport,
  probeFileSupport,
  shouldRefreshFileSupport,
} from '../src/client/file-support.js'
import { FILES_PROTOCOL_VERSION, type FileDescribe, type FileLimits } from '../src/files-protocol.js'

const LIMITS: FileLimits = {
  maxFileBytes: 20 * 1024 * 1024,
  maxAttachmentsPerMessage: 5,
  maxActiveUploads: 2,
  storageLimitBytes: 1024 * 1024 * 1024,
  chunkBytes: 256 * 1024,
  retentionMs: 7 * 24 * 60 * 60 * 1000,
  incompleteUploadTtlMs: 60 * 60 * 1000,
}

const DESCRIBE: FileDescribe = {
  protocolVersion: FILES_PROTOCOL_VERSION,
  limits: LIMITS,
  deliveryTool: 'available',
}

describe('classifyFileSupportError', () => {
  it.each([
    ['coordinator/capability-unavailable', 'protocol-unsupported'],
    ['coordinator/endpoint-not-found', 'endpoint-missing'],
    ['node/capability-unavailable', 'endpoint-missing'],
    ['coordinator/capability-mismatch', 'capability-mismatch'],
    ['coordinator/node-offline', 'network'],
    ['coordinator/request-timeout', 'network'],
    ['coordinator/request-aborted', 'network'],
    ['coordinator/connection-lost', 'network'],
    ['master/coordinator-unreachable', 'network'],
    ['coordinator/auth-rejected', 'permission'],
    ['coordinator/auth-required', 'permission'],
    ['coordinator/auth-invalid-request', 'permission'],
    ['master/forbidden', 'permission'],
    ['master/credential-unavailable', 'permission'],
    ['files/forbidden', 'permission'],
    ['files/io-error', 'unknown'],
    ['coordinator/internal', 'unknown'],
  ])('maps %s to %s', (code, reason) => {
    const failure = classifyFileSupportError(new ApiError(code, 'upstream failure'))
    expect(failure.status).toBe('error')
    expect(failure.reason).toBe(reason)
    expect(failure.code).toBe(code)
    expect(failure.retryable).toBe(
      reason === 'protocol-unsupported' || reason === 'endpoint-missing'
      || reason === 'network' || reason === 'unknown',
    )
  })

  it('keeps a diagnostic message but removes credential-shaped values', () => {
    const failure = classifyFileSupportError(new ApiError(
      'coordinator/auth-rejected',
      'refused token=super-secret and Bearer abc.def.ghi',
    ))
    expect(failure.message).not.toContain('super-secret')
    expect(failure.message).not.toContain('abc.def.ghi')
    expect(failure.message).toContain('refused')
  })
})

describe('describeFileSupport', () => {
  it('accepts the protocol version this plugin speaks', () => {
    expect(describeFileSupport(DESCRIBE)).toEqual({ status: 'supported', describe: DESCRIBE })
  })

  it('reports a version disagreement as a mismatch, not as a missing tool', () => {
    const state = describeFileSupport({ ...DESCRIBE, protocolVersion: 2 })
    expect(state).toMatchObject({
      status: 'error',
      reason: 'capability-mismatch',
      code: 'master/files-protocol-mismatch',
      retryable: false,
    })
    expect(state.status === 'error' ? state.message : '').toContain('2')
  })
})

describe('probeFileSupport', () => {
  it('recovers after a failed probe once the node answers', async () => {
    const failed = await probeFileSupport(async () => {
      throw new ApiError('coordinator/node-offline', 'node is offline')
    })
    expect(failed).toMatchObject({ status: 'error', reason: 'network' })

    const recovered = await probeFileSupport(async () => DESCRIBE)
    expect(recovered).toEqual({ status: 'supported', describe: DESCRIBE })
  })

  it('turns a non-ApiError into an unknown failure instead of throwing', async () => {
    const state = await probeFileSupport(async () => {
      throw new TypeError('fetch failed')
    })
    expect(state).toMatchObject({ status: 'error', reason: 'unknown', code: 'master/internal' })
  })
})

describe('shouldRefreshFileSupport', () => {
  it('does not duplicate the probe on the first stream open', () => {
    expect(shouldRefreshFileSupport({ status: 'loading' }, false)).toBe(false)
    expect(shouldRefreshFileSupport({ status: 'error', reason: 'network', code: 'x', message: 'x', retryable: true }, false))
      .toBe(false)
  })

  it('retries a failed or tool-unregistered capability when the connection reopens', () => {
    expect(shouldRefreshFileSupport({ status: 'error', reason: 'network', code: 'x', message: 'x', retryable: true }, true))
      .toBe(true)
    expect(shouldRefreshFileSupport({ status: 'error', reason: 'permission', code: 'x', message: 'x', retryable: false }, true))
      .toBe(true)
    expect(shouldRefreshFileSupport({
      status: 'supported',
      describe: { ...DESCRIBE, deliveryTool: 'unavailable' },
    }, true)).toBe(true)
  })

  it('leaves a working capability alone', () => {
    expect(shouldRefreshFileSupport({ status: 'supported', describe: DESCRIBE }, true)).toBe(false)
    expect(shouldRefreshFileSupport({ status: 'loading' }, true)).toBe(false)
  })
})
