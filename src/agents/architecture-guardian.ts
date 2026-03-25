/**
 * Architecture Guardian Agent (Phase 3 & 5)
 * Phase 3 (Analysis): Maps spec requirements to codebase modules, identifies patterns,
 *                     loads ADRs, detects potential violations
 * Phase 5 (Review): Reviews modified files against ArchitectureContext patterns,
 *                   checks import boundaries, naming conventions, state management
 */

import { promises as fs } from 'fs'
import { join, resolve } from 'path'
import type {
  AgentContext,
  AgentResult,
  ArchitectureContext,
  ArchitectureReview,
  AssembledContext,
  ImplementationResult,
  ParsedMarkdown,
} from '@/core/types'
import type { Agent } from './agent-interface'
import { parseMarkdown } from '@/core/markdown-parser'

const ESTIMATED_DURATION_MS_PHASE3 = 8000
const ESTIMATED_DURATION_MS_PHASE5 = 5000

/**
 * ArchitectureGuardianAgent implementation
 * Handles both Phase 3 (Analysis) and Phase 5 (Review)
 */
export class ArchitectureGuardianAgent implements Agent {
  private phase: 'architecture-analysis' | 'architecture-review'

  constructor(phase: 'architecture-analysis' | 'architecture-review') {
    this.phase = phase
  }

