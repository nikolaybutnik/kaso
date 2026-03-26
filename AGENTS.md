# KASO — Kiro-Enabled Agent Swarm Orchestrator

## Project Overview

KASO is a TypeScript-based, locally-run modular orchestration system that reads Kiro-generated specification documents and coordinates specialized AI agents through an 8-phase development lifecycle. It automates the pipeline from spec intake to PR delivery with minimal human intervention.

### Design Goals
- Deterministic, sequential 8-phase pipeline with clear phase boundaries
- Stateless agents communicating exclusively through structured context objects
- Composition over inheritance with pure functions wherever possible
- Pluggable backends and extensible agent types via a plugin system
- Resource-conscious execution with configurable concurrency limits and cost budgets
- Real-time observability via event streaming and persisted execution history
- Crash-resilient execution with write-ahead checkpointing and automatic recovery
- Full CLI interface for controlling and inspecting all orchestration operations

### Current Status

The project has 38 source files across 69 test files with 1053 passing tests including comprehensive property-based tests.

- **Phase 1 (Infrastructure & Configuration)**: ✅ Complete
- **Phase 2 (Core Orchestration)**: ✅ Complete
- **Phase 3 (Remaining Agents & CLI)**: ✅ Complete
- **Phase 4 (Extensibility)**: ✅ Complete
- **Phase 5 (Integration)**: ✅ Complete
- **Phase 6 (Wiring & Final Integration)**: ✅ Complete

## Technology Stack

| Component | Technology |
|-----------|------------|
| Language | TypeScript 5.3+ (Node.js 18+) |
| Module System | ESNext with `@/` path aliases |
| Testing | Vitest 1.1+ with @fast-check/vitest for property-based testing |
| Database | SQLite (via better-sqlite3) with JSONL fallback |
| Git Operations | simple-git |
| Credentials | keytar for OS keychain integration |
| File Watching | chokidar |
| UI Testing | Playwright |
| CLI | Commander.js |
| Configuration | Zod for runtime schema validation |
| Build | esbuild (bundled ESM output) |

## Build and Test Commands

```bash
# Compile TypeScript
npm run build

# Run all tests (single execution)
npm test

# Run tests in watch mode
npm run test:watch

# Run property-based tests only
npm run test:property

# Run integration tests
npm run test:integration

# Generate coverage report
npm run test:coverage
```

## Project Structure

```
src/
├── agents/              # Agent implementations (10 files)
│   ├── agent-interface.ts
│   ├── agent-registry.ts
│   ├── architecture-guardian.ts
│   ├── delivery.ts
│   ├── executor.ts
│   ├── review-council.ts
│   ├── spec-reader.ts
│   ├── spec-validator.ts
│   ├── test-engineer.ts
│   └── ui-validator.ts
├── backends/            # Executor backend adapters (3 files)
│   ├── backend-adapter.ts
│   ├── backend-process.ts
│   └── backend-registry.ts
├── cli/                 # CLI interface (2 files)
│   ├── commands.ts
│   └── index.ts
├── config/              # Configuration loading & validation (2 files)
│   ├── loader.ts
│   └── schema.ts
├── core/                # Core orchestration logic (7 files)
│   ├── concurrency-manager.ts
│   ├── error-handler.ts
│   ├── event-bus.ts
│   ├── markdown-parser.ts
│   ├── orchestrator.ts
│   ├── state-machine.ts
│   └── types.ts
├── infrastructure/      # Core services (10 files)
│   ├── checkpoint-manager.ts
│   ├── cost-tracker.ts
│   ├── credential-manager.ts
│   ├── execution-store.ts
│   ├── file-watcher.ts
│   ├── log-redactor.ts
│   ├── mcp-client.ts
│   ├── spec-writer.ts
│   ├── webhook-dispatcher.ts
│   └── worktree-manager.ts
├── plugins/             # Plugin system (2 files)
│   ├── plugin-loader.ts         # npm package discovery and loading
│   └── phase-injector.ts        # Custom phase insertion logic
└── streaming/           # Event streaming (1 file)
    └── sse-server.ts

tests/
├── agents/              # 10 test files
├── backends/            # 2 test files
├── cli/                 # 1 test file
├── config/              # 1 test file
├── core/                # 3 test files
├── e2e/                 # 10 test files (tier1–tier4 + helper unit tests)
│   └── helpers/         # Shared test utilities (harness, mock-backend, mock-project, etc.)
├── infrastructure/      # 10 test files
├── integration/         # 5 test files
├── plugins/             # 2 test files
├── property/            # 24 property-based test files
└── streaming/           # 1 test file
```

## Architecture

### Hub-and-Spoke Design

- **Central Orchestrator** (`src/core/orchestrator.ts`): Coordinates all agent execution through the 8-phase pipeline. Wires together the state machine, event bus, agent registry, execution store, checkpoint manager, worktree manager, cost tracker, and concurrency manager.
- **Specialized Agents**: Stateless, single-responsibility workers implementing the `Agent` interface.
- **Pluggable Executor Backends**: Swappable AI coding tools communicating via NDJSON over stdio.
- **Infrastructure Layer**: Persistence, security, checkpointing, and cost tracking services.

