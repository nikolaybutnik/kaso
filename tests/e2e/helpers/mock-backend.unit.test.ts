/**
 * Unit Tests for MockBackend Helper
 *
 * Validates the mock backend implementation.
 * Requirements: 2.1–2.7
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { MockBackend } from './mock-backend'
import type { BackendRequest } from '@/core/types'

describe('MockBackend', () => {
  let backend: MockBackend

  beforeEach(() => {
    backend = new MockBackend({
      name: 'test-backend',
      maxContextWindow: 64000,
      costPer1000Tokens: 0.02,
    })
  })

  describe('interface compliance', () => {
    it('should have required properties', () => {
      expect(backend.name).toBe('test-backend')
      expect(backend.protocol).toBe('cli-json')
      expect(backend.maxContextWindow).toBe(64000)
      expect(backend.costPer1000Tokens).toBe(0.02)
    })

    it('should return name', () => {
      expect(backend.name).toBe('test-backend')
    })

    it('should report availability', async () => {
      expect(await backend.isAvailable()).toBe(true)

      backend.setAvailable(false)
      expect(await backend.isAvailable()).toBe(false)
    })
  })

  describe('execute', () => {
    it('should return success response by default', async () => {
      const request: BackendRequest = {
        id: 'test-1',
        context: {} as unknown as BackendRequest['context'],
        phase: 'intake',
        streamProgress: true,
      }

      const response = await backend.execute(request)

      expect(response.success).toBe(true)
      expect(response.tokensUsed).toBe(1000)
      expect(response.id).toBe('test-1')
    })

    it('should return configured phase response', async () => {
      backend.setPhaseResponse('implementation', {
        success: true,
        output: { modifiedFiles: ['test.ts'] },
        tokensUsed: 500,
      })

      const request: BackendRequest = {
        id: 'test-2',
        context: {} as unknown as BackendRequest['context'],
        phase: 'implementation',
        streamProgress: true,
      }

      const response = await backend.execute(request)

      expect(response.success).toBe(true)
      expect(response.tokensUsed).toBe(500)
      expect(response.output).toEqual({ modifiedFiles: ['test.ts'] })
    })

    it('should return failure when configured', async () => {
      backend.setPhaseResponse('validation', {
        success: false,
        error: 'Validation failed',
        retryable: true,
      })

      const request: BackendRequest = {
        id: 'test-3',
        context: {} as unknown as BackendRequest['context'],
        phase: 'validation',
        streamProgress: true,
      }

      const response = await backend.execute(request)

      expect(response.success).toBe(false)
      expect(response.error).toBe('Validation failed')
    })

    it('should respect delay configuration', async () => {
      backend.setDelay(50)

      const request: BackendRequest = {
        id: 'test-4',
        context: {} as unknown as BackendRequest['context'],
        phase: 'intake',
        streamProgress: true,
      }

      const start = Date.now()
      await backend.execute(request)
      const elapsed = Date.now() - start

      expect(elapsed).toBeGreaterThanOrEqual(45)
    })

    it('should emit at least 2 progress events', async () => {
      const events: unknown[] = []

      backend.onProgress((event) => {
        events.push(event)
      })

      const request: BackendRequest = {
        id: 'test-5',
        context: {} as unknown as BackendRequest['context'],
        phase: 'intake',
        streamProgress: true,
      }

      await backend.execute(request)

      expect(events.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('execution log', () => {
    it('should track all execute calls', async () => {
      const request1: BackendRequest = {
        id: 'test-6a',
        context: {} as unknown as BackendRequest['context'],
        phase: 'intake',
        streamProgress: true,
      }

      const request2: BackendRequest = {
        id: 'test-6b',
        context: {} as unknown as BackendRequest['context'],
        phase: 'validation',
        streamProgress: true,
      }

      await backend.execute(request1)
      await backend.execute(request2)

      const log = backend.getExecutionLog()
      expect(log).toHaveLength(2)
      expect(log[0]?.id).toBe('test-6a')
      expect(log[1]?.id).toBe('test-6b')
    })

    it('should reset log', async () => {
      const request: BackendRequest = {
        id: 'test-7',
        context: {} as unknown as BackendRequest['context'],
        phase: 'intake',
        streamProgress: true,
      }

      await backend.execute(request)
      expect(backend.getExecutionLog()).toHaveLength(1)

      backend.resetLog()
      expect(backend.getExecutionLog()).toHaveLength(0)
    })
  })
})