  /**
   * Execute the architecture guardian agent
   */
  async execute(context: AgentContext): Promise<AgentResult> {
    const startTime = Date.now()

    try {
      if (this.phase === 'architecture-analysis') {
        return await this.executePhase3(context, startTime)
      } else {
        return await this.executePhase5(context, startTime)
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
   * Execute Phase 3: Architecture Analysis
   */
  private async executePhase3(
    context: AgentContext,
    startTime: number,
  ): Promise<AgentResult> {
    // Get assembled context from Phase 1
    const assembledContext = context.phaseOutputs['intake'] as
      | AssembledContext
      | undefined

    if (!assembledContext) {
      throw new Error('Missing intake phase output (assembled context)')
    }

    // Load ADRs from repository
    const adrs = await this.loadADRs(context.worktreePath)

    // Identify architecture patterns from codebase
    const patterns = await this.identifyPatterns(
      context.worktreePath,
      assembledContext,
    )

    // Map module boundaries
    const moduleBoundaries = await this.identifyModuleBoundaries(
      context.worktreePath,
    )

    // Detect potential violations from spec
    const potentialViolations = this.detectPotentialViolations(
      assembledContext,
      patterns,
      moduleBoundaries,
    )

    const architectureContext: ArchitectureContext = {
      patterns,
      moduleBoundaries,
      adrs,
      adrsFound: Object.keys(adrs).length,
      potentialViolations,
    }

    const duration = Date.now() - startTime

    return {
      success: true,
      output: architectureContext,
      duration,
    }
  }

  /**
   * Execute Phase 5: Architecture Review
   */
  private async executePhase5(
    context: AgentContext,
    startTime: number,
  ): Promise<AgentResult> {
    // Get architecture context from Phase 3
    const architectureContext = context.architecture

    if (!architectureContext) {
      throw new Error('Missing architecture context from Phase 3')
    }

    // Get implementation result from Phase 4
    const implementationResult = context.phaseOutputs['implementation'] as
      | ImplementationResult
      | undefined

    if (!implementationResult) {
      throw new Error('Missing implementation result from Phase 4')
    }

    // Review all modified files against patterns
    const violations = await this.reviewModifiedFiles(
      implementationResult.modifiedFiles,
      architectureContext,
      context.worktreePath,
    )

    const architectureReview: ArchitectureReview = {
      approved: violations.length === 0,
      violations,
      modifiedFiles: implementationResult.modifiedFiles,
    }

    const duration = Date.now() - startTime

    return {
      success: true,
      output: architectureReview,
      duration,
    }
  }

  /**
   * Load Architectural Decision Records (ADRs) from repository
   */
  private async loadADRs(
    worktreePath?: string,
  ): Promise<Record<string, ParsedMarkdown>> {
    const adrs: Record<string, ParsedMarkdown> = {}

    if (!worktreePath) {
      return adrs
    }

    // Common ADR directory patterns
    const adrPaths = [
      'docs/adr',
      'adr',
      'architecture/adr',
      'docs/architecture/adr',
      '.adr',
    ]

    for (const adrPath of adrPaths) {
      const fullPath = resolve(worktreePath, adrPath)
      try {
        const entries = await fs.readdir(fullPath, { withFileTypes: true })

        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith('.md')) {
            const filePath = join(fullPath, entry.name)
            try {
              const content = await fs.readFile(filePath, 'utf-8')
              adrs[`${adrPath}/${entry.name}`] = parseMarkdown(content)
            } catch {
              // Skip files that can't be read
              continue
            }
          }
        }
      } catch {
        // Directory doesn't exist, continue to next path
        continue
      }
    }

    // Also search for ADR files in root level (e.g., 001-adr-name.md)
    try {
      const rootEntries = await fs.readdir(worktreePath, {
        withFileTypes: true,
      })
      for (const entry of rootEntries) {
        if (
          entry.isFile() &&
          entry.name.endsWith('.md') &&
          /^\d{3,4}-/.test(entry.name)
        ) {
          const filePath = join(worktreePath, entry.name)
          try {
            const content = await fs.readFile(filePath, 'utf-8')
            // Check if it looks like an ADR
            if (this.isADRContent(content)) {
              adrs[entry.name] = parseMarkdown(content)
            }
          } catch {
            continue
          }
        }
      }
    } catch {
      // Ignore errors reading root directory
    }

    return adrs
  }

  /**
   * Check if content appears to be an ADR
   */
  private isADRContent(content: string): boolean {
    const lowerContent = content.toLowerCase()
    const adrIndicators = [
      'architectural decision',
      'decision record',
      'context',
      'decision',
      'consequences',
      'adr',
    ]

    // Check for ADR template structure
    const hasAdrStructure =
      /#\s*\d{3,4}/.test(content) || // Numbered heading
      /status:\s*(proposed|accepted|deprecated|superseded)/i.test(content) ||
      /date:\s*\d{4}/.test(content)

    const indicatorCount = adrIndicators.filter((indicator) =>
      lowerContent.includes(indicator),
    ).length

    return hasAdrStructure || indicatorCount >= 3
  }

  /**
   * Identify architecture patterns from codebase
   */
  private async identifyPatterns(
    worktreePath: string | undefined,
    assembledContext: AssembledContext,
  ): Promise<ArchitectureContext['patterns']> {
    const patterns: ArchitectureContext['patterns'] = []

    if (!worktreePath) {
      return patterns
    }

    // Detect patterns from existing architecture docs
    const archDocs = assembledContext.architectureDocs
    for (const [docName, doc] of Object.entries(archDocs)) {
      const docPatterns = this.extractPatternsFromDoc(doc, docName)
      patterns.push(...docPatterns)
    }

    // Detect tech stack patterns from package.json
    const techStackPatterns = await this.detectTechStackPatterns(worktreePath)
    patterns.push(...techStackPatterns)

    // Detect folder structure patterns
    const folderPatterns = await this.detectFolderPatterns(worktreePath)
    patterns.push(...folderPatterns)

    return patterns
  }

  /**
   * Extract patterns from architecture documentation
   */
  private extractPatternsFromDoc(
    doc: ParsedMarkdown,
    docName: string,
  ): ArchitectureContext['patterns'] {
    const patterns: ArchitectureContext['patterns'] = []
    const content = doc.rawContent.toLowerCase()

    // Common pattern categories to detect
    const patternDetectors = [
      {
        name: 'Layered Architecture',
        indicators: ['layer', 'controller', 'service', 'repository', 'dao'],
        files: [
          'src/**/*controller*',
          'src/**/*service*',
          'src/**/*repository*',
        ],
      },
      {
        name: 'Hexagonal Architecture',
        indicators: ['hexagonal', 'port', 'adapter', 'domain', 'application'],
        files: ['src/domain/**/*', 'src/ports/**/*', 'src/adapters/**/*'],
      },
      {
        name: 'Microservices',
        indicators: ['microservice', 'service mesh', 'api gateway'],
        files: ['services/**/*', 'apps/**/*'],
      },
      {
        name: 'Event-Driven Architecture',
        indicators: ['event', 'event sourcing', 'cqrs', 'message bus'],
        files: ['src/events/**/*', 'src/handlers/**/*'],
      },
      {
        name: 'Component-Based UI',
        indicators: ['component', 'react', 'vue', 'angular'],
        files: ['src/components/**/*', 'src/pages/**/*', 'src/views/**/*'],
      },
      {
        name: 'Domain-Driven Design',
        indicators: [
          'ddd',
          'aggregate',
          'entity',
          'value object',
          'bounded context',
        ],
        files: ['src/domain/**/*', 'src/aggregates/**/*'],
      },
    ]

    for (const detector of patternDetectors) {
      const matches = detector.indicators.filter((indicator) =>
        content.includes(indicator),
      )

      if (matches.length >= 2) {
        patterns.push({
          name: detector.name,
          description: `Detected in ${docName}: ${matches.join(', ')}`,
          applicableFiles: detector.files,
          constraints: this.extractConstraints(doc, detector.name),
        })
      }
    }

    return patterns
  }

  /**
   * Extract constraints from documentation
   */
  private extractConstraints(
    doc: ParsedMarkdown,
    patternName: string,
  ): string[] {
    const constraints: string[] = []
    const content = doc.rawContent.toLowerCase()

    // Look for constraint keywords
    const constraintPatterns = [
      /must\s+not\s+[^.]+/gi,
      /should\s+not\s+[^.]+/gi,
      /avoid\s+[^.]+/gi,
      /never\s+[^.]+/gi,
      /always\s+[^.]+/gi,
      /required\s*:\s*[^.]+/gi,
      /constraint\s*:\s*[^.]+/gi,
    ]

    for (const pattern of constraintPatterns) {
      const matches = content.match(pattern)
      if (matches) {
        constraints.push(...matches.map((m) => m.trim()))
      }
    }

    // Pattern-specific constraints
    if (patternName.includes('TypeScript')) {
      constraints.push('Use TypeScript for all new files')
      constraints.push('Avoid plain JavaScript files')
    }

    return [...new Set(constraints)] // Deduplicate
  }

  /**
   * Detect tech stack patterns from package.json
   */
  private async detectTechStackPatterns(
    worktreePath: string,
  ): Promise<ArchitectureContext['patterns']> {
    const patterns: ArchitectureContext['patterns'] = []

    try {
      const packageJsonPath = join(worktreePath, 'package.json')
      const content = await fs.readFile(packageJsonPath, 'utf-8')
      const packageJson: {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      } = JSON.parse(content)

      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      }

      const depNames = Object.keys(allDeps).map((d) => d.toLowerCase())

      // React patterns
      if (depNames.includes('react')) {
        patterns.push({
          name: 'React',
          description: 'React UI library detected',
          applicableFiles: [
            'src/components/**/*',
            'src/pages/**/*',
            '*.tsx',
            '*.jsx',
          ],
          constraints: [
            'Use functional components with hooks',
            'Props interface must be defined',
          ],
        })
      }

      // Vue patterns
      if (depNames.includes('vue')) {
        patterns.push({
          name: 'Vue.js',
          description: 'Vue.js framework detected',
          applicableFiles: ['src/components/**/*.vue', 'src/views/**/*.vue'],
          constraints: ['Use Composition API for new components'],
        })
      }

      // TypeScript patterns
      if (depNames.includes('typescript')) {
        patterns.push({
          name: 'TypeScript',
          description: 'TypeScript language detected',
          applicableFiles: ['*.ts', '*.tsx'],
          constraints: [
            'Strict mode enabled',
            'No implicit any',
            'Explicit return types on public APIs',
          ],
        })
      }

      // Database patterns
      if (depNames.some((d) => d.includes('prisma'))) {
        patterns.push({
          name: 'Prisma ORM',
          description: 'Prisma database ORM detected',
          applicableFiles: ['prisma/schema.prisma', 'src/**/*.ts'],
          constraints: ['Use Prisma client for all database operations'],
        })
      }

      if (depNames.some((d) => d.includes('typeorm'))) {
        patterns.push({
          name: 'TypeORM',
          description: 'TypeORM database ORM detected',
          applicableFiles: ['src/entities/**/*', 'src/repositories/**/*'],
          constraints: ['Use TypeORM decorators for entity definitions'],
        })
      }

      // Testing patterns
      if (depNames.some((d) => d.includes('vitest') || d.includes('jest'))) {
        patterns.push({
          name: 'Unit Testing',
          description: 'Testing framework detected',
          applicableFiles: ['**/*.test.ts', '**/*.spec.ts'],
          constraints: ['Minimum 80% code coverage required'],
        })
      }
    } catch {
      // No package.json or invalid JSON, skip tech stack detection
    }

    return patterns
  }

