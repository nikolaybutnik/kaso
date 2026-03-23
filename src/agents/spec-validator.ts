/**
 * Spec Validator Agent (Phase 2 — Validation)
 * Validates spec completeness and architectural alignment
 */

import type {
  AgentContext,
  AgentResult,
  ValidationReport,
  AssembledContext,
  ArchitectureContext,
  ParsedMarkdown,
} from '../core/types'
import type { Agent } from './agent-interface'

/**
 * SpecValidatorAgent implementation
 * Checks for undefined APIs, missing DB schemas, missing error handling, architectural contradictions
 */

const ESTIMATED_DURATION_MS = 3000
const MAX_DESCRIPTION_LENGTH = 100
const NEARBY_LINES_WINDOW = 5
const LOCATION_SEARCH_PREFIX_LENGTH = 50

/** Truncate a match string for use in issue descriptions */
function truncateMatch(text: string): string {
  if (text.length <= MAX_DESCRIPTION_LENGTH) return text
  return `${text.substring(0, MAX_DESCRIPTION_LENGTH)}...`
}

export class SpecValidatorAgent implements Agent {
  /**
   * Execute the spec validator agent
   */
  async execute(context: AgentContext): Promise<AgentResult> {
    const startTime = Date.now()

    try {
      // Extract assembled context from phase outputs
      const assembledContext = context.phaseOutputs['intake'] as
        | AssembledContext
        | undefined

      if (!assembledContext) {
        throw new Error('Missing intake phase output (assembled context)')
      }

      // Perform validation checks
      const report = this.validateSpec(assembledContext, context)

      const duration = Date.now() - startTime

      return {
        success: true,
        output: report,
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
   * Validate the spec against all criteria
   */
  private validateSpec(
    assembled: AssembledContext,
    context: AgentContext,
  ): ValidationReport {
    const issues: ValidationReport['issues'] = []
    const suggestedFixes: string[] = []

    // Check for undefined API contracts
    const apiIssues = this.checkApiContracts(
      assembled.designDoc,
      assembled.techSpec,
    )
    issues.push(...apiIssues)

    // Check for missing database schemas
    const dbIssues = this.checkDatabaseSchemas(
      assembled.designDoc,
      assembled.techSpec,
    )
    issues.push(...dbIssues)

    // Check for missing error handling strategies
    const errorIssues = this.checkErrorHandling(
      assembled.designDoc,
      assembled.techSpec,
    )
    issues.push(...errorIssues)

    // Check for contradictions with architecture patterns
    if (context.architecture) {
      const archIssues = this.checkArchitectureContradictions(
        assembled,
        context.architecture,
      )
      issues.push(...archIssues)
    }

    // Generate suggested fixes based on issues
    if (issues.length > 0) {
      suggestedFixes.push(...this.generateSuggestedFixes(issues, assembled))
    }

    // Only add "complete" message if no issues
    if (issues.length === 0) {
      suggestedFixes.push('Spec is complete and well-defined')
    }

    return {
      approved: issues.length === 0,
      issues,
      suggestedFixes,
    }
  }

  /**
   * Check for undefined API contracts
   */
  private checkApiContracts(
    designDoc?: ParsedMarkdown,
    techSpec?: ParsedMarkdown,
  ): ValidationReport['issues'] {
    const issues: ValidationReport['issues'] = []
    const content = this.getCombinedContent(designDoc, techSpec)

    // Patterns that indicate undefined API contracts
    const undefinedApiPatterns = [
      /API\s+(endpoint|contract|interface)s?[^.]{0,200}\b(not\s+defined|undefined|missing|TODO|FIXME)/gi,
      /\b(not\s+specified|not\s+implemented|placeholder)\s+API/gi,
      /API\s+specification\s*[:：]?\s*\n\s*[-*]\s*(TODO|FIXME|missing|undefined)/gi,
      /\b(REST|GraphQL|gRPC)\s+API[^.]{0,200}\b(not\s+defined|undefined|missing|TODO)/gi,
    ]

    // Patterns for API endpoints without definitions
    const endpointPatterns = [
      /\b(POST|GET|PUT|PATCH|DELETE)\s+\/\S+[^.]{0,200}\b(not\s+defined|undefined|missing|TODO)/gi,
      /\bendpoint\s*:?[^\n]*\b(not\s+defined|undefined|missing|TODO)/gi,
    ]

    for (const pattern of [...undefinedApiPatterns, ...endpointPatterns]) {
      const matches = content.match(pattern)
      if (matches) {
        for (const match of matches) {
          issues.push({
            type: 'api-contract',
            severity: 'error',
            description: `Undefined API contract found: "${truncateMatch(match)}"`,
            location: this.findLocationInDocs(match, designDoc, techSpec),
            suggestion:
              'Define the API contract with request/response schemas, authentication, and error codes',
          })
        }
      }
    }

    // Check for API routes without schema definitions
    if (content.includes('API') || content.includes('endpoint')) {
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? ''
        const routeMatch = line.match(
          /['"`]?(GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s'"`]+)['"`]?/i,
        )
        if (routeMatch) {
          // Check if this route has a schema defined nearby
          const nearbyContent = lines
            .slice(
              Math.max(0, i - NEARBY_LINES_WINDOW),
              Math.min(lines.length, i + NEARBY_LINES_WINDOW),
            )
            .join('\n')
          const hasSchema = /schema|request|response|body|params|query/i.test(
            nearbyContent,
          )

          if (!hasSchema) {
            issues.push({
              type: 'api-contract',
              severity: 'warning',
              description: `API route ${routeMatch[1]} ${routeMatch[2]} may lack schema definition`,
              location: `Line ~${i + 1}`,
              suggestion: `Define request/response schemas for ${routeMatch[2]}`,
            })
          }
        }
      }
    }

    return issues
  }

  /**
   * Check for missing database schemas
   */
  private checkDatabaseSchemas(
    designDoc?: ParsedMarkdown,
    techSpec?: ParsedMarkdown,
  ): ValidationReport['issues'] {
    const issues: ValidationReport['issues'] = []
    const content = this.getCombinedContent(designDoc, techSpec)

    // Check for database mentions without schema definitions
    const dbMentions = content.match(
      /\b(database|db|table|collection|schema|model|entity|migration)\b/gi,
    )

    if (dbMentions && dbMentions.length > 0) {
      // Patterns that indicate missing schema definitions
      const missingSchemaPatterns = [
        /\b(database|db|table|collection)s?[^.]{0,200}\b(not\s+defined|undefined|missing|TODO|FIXME)/gi,
        /\bschema\s*:?[^\n]*\b(not\s+defined|undefined|missing|TODO|FIXME)/gi,
        /migration\s*:?[^\n]*\b(not\s+defined|undefined|missing|TODO|FIXME)/gi,
        /model\s*:?[^\n]*\b(not\s+defined|undefined|missing|TODO|FIXME)/gi,
        /\b(not\s+specified|not\s+implemented)\s+(database|schema|table|entity)/gi,
      ]

      for (const pattern of missingSchemaPatterns) {
        const matches = content.match(pattern)
        if (matches) {
          for (const match of matches) {
            issues.push({
              type: 'db-schema',
              severity: 'error',
              description: `Missing database schema definition: "${truncateMatch(match)}"`,
              location: this.findLocationInDocs(match, designDoc, techSpec),
              suggestion:
                'Define the database schema with fields, types, indexes, and relationships',
            })
          }
        }
      }

      // Check if tables are mentioned without CREATE statements or ORM models
      if (content.includes('table') || content.includes('Table')) {
        const hasCreateTable =
          /CREATE\s+TABLE|@Entity|@model|schema\.createTable|knex\.schema/i.test(
            content,
          )
        const hasOrmModel =
          /class\s+\w+\s+extends\s+Model|@Table|@Entity/i.test(content)

        if (!hasCreateTable && !hasOrmModel) {
          issues.push({
            type: 'db-schema',
            severity: 'warning',
            description:
              'Database tables mentioned but no schema creation statements or ORM models found',
            location: this.findLocationForDbSchema(
              content,
              designDoc,
              techSpec,
            ),
            suggestion:
              'Add CREATE TABLE statements, ORM models, or migration definitions for database tables',
          })
        }
      }
    }

    return issues
  }

  /**
   * Check for missing error handling
   */
  private checkErrorHandling(
    designDoc?: ParsedMarkdown,
    techSpec?: ParsedMarkdown,
  ): ValidationReport['issues'] {
    const issues: ValidationReport['issues'] = []
    const content = this.getCombinedContent(designDoc, techSpec)

    // Patterns that indicate missing error handling
    const missingErrorPatterns = [
      /error\s+handling[^.]{0,200}\b(not\s+defined|undefined|missing|TODO|FIXME)/gi,
      /error\s+handling\s*:?[^\n]*\b(not\s+defined|undefined|missing|TODO|FIXME)/gi,
      /exception\s+handling[^.]{0,200}\b(not\s+defined|undefined|missing|TODO|FIXME)/gi,
      /\b(not\s+specified|not\s+implemented)\s+error\s+handling/gi,
    ]

    for (const pattern of missingErrorPatterns) {
      const matches = content.match(pattern)
      if (matches) {
        for (const match of matches) {
          issues.push({
            type: 'error-handling',
            severity: 'error',
            description: `Missing error handling strategy: "${truncateMatch(match)}"`,
            location: this.findLocationInDocs(match, designDoc, techSpec),
            suggestion:
              'Define error handling strategy including error types, recovery mechanisms, and user feedback',
          })
        }
      }
    }

    // Check if API endpoints lack error responses
    if (
      content.includes('API') ||
      content.includes('endpoint') ||
      content.includes('route')
    ) {
      const apiSections = this.extractApiSections(content)
      for (const section of apiSections) {
        const hasErrorResponse = /error|Error|4xx|5xx|catch|try/i.test(section)

        if (!hasErrorResponse) {
          issues.push({
            type: 'error-handling',
            severity: 'warning',
            description: `API section may lack error handling definitions`,
            location: this.findLocationInDocs(
              section.substring(0, LOCATION_SEARCH_PREFIX_LENGTH),
              designDoc,
              techSpec,
            ),
            suggestion:
              'Define error responses for the API including status codes, error messages, and recovery flows',
          })
        }
      }
    }

    // Check if there are any try-catch blocks or error handling patterns
    const hasTryCatch = /try\s*{[\s\S]*?}\s*catch|\.catch\(|catch\s*\(/i.test(
      content,
    )
    const hasErrorTypes = /Error\s+types|error\s+types|Exception\s+types/i.test(
      content,
    )

    // FIXED: Proper operator precedence
    if (
      !hasTryCatch &&
      !hasErrorTypes &&
      (content.includes('function') || content.includes('method'))
    ) {
      issues.push({
        type: 'error-handling',
        severity: 'warning',
        description:
          'Code functions/methods found but no error handling patterns detected',
        location: this.findOverallLocation(designDoc, techSpec),
        suggestion:
          'Implement try-catch blocks, error type definitions, and error recovery logic',
      })
    }

    return issues
  }

  /**
   * Check for contradictions with architecture patterns
   */
  private checkArchitectureContradictions(
    assembled: AssembledContext,
    architecture: ArchitectureContext,
  ): ValidationReport['issues'] {
    const issues: ValidationReport['issues'] = []

    // Only check if we have patterns
    if (architecture.patterns && architecture.patterns.length > 0) {
      // Check tech stack contradictions
      issues.push(...this.checkTechStackContradictions(assembled, architecture))

      // Check module boundary violations
      if (
        architecture.moduleBoundaries &&
        architecture.moduleBoundaries.length > 0
      ) {
        issues.push(
          ...this.checkModuleBoundaryViolations(assembled, architecture),
        )
      }

      // Check pattern violations
      issues.push(...this.checkPatternViolations(assembled, architecture))
    }

    return issues
  }

  /**
   * Check for tech stack contradictions
   */
  private checkTechStackContradictions(
    assembled: AssembledContext,
    architecture: ArchitectureContext,
  ): ValidationReport['issues'] {
    const issues: ValidationReport['issues'] = []
    const content = this.getCombinedContent(
      assembled.designDoc,
      assembled.techSpec,
    )

    for (const pattern of architecture.patterns) {
      const patternName = pattern.name.toLowerCase()

      // Example: If architecture uses React, check for Vue mentions
      if (
        patternName.includes('react') &&
        content.toLowerCase().includes('vue')
      ) {
        issues.push({
          type: 'contradiction',
          severity: 'error',
          description:
            'Spec mentions Vue.js but architecture pattern specifies React',
          location: this.findLocationInDocs(
            'vue',
            assembled.designDoc,
            assembled.techSpec,
          ),
          suggestion:
            'Use React components instead of Vue to align with architecture decision',
        })
      }

      // Example: If architecture uses TypeScript, check for plain JS
      if (patternName.includes('typescript')) {
        const hasJsFiles =
          /\.js\b(?!\.)/i.test(content) && !/\.ts\b/i.test(content)

        if (hasJsFiles) {
          issues.push({
            type: 'contradiction',
            severity: 'warning',
            description:
              'Spec mentions JavaScript files but architecture uses TypeScript',
            location: this.findLocationInDocs(
              '.js',
              assembled.designDoc,
              assembled.techSpec,
            ),
            suggestion:
              'Use TypeScript (.ts) files instead of JavaScript (.js) to match architecture',
          })
        }
      }

      // Check for database contradictions
      if (
        patternName.includes('postgresql') &&
        content.toLowerCase().includes('mysql')
      ) {
        issues.push({
          type: 'contradiction',
          severity: 'error',
          description:
            'Spec mentions MySQL but architecture pattern specifies PostgreSQL',
          location: this.findLocationInDocs(
            'mysql',
            assembled.designDoc,
            assembled.techSpec,
          ),
          suggestion:
            'Use PostgreSQL instead of MySQL to align with architecture decision',
        })
      }

      if (
        patternName.includes('mysql') &&
        content.toLowerCase().includes('postgresql')
      ) {
        issues.push({
          type: 'contradiction',
          severity: 'error',
          description:
            'Spec mentions PostgreSQL but architecture pattern specifies MySQL',
          location: this.findLocationInDocs(
            'postgresql',
            assembled.designDoc,
            assembled.techSpec,
          ),
          suggestion:
            'Use MySQL instead of PostgreSQL to align with architecture decision',
        })
      }
    }

    return issues
  }

  /**
   * Check for module boundary violations
   */
  private checkModuleBoundaryViolations(
    assembled: AssembledContext,
    architecture: ArchitectureContext,
  ): ValidationReport['issues'] {
    const issues: ValidationReport['issues'] = []
    const content = this.getCombinedContent(
      assembled.designDoc,
      assembled.techSpec,
    )

    for (const boundary of architecture.moduleBoundaries) {
      // Check if spec mentions importing from restricted modules
      for (const boundaryRule of boundary.boundaries) {
        if (content.toLowerCase().includes(`import.*from.*${boundaryRule}`)) {
          issues.push({
            type: 'contradiction',
            severity: 'error',
            description: `Spec suggests importing from "${boundaryRule}" which violates module boundary for "${boundary.module}"`,
            location: this.findLocationInDocs(
              `import.*from.*${boundaryRule}`,
              assembled.designDoc,
              assembled.techSpec,
            ),
            suggestion: `Follow module boundary rule: Do not import "${boundaryRule}" in "${boundary.module}"`,
          })
        }
      }
    }

    return issues
  }

  /**
   * Check for pattern violations
   */
  private checkPatternViolations(
    assembled: AssembledContext,
    architecture: ArchitectureContext,
  ): ValidationReport['issues'] {
    const issues: ValidationReport['issues'] = []
    const content = this.getCombinedContent(
      assembled.designDoc,
      assembled.techSpec,
    )

    for (const pattern of architecture.patterns) {
      // Check if pattern constraints are violated
      for (const constraint of pattern.constraints) {
        if (
          content.toLowerCase().includes(constraint.toLowerCase()) &&
          this.isViolation(content, constraint)
        ) {
          issues.push({
            type: 'contradiction',
            severity: 'warning',
            description: `Spec may violate pattern "${pattern.name}": ${constraint}`,
            location: this.findLocationInDocs(
              constraint,
              assembled.designDoc,
              assembled.techSpec,
            ),
            suggestion: `Follow pattern constraint: ${constraint}`,
          })
        }
      }
    }

    return issues
  }

  /**
   * Check if a constraint is violated in content
   */
  private isViolation(content: string, constraint: string): boolean {
    // Simple heuristic: if constraint mentions "should not" and content includes what should not be done
    const lowerContent = content.toLowerCase()
    const lowerConstraint = constraint.toLowerCase()

    if (
      lowerConstraint.includes('should not') ||
      lowerConstraint.includes('avoid')
    ) {
      // Extract what should not be done (simplified)
      const parts = lowerConstraint.split('should not')
      const afterShouldNot = parts[1]
      if (afterShouldNot) {
        const prohibited = afterShouldNot.trim().split(/\s+/)[0] ?? ''
        if (prohibited) {
          return lowerContent.includes(prohibited)
        }
      }
    }

    return false
  }

  /**
   * Generate suggested fixes based on issues
   */
  private generateSuggestedFixes(
    issues: ValidationReport['issues'],
    _assembled: AssembledContext,
  ): string[] {
    const fixes = new Set<string>()

    for (const issue of issues) {
      if (issue.type === 'api-contract') {
        fixes.add(
          'Define all API contracts with OpenAPI/Swagger specifications including request/response schemas',
        )
        fixes.add(
          'Include authentication, authorization, and rate limiting details in API contracts',
        )
      } else if (issue.type === 'db-schema') {
        fixes.add(
          'Create database schema definitions with CREATE TABLE statements or ORM models',
        )
        fixes.add(
          'Include indexes, constraints, and relationships in schema definitions',
        )
      } else if (issue.type === 'error-handling') {
        fixes.add(
          'Document error handling strategy including error types, recovery mechanisms, and user feedback',
        )
        fixes.add(
          'Define error response formats and status codes for all API endpoints',
        )
      } else if (issue.type === 'contradiction') {
        fixes.add(
          'Review architecture decision records (ADRs) and align spec with established patterns',
        )
        fixes.add(
          'Update spec to use approved tech stack and follow module boundaries',
        )
      }
    }

    return Array.from(fixes)
  }

  /**
   * Get combined content from multiple docs
   */
  private getCombinedContent(...docs: (ParsedMarkdown | undefined)[]): string {
    return docs
      .filter((doc): doc is ParsedMarkdown => doc !== undefined)
      .map((doc) => doc.rawContent)
      .join('\n\n')
  }

  /**
   * Find location of text in docs
   */
  private findLocationInDocs(
    text: string,
    designDoc?: ParsedMarkdown,
    techSpec?: ParsedMarkdown,
  ): string {
    const lowerText = text.toLowerCase()

    if (designDoc?.rawContent.toLowerCase().includes(lowerText)) {
      const lineNum = this.findLineNumber(designDoc.rawContent, text)
      return `design.md:${lineNum}`
    }

    if (techSpec?.rawContent.toLowerCase().includes(lowerText)) {
      const lineNum = this.findLineNumber(techSpec.rawContent, text)
      return `tech-spec.md:${lineNum}`
    }

    return 'Unknown location'
  }

  /**
   * Find line number for text in content
   */
  private findLineNumber(content: string, searchText: string): number {
    const lines = content.split('\n')
    const lowerSearch = searchText.toLowerCase()

    for (let i = 0; i < lines.length; i++) {
      if ((lines[i] ?? '').toLowerCase().includes(lowerSearch)) {
        return i + 1
      }
    }

    return 0
  }

  /**
   * Find location for database schema issues
   */
  private findLocationForDbSchema(
    _content: string,
    designDoc?: ParsedMarkdown,
    techSpec?: ParsedMarkdown,
  ): string {
    // Look for "database" or "table" mentions
    if (
      designDoc?.rawContent.toLowerCase().includes('database') ||
      designDoc?.rawContent.toLowerCase().includes('table')
    ) {
      return 'design.md'
    }

    if (
      techSpec?.rawContent.toLowerCase().includes('database') ||
      techSpec?.rawContent.toLowerCase().includes('table')
    ) {
      return 'tech-spec.md'
    }

    return 'Unknown location'
  }

  /**
   * Extract API sections from content
   * Only extracts sections that are under headings mentioning API/endpoint/route
   */
  private extractApiSections(content: string): string[] {
    const sections: string[] = []
    const lines = content.split('\n')
    let inApiSection = false
    let currentSection = ''

    for (const line of lines) {
      // Check if this line is a heading that mentions API/endpoint/route
      const isApiHeading =
        line.match(/^#+\s+/) && /API|endpoint|route/i.test(line)

      if (isApiHeading) {
        // End previous API section if any
        if (inApiSection && currentSection) {
          sections.push(currentSection)
        }
        // Start new API section
        inApiSection = true
        currentSection = line + '\n'
      } else if (inApiSection) {
        // Check if this is a non-API heading (ends the API section)
        const isNonApiHeading =
          line.match(/^#+\s+/) && !/API|endpoint|route/i.test(line)

        if (isNonApiHeading) {
          // End current API section
          sections.push(currentSection)
          inApiSection = false
          currentSection = ''
        } else {
          // Continue current API section
          currentSection += line + '\n'
        }
      }
    }

    // Add the last API section if any
    if (inApiSection && currentSection) {
      sections.push(currentSection)
    }

    return sections
  }

  /**
   * Find overall location (fallback)
   */
  private findOverallLocation(
    designDoc?: ParsedMarkdown,
    techSpec?: ParsedMarkdown,
  ): string {
    if (designDoc) return 'design.md'
    if (techSpec) return 'tech-spec.md'
    return 'Unknown location'
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
    return ESTIMATED_DURATION_MS
  }

  requiredContext(): string[] {
    return ['phaseOutputs.intake']
  }
}
