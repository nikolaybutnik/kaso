/**
 * Unit Tests for MockProject Helper
 *
 * Validates the mock project fixture creation.
 * Requirements: 1.1–1.6
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createMockProject } from './mock-project'
import { validateConfig } from '@/config/schema'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

describe('createMockProject', () => {
  let cleanupFn: (() => Promise<void>) | undefined

  afterEach(async () => {
    if (cleanupFn) {
      await cleanupFn()
      cleanupFn = undefined
    }
  })

  it('should create a valid project directory', async () => {
    const result = await createMockProject()
    cleanupFn = result.cleanup

    expect(existsSync(result.projectDir)).toBe(true)
    expect(existsSync(result.specPath)).toBe(true)
    expect(existsSync(result.configPath)).toBe(true)
  })

  it('should generate valid kaso.config.json', async () => {
    const result = await createMockProject()
    cleanupFn = result.cleanup

    const configContent = readFileSync(result.configPath, 'utf-8')
    const config = JSON.parse(configContent)

    // Should pass schema validation
    expect(() => validateConfig(config)).not.toThrow()

    // Check key values
    expect(config.defaultBackend).toBe('mock-backend')
    expect(config.executionStore.type).toBe('sqlite')
    expect(config.executionStore.path).toBe(':memory:')
  })

  it('should create design.md with EARS pattern', async () => {
    const result = await createMockProject({ featureName: 'test-widget' })
    cleanupFn = result.cleanup

    const designPath = join(result.specPath, 'design.md')
    expect(existsSync(designPath)).toBe(true)

    const content = readFileSync(designPath, 'utf-8')

    // Check for required sections
    expect(content).toContain('# Design Document: test-widget')
    expect(content).toContain('## Introduction')
    expect(content).toContain('## Glossary')
    expect(content).toContain('## Requirements')
    expect(content).toContain('#### Acceptance Criteria')

    // Check for EARS pattern
    expect(content).toContain('WHEN')
    expect(content).toContain('THEN')
    expect(content).toContain('SHALL')
  })

  it('should create tasks.md with checkboxes', async () => {
    const result = await createMockProject()
    cleanupFn = result.cleanup

    const tasksPath = join(result.specPath, 'tasks.md')
    expect(existsSync(tasksPath)).toBe(true)

    const content = readFileSync(tasksPath, 'utf-8')

    expect(content).toContain('# Tasks')
    expect(content).toContain('- [x]')
    expect(content).toContain('- [ ]')
  })

  it('should create steering files', async () => {
    const result = await createMockProject()
    cleanupFn = result.cleanup

    const steeringDir = join(result.projectDir, '.kiro', 'steering')
    expect(existsSync(join(steeringDir, 'coding_practices.md'))).toBe(true)
    expect(existsSync(join(steeringDir, 'personality.md'))).toBe(true)
  })

  it('should apply config overrides', async () => {
    const result = await createMockProject({
      configOverrides: {
        maxPhaseRetries: 5,
        defaultPhaseTimeout: 120,
      },
    })
    cleanupFn = result.cleanup

    const configContent = readFileSync(result.configPath, 'utf-8')
    const config = JSON.parse(configContent)

    expect(config.maxPhaseRetries).toBe(5)
    expect(config.defaultPhaseTimeout).toBe(120)
  })

  it('should use custom feature name', async () => {
    const result = await createMockProject({ featureName: 'custom-api' })
    cleanupFn = result.cleanup

    expect(result.specPath).toContain('custom-api')

    const designPath = join(result.specPath, 'design.md')
    const content = readFileSync(designPath, 'utf-8')
    expect(content).toContain('# Design Document: custom-api')
  })

  it('should clean up temp directory', async () => {
    const result = await createMockProject()
    const projectDir = result.projectDir

    expect(existsSync(projectDir)).toBe(true)

    await result.cleanup()

    expect(existsSync(projectDir)).toBe(false)
  })
})