  /**
   * Detect folder structure patterns
   */
  private async detectFolderPatterns(
    worktreePath: string,
  ): Promise<ArchitectureContext['patterns']> {
    const patterns: ArchitectureContext['patterns'] = []

    const folderPatterns = [
      {
        name: 'Feature-Based Structure',
        folders: ['src/features/', 'src/modules/'],
        files: ['src/features/**/*', 'src/modules/**/*'],
      },
      {
        name: 'Type-Based Structure',
        folders: ['src/components/', 'src/utils/', 'src/hooks/', 'src/types/'],
        files: ['src/components/**/*', 'src/utils/**/*'],
      },
    ]

    for (const pattern of folderPatterns) {
      const exists = await Promise.all(
        pattern.folders.map(async (folder) => {
          try {
            const stat = await fs.stat(join(worktreePath, folder))
            return stat.isDirectory()
          } catch {
            return false
          }
        }),
      )

      if (exists.some((e) => e)) {
        patterns.push({
          name: pattern.name,
          description: `Detected based on folder structure: ${pattern.folders.join(', ')}`,
          applicableFiles: pattern.files,
          constraints: ['Follow existing folder structure conventions'],
        })
      }
    }

    return patterns
  }

  /**
   * Identify module boundaries from codebase
   */
  private async identifyModuleBoundaries(
    worktreePath: string | undefined,
  ): Promise<ArchitectureContext['moduleBoundaries']> {
    const boundaries: ArchitectureContext['moduleBoundaries'] = []

    if (!worktreePath) {
      return boundaries
    }

    // Check for common module structures
    const moduleFolders = [
      'src/modules',
      'src/features',
      'src/packages',
      'packages',
    ]

    for (const folder of moduleFolders) {
      const fullPath = join(worktreePath, folder)
      try {
        const entries = await fs.readdir(fullPath, { withFileTypes: true })
        const modules = entries
          .filter((e) => e.isDirectory())
          .map((e) => e.name)

        for (const module of modules) {
          const modulePath = join(fullPath, module)
          const boundaryFiles = await this.analyzeModuleBoundary(
            modulePath,
            module,
          )

          if (boundaryFiles.length > 0) {
            boundaries.push({
              module: `${folder}/${module}`,
              boundaries: boundaryFiles,
              violations: [],
            })
          }
        }
      } catch {
        // Folder doesn't exist, skip
        continue
      }
    }

    return boundaries
  }

