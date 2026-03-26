# KASO User Journey: From Spec to PR

This document provides a comprehensive walkthrough of the complete KASO user experience, from initial spec creation through to pull request delivery, with detailed technical implementation explanations.

---

## Overview

KASO (Kiro-Enabled Agent Swarm Orchestrator) is an 8-phase automated development pipeline that transforms Kiro specification documents into production-ready code changes. It operates entirely locally, uses git worktrees for isolation, and produces conventional commits with pull requests.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         KASO EXECUTION PIPELINE                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   │
│  │  Intake │──▶│Validation│──▶│  Arch    │──▶│  Impl    │──▶│  Arch    │   │
│  │  (P1)   │   │  (P2)    │   │  (P3)    │   │  (P4)    │   │  Rev (P5)│   │
│  └─────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘   │
│                                                                   │         │
│                              ┌────────────────────────────────────┘         │
│                              ▼                                              │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐                  │
│  │ Delivery │◀──│  Review  │◀──│   UI     │◀──│   Test   │                  │
│  │  (P8)    │   │Council   │   │  (P7)    │   │  (P6)    │                  │
│  └──────────┘   │  (P8)    │   └──────────┘   └──────────┘                  │
│                 └──────────┘                                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 0: Prerequisites & Setup

### User Actions

Before running KASO, the user must:

1. **Install dependencies**: Node.js 18+, Git 2.40+, and an AI backend CLI (e.g., Kimi Code CLI)
2. **Configure KASO**: Create `kaso.config.json` with executor backends
3. **Set API keys**: Environment variables or OS keychain
4. **Create a Kiro spec**: Three markdown files in `.kiro/specs/<feature-name>/`

### Configuration File (`kaso.config.json`)

```json
{
  "executorBackends": [
    {
      "name": "kimi-code",
      "command": "kimi",
      "protocol": "cli-json",
      "maxContextWindow": 128000,
      "costPer1000Tokens": 0.01
    }
  ],
  "defaultBackend": "kimi-code",
  "maxConcurrentAgents": "auto",
  "contextCapping": {
    "enabled": true,
    "charsPerToken": 4,
    "relevanceRanking": ["requirements.md", "design.md", "tasks.md"]
  },
  "reviewCouncil": {
    "maxReviewRounds": 2,
    "enableParallelReview": false,
    "perspectives": ["security", "performance", "maintainability"]
  },
  "executionStore": {
    "type": "sqlite",
    "path": ".kaso/execution-store.db"
  }
}
```

### Kiro Spec Directory Structure

```
.kiro/
├── specs/
│   └── my-feature/
│       ├── requirements.md   # Functional requirements, glossary, user stories
│       ├── design.md         # Architecture, data models, API design
│       ├── tasks.md          # Checkbox task list with nested hierarchy
│       └── .config.kiro      # Spec-level KASO configuration (optional)
├── steering/
│   ├── coding_practices.md   # Agent coding style / patterns
│   ├── personality.md        # Agent tone and behaviour
│   └── commit-conventions.md # Commit message rules
└── hooks/
    └── *.kiro.hook           # Lifecycle hook scripts
```

### Spec Format Details

**requirements.md** contains:
- Introduction and problem statement
- Glossary of domain terms
- Functional requirements
- User stories and acceptance criteria

**design.md** contains:
- Architecture overview
- Data models
- API endpoints with request/response examples
- Security considerations
- Implementation approach

**tasks.md** contains:
- Hierarchical checkbox tasks using `- [ ]` or `- [x]` syntax
- Nested subtasks through indentation
- Sprint/phase organization

---

## Entry Points: How Users Start KASO

### Option 1: CLI Command (Manual)

```bash
# Start a specific spec
kaso start .kiro/specs/my-feature

# With custom base branch
kaso start .kiro/specs/my-feature --branch develop

# Check system health first
kaso doctor
```

**Technical Flow:**
```
CLI Command
    │
    ▼
┌─────────────────┐
│  CLI Handler    │── Validates spec path exists
│  (commands.ts)  │── Loads configuration
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Orchestrator   │── Generates runId
│  (orchestrator) │── Checks for concurrent runs
│  .startRun()    │── Creates worktree
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Pipeline Exec   │── Begins Phase 1 (Intake)
│ (8 phases)      │
└─────────────────┘
```

### Option 2: File Watcher (Automatic)

```bash
# Start watcher mode
kaso watch

# Watcher monitors .kiro/specs/*/status.json
```

**How it works:**
1. Watcher uses `chokidar` to monitor `status.json` files
2. When a spec transitions to `runStatus: "pending"` with no `currentPhase`
3. The watcher triggers `orchestrator.startRun()` automatically
4. Ideal for CI/CD integration or IDE workflows

