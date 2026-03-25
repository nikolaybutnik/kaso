/**
 * Property tests for SpecReaderAgent
 */

import { test, fc } from '@fast-check/vitest'
import { expect, vi } from 'vitest'
import { SpecReaderAgent } from '@/agents/spec-reader'
import type { AgentContext, AssembledContext } from '@/core/types'
import { getDefaultConfig } from '@/config/schema'
import { promises as fs } from 'fs'

// Mock fs
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    readdir: vi.fn(),
  },
}))

/** Helper: create ENOENT error for missing files */
function enoent(): Error {
  return Object.assign(new Error('File not found'), { code: 'ENOENT' })
}

/**
 * Arbitrary for generating valid markdown content
 */
const markdownArbitrary = fc
  .array(
    fc
      .record({
        type: fc.constantFrom('heading', 'paragraph', 'code'),
        content: fc.string({ minLength: 1, maxLength: 100 }),
      })
      .map((block) => {
        switch (block.type) {
          case 'heading':
            return `# ${block.content}\n\n`
          case 'paragraph':
            return `${block.content}\n\n`
          case 'code':
            return '```typescript\n' + block.content + '\n```\n\n'
          default:
            return ''
        }
      }),
    { minLength: 1, maxLength: 5 },
  )
  .map((blocks) => blocks.join(''))

/**
 * Arbitrary for task items
 */
const taskItemArbitrary = fc
  .array(
    fc
      .record({
        status: fc.boolean(),
        title: fc.string({ minLength: 1, maxLength: 50 }),
        indent: fc.integer({ min: 0, max: 4 }),
      })
      .map((task) => {
        const status = task.status ? 'x' : ' '
        const indent = '  '.repeat(task.indent)
        return `${indent}- [${status}] ${task.title}`
      }),
    { minLength: 0, maxLength: 10 },
  )
  .map((tasks) => tasks.join('\n'))

/**
 * Property 1: Spec parsing produces structured context
 * The output of spec parsing should always be a valid AssembledContext structure
 */
test.prop([
  fc
    .string({ minLength: 1, maxLength: 50 })
    .filter(
      (s) => !s.includes('/') && !s.includes('\0') && s !== '.' && s !== '..',
    ),
  markdownArbitrary,
  markdownArbitrary,
  taskItemArbitrary,
])(
  'Property 1: Spec parsing produces structured context',
  async (featureName, requirementsContent, designContent, taskContent) => {
    const specPath = `/test/specs/${featureName}`
    const agent = new SpecReaderAgent(specPath)

    vi.mocked(fs.readFile).mockImplementation(async (path: unknown) => {
      const pathStr = String(path)
      if (pathStr.endsWith('requirements.md')) return requirementsContent
      if (pathStr.endsWith('design.md')) return designContent
      if (pathStr.endsWith('tasks.md')) return taskContent
      if (pathStr.endsWith('package.json')) return '{}'
      throw enoent()
    })
    vi.mocked(fs.readdir).mockResolvedValue([])

    const context: AgentContext = {
      runId: 'test-run',
      spec: {
        featureName,
        specPath,
        missingFiles: [],
      },
      steering: { hooks: {} },
      phaseOutputs: {},
      config: {
        ...getDefaultConfig(),
        contextCapping: {
          enabled: false,
          charsPerToken: 4,
          relevanceRanking: [],
        },
      },
      backends: {
        'kimi-code': {
          name: 'kimi-code',
          command: 'kimi',
          args: [],
          protocol: 'cli-json',
          maxContextWindow: 128000,
          costPer1000Tokens: 0.01,
          enabled: true,
        },
      },
    }

    const result = await agent.execute(context)

    expect(result.success).toBe(true)
    expect(result.output).toBeDefined()

    const output = result.output as AssembledContext
    expect(output.featureName).toBe(featureName)
    expect(output.designDoc).toBeDefined()
    expect(output.techSpec).toBeDefined()
    expect(output.taskList).toBeDefined()
    expect(output.architectureDocs).toBeDefined()
    expect(output.dependencies).toBeDefined()
  },
)

/**
 * Property 2: Missing spec files are identified by name
 * When spec files are missing, the error should clearly identify which files
 */