  /**
   * Analyze a module's boundary files
   */
  private async analyzeModuleBoundary(
    modulePath: string,
    moduleName: string,
  ): Promise<string[]> {
    const boundaries: string[] = []

    // Look for index files that define the public API
    const indexFiles = [
      'index.ts',
      'index.js',
      'public-api.ts',
      `${moduleName}.ts`,
    ]

    for (const indexFile of indexFiles) {
      try {
        const indexPath = join(modulePath, indexFile)
        await fs.access(indexPath)
        boundaries.push(indexFile)
      } catch {
        // File doesn't exist
        continue
      }
    }

    return boundaries
  }

  /**
   * Detect potential violations from spec against patterns
   */
  private detectPotentialViolations(
    assembledContext: AssembledContext,
    patterns: ArchitectureContext['patterns'],
    moduleBoundaries: ArchitectureContext['moduleBoundaries'],
  ): string[] {
    const violations: string[] = []

    const designContent =
      assembledContext.designDoc?.rawContent.toLowerCase() ?? ''
    const techSpecContent =
      assembledContext.techSpec?.rawContent.toLowerCase() ?? ''
    const combinedContent = `${designContent}\n${techSpecContent}`

    // Check for tech stack mismatches
    for (const pattern of patterns) {
      const patternName = pattern.name.toLowerCase()

      // React vs Vue conflict
      if (patternName.includes('react') && combinedContent.includes('vue')) {
        violations.push(
          `Potential conflict: Spec mentions Vue.js but codebase uses React`,
        )
      }

      // TypeScript vs JavaScript conflict
      if (patternName.includes('typescript')) {
        const hasJsFiles =
          /\.js\b(?!\.)/i.test(combinedContent) &&
          !/\.ts\b/i.test(combinedContent)
        if (hasJsFiles) {
          violations.push(
            `Potential conflict: Spec mentions JavaScript but codebase uses TypeScript`,
          )
        }
      }

      // Check constraints
      for (const constraint of pattern.constraints) {
        const lowerConstraint = constraint.toLowerCase()
        if (
          lowerConstraint.includes('should not') ||
          lowerConstraint.includes('must not') ||
          lowerConstraint.includes('avoid')
        ) {
          // Extract what should be avoided
          const parts = lowerConstraint.split(/should not|must not|avoid/)
          const afterNegation = parts[1]
          if (afterNegation) {
            const prohibitedTerm = afterNegation.trim().split(/\s+/)[0]
            const prohibited = prohibitedTerm
              ? prohibitedTerm.replace(/[^a-z0-9]/g, '')
              : ''
            if (prohibited && combinedContent.includes(prohibited)) {
              violations.push(
                `Potential violation: "${prohibited}" should be avoided per "${pattern.name}" pattern`,
              )
            }
          }
        }
      }
    }

    // Check module boundary violations
    for (const boundary of moduleBoundaries) {
      // Check if spec suggests importing from restricted areas
      if (
        boundary.boundaries.length > 0 &&
        combinedContent.includes(`from '${boundary.module}`)
      ) {
        violations.push(
          `Potential boundary violation: Spec suggests importing from "${boundary.module}"`,
        )
      }
    }

    return violations
  }