**Status file format:**
```json
{
  "currentPhase": null,
  "runStatus": "pending",
  "lastUpdated": "2024-01-15T10:30:00Z",
  "runId": null
}
```

---

## The 8-Phase Pipeline: Detailed Walkthrough

### Phase 1: Intake (Spec Reading)

**Agent:** `SpecReaderAgent`  
**Purpose:** Parse Kiro spec files and assemble execution context

#### User Input
- Path to spec directory containing `requirements.md`, `design.md`, `tasks.md`

#### Technical Implementation

```typescript
// File: src/agents/spec-reader.ts

class SpecReaderAgent {
  async execute(context: AgentContext): Promise<AgentResult> {
    // 1. Parse all three spec files
    const parsedSpec = await this.parseSpecFiles()
    
    // 2. Load architecture docs (ARCHITECTURE.md, .cursorrules, etc.)
    const architectureDocs = await this.loadArchitectureDocs()
    
    // 3. Load steering files (.kiro/steering/*.md) and hooks (.kiro/hooks/)
    const steering = await this.loadSteeringFiles()
    
    // 4. Extract package.json dependencies
    const dependencies = await this.extractDependencies()
    
    // 5. Apply context capping if needed
    return this.applyContextCapping(assembledContext, context)
  }
}
```

#### Context Capping Algorithm

When context exceeds backend's `maxContextWindow`:

1. Calculate token count: `chars / charsPerToken` (default 4)
2. Build removable list ordered by relevance ranking
3. Remove files in order: Architecture docs first, then design.md
4. Sort by: relevance score (lower = keep), then size (larger = remove first)
5. Stop when context fits or throw if irreducible

```
Relevance Ranking (lower index = higher priority):
["requirements.md", "design.md", "tasks.md", "ARCHITECTURE.md", ".cursorrules", "package.json"]

Files NOT in ranking are removed FIRST.
Within same relevance, LARGER files removed first.
```

#### Output: `AssembledContext`

```typescript
interface AssembledContext {
  featureName: string
  designDoc?: ParsedMarkdown      // From design.md
  techSpec?: ParsedMarkdown       // From requirements.md
  taskList?: TaskItem[]           // From tasks.md
  architectureDocs: Record<string, ParsedMarkdown>
  dependencies: Record<string, string>
  removedFiles: string[]          // Files culled by context capping
}
```

---

### Phase 2: Validation (Spec Validation)

**Agent:** `SpecValidatorAgent`  
**Purpose:** Check spec completeness and feasibility

#### What Gets Validated

1. **API Contracts**: Undefined request/response schemas
2. **Database Schemas**: Missing model definitions
3. **Error Handling**: No error cases specified
4. **Architecture Contradictions**: Conflicting patterns

#### Technical Implementation

```typescript
// File: src/agents/spec-validator.ts

class SpecValidatorAgent {
  async execute(context: AgentContext): Promise<AgentResult> {
    const issues: ValidationIssue[] = []
    
    // Check for API contracts in design.md
    if (!this.hasApiContracts(context.phaseOutputs.intake.designDoc)) {
      issues.push({
        type: 'api-contract',
        severity: 'warning',
        description: 'No API contracts defined'
      })
    }
    
    // Check for DB schemas in design.md
    if (!this.hasDbSchemas(context.phaseOutputs.intake.techSpec)) {
      issues.push({
        type: 'db-schema',
        severity: 'warning',
        description: 'No database schemas defined'
      })
    }
    
    return {
      approved: issues.filter(i => i.severity === 'error').length === 0,
      issues,
      suggestedFixes: this.generateFixes(issues)
    }
  }
}
```

#### Output: `ValidationReport`

```typescript
interface ValidationReport {
  approved: boolean
  issues: Array<{
    type: 'api-contract' | 'db-schema' | 'error-handling' | 'contradiction'
    severity: 'error' | 'warning'
    description: string
    suggestion?: string
    location?: string
  }>
  suggestedFixes: string[]
}
```

#### Failure Policy

- **Warnings**: Pipeline continues
- **Errors**: Pipeline HALTS (validation failures are non-retryable)

---

### Phase 3: Architecture Analysis

**Agent:** `ArchitectureGuardianAgent` (analysis mode)  
**Purpose:** Map spec requirements to codebase, identify patterns

#### What Happens

1. **Load ADRs**: Parse Architecture Decision Records
2. **Identify Patterns**: Detect existing architectural patterns
3. **Map Module Boundaries**: Understand codebase structure
4. **Detect Violations**: Find potential conflicts with spec

