/**
 * Unit tests for SpecWriter
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { SpecWriter } from '@/infrastructure/spec-writer'
import type { PhaseName } from '@/core/types'

describe('SpecWriter', () => {
  let specWriter: SpecWriter
  let testSpecPath: string

  beforeEach(() => {
    specWriter = new SpecWriter()
    testSpecPath = './test-specs/test-feature'
  })

  afterEach(async () => {
    // Clean up test directories
    try {
      await fs.rm('./test-specs', { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('appendExecutionLog', () => {
    it('should write log entry to execution-log.md', async () => {
      const entry = {
        timestamp: '2024-01-15T10:30:00.000Z',
        level: 'info' as const,
        source: 'orchestrator',
        message: 'Test log entry',
        phase: 'intake' as PhaseName,
        runId: 'test-run-123',
      }

      await specWriter.appendExecutionLog(testSpecPath, entry)

      const logContent = await fs.readFile(
        join(testSpecPath, 'execution-log.md'),
        'utf-8',
      )
      expect(logContent).toContain(
        '[2024-01-15T10:30:00.000Z] [info] [orchestrator] [intake] (run: test-run-123) Test log entry',
      )
    })

    it('should handle missing directories by creating them', async () => {
      const entry = {
        timestamp: '2024-01-15T10:30:00.000Z',
        level: 'info' as const,
        source: 'orchestrator',
        message: 'Test with missing directory',
      }

      // Path that doesn't exist yet
      const nonExistentPath = './test-specs/non-existent-feature'
      await expect(fs.access(nonExistentPath)).rejects.toThrow()

      // Should create directory and write log
      await specWriter.appendExecutionLog(nonExistentPath, entry)

      const logExists = await fs.access(
        join(nonExistentPath, 'execution-log.md'),
      )
      expect(logExists).toBeUndefined() // access resolves if file exists
    })

    it('should include data object in log entry', async () => {
      const entry = {
        timestamp: '2024-01-15T10:30:00.000Z',
        level: 'info' as const,
        source: 'orchestrator',
        message: 'Test with data',
        data: { durationMs: 1234, tokens: 567 },
      }

      await specWriter.appendExecutionLog(testSpecPath, entry)

      const logContent = await fs.readFile(
        join(testSpecPath, 'execution-log.md'),
        'utf-8',
      )
      expect(logContent).toContain('Test with data')
      expect(logContent).toContain('"durationMs": 1234')
      expect(logContent).toContain('"tokens": 567')
    })

    it('should append multiple log entries', async () => {
      const entry1 = {
        timestamp: '2024-01-15T10:30:00.000Z',
        level: 'info' as const,
        source: 'orchestrator',
        message: 'First entry',
      }
      const entry2 = {
        timestamp: '2024-01-15T10:31:00.000Z',
        level: 'info' as const,
        source: 'orchestrator',
        message: 'Second entry',
      }

      await specWriter.appendExecutionLog(testSpecPath, entry1)
      await specWriter.appendExecutionLog(testSpecPath, entry2)

      const logContent = await fs.readFile(
        join(testSpecPath, 'execution-log.md'),
        'utf-8',
      )
      expect(logContent).toContain('First entry')
      expect(logContent).toContain('Second entry')
    })
  })

  describe('updateSpecStatus', () => {
    it('should write status.json with current phase', async () => {
      const status = {
        currentPhase: 'implementation' as PhaseName,
        runStatus: 'running' as const,
        lastUpdated: '2024-01-15T10:30:00.000Z',
        runId: 'test-run-123',
      }

      await specWriter.updateSpecStatus(testSpecPath, status)

      const statusContent = await fs.readFile(
        join(testSpecPath, 'status.json'),
        'utf-8',
      )
      const parsed = JSON.parse(statusContent)
      expect(parsed).toEqual({
        currentPhase: 'implementation',
        runStatus: 'running',
        lastUpdated: '2024-01-15T10:30:00.000Z',
        runId: 'test-run-123',
      })
    })

    it('should create directories if they do not exist', async () => {
      const status = {
        runStatus: 'running' as const,
        lastUpdated: '2024-01-15T10:30:00.000Z',
      }

      const nonExistentPath = './test-specs/another-feature'
      await specWriter.updateSpecStatus(nonExistentPath, status)

      const statusExists = await fs.access(join(nonExistentPath, 'status.json'))
      expect(statusExists).toBeUndefined()
    })

    it('should format JSON with 2-space indentation', async () => {
      const status = {
        runStatus: 'completed' as const,
        lastUpdated: '2024-01-15T10:30:00.000Z',
      }

      await specWriter.updateSpecStatus(testSpecPath, status)

      const statusContent = await fs.readFile(
        join(testSpecPath, 'status.json'),
        'utf-8',
      )
      // Should contain newlines and 2-space indentation
      expect(statusContent).toContain('\n')
      expect(statusContent).toContain('  "runStatus"')
      expect(statusContent).toContain('  "lastUpdated"')
    })
  })

  describe('writeRunStarted', () => {
    it('should write run started log and status', async () => {
      const runId = 'test-run-456'
      const worktreePath = './worktrees/test-feature-abc123'

      await specWriter.writeRunStarted(testSpecPath, runId, worktreePath)

      // Check log entry
      const logContent = await fs.readFile(
        join(testSpecPath, 'execution-log.md'),
        'utf-8',
      )
      expect(logContent).toContain(runId)
      expect(logContent).toContain('started')
      expect(logContent).toContain(worktreePath)

      // Check status
      const statusContent = await fs.readFile(
        join(testSpecPath, 'status.json'),
        'utf-8',
      )
      const parsed = JSON.parse(statusContent)
      expect(parsed.runStatus).toBe('running')
      expect(parsed.runId).toBe(runId)
    })
  })

  describe('writePhaseTransition', () => {
    it('should write phase completion log and update status', async () => {
      const runId = 'test-run-789'
      const phase = 'validation' as PhaseName
      const durationMs = 2500

      await specWriter.writePhaseTransition(
        testSpecPath,
        runId,
        phase,
        'completed',
        durationMs,
      )

      // Check log entry
      const logContent = await fs.readFile(
        join(testSpecPath, 'execution-log.md'),
        'utf-8',
      )
      expect(logContent).toContain('validation')
      expect(logContent).toContain('completed')
      expect(logContent).toContain('durationMs": 2500')

      // Check status
      const statusContent = await fs.readFile(
        join(testSpecPath, 'status.json'),
        'utf-8',
      )
      const parsed = JSON.parse(statusContent)
      expect(parsed.currentPhase).toBe('validation')
    })

    it('should write error message on phase failure', async () => {
      const runId = 'test-run-999'
      const phase = 'implementation' as PhaseName

      await specWriter.writePhaseTransition(
        testSpecPath,
        runId,
        phase,
        'failed',
        undefined,
        'Compilation error',
      )

      const logContent = await fs.readFile(
        join(testSpecPath, 'execution-log.md'),
        'utf-8',
      )
      expect(logContent).toContain('failed')
      expect(logContent).toContain('Compilation error')
    })
  })

  describe('writeRunCompleted', () => {
    it('should write completion log and final status', async () => {
      const runId = 'test-run-111'
      const totalCost = 0.025

      await specWriter.writeRunCompleted(
        testSpecPath,
        runId,
        'completed',
        totalCost,
      )

      // Check log entry
      const logContent = await fs.readFile(
        join(testSpecPath, 'execution-log.md'),
        'utf-8',
      )
      expect(logContent).toContain(runId)
      expect(logContent).toContain('completed')
      expect(logContent).toContain('totalCost')

      // Check status
      const statusContent = await fs.readFile(
        join(testSpecPath, 'status.json'),
        'utf-8',
      )
      const parsed = JSON.parse(statusContent)
      expect(parsed.runStatus).toBe('completed')
      expect(parsed.currentPhase).toBeUndefined()
    })

    it('should include error message on failure', async () => {
      const runId = 'test-run-222'
      const error = 'Build failed with exit code 1'

      await specWriter.writeRunCompleted(
        testSpecPath,
        runId,
        'failed',
        undefined,
        error,
      )

      const logContent = await fs.readFile(
        join(testSpecPath, 'execution-log.md'),
        'utf-8',
      )
      expect(logContent).toContain('failed')
      expect(logContent).toContain(error)
    })

    it('should handle cancelled status', async () => {
      const runId = 'test-run-333'

      await specWriter.writeRunCompleted(testSpecPath, runId, 'cancelled')

      const statusContent = await fs.readFile(
        join(testSpecPath, 'status.json'),
        'utf-8',
      )
      const parsed = JSON.parse(statusContent)
      expect(parsed.runStatus).toBe('cancelled')
    })
  })

  describe('error handling', () => {
    it('should not throw when spec directory is read-only', async () => {
      // This test verifies graceful degradation
      // In a real scenario we'd mock fs operations, but here we test the try-catch

      const entry = {
        timestamp: '2024-01-15T10:30:00.000Z',
        level: 'info' as const,
        source: 'orchestrator',
        message: 'Test',
      }

      // Should not throw even if directory doesn't exist
      await expect(
        specWriter.appendExecutionLog(
          '/invalid/path/that/cannot/be/created',
          entry,
        ),
      ).resolves.toBeUndefined()
    })
  })
})