### 8-Phase Execution Pipeline

1. **Intake** (`spec-reader`): Parse Kiro spec files, load architecture docs, steering files, and assemble execution context with optional context capping.
2. **Validation** (`spec-validator`): Check for undefined API contracts, missing DB schemas, missing error handling, and architecture contradictions.
3. **Architecture Analysis** (`architecture-guardian`): Map spec requirements to codebase modules, load ADRs, identify patterns and potential violations.
4. **Implementation** (`executor`): Generate code changes via AI backend with self-correction retry loop (up to 3 internal retries).
5. **Architecture Review** (`architecture-guardian`): Review modified files against architectural patterns, import boundaries, naming conventions, and state management.
6. **Test & Verification** (`test-engineer`): Generate test stubs for modified files, run full test suite in worktree, collect coverage data.
7. **UI/UX Validation** (`ui-validator`): Visual regression testing via Playwright screenshot capture, baseline diffing, and AI-based review for visual consistency, responsive behavior, and accessibility. Skips automatically for non-UI specs.
8. **Review & Delivery** (`review-council`, `delivery`): Multi-perspective code review with consensus logic, conventional commits, and automated PR creation.

---

## Module Reference

### `src/core/types.ts`

All domain type definitions for the system.

| Export | Kind | Description |
|--------|------|-------------|
| `PhaseName` | Type | Union of 8 pipeline phase names plus `custom-${string}` |
| `RunStatus` | Type | `'pending' \| 'running' \| 'paused' \| 'completed' \| 'failed' \| 'cancelled'` |
| `EventType` | Type | 20 event types for the pub/sub system |
| `BackendProtocol` | Type | `'cli-stdout' \| 'cli-json' \| 'acp' \| 'mcp'` |
| `ExecutionEvent` | Interface | Event payload with type, runId, timestamp, optional phase/agent/data |
| `PhaseTransition` | Interface | Records from/to phase, timestamp, and trigger reason |
| `PhaseResult` | Interface | Phase execution result with status, output, error, timing |
| `PhaseResultRecord` | Interface | Persisted PhaseResult with runId and sequence number |
| `ExecutionRunStatus` | Interface | Run status snapshot with current phase, cost, timing |
| `ExecutionRunRecord` | Interface | Full run record with phase results and logs |
| `ParsedSpec` | Interface | Structured spec data from Kiro files |
| `ParsedMarkdown` | Interface | Parsed markdown with sections, code blocks, metadata |
| `MarkdownSection` | Interface | Hierarchical markdown section with children |
| `CodeBlock` | Interface | Code block with language, content, line number |
| `TaskItem` | Interface | Checkbox task with id, title, status, children |
| `SteeringFiles` | Interface | Loaded steering file contents |
| `AgentContext` | Interface | Main context object passed to all agents |
| `AgentResult` | Interface | Agent execution result with success, output, error, tokens |
| `AgentError` | Interface | Structured error with message, code, retryable flag |
| `LogEntry` | Interface | Timestamped log entry with level and source |
| `PhaseOutput` | Interface | Generic phase output (base for specific types) |
| `AssembledContext` | Interface | Phase 1 output — assembled spec context |
| `ValidationReport` | Interface | Phase 2 output — validation issues and fixes |
| `ArchitectureContext` | Interface | Phase 3 output — patterns, boundaries, ADRs |
| `ImplementationResult` | Interface | Phase 4 output — modified files, tests, duration |
| `ArchitectureReview` | Interface | Phase 5 output — violations in modified files |
| `TestReport` | Interface | Phase 6 output — test results and coverage |
| `UIReview` | Interface | Phase 7 output — screenshots and UI issues |
| `ReviewCouncilResult` | Interface | Phase 8 output — consensus votes |
| `DeliveryResult` | Interface | Phase 8 output — branch, commits, PR URL |
| `BackendRequest` | Interface | Request payload sent to executor backends |
| `BackendResponse` | Interface | Response from executor backends |
| `BackendProgressEvent` | Interface | NDJSON progress event from backends |
| `WorktreeInfo` | Interface | Git worktree path, branch, and runId |

### `src/core/orchestrator.ts`

Central hub that wires all components and drives the 8-phase pipeline.

| Export | Kind | Description |
|--------|------|-------------|
| `Orchestrator` | Class | Main orchestrator — `startRun`, `pauseRun`, `resumeRun`, `cancelRun`, `queueSpecUpdate`, `recoverInterruptedRuns`, `getRunStatus`, `listActiveRuns` |
| `StartRunOptions` | Interface | Options for `startRun` — specPath, baseBranch |
| `RunStatusResponse` | Interface | Status response with phase, cost, timing |

Key behaviors:
- Creates a git worktree per run, executes phases sequentially with checkpointing between each
- Rejects concurrent runs for the same spec
- Enforces per-phase timeouts (default 300s, configurable)
- Enforces cost budgets — halts and emits `run:budget_exceeded` when exceeded
- Supports pause/resume/cancel with `AbortSignal` propagation to agents
- Queues spec updates during active runs for re-execution after completion
- Recovers interrupted runs on startup by scanning for non-terminal runs
- Writes timestamped execution logs and status updates to spec directories via `SpecWriter`