  /**
   * Review modified files against architecture patterns
   */
  private async reviewModifiedFiles(
    modifiedFiles: string[],
    architectureContext: ArchitectureContext,
    worktreePath: string | undefined,
  ): Promise<ArchitectureReview['violations']> {
    const violations: ArchitectureReview['violations'] = []

    if (!worktreePath) {
      return violations
    }

    for (const file of modifiedFiles) {
      const filePath = join(worktreePath, file)

      try {
        const content = await fs.readFile(filePath, 'utf-8')

        // Check each pattern against the file
        for (const pattern of architectureContext.patterns) {
          const patternViolations = this.checkFileAgainstPattern(
            file,
            content,
            pattern,
          )
          violations.push(...patternViolations)
        }

        // Check import boundaries
        const importViolations = this.checkImportBoundaries(
          file,
          content,
          architectureContext.moduleBoundaries,
        )
        violations.push(...importViolations)

        // Check naming conventions
        const namingViolations = this.checkNamingConventions(file, content)
        violations.push(...namingViolations)

        // Check state management consistency
        const stateViolations = this.checkStateManagement(file, content)
        violations.push(...stateViolations)
      } catch {
        // File doesn't exist or can't be read, skip
        continue
      }
    }

    return violations
  }

  /**
   * Check a file against a specific pattern
   */
  private checkFileAgainstPattern(
    file: string,
    content: string,
    pattern: ArchitectureContext['patterns'][0],
  ): ArchitectureReview['violations'] {
    const violations: ArchitectureReview['violations'] = []

    // Check if file matches pattern's applicable files
    const isApplicable = pattern.applicableFiles.some((glob) => {
      // Simple glob matching - handle both exact matches and suffix/prefix matches
      // *.ts should match any .ts file in any directory
      // src/**/*.ts should match .ts files in src and subdirectories

      // Check original glob pattern type
      const isSuffixPattern = glob.startsWith('*.')

      let regexPattern: string

      if (isSuffixPattern) {
        // For *.ts, *.tsx, etc. - match any path ending with the extension
        const ext = glob.slice(1) // Get .ts, .tsx, etc.
        // Escape dots in the extension for regex (e.g., .ts -> \\.ts)
        const escapedExt = ext.replace(/\./g, '\\.')
        regexPattern = '.*' + escapedExt + '$'
      } else {
        // General glob pattern
        // First, handle /**/ specially - it should match / or nothing
        regexPattern = glob.replace(/\/\*\*\//g, '/(?:[^/]*/)?')

        // Then handle remaining **
        regexPattern = regexPattern
          .replace(/\*\*/g, '{{GLOBSTAR}}')
          .replace(/\*/g, '[^/]*')

        // Replace {{GLOBSTAR}} with pattern that matches zero or more path segments
        // This handles both /**/ (already processed) and standalone **
        regexPattern = regexPattern.replace(/\{\{GLOBSTAR\}\}/g, '.*')

        // Handle **/ prefix - match from start or any subdirectory
        if (regexPattern.startsWith('.*') && !glob.startsWith('.')) {
          regexPattern = '(^|.*/)' + regexPattern.substring(2)
        }

        // If pattern doesn't start with ^ or (, add start anchor
        if (!regexPattern.startsWith('^') && !regexPattern.startsWith('(')) {
          regexPattern = '(^|.*/)' + regexPattern
        }

        // Add end anchor if not present
        if (!regexPattern.endsWith('$')) {
          regexPattern = regexPattern + '$'
        }
      }

      const regex = new RegExp(regexPattern)
      return regex.test(file)
    })

    if (!isApplicable) {
      return violations
    }

    // Check constraints
    for (const constraint of pattern.constraints) {
      const lowerConstraint = constraint.toLowerCase()
      const lowerContent = content.toLowerCase()

      // Check "should not" / "must not" constraints
      if (
        lowerConstraint.includes('should not') ||
        lowerConstraint.includes('must not')
      ) {
        const parts = lowerConstraint.split(/should not|must not/)
        const afterNegation = parts[1]
        if (afterNegation) {
          const prohibitedTerm = afterNegation.trim().split(/\s+/)[0]
          const prohibited = prohibitedTerm
            ? prohibitedTerm.replace(/[^a-z0-9]/g, '')
            : ''
          if (prohibited && lowerContent.includes(prohibited)) {
            violations.push({
              file,
              pattern: pattern.name,
              issue: `Violates constraint: "${constraint}"`,
              suggestion: `Remove or refactor code that uses "${prohibited}"`,
            })
          }
        }
      }
    }

    // Pattern-specific checks
    if (pattern.name === 'TypeScript') {
      // Check for any type
      if (/:\s*any\b/.test(content)) {
        violations.push({
          file,
          pattern: 'TypeScript',
          issue: 'Uses explicit `any` type which violates strict TypeScript',
          suggestion: 'Replace `any` with a specific type or use `unknown`',
        })
      }

      // Check for missing return types on exported functions
      const exportFunctionPattern =
        /export\s+(async\s+)?function\s+\w+\s*\([^)]*\)\s*{/g
      let match: RegExpExecArray | null = null
      while ((match = exportFunctionPattern.exec(content)) !== null) {
        if (!match[0].includes(':')) {
          violations.push({
            file,
            pattern: 'TypeScript',
            issue: 'Exported function missing return type annotation',
            suggestion: 'Add explicit return type to exported function',
          })
        }
      }
    }

    if (pattern.name === 'React') {
      // Check for class components (should use functional)
      if (/class\s+\w+\s+extends\s+(React\.)?Component/.test(content)) {
        violations.push({
          file,
          pattern: 'React',
          issue: 'Uses class component instead of functional component',
          suggestion: 'Refactor to functional component with hooks',
        })
      }

      // Check for missing key prop in lists
      if (/\.map\s*\([^)]*=>/.test(content) && !/key\s*=/.test(content)) {
        violations.push({
          file,
          pattern: 'React',
          issue: 'List rendering may be missing key prop',
          suggestion: 'Ensure each element in a list has a unique key prop',
        })
      }
    }

    return violations
  }

  /**
   * Check import boundaries
   */
  private checkImportBoundaries(
    file: string,
    content: string,
    moduleBoundaries: ArchitectureContext['moduleBoundaries'],
  ): ArchitectureReview['violations'] {
    const violations: ArchitectureReview['violations'] = []

    // Extract all imports
    const importPattern = /import\s+.*?\s+from\s+['"]([^'"]+)['"];?/g
    const requirePattern = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g

    const imports: string[] = []
    let match: RegExpExecArray | null = null

    while ((match = importPattern.exec(content)) !== null) {
      if (match && match[1]) imports.push(match[1])
    }

    while ((match = requirePattern.exec(content)) !== null) {
      if (match[1]) imports.push(match[1])
    }

    // Check each import against module boundaries
    for (const imp of imports) {
      for (const boundary of moduleBoundaries) {
        // Check if importing from a restricted module - avoid unused rule variable
        if (
          imp.includes(boundary.module) &&
          !boundary.boundaries.some((b) => imp.endsWith(b))
        ) {
          violations.push({
            file,
            pattern: 'Module Boundaries',
            issue: `Import "${imp}" may violate module boundary for "${boundary.module}"`,
            suggestion: `Import only from public API of "${boundary.module}"`,
          })
        }
      }
    }

    return violations
  }

  /**
   * Check naming conventions
   */
  private checkNamingConventions(
    file: string,
    content: string,
  ): ArchitectureReview['violations'] {
    const violations: ArchitectureReview['violations'] = []

    // Check file naming conventions
    const fileName = file.split('/').pop() ?? ''

    // TypeScript files should use camelCase or PascalCase
    if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      // Check for snake_case in file name (not typical in TS)
      if (
        /_[a-z]/.test(fileName) &&
        !fileName.includes('.test.') &&
        !fileName.includes('.spec.')
      ) {
        violations.push({
          file,
          pattern: 'Naming Conventions',
          issue: `File name "${fileName}" uses snake_case`,
          suggestion: 'Use camelCase or PascalCase for TypeScript files',
        })
      }
    }

    // Check variable naming
    const constPattern = /const\s+([A-Z_][A-Z_0-9]*)\s*=/g
    let match: RegExpExecArray | null = null
    while ((match = constPattern.exec(content)) !== null) {
      const varName = match[1]
      // SCREAMING_SNAKE_CASE should only be for constants
      if (varName && !/^[A-Z][A-Z_0-9]*$/.test(varName)) {
        violations.push({
          file,
          pattern: 'Naming Conventions',
          issue: `Variable "${varName}" uses inconsistent naming`,
          suggestion: 'Use SCREAMING_SNAKE_CASE only for true constants',
        })
      }
    }

    // Check function naming (should be camelCase)
    // Skip PascalCase check for .tsx/.jsx files where PascalCase is standard for components
    const isJsxFile = file.endsWith('.tsx') || file.endsWith('.jsx')
    if (!isJsxFile) {
      const functionPattern = /function\s+([A-Z][a-zA-Z0-9]*)\s*\(/g
      let funcMatch: RegExpExecArray | null = null
      while ((funcMatch = functionPattern.exec(content)) !== null) {
        const funcName = funcMatch[1]
        if (funcName) {
          violations.push({
            file,
            pattern: 'Naming Conventions',
            issue: `Function "${funcName}" uses PascalCase`,
            suggestion:
              'Use camelCase for regular functions, PascalCase only for classes',
          })
        }
      }
    }

    return violations
  }

  /**
   * Check state management consistency
   */
  private checkStateManagement(
    file: string,
    content: string,
  ): ArchitectureReview['violations'] {
    const violations: ArchitectureReview['violations'] = []

    // Detect state management patterns in use
    const hasRedux = /import.*redux|useSelector|useDispatch/.test(content)
    const hasContext = /createContext|useContext/.test(content)
    const hasZustand = /import.*zustand/.test(content)
    const hasMobX = /import.*mobx/.test(content)

    // Count state management libraries used
    const stateLibraries = [hasRedux, hasContext, hasZustand, hasMobX].filter(
      Boolean,
    ).length

    if (stateLibraries > 1) {
      violations.push({
        file,
        pattern: 'State Management',
        issue: 'File uses multiple state management patterns',
        suggestion:
          'Consolidate state management to a single pattern per feature',
      })
    }

    // Check for direct state mutations (common anti-pattern)
    const mutationPattern = /state\.\w+\s*=|\.push\s*\(|\.splice\s*\(/
    if (mutationPattern.test(content) && hasRedux) {
      violations.push({
        file,
        pattern: 'State Management',
        issue: 'Potential direct state mutation detected',
        suggestion:
          'Use immutable updates with Redux (spread operator or Immer)',
      })
    }

    return violations
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
    return this.phase === 'architecture-analysis'
      ? ESTIMATED_DURATION_MS_PHASE3
      : ESTIMATED_DURATION_MS_PHASE5
  }

  requiredContext(): string[] {
    if (this.phase === 'architecture-analysis') {
      return ['phaseOutputs.intake']
    } else {
      return ['architecture', 'phaseOutputs.implementation']
    }
  }
}
