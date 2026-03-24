/**
 * Tests for File Watcher
 *
 * Requirements: 2.1, 2.2
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FileWatcher, createFileWatcher, FileWatcherConfig } from '../../src/infrastructure/file-watcher'
import { EventBus } from '../../src/core/event-bus'
import type { EventType } from '../../src/core/types'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// =============================================================================
// Test Fixtures
// =============================================================================

async function createTempSpecsDir(): Promise<string> {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(7)
  const dir = join(tmpdir(), `kaso-file-watcher-test-${timestamp}-${random}`)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

async function cleanupDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

async function createSpecDir(parentDir: string, specName: string): Promise<string> {
  const specDir = join(parentDir, specName)
  await fs.mkdir(specDir, { recursive: true })
  return specDir
}

async function writeStatusFile(
  specDir: string,
  status: { runStatus: string; currentPhase?: string },
): Promise<void> {
  const statusFile = join(specDir, 'status.json')
  const content = JSON.stringify(
    {
      ...status,
      lastUpdated: new Date().toISOString(),
    },
    null,
    2,
  )
  await fs.writeFile(statusFile, content, 'utf-8')
}

function createMockConfig(specsDir: string): Partial<FileWatcherConfig> {
  return {
    specsDir,
    watchPatterns: ['**/status.json'],
    ignorePatterns: ['**/node_modules/**'],
    pollingInterval: 100,
    usePolling: true, // Use polling for more reliable tests
  }
}

// =============================================================================
// Unit Tests
// =============================================================================