test.prop([
  fc.array(fc.constantFrom('requirements.md', 'design.md', 'tasks.md'), {
    minLength: 1,
    maxLength: 3,
  }),
])(
  'Property 2: Missing spec files are identified by name',
  async (missingFiles) => {
    const specPath = '/test/specs/test-feature'
    const agent = new SpecReaderAgent(specPath)

    // Map primary filenames to their fallback candidates so blocking
    // a primary also blocks its fallbacks (otherwise the fallback succeeds)
    const fallbackMap: Record<string, string[]> = {
      'requirements.md': ['design.md'],
      'design.md': ['tech-spec.md'],
      'tasks.md': ['task.md'],
    }
    const allBlocked = new Set<string>()
    for (const f of missingFiles) {
      allBlocked.add(f)
      for (const fb of fallbackMap[f] ?? []) {
        allBlocked.add(fb)
      }
    }

    vi.mocked(fs.readFile).mockImplementation(async (path: unknown) => {
      const pathStr = String(path)
      if ([...allBlocked].some((f) => pathStr.endsWith(f))) {
        throw enoent()
      }
      if (pathStr.endsWith('requirements.md')) return '# Requirements'
      if (pathStr.endsWith('design.md')) return '# Design'
      if (pathStr.endsWith('tasks.md')) return '- [ ] Task'
      if (pathStr.endsWith('package.json')) return '{}'
      throw enoent()
    })
    vi.mocked(fs.readdir).mockResolvedValue([])

    const context: AgentContext = {
      runId: 'test-run',
      spec: {
        featureName: 'test-feature',
        specPath,
        missingFiles: [],
      },
      steering: { hooks: {} },
      phaseOutputs: {},
      config: {
        ...getDefaultConfig(),
        contextCapping: {
          enabled: false,
          charsPerToken: 4,
          relevanceRanking: [],
        },
      },
      backends: {},
    }

    const result = await agent.execute(context)

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()

    // Verify each missing file is mentioned in error
    for (const missingFile of missingFiles) {
      expect(result.error?.message).toContain(missingFile)
    }
  },
)

/**
 * Property 3: Task checkbox parsing preserves status
 * Parsed task items should accurately reflect their completion status from checkboxes
 */
test.prop([
  fc.array(
    fc.record({
      completed: fc.boolean(),
      title: fc
        .string({ minLength: 1, maxLength: 30 })
        .filter((s) => !s.startsWith(' ') && s.length > 0),
    }),
    { minLength: 1, maxLength: 20 },
  ),
])('Property 3: Task checkbox parsing preserves status', async (tasks) => {
  const taskContent = tasks
    .map((task) => `- [${task.completed ? 'x' : ' '}] ${task.title}`)
    .join('\n')

  const specPath = '/test/specs/test-feature'
  const agent = new SpecReaderAgent(specPath)

  vi.mocked(fs.readFile).mockImplementation(async (path: unknown) => {
    const pathStr = String(path)
    if (pathStr.endsWith('requirements.md')) return '# Requirements'
    if (pathStr.endsWith('design.md')) return '# Design'
    if (pathStr.endsWith('tasks.md')) return taskContent
    if (pathStr.endsWith('package.json')) return '{}'
    throw enoent()
  })
  vi.mocked(fs.readdir).mockResolvedValue([])

  const context: AgentContext = {
    runId: 'test-run',
    spec: {
      featureName: 'test-feature',
      specPath,
      missingFiles: [],
    },
    steering: { hooks: {} },
    phaseOutputs: {},
    config: {
      ...getDefaultConfig(),
      contextCapping: {
        enabled: false,
        charsPerToken: 4,
        relevanceRanking: [],
      },
    },
    backends: {},
  }

  const result = await agent.execute(context)

  expect(result.success).toBe(true)
  expect(result.output).toBeDefined()

  const output = result.output as AssembledContext
  expect(output.taskList).toHaveLength(tasks.length)

  const taskList = output.taskList ?? []
  for (let i = 0; i < tasks.length; i++) {
    const task = taskList[i]
    const expected = tasks[i]
    expect(task?.status).toBe(expected?.completed ? 'complete' : 'incomplete')
    expect(task?.title).toBe(expected?.title)
  }
})

/**
 * Property 15: Assembled context respects max context window
 * When context capping is enabled, the final context must not exceed maxContextWindow
 */