### `src/core/state-machine.ts`

Enforces the sequential 8-phase pipeline order with configurable phase policies.

| Export | Kind | Description |
|--------|------|-------------|
| `StateMachine` | Class | Phase transition engine with pause/resume/cancel support |
| `SMTransition` | Interface | Transition record with from/to phase, timestamp, trigger |
| `PhaseConfig` | Interface | Per-phase config: maxRetries, onFailure policy, timeout |

Supports custom phase insertion, transition history tracking, and phase-specific failure policies (halt, retry, loopback).

### `src/core/error-handler.ts`

Error classification and recovery strategy selection.

| Export | Kind | Description |
|--------|------|-------------|
| `ErrorHandler` | Class | Handles phase failures — `handleFailure`, `classifyError`, `getPhaseErrorPolicy`, `buildFailureReport` |
| `ErrorHandlerResult` | Interface | Action to take: retry, rollback-retry, loopback, escalate, halt |
| `ErrorSeverity` | Type | `'transient' \| 'recoverable' \| 'security' \| 'architectural' \| 'fatal'` |
| `RetryState` | Interface | Tracks retry count and last strategy per phase |

Recovery strategies escalate through: default → reduced-context → alternative-backend. Security and architectural errors trigger immediate escalation. Phase-specific policies (halt/loopback/retry) are enforced per phase.

### `src/core/event-bus.ts`

Typed pub/sub system for real-time execution events.

| Export | Kind | Description |
|--------|------|-------------|
| `EventBus` | Class | `emit`, `on`, `onAny`, `getRecentEvents`, `removeAllListeners` |
| `EventListener` | Type | Callback receiving `ExecutionEvent` |
| `UnsubscribeFunction` | Type | Returned by `on`/`onAny` for cleanup |

Maintains event history (configurable max size) for replay/reconnect scenarios.

### `src/core/markdown-parser.ts`

Shared markdown parsing utility.

| Export | Kind | Description |
|--------|------|-------------|
| `parseMarkdown` | Function | Parses markdown into `ParsedMarkdown` with sections, code blocks, and YAML frontmatter |

### `src/core/concurrency-manager.ts`

Slot-based concurrency limiting with queuing.

| Export | Kind | Description |
|--------|------|-------------|
| `ConcurrencyManager` | Class | `acquire`, `getActiveSlotCount`, `getQueueLength`, `getMaxSlots`, `getQueueMetrics`, `clearQueue` |
| `ConcurrencySlot` | Interface | Acquired slot with `release()` function |

Defaults to CPU cores minus one. Queues requests when all slots are occupied and processes them FIFO on release.

### `src/agents/agent-interface.ts`

Core agent contract.

| Export | Kind | Description |
|--------|------|-------------|
| `Agent` | Interface | `execute(context)`, `supportsRollback()`, `estimatedDuration()`, `requiredContext()` |
| `AgentMetadata` | Interface | Phase, agent instance, name, description |
| `AgentRegistry` | Interface | `register`, `getAgentForPhase`, `listRegistered` |

### `src/agents/agent-registry.ts`

Agent registration with interface validation.

| Export | Kind | Description |
|--------|------|-------------|
| `AgentRegistryImpl` | Class | Validates all 4 interface methods at registration time. Rejects agents missing methods with descriptive errors. Supports `unregister`, `hasAgentForPhase`, `getAgentMetadata`, `getAgentCount`. |

### `src/agents/spec-reader.ts`

Phase 1 (Intake) agent — parses Kiro spec files and assembles execution context.

| Export | Kind | Description |
|--------|------|-------------|
| `SpecReaderAgent` | Class | Parses requirements.md, design.md, tasks.md (with legacy fallbacks). Resolves spec path from `AgentContext.spec.specPath` at runtime (falls back to constructor value). Derives project root by locating the `.kiro` boundary in the spec path. Loads architecture docs (ARCHITECTURE.md, ADRs) and extracts dependencies from package.json relative to project root. Loads steering files from `.kiro/rules/` and `.kiro/hooks/`. Applies context capping with relevance-ranked file removal. |

### `src/agents/spec-validator.ts`

Phase 2 (Validation) agent — validates spec completeness and feasibility.

| Export | Kind | Description |
|--------|------|-------------|
| `SpecValidatorAgent` | Class | Checks for undefined API contracts, missing DB schemas, missing error handling, and architecture contradictions. Produces `ValidationReport` with issues, severity, and suggested fixes. |

### `src/agents/architecture-guardian.ts`

Phase 3 (Analysis) and Phase 5 (Review) agent.

| Export | Kind | Description |
|--------|------|-------------|
| `ArchitectureGuardianAgent` | Class | Constructor takes `'architecture-analysis' \| 'architecture-review'` to select mode. Phase 3: loads ADRs, identifies patterns, detects tech stack patterns, maps module boundaries, detects potential violations. Phase 5: reviews modified files against patterns, checks import boundaries, naming conventions, state management. |

### `src/agents/executor.ts`

Phase 4 (Implementation) agent — delegates code generation to AI backends with self-correction.

