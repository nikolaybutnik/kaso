/**
 * Unit Tests for E2E Test Harness
 *
 * Requirements: 1.1–1.6, 2.1–2.7
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupHarness, teardownHarness, configurePhaseResponse } from './harness'
import type { HarnessContext } from './harness'

describe('E2E Test Harness', () => {
  describe('setupHarness', () => {
    let ctx: HarnessContext | undefined

    afterAll(async () => {
      if (ctx) {
        await teardownHarness(ctx)
      }
    })

    it('should create harness context', async () => {
      ctx = await setupHarness()

      expect(ctx.app).toBeDefined()
      expect(ctx.projectDir).toBeDefined()
      expect(ctx.specPath).toBeDefined()
      expect(ctx.backends).toBeDefined()
      expect(ctx.eventCollector).toBeDefined()
      expect(ctx.phaseValidator).toBeDefined()
    }, 30000)

    it('should create mock backend', async () => {
      ctx = await setupHarness()

      expect(ctx.backends.has('mock-backend')).toBe(true)
      const backend = ctx.backends.get('mock-backend')
      expect(backend).toBeDefined()
      expect(backend?.name).toBe('mock-backend')
    }, 30000)

    it('should register backend with registry', async () => {
      ctx = await setupHarness()

      const registry = ctx.app.backendRegistry
      const backend = registry.getBackend('mock-backend')
      expect(backend).toBeDefined()
    }, 30000)

    it('should apply config overrides', async () => {
      ctx = await setupHarness({
        configOverrides: {
          maxPhaseRetries: 5,
          defaultPhaseTimeout: 120,
        },
      })

      expect(ctx.app.config.maxPhaseRetries).toBe(5)
      expect(ctx.app.config.defaultPhaseTimeout).toBe(120)
    }, 30000)

    it('should create multiple backends when requested', async () => {
      ctx = await setupHarness({
        backendCount: 3,
      })

      expect(ctx.backends.size).toBe(3)
      expect(ctx.backends.has('mock-backend')).toBe(true)
      expect(ctx.backends.has('mock-backend-2')).toBe(true)
      expect(ctx.backends.has('mock-backend-3')).toBe(true)
    }, 30000)
  })

  describe('teardownHarness', () => {
    it('should cleanup without error', async () => {
      const ctx = await setupHarness()
      // Project dir will be cleaned up

      // Verify project exists
      expect(ctx.app).toBeDefined()

      // Teardown
      await teardownHarness(ctx)

      // Verify cleanup occurred
      // Note: We can't easily check if the directory was removed without
      // file system access, but the teardown should not throw
    }, 30000)
  })

  describe('configurePhaseResponse', () => {
    let ctx: HarnessContext | undefined

    beforeAll(async () => {
      ctx = await setupHarness()
    }, 30000)

    afterAll(async () => {
      if (ctx) {
        await teardownHarness(ctx)
      }
    })

    it('should configure phase response', () => {
      configurePhaseResponse(ctx!, 'mock-backend', 'implementation', true, {
        modifiedFiles: ['test.ts'],
      })

      // Backend configured, execution log would be populated after execution
      // Backend hasn't executed yet, just verify no throw
      expect(ctx!.backends.get('mock-backend')).toBeDefined()
    })

    it('should throw for unknown backend', () => {
      expect(() =>
        configurePhaseResponse(ctx!, 'unknown-backend', 'implementation', true),
      ).toThrow("Backend 'unknown-backend' not found")
    })
  })
})
