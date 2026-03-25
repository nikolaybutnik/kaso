/**
 * Spec Reader Agent (Phase 1 - Intake)
 * Parses Kiro spec files and assembles execution context
 */

import { promises as fs } from 'fs'
import { join, resolve } from 'path'
import type {
  AgentContext,
  AgentResult,
  ParsedSpec,
  ParsedMarkdown,
  TaskItem,
  AssembledContext,
  SteeringFiles,
} from '@/core/types'
import type { Agent } from './agent-interface'
import { parseMarkdown } from '@/core/markdown-parser'

const DEFAULT_CHARS_PER_TOKEN = 4
const DEFAULT_MAX_CONTEXT_WINDOW = 128000
const TRUNCATED_MARKER = '[Content truncated to fit context window]'
const TASK_SIZE_OVERHEAD = 10

/**
 * SpecReaderAgent implementation
 * Parses requirements.md, design.md, tasks.md and assembles context
 */
export class SpecReaderAgent implements Agent {
  private specPath: string

  constructor(specPath: string) {
    this.specPath = resolve(specPath)
  }

  /**
   * Execute the spec reader agent
   */
  async execute(context: AgentContext): Promise<AgentResult> {
    const startTime = Date.now()
    try {
      // Parse spec files
      const parsedSpec = await this.parseSpecFiles()

      // Load architecture documentation
      const architectureDocs = await this.loadArchitectureDocs()

      // Load steering files (used by orchestrator to populate AgentContext.steering)
      await this.loadSteeringFiles()

      // Extract dependencies
      const dependencies = await this.extractDependencies()

      // Assemble context
      let assembledContext: AssembledContext = {
        featureName: parsedSpec.featureName,
        designDoc: parsedSpec.design,
        techSpec: parsedSpec.techSpec,
        taskList: parsedSpec.taskList,
        architectureDocs,
        dependencies,
        removedFiles: [],
      }

      // Apply context capping if enabled
      if (context.config.contextCapping?.enabled) {
        assembledContext = this.applyContextCapping(assembledContext, context)
      }

      const duration = Date.now() - startTime

      return {
        success: true,
        output: assembledContext,
        duration,
      }
    } catch (error) {
      return {
        success: false,
        error: this.formatError(error),
        duration: Date.now() - startTime,
      }
    }
  }

  /**
   * Parse requirements.md, design.md, tasks.md files (with legacy fallbacks)
   */
  private async parseSpecFiles(): Promise<ParsedSpec> {
    const missingFiles: string[] = []

    let design: ParsedMarkdown | undefined
    let techSpec: ParsedMarkdown | undefined
    let taskList: TaskItem[] | undefined

    // Kiro standard files: requirements.md, design.md, tasks.md
    // Legacy fallbacks: design.md→requirements, tech-spec.md→design, task.md→tasks
    const specFiles: Array<{
      candidates: string[]
      type: 'design' | 'techSpec' | 'taskList'
    }> = [
      { candidates: ['requirements.md', 'design.md'], type: 'design' },
      { candidates: ['design.md', 'tech-spec.md'], type: 'techSpec' },
      { candidates: ['tasks.md', 'task.md'], type: 'taskList' },
    ]

    // Track which files have been claimed so a file isn't used for two slots
    const claimedFiles = new Set<string>()

    for (const { candidates, type } of specFiles) {
      let loaded = false
      for (const file of candidates) {
        if (claimedFiles.has(file)) continue
        const filePath = join(this.specPath, file)
        try {
          const content = await fs.readFile(filePath, 'utf-8')

          if (type === 'design') {
            design = parseMarkdown(content)
          } else if (type === 'techSpec') {
            techSpec = parseMarkdown(content)
          } else if (type === 'taskList') {
            taskList = this.parseTaskList(content, filePath)
          }
          claimedFiles.add(file)
          loaded = true
          break
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw new Error(
              `Failed to read ${file}: ${(error as Error).message}`,
            )
          }
        }
      }
      if (!loaded) {
        missingFiles.push(candidates[0]!)
      }
    }

    if (missingFiles.length > 0) {
      throw new Error(`Missing required spec files: ${missingFiles.join(', ')}`)
    }