#### Technical Implementation

```typescript
// File: src/agents/architecture-guardian.ts

class ArchitectureGuardianAgent {
  constructor(private mode: 'architecture-analysis' | 'architecture-review') {}
  
  async execute(context: AgentContext): Promise<AgentResult> {
    if (this.mode === 'architecture-analysis') {
      // Phase 3: Analysis
      return this.analyzeArchitecture(context)
    } else {
      // Phase 5: Review (see later)
      return this.reviewArchitecture(context)
    }
  }
  
  private async analyzeArchitecture(context: AgentContext) {
    const patterns = await this.identifyPatterns(context.worktreePath)
    const boundaries = await this.mapModuleBoundaries(context.worktreePath)
    const adrs = await this.loadADRs(context.worktreePath)
    
    return {
      patterns,
      moduleBoundaries,
      adrs,
      adrsFound: Object.keys(adrs).length,
      potentialViolations: this.detectViolations(patterns, context.spec)
    }
  }
}
```

#### Output: `ArchitectureContext`

```typescript
interface ArchitectureContext {
  patterns: Array<{
    name: string
    description: string
    applicableFiles: string[]
    constraints: string[]
  }>
  moduleBoundaries: Array<{
    module: string
    boundaries: string[]
    violations: string[]
  }>
  adrs: Record<string, ParsedMarkdown>
  adrsFound: number
  potentialViolations: string[]
}
```

---

### Phase 4: Implementation

**Agent:** `ExecutorAgent`  
**Purpose:** Generate code changes via AI backend

#### This is the Core Code Generation Phase

```typescript
// File: src/agents/executor.ts

class ExecutorAgent {
  async execute(context: AgentContext): Promise<AgentResult> {
    // 1. Validate prerequisite phases completed
    this.validateIntakeContext(context)
    this.validateValidationContext(context)
    this.validateArchitectureContext(context)
    
    // 2. Select backend (context-aware or default)
    const backend = this.selectBackend(context)
    
    // 3. Build request with all context
    const request: BackendRequest = {
      id: context.runId,
      context,
      phase: 'implementation',
      streamProgress: true
    }
    
    // 4. Self-correction retry loop (up to 4 attempts: 1 initial + 3 retries)
    const MAX_SELF_CORRECTION_RETRIES = 3
    let selfCorrectionAttempts = 0
    let lastError: string | undefined

    while (selfCorrectionAttempts <= MAX_SELF_CORRECTION_RETRIES) {
      try {
        const result = await this.executeAttempt(context, lastError, startTime)

        if (result.success) {
          if (result.output) {
            (result.output as ImplementationResult).selfCorrectionAttempts = selfCorrectionAttempts
          }
          return result
        }

        // Failed - retry with error context
        lastError = result.error?.message ?? 'Unknown error'
        selfCorrectionAttempts++

      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        selfCorrectionAttempts++
      }
    }

    // All retries exhausted (4 attempts total)
    return {
      success: false,
      error: {
        message: `Implementation failed after ${MAX_SELF_CORRECTION_RETRIES + 1} attempts. Last error: ${lastError}`,
        retryable: true,
        data: { selfCorrectionAttempts, lastError }
      }
    }
  }
}
```

#### Backend Selection Logic

```
if (context.preferredBackend is set):
    use preferredBackend (supplied by error handler on retry)
else if (strategy == 'context-aware'):
    find cheapest backend where maxContextWindow >= estimated context size
else:
    use defaultBackend
```

> **Note:** Phase-level `phaseBackends` overrides are resolved by `BackendRegistry.selectBackendForPhase()` (called by the Orchestrator during `executePhase()`), allowing different backends for different phases.

#### MCP Tools Integration

During Implementation phase only:
1. MCP client lists available tools from configured MCP servers
2. Tools are injected into `AgentContext.mcpTools`
3. Backend can invoke tools via MCP protocol
4. Other phases do NOT receive MCP tools (security isolation)

#### Output: `ImplementationResult`

```typescript
interface ImplementationResult {
  modifiedFiles: string[]     // Files changed in worktree
  addedTests: string[]        // New test files created
  duration: number            // Time taken in ms
  backend: string             // Which backend was used
  selfCorrectionAttempts: number
}
```

---

### Phase 5: Architecture Review

**Agent:** `ArchitectureGuardianAgent` (review mode)  
**Purpose:** Review modified files against architectural patterns

#### What Gets Reviewed

1. **Pattern Compliance**: Do changes follow identified patterns?
2. **Import Boundaries**: Are imports respecting module boundaries?
3. **Naming Conventions**: Do names match project standards?
4. **State Management**: Is state handled consistently?

