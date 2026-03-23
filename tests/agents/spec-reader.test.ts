/**
 * Unit tests for SpecReaderAgent
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import { SpecReaderAgent } from '../../src/agents/spec-reader'
import type { AgentContext, AssembledContext } from '../../src/core/types'
import { getDefaultConfig } from '../../src/config/schema'

// Mock fs
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    readdir: vi.fn(),
  },
}))

describe('SpecReaderAgent', () => {
  let agent: SpecReaderAgent
  let mockContext: AgentContext
  const specPath = '/test/specs/feature-1'

  beforeEach(() => {
    agent = new SpecReaderAgent(specPath)
    mockContext = {
      runId: 'test-run',
      spec: {
        featureName: 'feature-1',
        specPath,
        missingFiles: [],
      },
      steering: { hooks: {} },
      phaseOutputs: {},
      config: getDefaultConfig(),
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
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('execute', () => {
    it('should parse spec files successfully', async () => {
      const designContent = `# Design\n\nThis is the design.`
      const techSpecContent = `# Tech Spec\n\nTechnical details here.`
      const taskContent = `- [x] Task 1\n- [ ] Task 2`

      vi.mocked(fs.readFile).mockImplementation(async (path: unknown) => {
        const pathStr = String(path)
        if (pathStr.endsWith('design.md')) return designContent
        if (pathStr.endsWith('tech-spec.md')) return techSpecContent
        if (pathStr.endsWith('task.md')) return taskContent
        if (pathStr.endsWith('package.json'))
          return '{"dependencies": {"react": "^18.0.0"}}'
        throw new Error('File not found')
      })
      vi.mocked(fs.readdir).mockResolvedValue([])

      const result = await agent.execute(mockContext)

      expect(result.success).toBe(true)
      expect(result.output).toBeDefined()

      const output = result.output as AssembledContext
      expect(output.featureName).toBe('feature-1')
      expect(output.designDoc).toBeDefined()
      expect(output.techSpec).toBeDefined()
      expect(output.taskList).toHaveLength(2)
      expect(output.dependencies.react).toBe('^18.0.0')
    })

    it('should identify missing files', async () => {
      vi.mocked(fs.readFile).mockImplementation(async (path: unknown) => {
        const pathStr = String(path)
        if (pathStr.endsWith('design.md')) return '# Design'
        // Throw ENOENT error for missing files
        throw Object.assign(new Error('File not found'), { code: 'ENOENT' })
      })
      vi.mocked(fs.readdir).mockResolvedValue([])

      const result = await agent.execute(mockContext)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('Missing required spec files')
    })

    it('should continue without steering files', async () => {
      const designContent = '# Design\n\nContent'
      const techSpecContent = '# Tech Spec\n\nContent'
      const taskContent = '- [ ] Task 1'

      vi.mocked(fs.readFile).mockImplementation(async (path: unknown) => {
        const pathStr = String(path)
        if (pathStr.endsWith('design.md')) return designContent
        if (pathStr.endsWith('tech-spec.md')) return techSpecContent
        if (pathStr.endsWith('task.md')) return taskContent
        if (pathStr.endsWith('package.json')) return '{}'
        throw new Error('File not found')
      })
      vi.mocked(fs.readdir).mockRejectedValue(new Error('Directory not found'))

      const result = await agent.execute(mockContext)

      expect(result.success).toBe(true)
      expect(result.output).toBeDefined()
    })
  })

  describe('markdown parsing', () => {
    it('should parse markdown with headings', async () => {
      const content = `# Main Title\n\n## Section 1\n\nContent 1\n\n### Subsection\n\nContent 2`

      vi.mocked(fs.readFile).mockImplementation(async (path: unknown) => {
        const pathStr = String(path)
        if (pathStr.endsWith('design.md')) return content
        if (pathStr.endsWith('tech-spec.md')) return '# Tech Spec'
        if (pathStr.endsWith('task.md')) return '- [ ] Task'
        if (pathStr.endsWith('package.json')) return '{}'
        throw new Error('File not found')
      })
      vi.mocked(fs.readdir).mockResolvedValue([])

      const result = await agent.execute(mockContext)

      expect(result.success).toBe(true)
      const output = result.output as AssembledContext
      expect(output.designDoc?.sections).toHaveLength(1)
      expect(output.designDoc?.sections[0]?.level).toBe(1)
      expect(output.designDoc?.sections[0]?.children).toHaveLength(1)
    })

    it('should parse code blocks', async () => {
      const content = `# Code Example\n\n\`\`\`typescript\nconst x = 1;\n\`\`\`\n\n\`\`\`javascript\nconst y = 2;\n\`\`\``

      vi.mocked(fs.readFile).mockImplementation(async (path: unknown) => {
        const pathStr = String(path)
        if (pathStr.endsWith('design.md')) return content
        if (pathStr.endsWith('tech-spec.md')) return '# Tech Spec'
        if (pathStr.endsWith('task.md')) return '- [ ] Task'
        if (pathStr.endsWith('package.json')) return '{}'
        throw new Error('File not found')
      })
      vi.mocked(fs.readdir).mockResolvedValue([])

      const result = await agent.execute(mockContext)

      expect(result.success).toBe(true)
      const output = result.output as AssembledContext
      expect(output.designDoc?.codeBlocks).toHaveLength(2)
      expect(output.designDoc?.codeBlocks[0]?.language).toBe('typescript')
      expect(output.designDoc?.codeBlocks[0]?.content).toBe('const x = 1;')
    })

    it('should parse YAML frontmatter', async () => {
      const content = `---\ntitle: Design Doc\nversion: 1.0\n---\n\n# Content`

      vi.mocked(fs.readFile).mockImplementation(async (path: unknown) => {
        const pathStr = String(path)
        if (pathStr.endsWith('design.md')) return content
        if (pathStr.endsWith('tech-spec.md')) return '# Tech Spec'
        if (pathStr.endsWith('task.md')) return '- [ ] Task'
        if (pathStr.endsWith('package.json')) return '{}'
        throw new Error('File not found')
      })
      vi.mocked(fs.readdir).mockResolvedValue([])

      const result = await agent.execute(mockContext)

      expect(result.success).toBe(true)
      const output = result.output as AssembledContext
      expect(output.designDoc?.metadata.title).toBe('Design Doc')
      expect(output.designDoc?.metadata.version).toBe('1.0')
    })
  })

  describe('task list parsing', () => {
    it('should parse task items with status', async () => {
      const designContent = '# Design'
      const techSpecContent = '# Tech Spec'
      const taskContent = `- [x] Completed task\n- [ ] Incomplete task\n- [X] Another completed`

      vi.mocked(fs.readFile).mockImplementation(async (path: unknown) => {
        const pathStr = String(path)
        if (pathStr.endsWith('design.md')) return designContent
        if (pathStr.endsWith('tech-spec.md')) return techSpecContent
        if (pathStr.endsWith('task.md')) return taskContent
        if (pathStr.endsWith('package.json')) return '{}'
        throw new Error('File not found')
      })
      vi.mocked(fs.readdir).mockResolvedValue([])

      const result = await agent.execute(mockContext)

      expect(result.success).toBe(true)
      const output = result.output as AssembledContext
      expect(output.taskList).toHaveLength(3)
      expect(output.taskList?.[0]?.status).toBe('complete')
      expect(output.taskList?.[1]?.status).toBe('incomplete')
      expect(output.taskList?.[2]?.status).toBe('complete')
    })
  })

  describe('context capping', () => {
    it('should apply context capping when enabled', async () => {
      // Create large content that exceeds typical context window
      const largeContent = 'x'.repeat(200000) // ~50000 tokens
      const designContent = `# Design\n\n${largeContent}`
      const techSpecContent = `# Tech Spec\n\n${largeContent}`
      const taskContent = '- [ ] Task'

      vi.mocked(fs.readFile).mockImplementation(async (path: unknown) => {
        const pathStr = String(path)
        if (pathStr.endsWith('design.md')) return designContent
        if (pathStr.endsWith('tech-spec.md')) return techSpecContent
        if (pathStr.endsWith('task.md')) return taskContent
        if (pathStr.endsWith('package.json')) return '{}'
        if (pathStr.endsWith('ARCHITECTURE.md')) return largeContent
        throw new Error('File not found')
      })
      vi.mocked(fs.readdir).mockResolvedValue([])

      const config = {
        ...getDefaultConfig(),
        contextCapping: {
          enabled: true,
          charsPerToken: 4,
          relevanceRanking: ['tech-spec.md', 'design.md', 'ARCHITECTURE.md'],
        },
      }

      const result = await agent.execute({ ...mockContext, config })

      expect(result.success).toBe(true)
      const output = result.output as AssembledContext
      expect(output.removedFiles).toBeDefined()
      // Should have removed some files to fit within window
      expect(output.removedFiles.length).toBeGreaterThan(0)
    })

    it('should throw error when irreducible overflow occurs', async () => {
      // Create content that exceeds window even for essential files
      const hugeContent = 'x'.repeat(600000) // ~150000 tokens
      const designContent = `# Design\n\nText` // Small design
      const techSpecContent = `# Tech Spec\n\n${hugeContent}` // Make tech-spec huge (most essential)
      const taskContent = '- [ ] Task'

      vi.mocked(fs.readFile).mockImplementation(async (path: unknown) => {
        const pathStr = String(path)
        if (pathStr.endsWith('design.md')) return designContent
        if (pathStr.endsWith('tech-spec.md')) return techSpecContent
        if (pathStr.endsWith('task.md')) return taskContent
        if (pathStr.endsWith('package.json')) return '{}'
        throw new Error('File not found')
      })
      vi.mocked(fs.readdir).mockRejectedValue(new Error('Directory not found'))

      const config = {
        ...getDefaultConfig(),
        contextCapping: {
          enabled: true,
          charsPerToken: 4,
          relevanceRanking: ['tech-spec.md', 'design.md'],
        },
      }

      const result = await agent.execute({ ...mockContext, config })

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('Cannot cap context')
    })
  })

  describe('agent interface', () => {
    it('should implement required interface methods', () => {
      expect(agent.supportsRollback()).toBe(false)
      expect(agent.estimatedDuration()).toBeGreaterThan(0)
      expect(agent.requiredContext()).toContain('specPath')
    })
  })
})
