/**
 * Tests for configuration loader
 * Tests backend config round-trip and validation
 */

import { describe, expect, it } from 'vitest'
import { loadConfig, loadConfigSafe } from '@/config/loader'
import {
  validateConfig,
  getDefaultConfig,
  ExecutorBackendConfigSchema,
} from '@/config/schema'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { resolve } from 'path'
import { tmpdir } from 'os'

// Helper to create a temporary config file
function createTempConfig(config: unknown): string {
  const tmpPath = resolve(
    tmpdir(),
    `kaso-test-config-${Date.now()}-${Math.random().toString(36).substring(7)}.json`,
  )
  writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8')
  return tmpPath
}

describe('Config Loader Tests', () => {
  describe('Property 13: Backend config round-trip', () => {
    it('should load and preserve a valid config', () => {
      const config = {
        executorBackends: [
          {
            name: 'kimi-test',
            command: 'kimi',
            args: [],
            protocol: 'cli-json',
            maxContextWindow: 128000,
            costPer1000Tokens: 0.01,
            enabled: true,
          },
        ],
        defaultBackend: 'kimi-test',
        backendSelectionStrategy: 'default',
        maxConcurrentAgents: 'auto',
        maxPhaseRetries: 2,
        defaultPhaseTimeout: 300,
        uiBaseline: {
          baselineDir: '.kiro/ui-baselines',
          captureOnPass: true,
          diffThreshold: 0.1,
          viewport: {
            width: 1280,
            height: 720,
          },
        },
      }

      const tmpPath = createTempConfig(config)

      try {
        // Load the config
        const loaded = loadConfig({ configPath: tmpPath, useDefaults: false })

        // Verify all properties are preserved
        expect(loaded.executorBackends).toHaveLength(1)
        expect(loaded.defaultBackend).toBe('kimi-test')
        expect(loaded.backendSelectionStrategy).toBe('default')
        expect(loaded.maxPhaseRetries).toBe(2)
        expect(loaded.defaultPhaseTimeout).toBe(300)

        // Verify backend config is preserved
        const loadedBackend = loaded.executorBackends[0]!
        expect(loadedBackend.name).toBe('kimi-test')
        expect(loadedBackend.command).toBe('kimi')
        expect(loadedBackend.args).toEqual([])
        expect(loadedBackend.protocol).toBe('cli-json')
        expect(loadedBackend.maxContextWindow).toBe(128000)
        expect(loadedBackend.costPer1000Tokens).toBe(0.01)
        expect(loadedBackend.enabled).toBe(true)
      } finally {
        if (existsSync(tmpPath)) {
          unlinkSync(tmpPath)
        }
      }
    })
  })

  describe('Config validation', () => {
    it('should reject config with missing required fields', () => {
      const invalidConfig = {
        // Missing executorBackends
        defaultBackend: 'test',
      }

      expect(() => validateConfig(invalidConfig)).toThrow()
    })

    it('should reject config with invalid backend protocol', () => {
      const invalidConfig = {
        executorBackends: [
          {
            name: 'test-backend',
            command: 'test',
            protocol: 'invalid-protocol',
          },
        ],
        defaultBackend: 'test-backend',
      }

      expect(() => validateConfig(invalidConfig)).toThrow()
    })

    it('should accept valid config', () => {
      const validConfig = {
        executorBackends: [
          {
            name: 'test-backend',
            command: 'test',
          },
        ],
        defaultBackend: 'test-backend',
        uiBaseline: {
          baselineDir: '.kiro/ui-baselines',
          captureOnPass: true,
          diffThreshold: 0.1,
          viewport: {
            width: 1280,
            height: 720,
          },
        },
      }

      expect(() => validateConfig(validConfig)).not.toThrow()
    })
  })

  describe('loadConfigSafe behavior', () => {
    it('should return defaults when file does not exist', () => {
      const safeConfig = loadConfigSafe({
        configPath: '/non/existent/path/config.json',
      })
      const defaultConfig = getDefaultConfig()

      // Should return valid config with defaults
      expect(safeConfig.executorBackends).toBeDefined()
      expect(safeConfig.defaultBackend).toBeDefined()
      expect(safeConfig.maxPhaseRetries).toBe(defaultConfig.maxPhaseRetries)
      expect(safeConfig.defaultPhaseTimeout).toBe(
        defaultConfig.defaultPhaseTimeout,
      )
    })
  })

  describe('ExecutorBackendConfig schema', () => {
    it('should validate backend config', () => {
      const backendConfig = {
        name: 'test-backend',
        command: 'test-command',
        args: ['--option', 'value'],
        protocol: 'cli-json',
        maxContextWindow: 100000,
        costPer1000Tokens: 0.02,
        enabled: false,
      }

      const result = ExecutorBackendConfigSchema.safeParse(backendConfig)
      expect(result.success).toBe(true)
    })
  })

  // ============================================================================
  // Feature: configurable-backends-review
  // ============================================================================

  describe('Cross-field backend validation', () => {
    it('should reject phaseBackends referencing non-existent backend', () => {
      const config = {
        executorBackends: [
          {
            name: 'kimi-code',
            command: 'kimi',
            protocol: 'cli-json',
            enabled: true,
          },
        ],
        defaultBackend: 'kimi-code',
        phaseBackends: {
          implementation: 'non-existent-backend',
        },
        uiBaseline: {
          baselineDir: '.kiro/ui-baselines',
          captureOnPass: true,
          diffThreshold: 0.1,
          viewport: { width: 1280, height: 720 },
        },
      }

      expect(() => validateConfig(config)).toThrow(/non-existent-backend/)
    })

    it('should reject phaseBackends referencing disabled backend', () => {
      const config = {
        executorBackends: [
          {
            name: 'kimi-code',
            command: 'kimi',
            protocol: 'cli-json',
            enabled: true,
          },
          {
            name: 'disabled-backend',
            command: 'disabled',
            protocol: 'cli-json',
            enabled: false,
          },
        ],
        defaultBackend: 'kimi-code',
        phaseBackends: {
          implementation: 'disabled-backend',
        },
        uiBaseline: {
          baselineDir: '.kiro/ui-baselines',
          captureOnPass: true,
          diffThreshold: 0.1,
          viewport: { width: 1280, height: 720 },
        },
      }

      expect(() => validateConfig(config)).toThrow(/disabled/)
    })

    it('should reject reviewers referencing non-existent backend', () => {
      const config = {
        executorBackends: [
          {
            name: 'kimi-code',
            command: 'kimi',
            protocol: 'cli-json',
            enabled: true,
          },
        ],
        defaultBackend: 'kimi-code',
        reviewCouncil: {
          reviewers: [{ role: 'security', backend: 'non-existent-backend' }],
        },
        uiBaseline: {
          baselineDir: '.kiro/ui-baselines',
          captureOnPass: true,
          diffThreshold: 0.1,
          viewport: { width: 1280, height: 720 },
        },
      }

      expect(() => validateConfig(config)).toThrow(/non-existent-backend/)
    })

    it('should reject reviewers referencing disabled backend', () => {
      const config = {
        executorBackends: [
          {
            name: 'kimi-code',
            command: 'kimi',
            protocol: 'cli-json',
            enabled: true,
          },
          {
            name: 'disabled-backend',
            command: 'disabled',
            protocol: 'cli-json',
            enabled: false,
          },
        ],
        defaultBackend: 'kimi-code',
        reviewCouncil: {
          reviewers: [{ role: 'security', backend: 'disabled-backend' }],
        },
        uiBaseline: {
          baselineDir: '.kiro/ui-baselines',
          captureOnPass: true,
          diffThreshold: 0.1,
          viewport: { width: 1280, height: 720 },
        },
      }

      expect(() => validateConfig(config)).toThrow(/disabled/)
    })

    it('should accept valid phaseBackends and reviewers', () => {
      const config = {
        executorBackends: [
          {
            name: 'kimi-code',
            command: 'kimi',
            protocol: 'cli-json',
            enabled: true,
          },
          {
            name: 'claude-code',
            command: 'claude',
            protocol: 'cli-json',
            enabled: true,
          },
        ],
        defaultBackend: 'kimi-code',
        phaseBackends: {
          implementation: 'claude-code',
        },
        reviewCouncil: {
          reviewers: [
            { role: 'security', backend: 'claude-code' },
            { role: 'performance' },
          ],
        },
        uiBaseline: {
          baselineDir: '.kiro/ui-baselines',
          captureOnPass: true,
          diffThreshold: 0.1,
          viewport: { width: 1280, height: 720 },
        },
      }

      expect(() => validateConfig(config)).not.toThrow()
    })

    it('should accept empty phaseBackends', () => {
      const config = {
        executorBackends: [
          {
            name: 'kimi-code',
            command: 'kimi',
            protocol: 'cli-json',
            enabled: true,
          },
        ],
        defaultBackend: 'kimi-code',
        phaseBackends: {},
        uiBaseline: {
          baselineDir: '.kiro/ui-baselines',
          captureOnPass: true,
          diffThreshold: 0.1,
          viewport: { width: 1280, height: 720 },
        },
      }

      expect(() => validateConfig(config)).not.toThrow()
      const loaded = validateConfig(config)
      expect(loaded.phaseBackends).toEqual({})
    })

    it('should warn when >10 reviewers configured', () => {
      const reviewers = Array.from({ length: 11 }, (_, i) => ({
        role: `role-${i}`,
      }))
      const config = {
        executorBackends: [
          {
            name: 'kimi-code',
            command: 'kimi',
            protocol: 'cli-json',
            enabled: true,
          },
        ],
        defaultBackend: 'kimi-code',
        reviewCouncil: { reviewers },
        uiBaseline: {
          baselineDir: '.kiro/ui-baselines',
          captureOnPass: true,
          diffThreshold: 0.1,
          viewport: { width: 1280, height: 720 },
        },
      }

      expect(() => validateConfig(config)).toThrow(/more than 10 reviewers/)
    })

    it('should reject duplicate reviewer roles', () => {
      const config = {
        executorBackends: [
          {
            name: 'kimi-code',
            command: 'kimi',
            protocol: 'cli-json',
            enabled: true,
          },
        ],
        defaultBackend: 'kimi-code',
        reviewCouncil: {
          reviewers: [
            { role: 'security' },
            { role: 'security' }, // duplicate
          ],
        },
        uiBaseline: {
          baselineDir: '.kiro/ui-baselines',
          captureOnPass: true,
          diffThreshold: 0.1,
          viewport: { width: 1280, height: 720 },
        },
      }

      expect(() => validateConfig(config)).toThrow(/unique/)
    })
  })
})