#### Technical Implementation

```typescript
// Same ArchitectureGuardianAgent, different mode

private async reviewArchitecture(context: AgentContext): Promise<AgentResult> {
  const implementation = context.phaseOutputs['implementation'] as ImplementationResult
  const architecture = context.phaseOutputs['architecture-analysis'] as ArchitectureContext
  
  const violations: ArchitectureViolation[] = []
  
  for (const file of implementation.modifiedFiles) {
    const content = await fs.readFile(join(context.worktreePath!, file), 'utf-8')
    
    // Check against each pattern
    for (const pattern of architecture.patterns) {
      if (!this.matchesPattern(content, pattern)) {
        violations.push({
          file,
          pattern: pattern.name,
          issue: `Does not follow ${pattern.name} pattern`,
          suggestion: pattern.constraints[0]
        })
      }
    }
    
    // Check import boundaries
    const imports = this.extractImports(content)
    for (const imp of imports) {
      if (this.violatesBoundary(imp, architecture.moduleBoundaries)) {
        violations.push({
          file,
          pattern: 'module-boundary',
          issue: `Import violates module boundary: ${imp}`,
          suggestion: 'Use public API exports only'
        })
      }
    }
  }
  
  return {
    approved: violations.length === 0 || violations.every(v => v.severity !== 'error'),
    violations,
    modifiedFiles: implementation.modifiedFiles
  }
}
```

#### Failure Policy: LOOPBACK

If architecture review fails:
1. Pipeline loops back to Phase 4 (Implementation)
2. Architecture context is passed with violations highlighted
3. Backend retries with architectural guidance
4. Max 2 loopbacks before escalation

#### Output: `ArchitectureReview`

```typescript
interface ArchitectureReview {
  approved: boolean
  violations: Array<{
    file: string
    pattern: string
    issue: string
    suggestion: string
  }>
  modifiedFiles: string[]
}
```

---

### Phase 6: Test & Verification

**Agent:** `TestEngineerAgent`  
**Purpose:** Generate tests and run test suite

#### What Happens

1. **Generate Test Stubs**: For modified files lacking tests
2. **Run Test Suite**: `npm test` in the worktree
3. **Collect Coverage**: Parse coverage report
4. **Report Results**: Pass/fail with details

#### Technical Implementation

```typescript
// File: src/agents/test-engineer.ts

class TestEngineerAgent {
  async execute(context: AgentContext): Promise<AgentResult> {
    const implementation = context.phaseOutputs['implementation'] as ImplementationResult
    
    // 1. Generate test stubs for modified files
    const generatedTests: string[] = []
    for (const file of implementation.modifiedFiles) {
      if (!this.hasCorrespondingTest(file)) {
        const testFile = await this.generateTestStub(file, context.worktreePath!)
        generatedTests.push(testFile)
      }
    }
    
    // 2. Run test suite
    const testResult = await this.runTests(context.worktreePath!)
    
    // 3. Collect coverage
    const coverage = await this.parseCoverage(context.worktreePath!, implementation.modifiedFiles)
    
    return {
      passed: testResult.exitCode === 0,
      testsRun: testResult.testsRun,
      testFailures: testResult.failures,
      coverage,
      duration: testResult.duration,
      generatedTests
    }
  }
  
  private async runTests(worktreePath: string): Promise<TestRunResult> {
    // Spawn npm test process
    const proc = spawn('npm', ['test'], { cwd: worktreePath })
    
    // Parse Vitest/Jest output
    // Look for: "Test Files  15 passed (15)"
    // Look for: "Tests  45 passed (45)"
    
    return parseTestOutput(proc)
  }
}
```

#### Failure Policy: LOOPBACK

If tests fail:
1. Pipeline loops back to Phase 4 (Implementation)
2. Test failures are passed as context
3. Backend fixes the failing tests
4. Max 2 loopbacks before escalation

#### Output: `TestReport`

```typescript
interface TestReport {
  passed: boolean
  coverage: number              // Line coverage percentage
  testFailures: Array<{
    test: string
    error: string
    stack?: string
  }>
  testsRun: number
  duration: number
  generatedTests?: string[]
}
```

---

### Phase 7: UI/UX Validation

**Agent:** `UIValidatorAgent`  
**Purpose:** Visual regression testing (skips automatically for non-UI specs)

#### What Happens

1. **Detect UI Spec**: Check if spec affects UI components
2. **Identify Routes**: Extract affected routes from spec
3. **Capture Screenshots**: Use Playwright
4. **Diff Against Baselines**: Compare with stored baselines
5. **AI Review**: Check visual consistency, responsive behavior, accessibility

