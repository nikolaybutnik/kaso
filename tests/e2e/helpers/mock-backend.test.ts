/**
 * Unit tests for MockBackend helper
 *
 * Validates: Requirements 2.1–2.7
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { MockBackend } from './mock-backend'
import type { MockBackendConfig, MockPhaseResponse } from './mock-backend'
import type {
  BackendRequest,
  BackendProgressEvent,
  AgentContext,
  PhaseName,
} from '@/core/types'

/** Minimal BackendRequest fixture */
function createRequest(overrides?: Partial<BackendRequest>): BackendRequest {
  return {
    id: 'test-req-1',
    phase: 'implementation' as PhaseName,
    context: {} as AgentContext,
    streamProgress: false,
    ...overrides,
  }
}

const DEFAULT_CONFIG: MockBackendConfig = {
  name: 'test-backend',
  maxContextWindow: 128000,
  costPer1000Tokens: 0.01,
}

describe('MockBackend', () => {
  let backend: MockBackend

  beforeEach(() => {
    backend = new MockBackend(DEFAULT_CONFIG)
  })

  describe('execute() returns configured responses', () => {
    it('returns default success response when no phase response configured', async () => {
      const response = await backend.execute(createRequest())

      expect(response.success).toBe(true)
      expect(response.id).toBe('test-req-1')
      expect(response.tokensUsed).toBe(1000)
    })

    it('returns configured success response for a phase', async () => {
      const phaseResponse: MockPhaseResponse = {
        success: true,
        output: {
          modifiedFiles: ['src/foo.ts'],
          addedTests: [],
          duration: 100,
          backend: 'test',
          selfCorrectionAttempts: 0,
        },
        tokensUsed: 5000,
      }
      backend.setPhaseResponse('implementation', phaseResponse)

      const response = await backend.execute(
        createRequest({ phase: 'implementation' }),
      )

      expect(response.success).toBe(true)
      expect(response.output).toEqual(phaseResponse.output)
      expect(response.tokensUsed).toBe(5000)
    })

    it('returns configured failure response for a phase', async () => {
      backend.setPhaseResponse('validation', {
        success: false,
        error: 'Validation failed: missing schema',
        retryable: true,
      })

      const response = await backend.execute(
        createRequest({ phase: 'validation' }),
      )

      expect(response.success).toBe(false)
      expect(response.error).toBe('Validation failed: missing schema')
    })

    it('uses default tokensUsed when phase response omits it', async () => {
      backend.setPhaseResponse('intake', { success: true })

      const response = await backend.execute(createRequest({ phase: 'intake' }))

      expect(response.tokensUsed).toBe(1000) // defaultTokensUsed
    })
  })

  describe('progress events', () => {
    it('emits at least 2 progress events per execute() call', async () => {
      const events: BackendProgressEvent[] = []
      backend.onProgress((event) => events.push(event))

      await backend.execute(createRequest())

      expect(events.length).toBeGreaterThanOrEqual(2)
    })

    it('emits progress events with valid structure', async () => {
      const events: BackendProgressEvent[] = []
      backend.onProgress((event) => events.push(event))

      await backend.execute(createRequest({ phase: 'implementation' }))

      for (const event of events) {
        expect(event.type).toBeDefined()
        expect(event.timestamp).toBeDefined()
        expect(event.message).toBeDefined()
      }
    })

    it('notifies all registered callbacks', async () => {
      let countA = 0
      let countB = 0
      backend.onProgress(() => countA++)
      backend.onProgress(() => countB++)

      await backend.execute(createRequest())

      expect(countA).toBeGreaterThanOrEqual(2)
      expect(countB).toBeGreaterThanOrEqual(2)
    })
  })

  describe('delay behavior', () => {
    it('respects configured delay via setDelay()', async () => {
      const delayMs = 50
      const timerTolerance = 5
      backend.setDelay(delayMs)

      const start = Date.now()
      await backend.execute(createRequest())
      const elapsed = Date.now() - start

      expect(elapsed).toBeGreaterThanOrEqual(delayMs - timerTolerance)
    })

    it('executes immediately with no delay configured', async () => {
      const start = Date.now()
      await backend.execute(createRequest())
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(50)
    })
  })

  describe('availability toggle', () => {
    it('defaults to available', async () => {
      expect(await backend.isAvailable()).toBe(true)
    })

    it('setAvailable(false) makes isAvailable() return false', async () => {
      backend.setAvailable(false)
      expect(await backend.isAvailable()).toBe(false)
    })

    it('setAvailable(true) restores availability', async () => {
      backend.setAvailable(false)
      backend.setAvailable(true)
      expect(await backend.isAvailable()).toBe(true)
    })
  })

  describe('execution log tracking', () => {
    it('tracks execute() calls in getExecutionLog()', async () => {
      const req1 = createRequest({ id: 'req-1', phase: 'intake' })
      const req2 = createRequest({ id: 'req-2', phase: 'validation' })

      await backend.execute(req1)
      await backend.execute(req2)

      const log = backend.getExecutionLog()
      expect(log).toHaveLength(2)
      expect(log[0]!.id).toBe('req-1')
      expect(log[1]!.id).toBe('req-2')
    })

    it('returns a copy from getExecutionLog() (not internal reference)', async () => {
      await backend.execute(createRequest())
      const log1 = backend.getExecutionLog()
      const log2 = backend.getExecutionLog()

      expect(log1).not.toBe(log2)
      expect(log1).toEqual(log2)
    })

    it('resetLog() clears the execution log', async () => {
      await backend.execute(createRequest())
      expect(backend.getExecutionLog()).toHaveLength(1)

      backend.resetLog()
      expect(backend.getExecutionLog()).toHaveLength(0)
    })

    it('starts with empty execution log', () => {
      expect(backend.getExecutionLog()).toHaveLength(0)
    })
  })
})