    return {
      featureName: this.extractFeatureName(),
      specPath: this.specPath,
      missingFiles: [],
      design,
      techSpec,
      taskList,
    }
  }

  /**
   * Parse task list from markdown checkbox format
   */
  private parseTaskList(content: string, _filePath: string): TaskItem[] {
    const lines = content.split('\n')
    const taskStack: TaskItem[] = []
    const rootTasks: TaskItem[] = []
    let taskIdCounter = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ''
      const match = line.match(/^\s*-\s*\[(.)\]\s+(.+)$/)

      if (match) {
        const statusChar = match[1] ?? ' '
        const title = match[2] ?? ''
        const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0

        const taskId = `task-${taskIdCounter++}`
        const task: TaskItem = {
          id: taskId,
          title,
          status:
            statusChar === 'x' || statusChar === 'X'
              ? 'complete'
              : 'incomplete',
          children: [],
          line: i + 1,
        }

        // Track indent for nesting logic
        this.taskIndentMap.set(taskId, indent)

        // Determine parent based on indentation
        while (
          taskStack.length > 0 &&
          this.getIndentLevel(taskStack[taskStack.length - 1]!) >= indent
        ) {
          taskStack.pop()
        }

        const parentTask = taskStack[taskStack.length - 1]
        if (parentTask) {
          parentTask.children.push(task)
        } else {
          rootTasks.push(task)
        }

        taskStack.push(task)
      }
    }

    return rootTasks
  }

  /**
   * Get the indent level of a task item
   * Stored as a private map during parsing
   */
  private taskIndentMap = new Map<string, number>()

  private getIndentLevel(task: TaskItem): number {
    return this.taskIndentMap.get(task.id) ?? 0
  }

  /**
   * Extract feature name from spec path
   */
  private extractFeatureName(): string {
    const parts = this.specPath.split('/')
    return parts[parts.length - 1] || 'unknown-feature'
  }

  /**
   * Load architecture documentation files
   */
  private async loadArchitectureDocs(): Promise<
    Record<string, ParsedMarkdown>
  > {
    const docs: Record<string, ParsedMarkdown> = {}
    const archFiles = [
      'ARCHITECTURE.md',
      'docs/ARCHITECTURE.md',
      'architecture/README.md',
    ]

    for (const file of archFiles) {
      try {
        const fullPath = resolve(this.specPath, '..', file)
        const content = await fs.readFile(fullPath, 'utf-8')
        docs[file] = parseMarkdown(content)
      } catch (error) {
        // File doesn't exist, skip it
        continue
      }
    }

    return docs
  }

  /**
   * Load steering files from .kiro/rules/ and .kiro/hooks/
   */
  private async loadSteeringFiles(): Promise<SteeringFiles> {
    const rulesDir = join(this.specPath, 'rules')
    const hooksDir = join(this.specPath, 'hooks')
    const steering: SteeringFiles = {
      hooks: {},
    }

    try {
      const codingPracticesPath = join(rulesDir, 'coding-practices.md')
      steering.codingPractices = await fs.readFile(codingPracticesPath, 'utf-8')
    } catch (error) {
      console.warn(
        `Warning: No coding practices file found at ${rulesDir}/coding-practices.md`,
      )
    }

    try {
      const personalityPath = join(rulesDir, 'personality.md')
      steering.personality = await fs.readFile(personalityPath, 'utf-8')
    } catch (error) {
      console.warn(
        `Warning: No personality file found at ${rulesDir}/personality.md`,
      )
    }

    try {
      const commitConventionsPath = join(rulesDir, 'commit-conventions.md')
      steering.commitConventions = await fs.readFile(
        commitConventionsPath,
        'utf-8',
      )
    } catch (error) {
      console.warn(
        `Warning: No commit conventions file found at ${rulesDir}/commit-conventions.md`,
      )
    }

    // Load hooks
    try {
      const hookFiles = await fs.readdir(hooksDir)
      for (const file of hookFiles) {
        if (file.endsWith('.js') || file.endsWith('.ts')) {
          const hookName = file.replace(/\.(js|ts)$/, '')
          steering.hooks[hookName] = join(hooksDir, file)
        }
      }
    } catch (error) {
      console.warn(`Warning: Could not load hooks from ${hooksDir}`)
    }

    return steering
  }

  /**
   * Extract dependencies from package.json
   */
  private async extractDependencies(): Promise<Record<string, string>> {
    const dependencies: Record<string, string> = {}

    try {
      const packageJsonPath = resolve(this.specPath, '..', 'package.json')
      const content = await fs.readFile(packageJsonPath, 'utf-8')
      const packageJson: Record<string, Record<string, string> | undefined> =
        JSON.parse(content) as Record<
          string,
          Record<string, string> | undefined
        >

      // Include all dependency types
      Object.assign(dependencies, packageJson.dependencies ?? {})
      Object.assign(dependencies, packageJson.devDependencies ?? {})
      Object.assign(dependencies, packageJson.peerDependencies ?? {})
      Object.assign(dependencies, packageJson.optionalDependencies ?? {})
    } catch (error) {
      // Not a Node.js project or no package.json, continue without dependencies
      console.warn(
        'Warning: Could not read package.json for dependency extraction',
      )
    }

    return dependencies
  }

  /**
   * Apply context capping to fit within max context window
   */
  private applyContextCapping(
    assembled: AssembledContext,
    context: AgentContext,
  ): AssembledContext {
    const cappingConfig = context.config.contextCapping

    if (!cappingConfig?.enabled) {
      return assembled
    }

    const charsPerToken = cappingConfig.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN
    const maxTokens =
      context.backends[context.config.defaultBackend]?.maxContextWindow ??
      DEFAULT_MAX_CONTEXT_WINDOW
    const relevanceRanking = cappingConfig.relevanceRanking ?? []

    let currentTokens = this.estimateContextSize(assembled, charsPerToken)

    if (currentTokens <= maxTokens) {
      return assembled
    }

    const capped: AssembledContext = {
      ...assembled,
      architectureDocs: { ...assembled.architectureDocs },
    }
    const removedFiles: string[] = []

    // Build removable list: architecture docs first (least essential), then design doc
    const removable = this.buildRemovableList(
      capped,
      relevanceRanking,
      charsPerToken,
    )

    for (const entry of removable) {
      if (currentTokens <= maxTokens) break

      this.removeFromContext(capped, entry.file, entry.category)
      removedFiles.push(entry.file)
      currentTokens -= entry.tokenSize
    }

    // After removing everything removable, check if we fit
    if (currentTokens > maxTokens) {
      throw new Error(
        `Cannot cap context to fit within max window. Current size: ${currentTokens}, Max: ${maxTokens}. ` +
          `Irreducible context (spec + arch docs) exceeds window. Consider increasing maxContextWindow.`,
      )
    }

    capped.removedFiles = removedFiles
    return capped
  }

  /**
   * Build ordered list of removable content (least relevant first)
   * Architecture docs are removed before spec files.
   * Within each category, files not in the relevance ranking are removed first,
   * then files ranked lower (higher index = lower relevance).
   * Ties broken by size descending (remove largest first).
   */
  private buildRemovableList(
    assembled: AssembledContext,
    relevanceRanking: string[],
    charsPerToken: number,
  ): Array<{
    file: string
    category: string
    tokenSize: number
    relevanceScore: number
  }> {
    const removable: Array<{
      file: string
      category: string
      tokenSize: number
      relevanceScore: number
    }> = []

    const UNRANKED_SCORE = Number.MAX_SAFE_INTEGER

    // Architecture docs — least essential category
    for (const [file, doc] of Object.entries(assembled.architectureDocs)) {
      const tokenSize = Math.ceil(doc.rawContent.length / charsPerToken)
      const rankIndex = relevanceRanking.indexOf(file)
      const relevanceScore = rankIndex === -1 ? UNRANKED_SCORE : rankIndex
      removable.push({
        file,
        category: 'architecture',
        tokenSize,
        relevanceScore,
      })
    }

    // Design doc (requirements.md or legacy design.md) — can be truncated as last resort
    if (assembled.designDoc) {
      const tokenSize = Math.ceil(
        assembled.designDoc.rawContent.length / charsPerToken,
      )
      // Check both names in relevance ranking for backwards compat
      let rankIndex = relevanceRanking.indexOf('requirements.md')
      if (rankIndex === -1) rankIndex = relevanceRanking.indexOf('design.md')
      const relevanceScore = rankIndex === -1 ? UNRANKED_SCORE : rankIndex
      removable.push({
        file: 'requirements.md',
        category: 'spec',
        tokenSize,
        relevanceScore,
      })
    }

    // Sort: higher relevanceScore first (least relevant removed first), then larger files first
    removable.sort((a, b) => {
      if (b.relevanceScore !== a.relevanceScore)
        return b.relevanceScore - a.relevanceScore
      return b.tokenSize - a.tokenSize
    })

    return removable
  }

  /**
   * Remove a file's content from the assembled context
   */
  private removeFromContext(
    capped: AssembledContext,
    file: string,
    category: string,
  ): void {
    if (category === 'architecture') {
      delete capped.architectureDocs[file]
    } else if (file === 'requirements.md' && capped.designDoc) {
      capped.designDoc = {
        rawContent: TRUNCATED_MARKER,
        sections: [],
        codeBlocks: [],
        metadata: {},
      }
    }
  }

  /**
   * Estimate context size in tokens
   */
  private estimateContextSize(
    assembled: AssembledContext,
    charsPerToken: number = DEFAULT_CHARS_PER_TOKEN,
  ): number {
    let charCount = 0

    if (assembled.designDoc?.rawContent) {
      charCount += assembled.designDoc.rawContent.length
    }
    if (assembled.techSpec?.rawContent) {
      charCount += assembled.techSpec.rawContent.length
    }

    for (const doc of Object.values(assembled.architectureDocs)) {
      charCount += doc.rawContent?.length ?? 0
    }

    if (assembled.taskList) {
      for (const task of assembled.taskList) {
        charCount += this.estimateTaskSize(task)
      }
    }

    return Math.ceil(charCount / charsPerToken)
  }

  /**
   * Estimate size of task and its children in characters
   */
  private estimateTaskSize(task: TaskItem): number {
    let size = task.title.length + TASK_SIZE_OVERHEAD
    for (const child of task.children) {
      size += this.estimateTaskSize(child)
    }
    return size
  }

  /**
   * Format error for AgentResult
   */
  private formatError(error: unknown): {
    message: string
    code?: string
    stack?: string
    retryable: boolean
  } {
    if (error instanceof Error) {
      const nodeError = error as NodeJS.ErrnoException
      return {
        message: error.message,
        code: nodeError.code,
        stack: error.stack,
        retryable: false,
      }
    }
    return {
      message: String(error),
      retryable: false,
    }
  }

  supportsRollback(): boolean {
    return false
  }

  estimatedDuration(): number {
    return 5000 // 5 seconds typical
  }

  requiredContext(): string[] {
    return ['specPath']
  }
}