#### Technical Implementation

```typescript
// File: src/agents/ui-validator.ts

class UIValidatorAgent {
  async execute(context: AgentContext): Promise<AgentResult> {
    // Auto-skip if not a UI spec
    if (!this.isUISpec(context.spec)) {
      return {
        success: true,
        output: { approved: true, screenshots: [], uiIssues: [], skipped: true }
      }
    }
    
    const routes = this.identifyRoutes(context.spec)
    const screenshots: ScreenshotInfo[] = []
    
    // Launch Playwright
    const browser = await playwright.chromium.launch()
    
    for (const route of routes) {
      const page = await browser.newPage({
        viewport: context.config.uiBaseline.viewport
      })
      
      await page.goto(route)
      const screenshotPath = await this.captureScreenshot(page, route)
      
      // Diff against baseline if exists
      const baselinePath = this.getBaselinePath(route)
      if (existsSync(baselinePath)) {
        const diffResult = await this.diffScreenshots(screenshotPath, baselinePath)
        
        if (diffResult.diffPercentage > context.config.uiBaseline.diffThreshold) {
          uiIssues.push({
            type: 'visual',
            description: `Visual difference: ${diffResult.diffPercentage}%`,
            severity: 'medium'
          })
        }
      } else {
        // No baseline - create one
        await this.updateBaselines([screenshotPath])
      }
      
      screenshots.push({
        route,
        path: screenshotPath,
        baseline: baselinePath,
        diff: diffResult.diffPath,
        diffPercentage: diffResult.diffPercentage
      })
    }
    
    await browser.close()
    
    // AI review of screenshots (if backend available)
    const aiReview = await this.aiReviewScreenshots(screenshots, context)
    
    return {
      approved: uiIssues.length === 0,
      screenshots,
      uiIssues: [...uiIssues, ...aiReview.issues]
    }
  }
}
```

#### Output: `UIReview`

```typescript
interface UIReview {
  approved: boolean
  screenshots: Array<{
    route: string
    path: string
    baseline?: string
    diff?: string
    diffPercentage?: number
  }>
  uiIssues: Array<{
    type: 'visual' | 'responsive' | 'accessibility' | 'consistency'
    description: string
    component?: string
    severity: 'high' | 'medium' | 'low'
  }>
  skipped?: boolean
}
```

---

### Phase 8: Review & Delivery

**Two agents run in sequence:**
1. **Review Council**: Multi-perspective code review
2. **Delivery**: Create branch, commits, and PR

#### 8a: Review Council

**Agent:** `ReviewCouncilAgent`  
**Purpose:** Multi-perspective code review with consensus

```typescript
// File: src/agents/review-council.ts

class ReviewCouncilAgent {
  async execute(context: AgentContext): Promise<AgentResult> {
    const config = context.config.reviewCouncil
    
    // Build reviewer list
    const reviewers = config.reviewers ?? 
      config.perspectives.map(p => ({ role: p }))
    
    let round = 0
    let consensus: ConsensusResult | null = null
    
    while (round < config.maxReviewRounds) {
      round++
      
      // Run reviews (parallel or sequential)
      const votes = config.enableParallelReview
        ? await Promise.all(reviewers.map(r => this.runReviewer(r, context)))
        : await this.runReviewersSequential(reviewers, context)
      
      // Calculate consensus
      consensus = this.calculateConsensus(votes)
      
      if (consensus.result === 'passed') {
        break
      }
      
      // If rejected, loopback to implementation with feedback
      if (consensus.result === 'rejected' && round < config.maxReviewRounds) {
        // Continue to next round
      }
    }
    
    return {
      consensus: consensus.result,  // 'passed' | 'passed-with-warnings' | 'rejected'
      votes: consensus.votes,
      rounds: round,
      cost: this.calculateCost(reviewers, round)
    }
  }
  
  private calculateConsensus(votes: ReviewVote[]): ConsensusResult {
    const total = votes.length
    const approved = votes.filter(v => v.approved).length
    
    // All approve = passed
    if (approved === total) {
      return { result: 'passed', votes }
    }
    
    // ≥ 2/3 approve = passed-with-warnings
    if (approved >= Math.max(1, Math.floor(total * 2 / 3))) {
      return { result: 'passed-with-warnings', votes }
    }
    
    // Otherwise rejected
    return { result: 'rejected', votes }
  }
}
```

**Per-Reviewer Backend Selection:**
```
1. reviewer.backend if specified
2. phaseBackends['review-delivery'] if specified
3. defaultBackend
```

#### Output: `ReviewCouncilResult`