| Export | Kind | Description |
|--------|------|-------------|
| `ExecutorAgent` | Class | Delegates to configured `ExecutorBackend` via `BackendRegistry`. Validates intake, validation, and architecture context. Self-correction retry loop (up to 3 retries) re-invokes backend with failure context. Streams NDJSON progress events via `EventBus`. Produces `ImplementationResult` with modifiedFiles, addedTests, duration, backend name, selfCorrectionAttempts. Supports `AbortSignal` for cooperative cancellation. |
| `createExecutorAgent` | Function | Factory function accepting optional `EventBus` and `BackendRegistry` |

### `src/agents/test-engineer.ts`

Phase 6 (Test & Verification) agent — generates tests, runs the test suite, and collects coverage.

| Export | Kind | Description |
|--------|------|-------------|
| `TestEngineerAgent` | Class | Generates unit/integration/edge-case test stubs for modified source files that lack tests. Skips test execution when `modifiedFiles` is empty (returns a passing report with zero tests). Runs `npm test` in the worktree and parses Vitest/Jest output. Reads `coverage-summary.json` for line coverage on modified files. Produces `TestReport` with passed, testsRun, testFailures, coverage, duration, generatedTests. Supports `AbortSignal` for cooperative cancellation. |
| `createTestEngineerAgent` | Function | Factory function accepting optional `EventBus` |

### `src/agents/review-council.ts`

Phase 8 (Review & Delivery) agent — configurable multi-perspective code review with consensus logic.

| Export | Kind | Description |
|--------|------|-------------|
| `ReviewCouncilAgent` | Class | Spawns configurable reviewer instances from `reviewers` array or legacy `perspectives`. Supports custom review perspectives and per-reviewer backend assignment with fallback chain (reviewer.backend → phaseBackends['review-delivery'] → defaultBackend). Generalized consensus: all approve → passed, ≥ Math.max(1, Math.floor(N*2/3)) → passed-with-warnings, else rejected. Enforces maxReviewRounds cap and reviewBudgetUsd cost cap. Supports parallel vs sequential execution toggle. Falls back to heuristic review when no backend is available. Emits `agent:backend-selected` events for per-reviewer backend overrides. Supports `AbortSignal` for cooperative cancellation. |
| `createReviewCouncilAgent` | Function | Factory function accepting `ReviewCouncilDependencies` (eventBus optional, backendRegistry required) |
| `ReviewPerspective` | Type | `'security' \| 'performance' \| 'maintainability'` (deprecated — use `string` for custom perspectives) |
| `ReviewVote` | Interface | Individual vote with perspective (string), approved, feedback, severity |

### `src/agents/ui-validator.ts`

Phase 7 (UI/UX Validation) agent — visual regression testing using Playwright, baseline management, and AI-based UI review.

| Export | Kind | Description |
|--------|------|-------------|
| `UIValidatorAgent` | Class | Identifies affected routes from modified files and spec content. Captures screenshots via Playwright (falls back to mock when unavailable). Diffs against baseline images, creates new baselines when none exist. Performs AI review for visual consistency, responsive behavior, and accessibility. Produces `UIReview` with approved, screenshots, uiIssues. Skips automatically for non-UI specs. Supports `AbortSignal` for cooperative cancellation. Public methods: `isUISpec`, `identifyRoutes`, `updateBaselines`. |
| `createUIValidatorAgent` | Function | Factory function accepting optional `EventBus` and `playwright` dependency |
| `ScreenshotInfo` | Interface | Screenshot metadata with route, path, baseline, diff, diffPercentage |
| `UIIssue` | Interface | UI issue with type (visual/responsive/accessibility/consistency), description, severity |

### `src/agents/delivery.ts`

Phase 8 (PR Delivery) agent — creates feature branch, commits with conventional format, opens PR, and appends execution summary.

| Export | Kind | Description |
|--------|------|-------------|
| `DeliveryAgent` | Class | Creates feature branch from worktree (`kaso/[feature]-delivery-[timestamp]`). Analyzes modified files and creates categorized conventional commits (feat, test, docs, chore). Opens PR via GitHub CLI (`gh`) with graceful fallback. Builds PR body with execution summary, test results, and review council outcome. Appends execution summary to spec directory. Supports `AbortSignal` for cooperative cancellation. |
| `createDeliveryAgent` | Function | Factory function accepting optional `EventBus` and `CommandRunner` |
| `ConventionalCommitType` | Type | `'feat' \| 'fix' \| 'refactor' \| 'test' \| 'docs' \| 'chore' \| 'style' \| 'perf' \| 'ci' \| 'build'` |
| `CommitInfo` | Interface | Commit metadata with type, scope, description, body, breaking flag |

Backend interface definition.

| Export | Kind | Description |
|--------|------|-------------|
| `ExecutorBackend` | Interface | `execute(request)`, `isAvailable()`, `onProgress(callback)`. Properties: `name`, `protocol`, `maxContextWindow`, `costPer1000Tokens`. |

### `src/backends/backend-process.ts`

Subprocess management for CLI-based backends.

| Export | Kind | Description |
|--------|------|-------------|
| `CLIProcessBackend` | Class | Spawns child process, communicates via NDJSON on stdout. Handles timeouts (SIGTERM → SIGKILL escalation), exit codes, stderr capture. |
| `MockBackend` | Class | Test double that simulates backend execution with progress events. |
| `BackendExecutionError` | Class | Typed error with exitCode and stderr lines. |

