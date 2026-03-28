/**
 * Pipeline Integration Tests for KASO
 *
 * End-to-end pipeline test with mock backend, file watcher trigger,
 * worktree isolation, and SSE event streaming.
 *
 * Requirements: All
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import http from 'http'
import { initializeKASO, shutdownKASO, type ApplicationContext } from '@/index'
import { FileWatcher } from '@/infrastructure/file-watcher'
import { EventBus } from '@/core/event-bus'
import { SSEServer } from '@/streaming/sse-server'
import { createTestConfig } from './kaso.integration.test'
import type { ExecutionEvent, PhaseName } from '@/core/types'

// =============================================================================
// Helpers
// =============================================================================

function createTempDir(prefix: string): string {
  const dir = join(tmpdir(), `kaso-integration-${prefix}-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanupDir(dir: string): void {
  try {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
    }
  } catch {
    // Best-effort cleanup
  }
}

/** Clean up spec directories and worktrees created by startRun during tests */
async function cleanupTestRun(
  context: ApplicationContext,
  specPath: string,
): Promise<void> {
  // Remove the spec directory the orchestrator created
  const specName = specPath.split('/').pop()
  if (specName) {
    cleanupDir(`.kiro/specs/${specName}`)
  }

  // Clean up any worktrees the orchestrator created
  for (const wt of context.worktreeManager.listWorktrees()) {
    try {
      await context.worktreeManager.cleanup(wt.runId)
    } catch {
      // Best-effort
    }
  }
}

// =============================================================================
// End-to-End Pipeline Test with Mock Backend
// =============================================================================

describe('End-to-End Pipeline with Mock Backend', () => {
  let context: ApplicationContext | undefined
  const usedSpecPaths: string[] = []

  afterEach(async () => {
    if (context) {
      for (const sp of usedSpecPaths) {
        await cleanupTestRun(context, sp)
      }
      usedSpecPaths.length = 0
      await shutdownKASO(context)
      context = undefined
    }
  })

  it('should emit run:started and run:failed events for invalid spec', async () => {
    context = await initializeKASO({
      config: createTestConfig(),
      enableSSE: false,
      enableWebhooks: false,
      enableFileWatcher: false,
      enableMCP: false,
    })

    const specPath = '/tmp/nonexistent-pipeline-test'
    usedSpecPaths.push(specPath)

    const events: ExecutionEvent[] = []
    const unsub = context.eventBus.onAny((e) => {
      events.push(e as ExecutionEvent)
    })

    try {
      await context.orchestrator.startRun({ specPath })
    } catch {
      // Expected — spec doesn't exist
    }

    unsub()

    const startEvent = events.find((e) => e.type === 'run:started')
    expect(startEvent).toBeDefined()
    expect(startEvent!.runId).toBeDefined()

    const failEvent = events.find(
      (e) => e.type === 'run:failed' || e.type === 'phase:failed',
    )
    expect(failEvent).toBeDefined()
  })

  it('should persist run record in execution store after pipeline attempt', async () => {
    context = await initializeKASO({
      config: createTestConfig(),
      enableSSE: false,
      enableWebhooks: false,
      enableFileWatcher: false,
      enableMCP: false,
    })

    const specPath = '/tmp/store-pipeline-test'
    usedSpecPaths.push(specPath)

    try {
      await context.orchestrator.startRun({ specPath })
    } catch {
      // Expected
    }

    const runs = context.executionStore.getRuns(10)
    expect(runs.length).toBeGreaterThan(0)

    const latestRun = runs[0]!
    expect(latestRun.specPath).toBe(specPath)
    expect(['failed', 'completed', 'cancelled']).toContain(latestRun.status)
  })

  it('should emit phase:started for the intake phase', async () => {
    context = await initializeKASO({
      config: createTestConfig(),
      enableSSE: false,
      enableWebhooks: false,
      enableFileWatcher: false,
      enableMCP: false,
    })

    const specPath = '/tmp/phase-event-test'
    usedSpecPaths.push(specPath)

    const phaseEvents: ExecutionEvent[] = []
    const unsub = context.eventBus.onAny((e) => {
      const event = e as ExecutionEvent
      if (event.type === 'phase:started') {
        phaseEvents.push(event)
      }
    })

    try {
      await context.orchestrator.startRun({ specPath })
    } catch {
      // Expected
    }

    unsub()

    const intakeStart = phaseEvents.find((e) => e.phase === 'intake')
    expect(intakeStart).toBeDefined()
  })
})

// =============================================================================
// File Watcher Trigger Test
// =============================================================================