```typescript
interface ReviewCouncilResult {
  consensus: 'passed' | 'passed-with-warnings' | 'rejected'
  votes: Array<{
    perspective: string
    approved: boolean
    feedback: string
    severity: 'high' | 'medium' | 'low'
  }>
  rounds: number
  cost: number
}
```

#### 8b: Delivery

**Agent:** `DeliveryAgent`  
**Purpose:** Create feature branch, conventional commits, and PR

```typescript
// File: src/agents/delivery.ts

class DeliveryAgent {
  async execute(context: AgentContext): Promise<AgentResult> {
    // 1. Create feature branch
    const branchName = await this.createFeatureBranch(
      context.worktreePath!,
      context.spec
    )
    // Format: kaso/[feature-name]-delivery-[YYYYMMDDTHHmmss]
    
    // 2. Analyze and categorize changes
    const commitGroups = this.analyzeChanges(implementation.modifiedFiles)
    // Categories: feat, test, docs, chore, refactor, fix, style, perf
    
    // 3. Create conventional commits
    const commits: string[] = []
    for (const group of commitGroups) {
      const message = this.buildConventionalCommitMessage(group)
      // Format: type(scope): description
      // Example: feat(auth): add JWT authentication endpoints
      
      const sha = await this.createCommit(context.worktreePath!, message)
      commits.push(sha)
    }
    
    // 4. Push branch
    await this.pushBranch(context.worktreePath!, branchName)
    
    // 5. Create PR via GitHub CLI
    const prResult = await this.createPullRequest(context, branchName)
    
    // 6. Append execution summary to spec directory
    await this.appendExecutionSummary(context, branchName, commits, prResult)
    
    return {
      branch: branchName,
      commits,
      prUrl: prResult.prUrl,
      summary: this.buildSummary(context, branchName, commits, prResult)
    }
  }
}
```

#### Conventional Commit Format

```
<type>[(<scope>)][!]: <description>

[body]

[footer]

Types:
- feat: New feature
- fix: Bug fix
- refactor: Code change that neither fixes nor adds
- test: Adding or correcting tests
- docs: Documentation only
- chore: Build process or auxiliary tool changes
- style: Formatting changes
- perf: Performance improvements
- ci: CI/CD changes
- build: Build system changes
```

#### Output: `DeliveryResult`

```typescript
interface DeliveryResult {
  branch: string               // e.g., "kaso/user-auth-delivery-20240115T103000"
  commits: string[]            // Commit SHAs
  prUrl?: string               // GitHub PR URL
  summary: string              // Human-readable summary
}
```

---

## Error Handling & Recovery

### Phase Failure Policies

| Phase | Failure Policy | Max Retries | Can Loopback |
|-------|---------------|-------------|--------------|
| Intake | HALT | 0 | No |
| Validation | HALT | 0 | No |
| Architecture Analysis | HALT | 0 | No |
| Implementation | RETRY | 2 | Yes (target) |
| Architecture Review | LOOPBACK | 1 | Yes |
| Test Verification | LOOPBACK | 2 | Yes |
| UI Validation | RETRY | 1 | No |
| Review & Delivery | HALT | 1 | No |

**Note:** LOOPBACK phases jump to Implementation (P4) on failure, allowing the AI to fix issues. Max loopbacks: 2 per phase before escalation.

### Error Classification

```typescript
type ErrorSeverity = 
  | 'transient'      // Network timeout - retry immediately
  | 'recoverable'    // Context too large - retry with reduced context
  | 'security'       // Security concern - escalate immediately
  | 'architectural'  // Pattern violation - loopback or escalate
  | 'fatal'          // Unknown - halt
```

### Retry Escalation Strategy

When a phase fails:

```
Attempt 1: Default context, default backend
    ↓ (failure)
Attempt 2: Reduced context (if context error), same backend
    ↓ (failure)
Attempt 3: Alternative backend (if configured), reduced context
    ↓ (failure)
Result: Escalate or Halt
```

### Checkpoint & Recovery

After each phase completes, the orchestrator:

1. **Saves checkpoint**: Full run state to SQLite
2. **Updates spec status**: Writes to `status.json` in spec directory
3. **Appends execution log**: To `execution-log.md`

On startup, KASO automatically:

```typescript
async recoverInterruptedRuns(): Promise<string[]> {
  // 1. Find non-terminal runs from database
  const interrupted = this.executionStore.getInterruptedRuns()
  
  for (const run of interrupted) {
    // 2. Verify worktree still exists
    if (!this.worktreeManager.exists(run.runId)) {
      markFailed(run.runId)
      continue
    }
    
    // 3. Check worktree consistency
    if (!await this.worktreeManager.isConsistent(run.runId)) {
      markFailed(run.runId)
      continue
    }
    
    // 4. Resume from last completed phase
    await this.resumeRun(run.runId)
  }
}
```