### `src/backends/backend-registry.ts`

Backend discovery and selection.

| Export | Kind | Description |
|--------|------|-------------|
| `BackendRegistry` | Class | Registers backends from config. Selection strategies: `'default'` (use configured default) or `'context-aware'` (cheapest backend whose maxContextWindow fits the estimated context size). Phase-aware selection via `selectBackendForPhase(phase, context?)` checks phase overrides first, then falls back to selection strategy. Fail-fast on unavailable phase override backends. `hasPhaseOverride(phase)` and `getPhaseOverride(phase)` for phase override introspection. `registerBackend()` allows direct instance registration for testing with mocks. |

### `src/config/schema.ts`

Zod schemas for runtime configuration validation.

| Export | Kind | Description |
|--------|------|-------------|
| `KASOConfigSchema` | Zod Schema | Main config schema with all sections, includes `phaseBackends` phase-to-backend mapping and `.superRefine()` cross-field validation for backend references |
| `KASOConfig` | Type | Inferred TypeScript type from schema |
| `ExecutorBackendConfigSchema` | Zod Schema | Backend config: name, command, args, protocol, maxContextWindow, costPer1000Tokens |
| `PluginConfigSchema` | Zod Schema | Plugin: package, enabled, config |
| `CustomPhaseConfigSchema` | Zod Schema | Custom phase: name (must match `custom-*`), package, position |
| `ContextCappingStrategySchema` | Zod Schema | Context capping: enabled, charsPerToken, relevanceRanking |
| `ReviewerConfigSchema` | Zod Schema | Reviewer config: required `role` string, optional `backend` string |
| `ReviewerConfig` | Type | Inferred TypeScript type from `ReviewerConfigSchema` |
| `ReviewCouncilConfigSchema` | Zod Schema | Review council: maxReviewRounds, enableParallelReview, reviewBudgetUsd, perspectives, optional reviewers array with unique-role validation |
| `UIBaselineConfigSchema` | Zod Schema | UI baselines: baselineDir, captureOnPass, diffThreshold, viewport |
| `WebhookConfigSchema` | Zod Schema | Webhooks: url, events, headers, secret |
| `MCPServerConfigSchema` | Zod Schema | MCP servers: name, transport, command, args, url, env |
| `MCPToolDefinitionSchema` | Zod Schema | MCP tools: name, description, inputSchema, server |
| `validateConfig` | Function | Parse and validate config, throws on failure |
| `isValidConfig` | Function | Boolean check without throwing |
| `getDefaultConfig` | Function | Returns config with all defaults applied |

### `src/config/loader.ts`

Configuration file I/O with deep merge.

| Export | Kind | Description |
|--------|------|-------------|
| `loadConfig` | Function | Load and validate from JSON file, merge with defaults |
| `loadConfigSafe` | Function | Same as `loadConfig` but returns defaults on failure |
| `loadConfigFromFile` | Function | Load from specific path |
| `checkConfigFile` | Function | Boolean check if config file exists and is valid |
| `getConfigPath` | Function | Returns resolved path to `kaso.config.json` |
| `ConfigLoaderOptions` | Interface | `configPath`, `useDefaults` |

### `src/infrastructure/execution-store.ts`

Dual-mode persistence for runs and phase results.

| Export | Kind | Description |
|--------|------|-------------|
| `ExecutionStore` | Class | SQLite primary, JSONL fallback. Disables WAL mode for `:memory:` databases. Uses UPDATE for existing runs to avoid CASCADE DELETE of phase results. Methods: `saveRun`, `getRun`, `listRuns`, `appendPhaseResult`, `getInterruptedRuns`, `updateRunStatus`, `checkpoint`, `getPhaseResults`, `getDatabase`, `close`. |
| `ExecutionStoreConfig` | Interface | `type` (`'sqlite' \| 'jsonl'`), `path` |

SQLite schema: `runs` table, `phase_results` table, `checkpoints` table.

### `src/infrastructure/checkpoint-manager.ts`

Write-ahead persistence for crash recovery.

| Export | Kind | Description |
|--------|------|-------------|
| `CheckpointManager` | Class | `saveCheckpoint`, `getLatestCheckpoint`, `clearCheckpoints`, `hasCheckpoints`, `createFromRun`, `recoverFromCheckpoint`, `listCheckpoints`, `cleanupOldCheckpoints` |
| `CheckpointRecord` | Interface | id, runId, phase, data, createdAt, isLatest |
| `CheckpointRecoveryData` | Interface | Typed recovery payload with run and phaseResults |

Stores checkpoints as JSON in SQLite with runId index. Verifies write-ahead succeeded after save.

### `src/infrastructure/cost-tracker.ts`

Token usage and cost accumulation.

| Export | Kind | Description |
|--------|------|-------------|
| `CostTracker` | Class | `recordInvocation`, `getRunCost`, `getHistoricalCosts`, `checkBudget`, `getTotalHistoricalCost`, `cleanupRun` |
| `InvocationCost` | Interface | Per-invocation cost record |
| `RunCost` | Interface | Per-run cost with backend breakdown |