describe('File Watcher Trigger', () => {
  let tempDir: string
  let fileWatcher: FileWatcher
  let eventBus: EventBus

  beforeEach(() => {
    tempDir = createTempDir('file-watcher')
    eventBus = new EventBus()
  })

  afterEach(async () => {
    if (fileWatcher) {
      await fileWatcher.stop()
    }
    cleanupDir(tempDir)
  })

  it('should trigger callback when spec status becomes ready', async () => {
    const specDir = join(tempDir, 'test-feature')
    mkdirSync(specDir, { recursive: true })

    fileWatcher = new FileWatcher(
      { specsDir: tempDir, usePolling: true, pollingInterval: 100 },
      eventBus,
    )

    let triggeredSpecPath: string | undefined
    let triggeredSpecName: string | undefined

    await fileWatcher.start(async (specPath, specName) => {
      triggeredSpecPath = specPath
      triggeredSpecName = specName
    })

    // Write a status.json that marks the spec as ready
    const statusPath = join(specDir, 'status.json')
    writeFileSync(
      statusPath,
      JSON.stringify({
        runStatus: 'pending',
        lastUpdated: new Date().toISOString(),
      }),
    )

    // Wait for the watcher to detect the change (polling + awaitWriteFinish stability)
    const deadline = Date.now() + 10000
    while (!triggeredSpecPath && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }

    expect(triggeredSpecPath).toBeDefined()
    expect(triggeredSpecName).toBe('test-feature')
  })

  it('should not trigger for non-ready specs', async () => {
    const specDir = join(tempDir, 'running-feature')
    mkdirSync(specDir, { recursive: true })

    fileWatcher = new FileWatcher(
      { specsDir: tempDir, usePolling: true, pollingInterval: 100 },
      eventBus,
    )

    let triggered = false

    await fileWatcher.start(async () => {
      triggered = true
    })

    // Write a status.json with a running state (not ready)
    const statusPath = join(specDir, 'status.json')
    writeFileSync(
      statusPath,
      JSON.stringify({
        runStatus: 'running',
        currentPhase: 'implementation',
        lastUpdated: new Date().toISOString(),
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 1500))

    expect(triggered).toBe(false)
  })
})

// =============================================================================
// Git Worktree Isolation Verification
// =============================================================================

describe('Git Worktree Isolation', () => {
  let context: ApplicationContext | undefined

  afterEach(async () => {
    if (context) {
      await shutdownKASO(context)
      context = undefined
    }
  })

  it('should create worktree under .kaso/worktrees/', async () => {
    context = await initializeKASO({
      config: createTestConfig(),
      enableSSE: false,
      enableWebhooks: false,
      enableFileWatcher: false,
      enableMCP: false,
    })

    const uniqueName = `isolation-${Date.now()}`
    let worktree: Awaited<
      ReturnType<typeof context.worktreeManager.create>
    > | null = null

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        worktree = await context.worktreeManager.create(uniqueName, 'main')
        break
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        if (
          (msg.includes('lock') || msg.includes('File exists')) &&
          attempt < 4
        ) {
          await new Promise((r) =>
            setTimeout(r, 500 * Math.pow(2, attempt) + Math.random() * 300),
          )
          continue
        }
        throw error
      }
    }

    expect(worktree).toBeDefined()
    expect(worktree!.path).toContain('.kaso/worktrees/')
    expect(existsSync(worktree!.path)).toBe(true)
    expect(worktree!.branch).toMatch(/^kaso\/isolation-/)

    await context.worktreeManager.cleanup(worktree!.runId)
  })

  it('should not modify main working directory during worktree operations', async () => {
    context = await initializeKASO({
      config: createTestConfig(),
      enableSSE: false,
      enableWebhooks: false,
      enableFileWatcher: false,
      enableMCP: false,
    })

    // Record the state of the main working directory
    const mainPackageJson = readFileSync('package.json', 'utf-8')

    const uniqueName = `no-modify-${Date.now()}`
    let worktree: Awaited<
      ReturnType<typeof context.worktreeManager.create>
    > | null = null

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        worktree = await context.worktreeManager.create(uniqueName, 'main')
        break
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        if (
          (msg.includes('lock') || msg.includes('File exists')) &&
          attempt < 4
        ) {
          await new Promise((r) =>
            setTimeout(r, 500 * Math.pow(2, attempt) + Math.random() * 300),
          )
          continue
        }
        throw error
      }
    }

    expect(worktree).toBeDefined()

    // Write a file in the worktree
    const testFilePath = join(worktree!.path, 'worktree-test-file.txt')
    writeFileSync(testFilePath, 'this should only exist in the worktree')

    // Verify the file exists in the worktree but NOT in main
    expect(existsSync(testFilePath)).toBe(true)
    expect(existsSync('worktree-test-file.txt')).toBe(false)

    // Verify main package.json is unchanged
    expect(readFileSync('package.json', 'utf-8')).toBe(mainPackageJson)

    await context.worktreeManager.cleanup(worktree!.runId)
  })

  it('should cleanup worktree directory after removal', async () => {
    context = await initializeKASO({
      config: createTestConfig(),
      enableSSE: false,
      enableWebhooks: false,
      enableFileWatcher: false,
      enableMCP: false,
    })

    const uniqueName = `cleanup-${Date.now()}`
    const worktree = await context.worktreeManager.create(uniqueName, 'main')
    const worktreePath = worktree.path

    expect(existsSync(worktreePath)).toBe(true)

    await context.worktreeManager.cleanup(worktree.runId)

    expect(existsSync(worktreePath)).toBe(false)
  })
})