---

## Observability & Monitoring

### Event Bus System

All significant events are emitted via the EventBus:

```typescript
type EventType =
  // Phase lifecycle
  | 'phase:started'
  | 'phase:completed'
  | 'phase:failed'
  | 'phase:timeout'
  
  // Run lifecycle
  | 'run:started'
  | 'run:paused'
  | 'run:resumed'
  | 'run:completed'
  | 'run:failed'
  | 'run:cancelled'
  | 'run:budget_exceeded'
  | 'run:escalated'
  
  // Agent events
  | 'agent:progress'
  | 'agent:backend-selected'
  | 'agent:error'
  
  // Resource events
  | 'concurrency:acquired'
  | 'concurrency:released'
  | 'worktree:created'
```

### CLI Status Commands

```bash
# Show active runs
kaso status

# Show specific run details
kaso status <run-id>

# View run history
kaso history --limit 20

# Stream logs
kaso logs <run-id> [--phase implementation] [--follow]

# Cost breakdown
kaso cost <run-id>
kaso cost --history
```

### SSE Streaming (Optional)

If enabled in config, KASO starts an SSE server:

```bash
# Connect to event stream
curl http://localhost:3001/events?runId=<run-id>

# With authentication
curl -H "Authorization: Bearer <token>" http://localhost:3001/events
```

### Webhook Integration

```json
{
  "webhooks": [{
    "url": "https://hooks.example.com/kaso",
    "events": ["run:completed", "run:failed"],
    "secret": "${WEBHOOK_SECRET}"
  }]
}
```

Payloads include:
- Event type and timestamp
- Run ID and spec path
- Current phase and status
- Cost information
- HMAC-SHA256 signature (if secret configured)

---

## Resource Management

### Concurrency Control

```typescript
class ConcurrencyManager {
  private slots: number = Math.max(1, cpus().length - 1)  // Default (min 1)
  private queue: Array<QueuedRequest> = []
  
  async acquire(runId: string, phase: PhaseName): Promise<ConcurrencySlot> {
    if (this.activeSlots < this.maxSlots) {
      return this.allocateSlot(runId, phase)
    }
    
    // Queue the request
    return new Promise((resolve) => {
      this.queue.push({ runId, phase, resolve })
      this.emit('concurrency:queued', { runId, phase })
    })
  }
}
```

### Cost Tracking

```typescript
class CostTracker {
  recordInvocation(
    runId: string,
    backendName: string,
    tokensUsed: number,
    costPer1000Tokens: number
  ) {
    const cost = (tokensUsed / 1000) * costPer1000Tokens
    
    // Store per-run cost
    this.runCosts[runId].totalCost += cost
    this.runCosts[runId].backendCosts[backendName] += cost
    
    // Check budget
    if (this.config.costBudgetPerRun && 
        this.runCosts[runId].totalCost > this.config.costBudgetPerRun) {
      emit('run:budget_exceeded', { runId, cost })
    }
  }
}
```

---

## Security Model

### Worktree Isolation

```
Main Repository          KASO Worktree (.kaso/worktrees/)
┌─────────────┐          ┌──────────────────────────────┐
│  src/       │          │  src/  ← modified here       │
│  tests/     │          │  tests/                      │
│  .git/      │◄─────────│  .git/ (linked worktree)     │
│             │          │                              │
└─────────────┘          └──────────────────────────────┘
      │
      └── Original files NEVER modified during KASO runs
```

### Credential Handling

```typescript
class CredentialManager {
  async getApiKey(keyName: string): Promise<string | null> {
    // 1. Check environment variable first
    const envValue = process.env[keyName]
    if (envValue) return envValue
    
    // 2. Fall back to OS keychain (via keytar)
    return await keytar.getPassword(this.serviceName, keyName)
  }
}
```

Secrets are NEVER:
- Read from git-tracked files
- Logged to console (redacted via LogRedactor)
- Sent in webhook payloads (redacted)

### MCP Tool Isolation

MCP tools are ONLY available during:
- ✅ Phase 4: Implementation

MCP tools are NOT available during:
- ❌ Phase 1-3: Spec analysis
- ❌ Phase 5-8: Review and delivery

This prevents tool misuse during evaluation phases.

---