Cost formula: `(tokensUsed / 1000) * costPer1000Tokens`.

### `src/infrastructure/credential-manager.ts`

Secure API key handling.

| Export | Kind | Description |
|--------|------|-------------|
| `CredentialManager` | Class | `getApiKey` (env var → keytar fallback), `getApiKeys`, `validateAllPresent`, `redact`, `getAllSecrets`, `clearCache` |
| `CredentialManagerOptions` | Interface | `serviceName`, `requiredKeys` |

Never reads from git-tracked files.

### `src/infrastructure/log-redactor.ts`

Secret redaction from arbitrary text.

| Export | Kind | Description |
|--------|------|-------------|
| `redactSecrets` | Function | Replace all occurrences of secrets with `[REDACTED]` |
| `redactMultiple` | Function | Redact across multiple text sources |
| `redactObject` | Function | Stringify and redact an object |
| `redactError` | Function | Redact Error message and stack trace |

Sorts secrets longest-first to handle overlapping patterns correctly.

### `src/infrastructure/worktree-manager.ts`

Git worktree lifecycle management.

| Export | Kind | Description |
|--------|------|-------------|
| `WorktreeManager` | Class | `create`, `getPath`, `push`, `cleanup`, `retain`, `exists`, `isConsistent`, `listWorktrees`, `loadExistingWorktrees`, `getWorktreeInfo`, `getWorktreeInfoFromDisk` |

Branch naming: `kaso/[specName]-[YYYYMMDDTHHmmss]`. Worktrees stored under `.kaso/worktrees/`. Supports retention (skip cleanup), consistency checks, and disk recovery for crash scenarios.

### `src/infrastructure/spec-writer.ts`

Writes execution state back to Kiro spec directories.

| Export | Kind | Description |
|--------|------|-------------|
| `SpecWriter` | Class | `appendExecutionLog`, `updateSpecStatus`, `writeRunStarted`, `writePhaseTransition`, `writeRunCompleted` |
| `SpecStatus` | Interface | currentPhase, runStatus, lastUpdated, runId |
| `ExecutionLogEntry` | Interface | Timestamped log entry for execution-log.md |

Writes `execution-log.md` and `status.json` to spec directories. Gracefully degrades on missing directories.

### `src/infrastructure/file-watcher.ts`

Monitors `.kiro/specs/` directories for spec status changes and triggers orchestration runs.

| Export | Kind | Description |
|--------|------|-------------|
| `FileWatcher` | Class | Watches `status.json` files via chokidar. `start(callback)`, `stop()`, `checkSpecStatus(path)`, `triggerSpecCheck(path)`, `getWatchedSpecs()`, `getState()`, `isWatching()`. |
| `FileWatcherConfig` | Interface | specsDir, watchPatterns, ignorePatterns, pollingInterval, usePolling |
| `SpecReadyCallback` | Type | `(specPath: string, specName: string) => void \| Promise<void>` |
| `FileWatcherState` | Type | `'idle' \| 'watching' \| 'stopped' \| 'error'` |
| `createFileWatcher` | Function | Factory function accepting optional config and EventBus |

Detects specs transitioning to "ready-for-dev" (runStatus=pending, no currentPhase). Deduplicates triggers, resets on status change away from ready. Emits events via EventBus for observability. Supports polling mode for network filesystems.

### `src/infrastructure/webhook-dispatcher.ts`

Delivers execution lifecycle events to configured external webhook URLs with retry logic and payload signing.

| Export | Kind | Description |
|--------|------|-------------|
| `WebhookDispatcher` | Class | Subscribes to EventBus and dispatches events to configured webhooks. `start()`, `stop()`, `isActive()`, `getWebhooks()`, `addWebhook()`, `removeWebhook()`, `dispatchToWebhook()`, `buildPayload()`, `buildHeaders()`, `signPayload()`, `verifySignature()`, `calculateBackoff()`. |
| `WebhookDispatcherConfig` | Interface | webhooks, maxRetries, baseDelayMs, timeoutMs |
| `WebhookPayload` | Interface | event, specName, phase, timestamp, runId, data |
| `WebhookDeliveryResult` | Interface | success, statusCode, error, attempts, duration |
| `createWebhookDispatcher` | Function | Factory function accepting optional config and dependencies |

Features: event filtering per webhook, custom headers from config, HMAC-SHA256 payload signing (`X-KASO-Signature` header), exponential backoff with jitter (capped at 30s), sensitive data redaction in payloads, AbortController-based request timeouts.

### `src/infrastructure/mcp-client.ts`

Manages connections to configured MCP servers, lists available tools, invokes tools with typed arguments, and scopes tool availability to the Implementation phase only.

| Export | Kind | Description |
|--------|------|-------------|
| `MCPClient` | Class | Manages MCP server connections and tool invocation. `initialize()`, `connect()`, `disconnect()`, `disconnectServer()`, `getAllTools()`, `getToolsForServer()`, `getToolsForPhase()`, `isPhaseEligible()`, `setServerTools()`, `getConnectedServerCount()`, `getConnectionState()`, `getAllConnections()`, `hasAvailableTools()`, `isToolAvailable()`, `invokeTool()`, `reconnect()`. |
| `MCPConnectionState` | Type | `'connecting' \| 'connected' \| 'disconnected' \| 'error'` |
| `MCPConnection` | Interface | Server connection info with name, config, state, tools, error, lastConnected |
| `MCPInvocationResult` | Interface | Tool invocation result with success, output, error |
| `createMCPClient` | Function | Factory function accepting MCPServerConfig array and optional EventBus |