describe('FileWatcher', () => {
  let watcher: FileWatcher
  let tempDir: string
  let eventBus: EventBus

  beforeEach(async () => {
    tempDir = await createTempSpecsDir()
    eventBus = new EventBus()
  })

  afterEach(async () => {
    if (watcher && watcher.isWatching()) {
      await watcher.stop()
    }
    await cleanupDir(tempDir)
  })

  describe('initialization', () => {
    it('should create file watcher with default config', () => {
      watcher = createFileWatcher()
      expect(watcher.getState()).toBe('idle')
      expect(watcher.isWatching()).toBe(false)
    })

    it('should create file watcher with custom config', () => {
      watcher = createFileWatcher({
        specsDir: '.kiro/specs',
        pollingInterval: 500,
      })
      expect(watcher.getState()).toBe('idle')
    })
  })

  describe('start/stop', () => {
    it('should start and stop watching', async () => {
      watcher = createFileWatcher(createMockConfig(tempDir), eventBus)

      let callbackInvoked = false
      await watcher.start(() => {
        callbackInvoked = true
      })

      expect(watcher.getState()).toBe('watching')
      expect(watcher.isWatching()).toBe(true)
      expect(callbackInvoked).toBe(false) // No specs to trigger

      await watcher.stop()

      expect(watcher.getState()).toBe('stopped')
      expect(watcher.isWatching()).toBe(false)
    })

    it('should throw if started twice', async () => {
      watcher = createFileWatcher(createMockConfig(tempDir), eventBus)
      await watcher.start(() => {})

      await expect(watcher.start(() => {})).rejects.toThrow('already running')
    })

    it('should emit started event', async () => {
      watcher = createFileWatcher(createMockConfig(tempDir), eventBus)

      const events: string[] = []
      eventBus.on('watcher:started' as EventType, () => {
        events.push('started')
      })

      await watcher.start(() => {})

      expect(events).toContain('started')
    })

    it('should emit ready event after initial scan', async () => {
      watcher = createFileWatcher(createMockConfig(tempDir), eventBus)

      const events: string[] = []
      eventBus.on('watcher:ready' as EventType, () => {
        events.push('ready')
      })

      await watcher.start(() => {})

      expect(events).toContain('ready')
    })
  })

  describe('spec readiness detection', () => {
    it('should detect spec ready for development', async () => {
      const specDir = await createSpecDir(tempDir, 'test-feature')
      await writeStatusFile(specDir, { runStatus: 'pending' })

      watcher = createFileWatcher(createMockConfig(tempDir), eventBus)

      const triggeredSpecs: string[] = []
      await watcher.start((specPath) => {
        triggeredSpecs.push(specPath)
      })

      // Wait for initial scan
      await new Promise((resolve) => setTimeout(resolve, 300))

      expect(triggeredSpecs.length).toBeGreaterThan(0)
      expect(triggeredSpecs[0]).toContain('test-feature')
    })

    it('should not trigger for specs with active runs', async () => {
      const specDir = await createSpecDir(tempDir, 'active-feature')
      await writeStatusFile(specDir, {
        runStatus: 'running',
        currentPhase: 'implementation',
      })

      watcher = createFileWatcher(createMockConfig(tempDir), eventBus)

      const triggeredSpecs: string[] = []
      await watcher.start((specPath) => {
        triggeredSpecs.push(specPath)
      })

      // Wait for initial scan
      await new Promise((resolve) => setTimeout(resolve, 300))

      // Should not trigger for running specs
      expect(triggeredSpecs).toHaveLength(0)
    })

    it('should detect status change to ready', async () => {
      const specDir = await createSpecDir(tempDir, 'changing-feature')
      await writeStatusFile(specDir, { runStatus: 'completed' })

      watcher = createFileWatcher(createMockConfig(tempDir), eventBus)

      const triggeredSpecs: string[] = []
      await watcher.start((specPath) => {
        triggeredSpecs.push(specPath)
      })

      // Wait for initial scan
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(triggeredSpecs).toHaveLength(0)

      // Change status to pending
      await writeStatusFile(specDir, { runStatus: 'pending' })

      // Wait for file change detection
      await new Promise((resolve) => setTimeout(resolve, 500))

      expect(triggeredSpecs.length).toBeGreaterThan(0)
    })

    it('should pass spec name to callback', async () => {
      const specDir = await createSpecDir(tempDir, 'my-feature')
      await writeStatusFile(specDir, { runStatus: 'pending' })

      watcher = createFileWatcher(createMockConfig(tempDir), eventBus)

      const triggeredNames: string[] = []
      await watcher.start((_specPath, specName) => {
        triggeredNames.push(specName)
      })

      // Wait for initial scan
      await new Promise((resolve) => setTimeout(resolve, 300))

      expect(triggeredNames).toContain('my-feature')
    })

    it('should not trigger same spec twice', async () => {
      const specDir = await createSpecDir(tempDir, 'duplicate-feature')
      await writeStatusFile(specDir, { runStatus: 'pending' })

      watcher = createFileWatcher(createMockConfig(tempDir), eventBus)

      let triggerCount = 0
      await watcher.start(() => {
        triggerCount++
      })

      // Wait for initial scan
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(triggerCount).toBe(1)

      // Update file again (should not trigger again)
      await writeStatusFile(specDir, { runStatus: 'pending' })
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Should still be 1
      expect(triggerCount).toBe(1)
    })
  })

  describe('manual spec checking', () => {
    it('should check spec status manually', async () => {
      const specDir = await createSpecDir(tempDir, 'manual-feature')
      await writeStatusFile(specDir, { runStatus: 'pending' })

      watcher = createFileWatcher(createMockConfig(tempDir), eventBus)

      const isReady = await watcher.checkSpecStatus(specDir)
      expect(isReady).toBe(true)
    })

    it('should return false for non-ready spec', async () => {
      const specDir = await createSpecDir(tempDir, 'busy-feature')
      await writeStatusFile(specDir, {
        runStatus: 'running',
        currentPhase: 'implementation',
      })

      watcher = createFileWatcher(createMockConfig(tempDir), eventBus)

      const isReady = await watcher.checkSpecStatus(specDir)
      expect(isReady).toBe(false)
    })

    it('should trigger spec check manually', async () => {
      const specDir = await createSpecDir(tempDir, 'trigger-feature')
      await writeStatusFile(specDir, { runStatus: 'pending' })

      watcher = createFileWatcher(createMockConfig(tempDir), eventBus)

      const triggeredSpecs: string[] = []
      await watcher.start((specPath) => {
        triggeredSpecs.push(specPath)
      })

      // Manually trigger another spec
      const otherSpecDir = await createSpecDir(tempDir, 'other-feature')
      await writeStatusFile(otherSpecDir, { runStatus: 'pending' })

      await watcher.triggerSpecCheck(otherSpecDir)

      expect(triggeredSpecs).toContain(otherSpecDir)
    })

    it('should throw when triggering without start', async () => {
      watcher = createFileWatcher(createMockConfig(tempDir), eventBus)

      await expect(watcher.triggerSpecCheck(tempDir)).rejects.toThrow(
        'No callback registered',
      )
    })
  })

  describe('event emission', () => {
    it('should emit status detected event', async () => {
      const specDir = await createSpecDir(tempDir, 'event-feature')
      await writeStatusFile(specDir, { runStatus: 'pending' })

      watcher = createFileWatcher(createMockConfig(tempDir), eventBus)

      const events: Array<{ type: string; data: unknown }> = []
      eventBus.on('watcher:status:detected' as EventType, (event) => {
        events.push({ type: 'detected', data: event.data })
      })

      await watcher.start(() => {})
      await new Promise((resolve) => setTimeout(resolve, 300))

      expect(events.length).toBeGreaterThan(0)
    })

    it('should emit spec ready event', async () => {
      const specDir = await createSpecDir(tempDir, 'ready-feature')
      await writeStatusFile(specDir, { runStatus: 'pending' })

      watcher = createFileWatcher(createMockConfig(tempDir), eventBus)

      const events: string[] = []
      eventBus.on('watcher:spec:ready' as EventType, () => {
        events.push('ready')
      })

      await watcher.start(() => {})
      await new Promise((resolve) => setTimeout(resolve, 300))

      expect(events).toContain('ready')
    })

    it('should emit stopped event', async () => {
      watcher = createFileWatcher(createMockConfig(tempDir), eventBus)

      const events: string[] = []
      eventBus.on('watcher:stopped' as EventType, () => {
        events.push('stopped')
      })

      await watcher.start(() => {})
      await watcher.stop()

      expect(events).toContain('stopped')
    })
  })

  describe('watched specs', () => {
    it('should return list of watched specs', async () => {
      await createSpecDir(tempDir, 'spec1')
      await writeStatusFile(join(tempDir, 'spec1'), { runStatus: 'pending' })
      await createSpecDir(tempDir, 'spec2')
      await writeStatusFile(join(tempDir, 'spec2'), { runStatus: 'pending' })

      watcher = createFileWatcher(createMockConfig(tempDir), eventBus)
      await watcher.start(() => {})

      // Wait for initial scan
      await new Promise((resolve) => setTimeout(resolve, 300))

      const watchedSpecs = watcher.getWatchedSpecs()
      expect(watchedSpecs.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('error handling', () => {
    it('should handle missing status.json gracefully', async () => {
      watcher = createFileWatcher(createMockConfig(tempDir), eventBus)

      const isReady = await watcher.checkSpecStatus(join(tempDir, 'nonexistent'))
      expect(isReady).toBe(false)
    })

    it('should handle invalid status.json gracefully', async () => {
      const specDir = await createSpecDir(tempDir, 'invalid-feature')
      await fs.writeFile(join(specDir, 'status.json'), 'invalid json', 'utf-8')

      watcher = createFileWatcher(createMockConfig(tempDir), eventBus)

      const isReady = await watcher.checkSpecStatus(specDir)
      expect(isReady).toBe(false)
    })

    it('should emit error event on callback failure', async () => {
      const specDir = await createSpecDir(tempDir, 'error-feature')
      await writeStatusFile(specDir, { runStatus: 'pending' })

      watcher = createFileWatcher(createMockConfig(tempDir), eventBus)

      const errors: string[] = []
      eventBus.on('watcher:callback:error' as EventType, (event) => {
        errors.push(event.data?.error as string)
      })

      await watcher.start(() => {
        throw new Error('Callback error')
      })

      await new Promise((resolve) => setTimeout(resolve, 300))

      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0]).toContain('Callback error')
    })
  })

  describe('status transitions', () => {
    it('should detect transition from completed to pending', async () => {
      const specDir = await createSpecDir(tempDir, 'transition-feature')
      await writeStatusFile(specDir, { runStatus: 'completed' })

      watcher = createFileWatcher(createMockConfig(tempDir), eventBus)

      const triggeredSpecs: string[] = []
      await watcher.start((specPath) => {
        triggeredSpecs.push(specPath)
      })

      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(triggeredSpecs).toHaveLength(0)

      // Transition to pending
      await writeStatusFile(specDir, { runStatus: 'pending' })
      await new Promise((resolve) => setTimeout(resolve, 500))

      expect(triggeredSpecs.length).toBeGreaterThan(0)
    })

    it('should reset seen status when spec becomes not ready', async () => {
      const specDir = await createSpecDir(tempDir, 'reset-feature')
      await writeStatusFile(specDir, { runStatus: 'pending' })

      watcher = createFileWatcher(createMockConfig(tempDir), eventBus)

      let triggerCount = 0
      await watcher.start(() => {
        triggerCount++
      })

      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(triggerCount).toBe(1)

      // Make spec not ready
      await writeStatusFile(specDir, { runStatus: 'running', currentPhase: 'impl' })
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Make ready again
      await writeStatusFile(specDir, { runStatus: 'pending' })
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Should trigger again
      expect(triggerCount).toBe(2)
    })
  })
})

// =============================================================================
// Edge Cases
// =============================================================================

describe('FileWatcher Edge Cases', () => {
  it('should handle empty specs directory', async () => {
    const emptyDir = await createTempSpecsDir()
    const watcher = createFileWatcher(createMockConfig(emptyDir))

    let callbackInvoked = false
    await watcher.start(() => {
      callbackInvoked = true
    })

    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(watcher.isWatching()).toBe(true)
    expect(callbackInvoked).toBe(false)

    await watcher.stop()
    await cleanupDir(emptyDir)
  })

  it('should handle deeply nested spec directories', async () => {
    const nestedDir = await createTempSpecsDir()
    const deepSpecDir = join(nestedDir, 'features', 'ui', 'button')
    await fs.mkdir(deepSpecDir, { recursive: true })
    await writeStatusFile(deepSpecDir, { runStatus: 'pending' })

    const watcher = createFileWatcher(createMockConfig(nestedDir))

    const triggeredSpecs: string[] = []
    await watcher.start((specPath) => {
      triggeredSpecs.push(specPath)
    })

    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(triggeredSpecs.some((p) => p.includes('button'))).toBe(true)

    await watcher.stop()
    await cleanupDir(nestedDir)
  })

  it('should ignore non-status.json files', async () => {
    const tempDir = await createTempSpecsDir()
    const specDir = await createSpecDir(tempDir, 'other-files')
    await fs.writeFile(join(specDir, 'design.md'), '# Design', 'utf-8')
    await fs.writeFile(join(specDir, 'tech-spec.md'), '# Tech Spec', 'utf-8')

    const watcher = createFileWatcher(createMockConfig(tempDir))

    let callbackInvoked = false
    await watcher.start(() => {
      callbackInvoked = true
    })

    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(callbackInvoked).toBe(false)

    await watcher.stop()
    await cleanupDir(tempDir)
  })
})