## Complete Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              INPUT SIDE                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  User creates:                    KASO reads:                               │
│  ┌────────────────┐               ┌────────────────┐                        │
│  │ .kiro/specs/   │──────────────▶│ SpecReaderAgent│                        │
│  │ ├── requirements.md│          └────────┬───────┘                        │
│  │ ├── design.md  │                        │                               │
│  │ └── tasks.md   │                         ▼                               │
│  └────────────────┘               ┌────────────────┐                        │
│                                   │ AssembledContext                        │
│  User configures:                 │  ├─ designDoc                             │
│  ┌────────────────┐               │  ├─ techSpec                              │
│  │kaso.config.json│──────────────▶│  ├─ taskList                              │
│  │  - backends    │               │  ├─ architectureDocs                      │
│  │  - timeouts    │               │  └─ dependencies                          │
│  │  - budgets     │               └────────────────┘                        │
│  └────────────────┘                                                         │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                          PROCESSING PIPELINE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Phase 1-3: Context Building        Phase 4-5: Code Generation              │
│  ┌──────────────────────┐          ┌──────────────────────┐                 │
│  │ 1. Intake            │          │ 4. Implementation    │                 │
│  │    Parse specs       │─────────▶│    AI generates code │                 │
│  │ 2. Validation        │          │ 5. Architecture Rev  │                 │
│  │    Check feasibility │          │    Pattern compliance│                 │
│  │ 3. Arch Analysis     │          │    ↺ Loopback if fail│                 │
│  │    Load patterns     │          └──────────────────────┘                 │
│  └──────────────────────┘                                                   │
│                                                                             │
│  Phase 6-8: Quality Gates & Delivery                                        │
│  ┌──────────────────────┐          ┌──────────────────────┐                 │
│  │ 6. Test Engineer     │          │ 7. UI Validator      │                 │
│  │    Run test suite    │─────────▶│    Visual regression │                 │
│  │    ↺ Loopback if fail│          │    (skip if non-UI)  │                 │
│  └──────────────────────┘          └──────────┬───────────┘                 │
│                                               │                             │
│                                               ▼                             │
│                              ┌──────────────────────┐                       │
│                              │ 8a. Review Council   │                       │
│                              │    Multi-perspective │                       │
│                              │    code review       │                       │
│                              └──────────┬───────────┘                       │
│                                         │                                   │
│                                         ▼                                   │
│                              ┌──────────────────────┐                       │
│                              │ 8b. Delivery         │                       │
│                              │    Branch + Commits  │                       │
│                              │    + Pull Request    │                       │
│                              └──────────────────────┘                       │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                             OUTPUT SIDE                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Git Worktree Changes:            Spec Directory Updates:                   │
│  ┌─────────────────────────┐      ┌─────────────────────────┐               │
│  │ .kaso/worktrees/        │      │ .kiro/specs/my-feature/ │               │
│  │ └── feature-xyz/        │      │ ├── execution-log.md    │               │
│  │     ├── src/            │      │ ├── execution-summary.md│               │
│  │     │   └── (changes)   │      │ └── status.json         │               │
│  │     └── (test changes)  │      └─────────────────────────┘               │
│  └─────────────────────────┘                                                │
│                                                                             │
│  Pull Request Created:                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Title: feat: User Authentication API                                │    │
│  │ Branch: kaso/user-auth-delivery-20240115T103000                    │    │
│  │ Commits:                                                            │    │
│  │   - feat(auth): add JWT authentication endpoints                    │    │
│  │   - test(auth): add unit tests for token service                    │    │
│  │   - docs(auth): add API documentation                               │    │
│  │ Body: Includes test results, review council outcome, coverage %     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  Database Records:                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ execution_store.db                                                  │    │
│  │ ├── runs table: run_id, status, cost, timestamps                    │    │
│  │ ├── phase_results: per-phase results with output                    │    │
│  │ └── checkpoints: recovery data                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary: What Happens When You Run KASO

1. **User runs** `kaso start .kiro/specs/my-feature`
2. **Orchestrator** generates a runId and creates a git worktree
3. **Phase 1** reads and parses all spec files
4. **Phase 2** validates the spec for completeness
5. **Phase 3** analyzes codebase architecture and patterns
6. **Phase 4** calls AI backend to generate code changes
7. **Phase 5** reviews changes against architectural patterns
8. **Phase 6** runs tests and collects coverage
9. **Phase 7** performs visual regression testing (if UI)
10. **Phase 8a** runs multi-perspective code review
11. **Phase 8b** creates branch, conventional commits, and PR
12. **Cleanup** removes worktree (unless retained for debugging)

Throughout this process:
- **Events** are emitted for real-time monitoring
- **Checkpoints** are saved for crash recovery
- **Costs** are tracked against budget limits
- **Logs** are written to the spec directory
- **Status** is updated in real-time

The user's original working directory is **never modified** — all changes happen in isolated git worktrees.
