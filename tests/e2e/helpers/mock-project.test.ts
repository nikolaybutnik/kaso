/**
 * Unit tests for mock-project helper
 *
 * Validates: Requirements 1.1–1.6
 */

import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { createMockProject, type MockProjectResult } from './mock-project'
import { validateConfig } from '@/config/schema'

describe('createMockProject', () => {
  let result: MockProjectResult | undefined

  afterEach(async () => {
    if (result) {
      await result.cleanup()
      result = undefined
    }
  })

  describe('generated config passes validateConfig()', () => {
    it('produces a valid kaso.config.json that passes schema validation', async () => {
      result = await createMockProject()

      const raw = readFileSync(result.configPath, 'utf-8')
      const config = JSON.parse(raw)

      expect(() => validateConfig(config)).not.toThrow()
    })

    it('passes validation with custom feature name', async () => {
      result = await createMockProject({ featureName: 'custom-widget' })

      const raw = readFileSync(result.configPath, 'utf-8')
      const config = JSON.parse(raw)

      expect(() => validateConfig(config)).not.toThrow()
    })
  })

  describe('directory structure contains expected files', () => {
    it('creates spec files: requirements.md, design.md, tasks.md', async () => {
      result = await createMockProject()

      expect(existsSync(join(result.specPath, 'requirements.md'))).toBe(true)
      expect(existsSync(join(result.specPath, 'design.md'))).toBe(true)
      expect(existsSync(join(result.specPath, 'tasks.md'))).toBe(true)
    })

    it('creates steering files: coding-practices.md, personality.md', async () => {
      result = await createMockProject()

      const steeringDir = join(result.projectDir, '.kiro', 'steering')
      expect(existsSync(join(steeringDir, 'coding-practices.md'))).toBe(true)
      expect(existsSync(join(steeringDir, 'personality.md'))).toBe(true)
    })

    it('creates kaso.config.json at project root', async () => {
      result = await createMockProject()

      expect(existsSync(join(result.projectDir, 'kaso.config.json'))).toBe(true)
    })

    it('creates package.json at project root', async () => {
      result = await createMockProject()

      expect(existsSync(join(result.projectDir, 'package.json'))).toBe(true)
    })
  })

  describe('cleanup removes temp directory', () => {
    it('removes the project directory after cleanup()', async () => {
      result = await createMockProject()
      const dir = result.projectDir

      expect(existsSync(dir)).toBe(true)

      await result.cleanup()
      result = undefined // prevent double-cleanup in afterEach

      expect(existsSync(dir)).toBe(false)
    })
  })
})
