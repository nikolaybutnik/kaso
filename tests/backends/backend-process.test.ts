/**
 * Unit tests for backend process manager
 */

import { describe, it, expect } from 'vitest'
import {
  CLIProcessBackend,
  MockBackend,
} from '../../src/backends/backend-process'
import type { ExecutorBackendConfig } from '../../src/config/schema'
import type { BackendRequest, BackendProgressEvent } from '../../src/core/types'
import { getDefaultConfig } from '../../src/config/schema'

/** Creates a minimal BackendRequest for testing */
function createTestRequest(id = 'test-request'): BackendRequest {
  return {
    id,
    context: {
      runId: 'test-run',
      spec: {
        featureName: 'test',
        specPath: '/test/spec',
        missingFiles: [],
      },
      steering: { hooks: {} },
      phaseOutputs: {},
      config: getDefaultConfig(),
      backends: {},
    },
    phase: 'implementation',
    streamProgress: true,
  }
}

describe('MockBackend', () => {
  it('should execute successfully and emit progress events', async () => {
    const backend = new MockBackend('test-backend')
    const progressEvents: BackendProgressEvent[] = []

    backend.onProgress((event) => {
      progressEvents.push(event)
    })

    const response = await backend.execute(createTestRequest())

    expect(response.success).toBe(true)
    expect(response.id).toBe('test-request')
    expect(response.tokensUsed).toBe(1000)
    expect(response.duration).toBe(100)
    expect(progressEvents).toHaveLength(4)
    expect(progressEvents[0]?.message).toBe('Starting execution')
    expect(progressEvents[1]?.message).toBe('Processing context')
    expect(progressEvents[2]?.message).toBe('Generating code')
    expect(progressEvents[3]?.message).toBe('Execution complete')
  })

  it('should indicate availability', async () => {
    const availableBackend = new MockBackend('test', true)
    const unavailableBackend = new MockBackend('test', false)

    expect(await availableBackend.isAvailable()).toBe(true)
    expect(await unavailableBackend.isAvailable()).toBe(false)
  })

  it('should throw error when not available', async () => {
    const backend = new MockBackend('test', false)

    await expect(backend.execute(createTestRequest())).rejects.toThrow(
      "Mock backend 'test' is not available",
    )
  })

  it('should expose backend name via property', () => {
    const backend = new MockBackend('my-backend')
    expect(backend.name).toBe('my-backend')
  })

  it('should handle multiple progress callbacks', async () => {
    const backend = new MockBackend('test-backend')
    const progressEvents1: BackendProgressEvent[] = []
    const progressEvents2: BackendProgressEvent[] = []

    backend.onProgress((event) => progressEvents1.push(event))
    backend.onProgress((event) => progressEvents2.push(event))

    await backend.execute(createTestRequest())

    expect(progressEvents1).toHaveLength(4)
    expect(progressEvents2).toHaveLength(4)
    expect(progressEvents1).toEqual(progressEvents2)
  })
})

describe('CLIProcessBackend', () => {
  it('should create backend with config', () => {
    const config: ExecutorBackendConfig = {
      name: 'test-backend',
      command: 'echo',
      args: [],
      protocol: 'cli-stdout',
      maxContextWindow: 64000,
      costPer1000Tokens: 0.01,
      enabled: true,
    }

    const backend = new CLIProcessBackend(config)
    expect(backend.name).toBe('test-backend')
  })

  it('should check availability of existing command', async () => {
    const config: ExecutorBackendConfig = {
      name: 'node',
      command: 'node',
      args: ['--version'],
      protocol: 'cli-stdout',
      maxContextWindow: 64000,
      costPer1000Tokens: 0.01,
      enabled: true,
    }

    const backend = new CLIProcessBackend(config)
    const available = await backend.isAvailable()

    // Node should be available in test environment
    expect(available).toBe(true)
  }, 10000)

  it('should indicate unavailability for non-existent command', async () => {
    const config: ExecutorBackendConfig = {
      name: 'non-existent-command',
      command: 'this-command-does-not-exist-12345',
      args: [],
      protocol: 'cli-stdout',
      maxContextWindow: 64000,
      costPer1000Tokens: 0.01,
      enabled: true,
    }

    const backend = new CLIProcessBackend(config)
    const available = await backend.isAvailable()
    expect(available).toBe(false)
  }, 10000)

  it('should handle progress callbacks', () => {
    const config: ExecutorBackendConfig = {
      name: 'test-backend',
      command: 'echo',
      args: [],
      protocol: 'cli-stdout',
      maxContextWindow: 64000,
      costPer1000Tokens: 0.01,
      enabled: true,
    }

    const backend = new CLIProcessBackend(config)
    const progressEvents: BackendProgressEvent[] = []

    backend.onProgress((event) => {
      progressEvents.push(event)
    })

    expect(progressEvents).toHaveLength(0)
  })
})