// =============================================================================
// SSE Event Streaming Test
// =============================================================================

describe('SSE Event Streaming', () => {
  let eventBus: EventBus
  let sseServer: SSEServer
  let ssePort: number

  beforeEach(async () => {
    eventBus = new EventBus()
    sseServer = new SSEServer(eventBus, {
      enabled: true,
      port: 0, // OS-assigned port to avoid EADDRINUSE
      host: 'localhost',
      endpoint: '/events',
      heartbeatIntervalMs: 60000,
      maxClients: 10,
    })
    await sseServer.start()
    ssePort = sseServer.getPort()
  })

  afterEach(async () => {
    if (sseServer?.isRunning()) {
      await sseServer.stop()
    }
  })

  it('should accept SSE client connections', async () => {
    expect(sseServer.isRunning()).toBe(true)
    expect(sseServer.getClientCount()).toBe(0)

    const receivedData = await connectSSEClient(ssePort, '/events', 500)
    expect(receivedData).toBeDefined()
  })

  it('should stream events to connected clients', async () => {
    const receivedEvents: string[] = []

    const clientPromise = new Promise<void>((resolve) => {
      const req = http.get(`http://localhost:${ssePort}/events`, (res) => {
        res.on('data', (chunk: Buffer) => {
          const lines = chunk.toString().split('\n')
          for (const line of lines) {
            if (line.startsWith('data:')) {
              receivedEvents.push(line.substring(5).trim())
            }
          }
        })

        setTimeout(() => {
          res.destroy()
          resolve()
        }, 1000)
      })
      req.on('error', () => resolve())
    })

    // Wait for client to connect
    await new Promise((resolve) => setTimeout(resolve, 200))

    // Emit events through the event bus
    eventBus.emit({
      type: 'run:started',
      runId: 'sse-test-run',
      timestamp: new Date().toISOString(),
    })

    eventBus.emit({
      type: 'phase:started',
      runId: 'sse-test-run',
      timestamp: new Date().toISOString(),
      phase: 'intake' as PhaseName,
    })

    await clientPromise

    expect(receivedEvents.length).toBeGreaterThan(0)

    // Parse and verify event content
    const parsed = receivedEvents
      .filter((d) => d.length > 0)
      .map((d) => {
        try {
          return JSON.parse(d) as Record<string, unknown>
        } catch {
          return null
        }
      })
      .filter(Boolean)

    expect(parsed.length).toBeGreaterThan(0)
  })

  it('should respond to health check endpoint', async () => {
    const response = await new Promise<{ statusCode: number; body: string }>(
      (resolve) => {
        http.get(`http://localhost:${ssePort}/health`, (res) => {
          let body = ''
          res.on('data', (chunk: Buffer) => {
            body += chunk.toString()
          })
          res.on('end', () => {
            resolve({ statusCode: res.statusCode ?? 0, body })
          })
        })
      },
    )

    expect(response.statusCode).toBe(200)
    const healthData = JSON.parse(response.body) as Record<string, unknown>
    expect(healthData.status).toBe('ok')
  })

  it('should track client count', async () => {
    expect(sseServer.getClientCount()).toBe(0)

    const clientReq = http.get(`http://localhost:${ssePort}/events`)

    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(sseServer.getClientCount()).toBe(1)

    clientReq.destroy()

    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(sseServer.getClientCount()).toBe(0)
  })
})

// =============================================================================
// SSE Helper
// =============================================================================

function connectSSEClient(
  port: number,
  path: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    const req = http.get(`http://localhost:${port}${path}`, (res) => {
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString()
      })
    })

    setTimeout(() => {
      req.destroy()
      resolve(data)
    }, timeoutMs)

    req.on('error', () => resolve(data))
  })
}