Features: phase-scoped tool access (only Implementation phase receives MCP tools per Req 25.2/25.3), graceful degradation on server crashes (marks tools unavailable, continues execution), tool injection via `setServerTools()` for testing and SDK integration, reconnection support, EventBus integration for observability. Supports stdio, SSE, and WebSocket transports.

### `src/streaming/sse-server.ts`

Server-Sent Events server for real-time streaming of execution events to connected clients.

| Export | Kind | Description |
|--------|------|-------------|
| `SSEServer` | Class | HTTP server streaming execution events via SSE. `start()`, `stop()`, `isRunning()`, `getClientCount()`, `getClientIds()`. Subscribes to EventBus and broadcasts events to connected clients with filtering support. |
| `SSEEventPayload` | Interface | SSE event wire format with id, event, data fields |
| `SSEMessage` | Interface | Formatted event payload with type, runId, timestamp, phase, agent, elapsedTime, data |
| `createSSEServer` | Function | Factory function accepting EventBus and optional partial SSEConfig |

Features: per-client runId and event type filtering via query params, Bearer token authentication, heartbeat/ping to keep connections alive, Last-Event-ID replay for reconnection, health check endpoint (`/health`), configurable endpoint path. Extracts elapsed time from event data (duration, elapsedTime, or startTime calculation).

### `src/plugins/plugin-loader.ts`

Discovers and loads custom agents from npm packages listed in config. Validates each plugin implements the Agent interface before registration.

| Export | Kind | Description |
|--------|------|-------------|
| `PluginLoader` | Class | Manages plugin lifecycle. `loadAndRegister()`, `getResults()`, `getSuccessfulLoads()`, `getFailedLoads()`, `allSuccessful()`. Loads plugins from config and registers valid agents with the AgentRegistry. |
| `PluginLoadResult` | Interface | Result of loading a plugin: package, success, agent, phaseName, error |
| `PluginMetadata` | Interface | Plugin metadata: name, version, description, kaso phase/agent hints |
| `validateAgentInterface` | Function | Validates an object implements all 4 required Agent interface methods (execute, supportsRollback, estimatedDuration, requiredContext) |
| `loadPlugin` | Function | Load a single plugin from an npm package via dynamic import |
| `loadAllPlugins` | Function | Load all configured plugins sequentially |
| `createPluginLoader` | Function | Factory function accepting AgentRegistry and PluginConfig array |

Security note: plugins run with the same privileges as the host process — no sandboxing. Supports default export, `KasoAgent` named export, or `agent` named export. Disabled plugins are skipped with descriptive error.

### `src/plugins/phase-injector.ts`

Inserts custom phases at configurable positions in the 8-phase pipeline. Custom phases receive the same AgentContext passing and error handling as built-in phases.

| Export | Kind | Description |
|--------|------|-------------|
| `PhaseInjector` | Class | Manages custom phase injection. `buildPipeline()`, `getPipeline()`, `getPhaseOrder()`, `hasErrors()`, `getErrors()`, `validateAgents()`. |
| `PipelinePhase` | Interface | Phase descriptor with name, type (built-in/custom), package, position |
| `PhaseInjectionResult` | Interface | Result of injection: phases array, customPhases map, errors array |
| `BUILTIN_PHASES` | Constant | Default 8-phase pipeline order |
| `validateCustomPhaseName` | Function | Validates name matches `custom-[a-z0-9-]+` pattern |
| `validatePosition` | Function | Validates position is within pipeline bounds (0 to 8) |
| `injectCustomPhases` | Function | Core injection logic — sorts by position, validates, inserts into pipeline |
| `getPhaseOrder` | Function | Extract ordered phase names from injection result |
| `isCustomPhase` | Function | Check if a phase is custom |
| `getCustomPhaseConfig` | Function | Get config for a custom phase |
| `createPhaseInjector` | Function | Factory function accepting CustomPhaseConfig array |

---

## Configuration Reference

### Main Config File: `kaso.config.json`

```json
{
  "executorBackends": [
    {
      "name": "kimi-code",
      "command": "kimi",
      "args": [],
      "protocol": "cli-json",
      "maxContextWindow": 128000,
      "costPer1000Tokens": 0.01,
      "enabled": true
    }
  ],
  "defaultBackend": "kimi-code",
  "backendSelectionStrategy": "default",
  "maxConcurrentAgents": "auto",
  "maxPhaseRetries": 2,
  "defaultPhaseTimeout": 300,
  "phaseTimeouts": {},
  "phaseBackends": {},
  "contextCapping": {
    "enabled": true,
    "charsPerToken": 4,
    "relevanceRanking": ["requirements.md", "design.md", "tasks.md", "ARCHITECTURE.md", "package.json"]
  },
  "reviewCouncil": {
    "maxReviewRounds": 2,
    "enableParallelReview": false,
    "perspectives": ["security", "performance", "maintainability"],
    "reviewers": [{"role": "security"}, {"role": "performance", "backend": "fast-model"}]
  },
  "uiBaseline": {
    "baselineDir": ".kiro/ui-baselines",
    "captureOnPass": true,
    "diffThreshold": 0.1,
    "viewport": { "width": 1280, "height": 720 }
  },
  "executionStore": {
    "type": "sqlite",
    "path": ".kaso-execution-store.db"
  },
  "webhooks": [],
  "mcpServers": [],
  "plugins": [],
  "customPhases": [],
  "costBudgetPerRun": null
}
```

