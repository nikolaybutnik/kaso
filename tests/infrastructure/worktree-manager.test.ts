import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'path'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { simpleGit } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { WorktreeManager } from '../../src/infrastructure/worktree-manager'

/** Partial mock of SimpleGit — only the methods WorktreeManager actually uses */
interface MockGit {
  raw: ReturnType<typeof vi.fn>
  branch: ReturnType<typeof vi.fn>
  checkIsRepo: ReturnType<typeof vi.fn>
  status: ReturnType<typeof vi.fn>
  push: ReturnType<typeof vi.fn>
}

/** Cast a partial mock to SimpleGit for vi.mocked().mockReturnValue() */
function asMockGit(mock: MockGit): SimpleGit {
  return mock as unknown as SimpleGit
}

// Mock simple-git
vi.mock('simple-git', () => {
  const mockGit: MockGit = {
    raw: vi.fn(),
    branch: vi.fn(),
    checkIsRepo: vi.fn(),
    status: vi.fn(),
    push: vi.fn(),
  }

  return {
    simpleGit: vi.fn(() => mockGit),
  }
})

describe('WorktreeManager', () => {
  const testDir = join(process.cwd(), '.kaso-test-worktrees')
  let manager: WorktreeManager
  let mockGit: MockGit

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
    mkdirSync(join(testDir, '.kaso', 'worktrees'), { recursive: true })

    manager = new WorktreeManager(testDir)
    mockGit = simpleGit() as unknown as MockGit

    vi.clearAllMocks()
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  describe('create', () => {
    it('should create a worktree with correct branch naming', async () => {
      const specName = 'test-feature'
      const baseBranch = 'main'

      mockGit.raw.mockResolvedValue('')

      const result = await manager.create(specName, baseBranch)

      mkdirSync(result.path, { recursive: true })

      expect(result).toBeDefined()
      expect(result.path).toContain(specName)
      expect(result.branch).toMatch(/^kaso\/test-feature-\d{8}T\d{6}$/)
      expect(result.runId).toMatch(/^test-feature-\d{8}T\d{6}$/)

      expect(mockGit.raw).toHaveBeenCalledWith([
        'worktree',
        'add',
        '-b',
        result.branch,
        result.path,
        baseBranch,
      ])
    })

    it('should throw error if worktree already exists', async () => {
      const specName = 'test-feature'
      const baseBranch = 'main'

      mockGit.raw.mockResolvedValue('')
      const worktree = await manager.create(specName, baseBranch)
      mkdirSync(worktree.path, { recursive: true })

      mockGit.raw.mockClear()

      await expect(manager.create(specName, baseBranch)).rejects.toThrow(
        'Worktree already exists',
      )
    })

    it('should cleanup worktree on creation failure', async () => {
      const specName = 'test-feature'
      const baseBranch = 'main'

      mockGit.raw.mockRejectedValue(new Error('Git command failed'))

      await expect(manager.create(specName, baseBranch)).rejects.toThrow(
        'Failed to create worktree',
      )

      const worktrees = manager.listWorktrees()
      expect(worktrees).toHaveLength(0)
    })
  })

  describe('getPath', () => {
    beforeEach(async () => {
      vi.clearAllMocks()
      mockGit.raw.mockResolvedValue('')
      const worktree = await manager.create('test-feature', 'main')
      mkdirSync(worktree.path, { recursive: true })
    })

    it('should return path for existing worktree', () => {
      const worktrees = manager.listWorktrees()
      const worktree = worktrees[0]

      const path = manager.getPath(worktree.runId)

      expect(path).toBe(worktree.path)
    })

    it('should throw error for non-existent worktree', () => {
      expect(() => manager.getPath('non-existent')).toThrow(
        'Worktree not found',
      )
    })

    it('should find worktree on disk even if not in memory', () => {
      const runId = 'manual-feature-20231225T120000'
      const worktreePath = join(testDir, '.kaso', 'worktrees', runId)
      mkdirSync(worktreePath, { recursive: true })

      const mockWorktreeGit: MockGit = {
        raw: vi.fn(),
        branch: vi.fn().mockResolvedValue({
          current: 'kaso/manual-feature-20231225T120000',
        }),
        checkIsRepo: vi.fn(),
        status: vi.fn(),
        push: vi.fn(),
      }
      vi.mocked(simpleGit).mockReturnValue(asMockGit(mockWorktreeGit))

      const path = manager.getPath(runId)
      expect(path).toBe(worktreePath)
    })
  })

  describe('getWorktreeInfo', () => {
    it('should return worktree info for existing worktree', async () => {
      mockGit.raw.mockResolvedValue('')
      await manager.create('test-feature', 'main')

      const worktrees = manager.listWorktrees()
      const worktree = worktrees[0]

      const info = manager.getWorktreeInfo(worktree.runId)

      expect(info).toBeDefined()
      expect(info?.path).toBe(worktree.path)
      expect(info?.branch).toBe(worktree.branch)
      expect(info?.runId).toBe(worktree.runId)
    })

    it('should return undefined for non-existent worktree', () => {
      const info = manager.getWorktreeInfo('non-existent')
      expect(info).toBeUndefined()
    })
  })

  describe('getWorktreeInfoFromDisk', () => {
    it('should find worktree info from disk', async () => {
      const runId = 'manual-feature-20231225T120000'
      const worktreePath = join(testDir, '.kaso', 'worktrees', runId)
      mkdirSync(worktreePath, { recursive: true })

      const mockWorktreeGit: MockGit = {
        raw: vi.fn(),
        branch: vi.fn().mockResolvedValue({
          current: 'kaso/manual-feature-20231225T120000',
        }),
        checkIsRepo: vi.fn(),
        status: vi.fn(),
        push: vi.fn(),
      }
      vi.mocked(simpleGit).mockReturnValue(asMockGit(mockWorktreeGit))

      const info = await manager.getWorktreeInfoFromDisk(runId)

      expect(info).toBeDefined()
      expect(info?.path).toBe(worktreePath)
      expect(info?.branch).toBe('kaso/manual-feature-20231225T120000')
      expect(info?.runId).toBe(runId)
    })

    it('should return undefined for non-existent worktree on disk', async () => {
      const info = await manager.getWorktreeInfoFromDisk('non-existent')
      expect(info).toBeUndefined()
    })

    it('should return worktree info from memory if available', async () => {
      mockGit.raw.mockResolvedValue('')
      await manager.create('test-feature', 'main')

      const worktrees = manager.listWorktrees()
      const worktree = worktrees[0]

      const info = await manager.getWorktreeInfoFromDisk(worktree.runId)

      expect(info).toBeDefined()
      expect(info?.runId).toBe(worktree.runId)
    })
  })

  describe('push', () => {
    it('should push worktree branch to remote', async () => {
      mockGit.raw.mockResolvedValue('')
      const worktree = await manager.create('test-feature', 'main')
      mkdirSync(worktree.path, { recursive: true })

      const mockWorktreeGit: MockGit = {
        raw: vi.fn(),
        branch: vi.fn(),
        checkIsRepo: vi.fn(),
        status: vi.fn(),
        push: vi.fn().mockResolvedValue(undefined),
      }
      vi.mocked(simpleGit).mockReturnValue(asMockGit(mockWorktreeGit))

      await manager.push(worktree.runId, 'origin')

      expect(mockWorktreeGit.push).toHaveBeenCalledWith(
        'origin',
        worktree.branch,
      )
    })

    it('should throw error if worktree does not exist', async () => {
      await expect(manager.push('non-existent', 'origin')).rejects.toThrow(
        'Worktree not found',
      )
    })

    it('should throw error if worktree path does not exist', async () => {
      mockGit.raw.mockResolvedValue('')
      await manager.create('test-feature', 'main')

      const worktrees = manager.listWorktrees()
      const worktree = worktrees[0]

      await expect(manager.push(worktree.runId, 'origin')).rejects.toThrow(
        'Worktree path does not exist',
      )
    })
  })

  describe('cleanup', () => {
    it('should remove worktree', async () => {
      mockGit.raw.mockResolvedValue('')
      const worktree = await manager.create('test-feature', 'main')
      mkdirSync(worktree.path, { recursive: true })

      await manager.cleanup(worktree.runId)

      expect(mockGit.raw).toHaveBeenCalledWith([
        'worktree',
        'remove',
        worktree.path,
      ])
      expect(manager.listWorktrees()).toHaveLength(0)
    })

    it('should not remove retained worktree', async () => {
      mockGit.raw.mockResolvedValue('')
      const worktree = await manager.create('test-feature', 'main')
      mkdirSync(worktree.path, { recursive: true })

      mockGit.raw.mockClear()

      manager.retain(worktree.runId)

      await manager.cleanup(worktree.runId)

      expect(mockGit.raw).not.toHaveBeenCalled()
      expect(manager.listWorktrees()).toHaveLength(1)
    })

    it('should handle non-existent worktree path gracefully', async () => {
      mockGit.raw.mockResolvedValue('')
      await manager.create('test-feature', 'main')

      const worktrees = manager.listWorktrees()
      const worktree = worktrees[0]

      await manager.cleanup(worktree.runId)

      expect(manager.listWorktrees()).toHaveLength(0)
    })
  })

  describe('retain', () => {
    it('should mark worktree as retained', async () => {
      mockGit.raw.mockResolvedValue('')
      const worktree = await manager.create('test-feature', 'main')
      mkdirSync(worktree.path, { recursive: true })

      manager.retain(worktree.runId)

      await manager.cleanup(worktree.runId)

      expect(manager.listWorktrees()).toHaveLength(1)
    })

    it('should create metadata entry for manual worktree', () => {
      const runId = 'manual-worktree'
      const worktreePath = join(testDir, '.kaso', 'worktrees', runId)

      mkdirSync(worktreePath, { recursive: true })

      const mockWorktreeGit: MockGit = {
        raw: vi.fn(),
        branch: vi.fn().mockResolvedValue({ current: `kaso/${runId}` }),
        checkIsRepo: vi.fn().mockResolvedValue(true),
        status: vi.fn().mockResolvedValue({ isClean: () => true }),
        push: vi.fn(),
      }
      vi.mocked(simpleGit).mockReturnValue(asMockGit(mockWorktreeGit))

      manager.retain(runId)

      expect(manager.exists(runId)).toBe(true)
    })
  })

  describe('exists', () => {
    it('should return true for existing worktree', async () => {
      mockGit.raw.mockResolvedValue('')
      const worktree = await manager.create('test-feature', 'main')
      mkdirSync(worktree.path, { recursive: true })

      expect(manager.exists(worktree.runId)).toBe(true)
    })

    it('should return false for non-existent worktree', () => {
      expect(manager.exists('non-existent')).toBe(false)
    })

    it('should check disk even if not in memory', async () => {
      const runId = 'manual-feature-20231225T120000'
      const worktreePath = join(testDir, '.kaso', 'worktrees', runId)
      mkdirSync(worktreePath, { recursive: true })

      expect(manager.exists(runId)).toBe(true)
    })
  })

  describe('isConsistent', () => {
    it('should return true for consistent worktree', async () => {
      mockGit.raw.mockResolvedValue('')
      const worktree = await manager.create('test-feature', 'main')
      mkdirSync(worktree.path, { recursive: true })

      const mockWorktreeGit: MockGit = {
        raw: vi.fn(),
        branch: vi.fn().mockResolvedValue({ current: worktree.branch }),
        checkIsRepo: vi.fn().mockResolvedValue(true),
        status: vi.fn().mockResolvedValue({ isClean: () => true }),
        push: vi.fn(),
      }
      vi.mocked(simpleGit).mockReturnValue(asMockGit(mockWorktreeGit))

      const isConsistent = await manager.isConsistent(worktree.runId)

      expect(isConsistent).toBe(true)
    })

    it('should return false for non-existent worktree', async () => {
      const isConsistent = await manager.isConsistent('non-existent')
      expect(isConsistent).toBe(false)
    })

    it('should return false if not a git repository', async () => {
      mockGit.raw.mockResolvedValue('')
      await manager.create('test-feature', 'main')

      const worktrees = manager.listWorktrees()
      const worktree = worktrees[0]

      const mockWorktreeGit: MockGit = {
        raw: vi.fn(),
        branch: vi.fn(),
        checkIsRepo: vi.fn().mockResolvedValue(false),
        status: vi.fn(),
        push: vi.fn(),
      }
      vi.mocked(simpleGit).mockReturnValue(asMockGit(mockWorktreeGit))

      const isConsistent = await manager.isConsistent(worktree.runId)

      expect(isConsistent).toBe(false)
    })

    it('should return false if branch does not match', async () => {
      mockGit.raw.mockResolvedValue('')
      const worktree = await manager.create('test-feature', 'main')
      mkdirSync(worktree.path, { recursive: true })

      const mockWorktreeGit: MockGit = {
        raw: vi.fn(),
        branch: vi.fn().mockResolvedValue({ current: 'different-branch' }),
        checkIsRepo: vi.fn().mockResolvedValue(true),
        status: vi.fn(),
        push: vi.fn(),
      }
      vi.mocked(simpleGit).mockReturnValue(asMockGit(mockWorktreeGit))

      const isConsistent = await manager.isConsistent(worktree.runId)

      expect(isConsistent).toBe(false)
    })

    it('should return false if there are uncommitted changes', async () => {
      mockGit.raw.mockResolvedValue('')
      const worktree = await manager.create('test-feature', 'main')
      mkdirSync(worktree.path, { recursive: true })

      const mockWorktreeGit: MockGit = {
        raw: vi.fn(),
        branch: vi.fn().mockResolvedValue({ current: worktree.branch }),
        checkIsRepo: vi.fn().mockResolvedValue(true),
        status: vi.fn().mockResolvedValue({ isClean: () => false }),
        push: vi.fn(),
      }
      vi.mocked(simpleGit).mockReturnValue(asMockGit(mockWorktreeGit))

      const isConsistent = await manager.isConsistent(worktree.runId)

      expect(isConsistent).toBe(false)
    })
  })

  describe('listWorktrees', () => {
    it('should return empty array when no worktrees exist', () => {
      const worktrees = manager.listWorktrees()
      expect(worktrees).toEqual([])
    })

    it('should return all worktrees', async () => {
      mockGit.raw.mockResolvedValue('')

      await manager.create('feature-1', 'main')
      await manager.create('feature-2', 'develop')

      const worktrees = manager.listWorktrees()
      expect(worktrees).toHaveLength(2)
    })
  })

  describe('loadExistingWorktrees', () => {
    it('should load existing worktrees from disk', async () => {
      const worktreePath1 = join(
        testDir,
        '.kaso',
        'worktrees',
        'feature-1-20231225T120000',
      )
      const worktreePath2 = join(
        testDir,
        '.kaso',
        'worktrees',
        'feature-2-20231225T130000',
      )

      mkdirSync(worktreePath1, { recursive: true })
      mkdirSync(worktreePath2, { recursive: true })

      const mockWorktreeGit: MockGit = {
        raw: vi.fn(),
        branch: vi
          .fn()
          .mockResolvedValueOnce({ current: 'kaso/feature-1-20231225T120000' })
          .mockResolvedValueOnce({ current: 'kaso/feature-2-20231225T130000' }),
        checkIsRepo: vi
          .fn()
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(true),
        status: vi.fn(),
        push: vi.fn(),
      }
      vi.mocked(simpleGit).mockReturnValue(asMockGit(mockWorktreeGit))

      const loaded = await manager.loadExistingWorktrees()

      expect(loaded).toBe(2)

      const worktrees = manager.listWorktrees()
      expect(worktrees).toHaveLength(2)
    })

    it('should skip non-git directories', async () => {
      const nonGitPath = join(testDir, '.kaso', 'worktrees', 'not-git')
      mkdirSync(nonGitPath, { recursive: true })

      const mockWorktreeGit: MockGit = {
        raw: vi.fn(),
        branch: vi.fn(),
        checkIsRepo: vi.fn().mockResolvedValue(false),
        status: vi.fn(),
        push: vi.fn(),
      }
      vi.mocked(simpleGit).mockReturnValue(asMockGit(mockWorktreeGit))

      const loaded = await manager.loadExistingWorktrees()

      expect(loaded).toBe(0)
      expect(manager.listWorktrees()).toHaveLength(0)
    })

    it('should skip worktrees without kaso branches', async () => {
      const worktreePath = join(testDir, '.kaso', 'worktrees', 'non-kaso')
      mkdirSync(worktreePath, { recursive: true })

      const mockWorktreeGit: MockGit = {
        raw: vi.fn(),
        branch: vi.fn().mockResolvedValue({ current: 'main' }),
        checkIsRepo: vi.fn().mockResolvedValue(true),
        status: vi.fn(),
        push: vi.fn(),
      }
      vi.mocked(simpleGit).mockReturnValue(asMockGit(mockWorktreeGit))

      const loaded = await manager.loadExistingWorktrees()

      expect(loaded).toBe(0)
      expect(manager.listWorktrees()).toHaveLength(0)
    })

    it('should return 0 if worktrees directory does not exist', async () => {
      rmSync(join(testDir, '.kaso', 'worktrees'), { recursive: true })

      const loaded = await manager.loadExistingWorktrees()

      expect(loaded).toBe(0)
    })
  })
})
