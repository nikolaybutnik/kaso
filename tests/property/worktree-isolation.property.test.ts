import { describe, expect, vi, afterEach } from 'vitest'
import { test, fc } from '@fast-check/vitest'
import { join } from 'path'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { WorktreeManager } from '../../src/infrastructure/worktree-manager'
import { simpleGit } from 'simple-git'
import type { SimpleGit } from 'simple-git'

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

describe('Worktree Isolation Properties', () => {
  const testBaseDir = join(process.cwd(), '.kaso-test-property-worktrees')

  afterEach(() => {
    if (existsSync(testBaseDir)) {
      rmSync(testBaseDir, { recursive: true })
    }
  })

  /**
   * Property 42: Worktree branch name derived from spec feature name
   * The created git worktree's branch name SHALL follow the format
   * kaso/[feature-name]-[YYYYMMDDTHHmmss]
   */
  test.prop({
    specName: fc.string({
      unit: fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'.split(
          '',
        ),
      ),
      minLength: 1,
      maxLength: 50,
    }),
    baseBranch: fc.constantFrom('main', 'develop', 'master', 'feature/test'),
  })(
    'Property 42: Worktree branch name derived from spec feature name',
    async ({ specName, baseBranch }) => {
      const testDir = join(testBaseDir, `prop42-${Date.now()}`)
      mkdirSync(join(testDir, '.kaso', 'worktrees'), { recursive: true })

      const mockGit: MockGit = {
        raw: vi.fn().mockImplementation((args: string[]) => {
          if (
            Array.isArray(args) &&
            args[0] === 'worktree' &&
            args[1] === 'remove'
          ) {
            const removePath = args[2]
            if (existsSync(removePath)) {
              rmSync(removePath, { recursive: true })
            }
          }
          return Promise.resolve('')
        }),
        branch: vi.fn(),
        checkIsRepo: vi.fn(),
        status: vi.fn(),
        push: vi.fn(),
      }
      vi.mocked(simpleGit).mockReturnValue(asMockGit(mockGit))

      const manager = new WorktreeManager(testDir)

      const worktree = await manager.create(specName, baseBranch)

      expect(worktree.branch).toMatch(
        new RegExp(`^kaso/${specName}-\\d{8}T\\d{6}$`),
      )
      expect(worktree.runId).toMatch(new RegExp(`^${specName}-\\d{8}T\\d{6}$`))

      if (existsSync(worktree.path)) {
        rmSync(worktree.path, { recursive: true })
      }
    },
  )

  /**
   * Property 35: Worktree preserved on halt or cancel
   */
  test.prop({
    specName: fc.string({
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz-'.split('')),
      minLength: 1,
      maxLength: 30,
    }),
    retainDecision: fc.boolean(),
  })(
    'Property 35: Worktree preserved when marked for retention',
    async ({ specName, retainDecision }) => {
      const testDir = join(testBaseDir, `prop35-${Date.now()}`)
      mkdirSync(join(testDir, '.kaso', 'worktrees'), { recursive: true })

      const mockGit: MockGit = {
        raw: vi.fn().mockResolvedValue(''),
        branch: vi.fn().mockResolvedValue({ current: `kaso/${specName}` }),
        checkIsRepo: vi.fn().mockResolvedValue(true),
        status: vi.fn().mockResolvedValue({ isClean: () => true }),
        push: vi.fn(),
      }
      vi.mocked(simpleGit).mockReturnValue(asMockGit(mockGit))

      const manager = new WorktreeManager(testDir)
      const worktree = await manager.create(specName, 'main')

      mkdirSync(worktree.path, { recursive: true })

      if (retainDecision) {
        manager.retain(worktree.runId)
      }

      await manager.cleanup(worktree.runId)

      if (retainDecision) {
        expect(manager.getWorktreeInfo(worktree.runId)).toBeDefined()
      } else {
        expect(manager.getWorktreeInfo(worktree.runId)).toBeUndefined()
      }
    },
  )

  /**
   * Property 21: All file modifications confined to worktree
   */
  test.prop({
    runId: fc.string({
      unit: fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyz-0123456789'.split(''),
      ),
      minLength: 10,
      maxLength: 50,
    }),
  })(
    'Property 21: All file operations confined to worktree',
    async ({ runId }) => {
      const testDir = join(testBaseDir, `prop21-${Date.now()}`)
      const worktreesDir = join(testDir, '.kaso', 'worktrees')
      mkdirSync(worktreesDir, { recursive: true })

      const mockGit: MockGit = {
        raw: vi.fn().mockImplementation((args: string[]) => {
          if (
            Array.isArray(args) &&
            args[0] === 'worktree' &&
            args[1] === 'remove'
          ) {
            const removePath = args[2]
            if (existsSync(removePath)) {
              rmSync(removePath, { recursive: true })
            }
          }
          return Promise.resolve('')
        }),
        branch: vi.fn(),
        checkIsRepo: vi.fn().mockResolvedValue(true),
        status: vi.fn().mockResolvedValue({ isClean: () => true }),
        push: vi.fn(),
      }
      vi.mocked(simpleGit).mockReturnValue(asMockGit(mockGit))

      const manager = new WorktreeManager(testDir)

      const worktreePath = join(worktreesDir, runId)
      mkdirSync(worktreePath, { recursive: true })

      const mockWorktreeGit: MockGit = {
        raw: vi.fn().mockResolvedValue(''),
        branch: vi.fn().mockResolvedValue({ current: `kaso/${runId}` }),
        checkIsRepo: vi.fn().mockResolvedValue(true),
        status: vi.fn().mockResolvedValue({ isClean: () => true }),
        push: vi.fn().mockResolvedValue(undefined),
      }
      vi.mocked(simpleGit).mockReturnValue(asMockGit(mockWorktreeGit))

      const worktreeInfo = await manager.getWorktreeInfoFromDisk(runId)

      if (worktreeInfo) {
        expect(worktreeInfo.path.startsWith(worktreesDir)).toBe(true)

        const path = manager.getPath(runId)
        expect(path.startsWith(worktreesDir)).toBe(true)
        expect(
          path.startsWith(testDir) && !path.startsWith(join(testDir, 'src')),
        ).toBe(true)
      }

      if (existsSync(worktreePath)) {
        rmSync(worktreePath, { recursive: true })
      }
    },
  )

  /**
   * Additional property: Worktree uniqueness
   */
  test.prop({
    specName1: fc.string({
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
      minLength: 1,
      maxLength: 20,
    }),
    specName2: fc.string({
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
      minLength: 1,
      maxLength: 20,
    }),
  })(
    'Generated worktree paths are unique per run',
    async ({ specName1, specName2 }) => {
      fc.pre(specName1 !== specName2)

      const testDir = join(testBaseDir, `unique-${Date.now()}`)
      mkdirSync(join(testDir, '.kaso', 'worktrees'), { recursive: true })

      const mockGit: MockGit = {
        raw: vi.fn().mockImplementation((args: string[]) => {
          if (
            Array.isArray(args) &&
            args[0] === 'worktree' &&
            args[1] === 'remove'
          ) {
            const removePath = args[2]
            if (existsSync(removePath)) {
              rmSync(removePath, { recursive: true })
            }
          }
          return Promise.resolve('')
        }),
        branch: vi.fn(),
        checkIsRepo: vi.fn(),
        status: vi.fn(),
        push: vi.fn(),
      }
      vi.mocked(simpleGit).mockReturnValue(asMockGit(mockGit))

      const manager = new WorktreeManager(testDir)

      const worktree1 = await manager.create(specName1, 'main')
      const worktree2 = await manager.create(specName2, 'main')

      expect(worktree1.path).not.toBe(worktree2.path)
      expect(worktree1.branch).not.toBe(worktree2.branch)
      expect(worktree1.runId).not.toBe(worktree2.runId)

      if (existsSync(worktree1.path)) {
        rmSync(worktree1.path, { recursive: true })
      }
      if (existsSync(worktree2.path)) {
        rmSync(worktree2.path, { recursive: true })
      }
    },
  )

  /**
   * Additional property: Cleanup removes worktree directory
   */
  test.prop({
    specName: fc.string({
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
      minLength: 1,
      maxLength: 30,
    }),
  })('Cleanup removes worktree from disk', async ({ specName }) => {
    const testDir = join(testBaseDir, `cleanup-${Date.now()}`)
    mkdirSync(join(testDir, '.kaso', 'worktrees'), { recursive: true })

    const mockGit: MockGit = {
      raw: vi.fn().mockImplementation((args: string[]) => {
        if (
          Array.isArray(args) &&
          args[0] === 'worktree' &&
          args[1] === 'remove'
        ) {
          const removePath = args[2]
          if (existsSync(removePath)) {
            rmSync(removePath, { recursive: true })
          }
        }
        return Promise.resolve('')
      }),
      branch: vi.fn(),
      checkIsRepo: vi.fn(),
      status: vi.fn(),
      push: vi.fn(),
    }
    vi.mocked(simpleGit).mockReturnValue(asMockGit(mockGit))

    const manager = new WorktreeManager(testDir)
    const worktree = await manager.create(specName, 'main')

    mkdirSync(worktree.path, { recursive: true })

    expect(existsSync(worktree.path)).toBe(true)

    await manager.cleanup(worktree.runId)

    expect(manager.getWorktreeInfo(worktree.runId)).toBeUndefined()
  })
})