### Required Environment Variables
- API keys for configured AI backends (e.g., `KIMI_API_KEY`, `ANTHROPIC_API_KEY`) — set via `.env` file, environment variables, or OS keychain
- Git credentials (if using remote operations)
- Webhook secrets (for signed webhook payloads)

---

## Security

1. **Worktree Isolation**: All file modifications confined to git worktrees under `.kaso/worktrees/` — main working directory is never modified
2. **Credential Security**: API keys loaded from environment variables or OS keychain via keytar — never from git-tracked files
3. **Log Redaction**: All known secrets automatically redacted from log output
4. **Webhook Security**: HMAC-SHA256 payload signing (planned)
5. **Review Council**: Multi-perspective security review for all changes
6. **Audit Trail**: Complete execution logs and phase history persisted in SQLite

## Error Handling

- **Rollback**: Agents implementing `supportsRollback()` get rollback-retry on failure
- **Retry Escalation**: default → reduced-context → alternative-backend, capped at configured max retries
- **Phase Policies**: Per-phase failure behavior — halt (intake, validation), loopback to implementation (architecture-review, test-verification), retry (implementation, ui-validation)
- **Immediate Escalation**: Security concerns and architectural deadlocks bypass retry logic
- **Crash Recovery**: Automatic resumption from last checkpoint on startup

## Resource Management

- **Concurrency**: Slot-based limiting, defaults to CPU cores - 1
- **Cost Tracking**: Per-run cost calculation with configurable budget caps
- **Context Capping**: Relevance-ranked file removal to fit backend context windows
- **Phase Timeouts**: Configurable per phase (default 300s)

---

## Implementation Status

| Task | Description | Status |
|------|-------------|--------|
| 0 | Verify prerequisites | ✅ |
| 1.1–1.5 | Project scaffolding, core types, config | ✅ |
| 2.1–2.3 | Credential manager, log redactor | ✅ |
| 3.1–3.3 | Execution store, checkpoint manager | ✅ |
| 4.1–4.2 | Worktree manager | ✅ |
| 5 | Checkpoint — Foundation complete | ✅ |
| 6.1–6.3 | Event bus, concurrency manager | ✅ |
| 7.1–7.4 | Agent interface, registry, cost tracker | ✅ |
| 8.1–8.2 | State machine | ✅ |
| 9.1–9.4 | Backend adapters | ✅ |
| 10.1–10.3 | Spec reader agent (Phase 1) | ✅ |
| 11.1–11.2 | Spec validator agent (Phase 2) | ✅ |
| 12 | Checkpoint — Core pipeline agents ready | ✅ |
| 13.1–13.5 | Orchestrator (central hub) | ✅ |
| 14.1–14.4 | Error handling and recovery | ✅ |
| 15 | Checkpoint — Orchestrator complete | ✅ |
| 16.1–16.2 | Architecture guardian (Phase 3 & 5) | ✅ |
| 17 | Executor agent (Phase 4) | ✅ |
| 18 | Test engineer agent (Phase 6) | ✅ |
| 19 | Review council (Phase 8) | ✅ |
| 20 | Delivery agent (Phase 8) | ✅ |
| 21 | Checkpoint — Quality gates | ✅ |
| 22 | UI validator agent (Phase 7) | ✅ |
| 23 | File watcher for spec monitoring | ✅ |
| 24 | Webhook dispatcher | ✅ |
| 25 | SSE server for streaming | ✅ |
| 26 | CLI interface | ✅ |
| 27 | Checkpoint — Polish complete | ✅ |
| 28 | Plugin loader and custom phases | ✅ |
| 29 | MCP client integration | ✅ |
| 30 | Wire everything together | ✅ |
| 31 | Final checkpoint | 📋 Planned |

## Commit Conventions

Format: `<type>(<scope>): <short description>`

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `spec`

Scopes: `core`, `agents`, `backends`, `infra`, `cli`, `config`, `plugins`, `streaming`, `hooks`, `steering`

Rules: subject max 72 chars, imperative mood, no trailing period, body wraps at 80 chars.

## Key Files for AI Agents

- `.kiro/steering/coding_practices.md` — Code style and quality standards
- `.kiro/steering/personality.md` — Communication tone guidelines
- `.kiro/steering/commit-conventions.md` — Git commit message format
- `src/core/types.ts` — All domain types and interfaces
- `src/config/schema.ts` — Configuration schemas and validation
- `.kiro/specs/kaso-orchestrator/tasks.md` — Implementation task tracker