test.prop([fc.integer({ min: 5000, max: 50000 })])(
  'Property 15: Assembled context respects max context window',
  async (maxWindow) => {
    const thirtyPercent = Math.floor(maxWindow * 4 * 0.3)
    const filler = 'x'.repeat(thirtyPercent)
    const requirementsContent = `# Requirements\n\n${filler}`
    const designContent = `# Design\n\n${filler}`
    const taskContent = '- [ ] Task'

    const specPath = '/test/specs/test-feature'
    const agent = new SpecReaderAgent(specPath)

    vi.mocked(fs.readFile).mockImplementation(async (path: unknown) => {
      const pathStr = String(path)
      if (pathStr.endsWith('requirements.md')) return requirementsContent
      if (pathStr.endsWith('design.md')) return designContent
      if (pathStr.endsWith('tasks.md')) return taskContent
      if (pathStr.endsWith('package.json')) return '{}'
      if (pathStr.endsWith('ARCHITECTURE.md')) return filler
      throw enoent()
    })
    vi.mocked(fs.readdir).mockResolvedValue([])

    const context: AgentContext = {
      runId: 'test-run',
      spec: {
        featureName: 'test-feature',
        specPath,
        missingFiles: [],
      },
      steering: { hooks: {} },
      phaseOutputs: {},
      config: {
        ...getDefaultConfig(),
        contextCapping: {
          enabled: true,
          charsPerToken: 4,
          relevanceRanking: ['design.md', 'requirements.md', 'ARCHITECTURE.md'],
        },
      },
      backends: {
        'kimi-code': {
          name: 'kimi-code',
          command: 'kimi',
          args: [],
          protocol: 'cli-json',
          maxContextWindow: maxWindow,
          costPer1000Tokens: 0.01,
          enabled: true,
        },
      },
    }

    const result = await agent.execute(context)

    expect(result.success).toBe(true)
    expect(result.output).toBeDefined()

    const output = result.output as AssembledContext
    expect(output.removedFiles).toBeDefined()
    expect(output.removedFiles.length).toBeGreaterThan(0)
  },
)

/**
 * Property 16: Dependency info included in context
 * The assembled context should include package.json dependencies when available
 */
test.prop([
  fc.dictionary(
    fc
      .string({ minLength: 1, maxLength: 20 })
      .filter((s) => s !== '__proto__' && s !== 'constructor'),
    fc.string({ minLength: 1, maxLength: 20 }),
    { minKeys: 0, maxKeys: 10 },
  ),
])('Property 16: Dependency info included in context', async (dependencies) => {
  const requirementsContent = '# Requirements\n\nContent'
  const designContent = '# Design\n\nContent'
  const taskContent = '- [ ] Task'

  const specPath = '/test/specs/test-feature'
  const agent = new SpecReaderAgent(specPath)

  vi.mocked(fs.readFile).mockImplementation(async (path: unknown) => {
    const pathStr = String(path)
    if (pathStr.endsWith('requirements.md')) return requirementsContent
    if (pathStr.endsWith('design.md')) return designContent
    if (pathStr.endsWith('tasks.md')) return taskContent
    if (pathStr.endsWith('package.json')) {
      return JSON.stringify({ dependencies })
    }
    throw enoent()
  })
  vi.mocked(fs.readdir).mockResolvedValue([])

  const context: AgentContext = {
    runId: 'test-run',
    spec: {
      featureName: 'test-feature',
      specPath,
      missingFiles: [],
    },
    steering: { hooks: {} },
    phaseOutputs: {},
    config: getDefaultConfig(),
    backends: {},
  }

  const result = await agent.execute(context)

  expect(result.success).toBe(true)
  expect(result.output).toBeDefined()

  const output = result.output as AssembledContext
  expect(output.dependencies).toEqual(dependencies)
})

/**
 * Property 61: Context capping throws on irreducible overflow
 * When essential files (spec + arch docs) exceed max window, should throw error
 */
test.prop([fc.integer({ min: 100, max: 5000 })])(
  'Property 61: Context capping throws on irreducible overflow',
  async (smallWindow) => {
    const hugeContent = 'x'.repeat(smallWindow * 10)
    const requirementsContent = `# Requirements\n\nSmall content`
    const designContent = `# Design\n\n${hugeContent}`
    const taskContent = '- [ ] Task'

    const specPath = '/test/specs/test-feature'
    const agent = new SpecReaderAgent(specPath)

    vi.mocked(fs.readFile).mockImplementation(async (path: unknown) => {
      const pathStr = String(path)
      if (pathStr.endsWith('requirements.md')) return requirementsContent
      if (pathStr.endsWith('design.md')) return designContent
      if (pathStr.endsWith('tasks.md')) return taskContent
      if (pathStr.endsWith('package.json')) return '{}'
      throw enoent()
    })
    vi.mocked(fs.readdir).mockRejectedValue(new Error('Directory not found'))

    const context: AgentContext = {
      runId: 'test-run',
      spec: {
        featureName: 'test-feature',
        specPath,
        missingFiles: [],
      },
      steering: { hooks: {} },
      phaseOutputs: {},
      config: {
        ...getDefaultConfig(),
        contextCapping: {
          enabled: true,
          charsPerToken: 4,
          relevanceRanking: ['design.md', 'requirements.md'],
        },
      },
      backends: {
        'kimi-code': {
          name: 'kimi-code',
          command: 'kimi',
          args: [],
          protocol: 'cli-json',
          maxContextWindow: smallWindow,
          costPer1000Tokens: 0.01,
          enabled: true,
        },
      },
    }

    const result = await agent.execute(context)

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.error?.message).toContain('Cannot cap context')
    expect(result.error?.message).toContain('Irreducible')
  },
)
