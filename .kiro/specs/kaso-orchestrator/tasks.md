# Implementation Plan: KASO — Kiro-Enabled Agent Swarm Orchestrator

## Overview

Incremental build of the KASO orchestration system in TypeScript, organized into sprints that progressively layer functionality: foundation types and infrastructure first, then core pipeline mechanics, quality gates, polish/streaming, and finally extensibility. Each task builds on previous work — no orphaned code. Uses Vitest for testing and fast-check for property-based tests.

## Tasks

- [x] 0. Verify prerequisites
  - [x] 0.1 Create prerequisite check script
    - Verify Node.js 18+ installed (`node --version`)
    - Verify Git 2.40+ installed (`git --version`)
    - Verify Kimi Code CLI installed and authenticated
    - Create `scripts/check-prerequisites.ts` that runs all checks and reports pass/fail with actionable error messages
    - Exit with non-zero code if any prerequisite is missing

<!-- NOTE: the conditions were satified and the script has been deleted. -->
- [x] 1. Project scaffolding and core types
  - [x] 1.1 Initialize project structure and tooling
    - Create `package.json` with TypeScript, Vitest, `@fast-check/vitest`, `simple-git`, `better-sqlite3`, `keytar` dependencies
    - Add dev dependencies: `playwright` (for Task 22 — UI validation)
    - Add dependencies: `chokidar` (for Task 23 — file watching), `zod` (for Task 1.3 — config schema validation), `commander` (for Task 26 — CLI)
    - Create `tsconfig.json` with strict mode, no implicit any, path aliases
    - Create `vitest.config.ts` with v8 coverage provider
    - Set up `src/` directory structure matching the design module organization
    - Create `.gitignore` entries for `.env`, credential stores, `node_modules`, `dist`
    - _Requirements: 20.3_

  - [x] 1.2 Define core type definitions in `src/core/types.ts`
    - Implement `PhaseName`, `RunStatus`, `EventType` union types
    - Implement `ExecutionEvent`, `PhaseTransition`, `PhaseResult`, `PhaseResultRecord` interfaces
    - Implement `ExecutionRunStatus`, `ExecutionRunRecord` interfaces
    - Implement `AgentContext`, `ParsedSpec`, `ParsedMarkdown`, `MarkdownSection`, `CodeBlock`, `TaskItem`, `SteeringFiles` interfaces
    - Implement `AgentResult`, `PhaseOutput`, `LogEntry`, `AgentError` types
    - Implement all phase-specific output types: `AssembledContext`, `ValidationReport`, `ArchitectureContext`, `ImplementationResult`, `ArchitectureReview`, `TestReport`, `UIReview`, `ReviewCouncilResult`, `DeliveryResult`
    - Implement `BackendProtocol`, `BackendRequest`, `BackendResponse`, `BackendProgressEvent` types
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 11.4_

  - [x] 1.3 Define configuration types and schema in `src/config/schema.ts`
    - Implement `KASOConfig`, `ExecutorBackendConfig`, `PluginConfig`, `CustomPhaseConfig` interfaces
    - Implement `ContextCappingStrategy`, `ReviewCouncilConfig`, `UIBaselineConfig` interfaces
    - Implement `WebhookConfig`, `MCPServerConfig`, `MCPToolDefinition` interfaces
    - Implement JSON schema validation function for config files using `zod`
    - _Requirements: 7.1, 7.3, 24.1, 25.1, 29.1_

  - [x] 1.4 Implement config loader in `src/config/loader.ts`
    - Load and validate KASO config from JSON file with sensible defaults
    - Merge defaults for `maxPhaseRetries` (2), `defaultPhaseTimeout` (300), `maxConcurrentAgents` ('auto')
    - _Requirements: 7.1, 7.2_

  - [x]* 1.5 Write property test for backend config round-trip
    - **Property 13: Backend config round-trip**
    - **Validates: Requirements 7.1, 7.3**

- [x] 2. Credential manager and log redactor
  - [x] 2.1 Implement credential manager in `src/infrastructure/credential-manager.ts`
    - Load API keys from environment variables with `keytar` OS keychain fallback
    - Implement `getApiKey`, `listRequiredKeys`, `validateAllPresent`, `redact` methods
    - Throw descriptive error naming the missing key when not found
    - Never read from git-tracked files
    - _Requirements: 20.1, 20.4_

  - [x] 2.2 Implement log redactor in `src/infrastructure/log-redactor.ts`
    - Redact all known secret values from arbitrary text
    - Accept a set of secret strings and replace all occurrences with `[REDACTED]`
    - _Requirements: 20.2_

  - [x]* 2.3 Write property tests for credential security
    - **Property 36: Secret redaction in logs**
    - **Property 37: Credentials loaded only from secure sources**
    - **Validates: Requirements 20.1, 20.2**

- [x] 3. Execution store and checkpoint manager
  - [x] 3.1 Implement execution store in `src/infrastructure/execution-store.ts`
    - Use `better-sqlite3` for SQLite storage (with JSONL fallback based on config)
    - Implement `saveRun`, `getRun`, `listRuns`, `appendPhaseResult`, `getInterruptedRuns`, `updateRunStatus`, `checkpoint` methods
    - Create schema with runs table and phase_results table
    - _Requirements: 17.5, 27.1_

  - [x] 3.2 Implement checkpoint manager in `src/infrastructure/checkpoint-manager.ts`
    - Write-ahead persistence: save checkpoint before phase transitions
    - Implement `saveCheckpoint`, `getLatestCheckpoint`, `clearCheckpoints` methods
    - Store checkpoints as JSON in SQLite with runId index
    - _Requirements: 27.1, 27.3_

  - [x]* 3.3 Write property tests for execution store and checkpoints
    - **Property 39: Execution history round-trip**
    - **Property 51: Execution state survives process restart**
    - **Validates: Requirements 17.5, 27.1, 27.2, 27.3**

- [x] 4. Worktree manager
  - [x] 4.1 Implement worktree manager in `src/infrastructure/worktree-manager.ts`
    - Use `simple-git` for all git operations
    - Implement `create`, `getPath`, `push`, `cleanup`, `retain`, `exists`, `isConsistent` methods
    - Branch naming: `kaso/[feature-name]-[YYYYMMDDTHHmmss]`
    - _Requirements: 19.1, 19.2, 19.3, 19.4_

  - [x]* 4.2 Write property tests for worktree isolation
    - **Property 21: All file modifications confined to worktree**
    - **Property 35: Worktree preserved on halt or cancel**
    - **Property 42: Worktree branch name derived from spec feature name**
    - **Validates: Requirements 11.6, 19.1, 19.2, 19.4**

- [x] 5. Checkpoint — Foundation complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Event bus and concurrency manager
  - [x] 6.1 Implement event bus in `src/core/event-bus.ts`
    - Typed pub/sub with `emit`, `on`, `onAny` methods
    - Return unsubscribe functions from listeners
    - Support all `EventType` variants from core types
    - _Requirements: 6.5, 17.1_

  - [x] 6.2 Implement concurrency manager in `src/core/concurrency-manager.ts`
    - Slot-based concurrency limiting with `acquire`/`release`
    - Default max slots to CPU cores minus one
    - Queue requests when all slots occupied
    - _Requirements: 21.1, 21.2, 21.3_

  - [x]* 6.3 Write property test for concurrency limits
    - **Property 38: Concurrency limit enforced**
    - **Validates: Requirements 21.1, 21.3**

- [x] 7. Agent interface, registry, and cost tracker
  - [x] 7.1 Define agent interface in `src/agents/agent-interface.ts`
    - Export `Agent` interface with `execute`, `supportsRollback`, `estimatedDuration`, `requiredContext` methods
    - Export `AgentRegistry` interface with `register`, `getAgentForPhase`, `listRegistered` methods
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 7.2 Implement agent registry in `src/agents/agent-registry.ts`
    - Validate all four interface methods present and correctly typed at registration time
    - Reject agents missing any required method with descriptive errors
    - Store registered agents indexed by phase name
    - _Requirements: 5.5, 22.3_

  - [x] 7.3 Implement cost tracker in `src/infrastructure/cost-tracker.ts`
    - Implement `recordInvocation`, `getRunCost`, `getHistoricalCosts`, `checkBudget` methods
    - Cost formula: `(tokensUsed / 1000) * costPer1000Tokens`
    - Accumulate per-run totals with backend breakdown
    - _Requirements: 26.1, 26.2, 26.3, 26.4_

  - [x]* 7.4 Write property tests for agent registry and cost tracking
    - **Property 8: Agent registration validates interface completeness**
    - **Property 47: Cost calculation correctness**
    - **Validates: Requirements 5.5, 22.3, 26.1, 26.2, 26.3**

- [x] 8. State machine
  - [x] 8.1 Implement state machine in `src/core/state-machine.ts`
    - Enforce sequential 8-phase pipeline order with support for custom phase insertion
    - Handle phase transitions: success → next phase, failure → retry/loop-back/halt per phase policy
    - Track transition history with timestamps and triggers
    - Support pause/resume/cancel state transitions
    - _Requirements: 6.1, 6.3, 12.4, 13.5, 15.5, 18.1, 18.2, 18.3_

  - [x]* 8.2 Write property tests for pipeline ordering
    - **Property 9: Pipeline executes phases in sequential order**
    - **Property 10: Phase output flows to next phase context**
    - **Property 11: Failing phase results trigger appropriate pipeline response**
    - **Validates: Requirements 6.1, 6.2, 6.3, 9.6, 12.4, 13.5, 15.5**

- [x] 9. Executor backend adapter layer
  - [x] 9.1 Define backend adapter interface in `src/backends/backend-adapter.ts`
    - Export `ExecutorBackend` interface with `execute`, `isAvailable`, `onProgress` methods
    - _Requirements: 7.2_

  - [x] 9.2 Implement backend registry in `src/backends/backend-registry.ts`
    - Register backends from config, select by name or context-aware strategy
    - Context-aware: pick cheapest backend whose maxContextWindow fits the context size
    - _Requirements: 7.2, 7.4_

  - [x] 9.3 Implement backend process manager in `src/backends/backend-process.ts`
    - Spawn backend as child process with configured command and args
    - Parse NDJSON progress events from stdout using readline
    - Handle process exit codes and stderr
    - Handle backend crashes (exit code !== 0) — capture stderr, wrap in descriptive error, propagate to caller
    - _Requirements: 11.2, 11.4_

  - [x]* 9.4 Write property tests for backend selection and NDJSON
    - **Property 14: Context-aware backend selection picks cheapest fitting backend**
    - **Property 57: Backend progress events are NDJSON on stdout**
    - **Validates: Requirements 7.4, 11.4**

- [x] 10. Spec reader agent (Phase 1 — Intake)
  - [x] 10.1 Implement basic spec parsing in `src/agents/spec-reader.ts`
    - Parse design.md, tech-spec.md, task.md into structured `ParsedSpec`
    - Preserve markdown structure, code blocks, metadata
    - Parse checkbox task items with status (complete/incomplete) and nesting
    - Identify missing files and return descriptive errors
    - Scan for architecture docs (ARCHITECTURE.md, .cursorrules, etc.)
    - Extract dependency info from package.json
    - Load steering files from .kiro/rules/ and .kiro/hooks/ (warn if missing)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 4.1, 4.2, 4.3, 8.1, 8.2, 8.3, 8.4_

  - [x] 10.2 Implement context capping in `src/agents/spec-reader.ts`
    - Implement relevance-ranked file removal algorithm to cap assembled context to fit executor backend's max context window
    - Token estimation using configurable `charsPerToken` ratio from `ContextCappingStrategy`
    - Throw error if minimum required context (spec + arch docs) exceeds window — irreducible overflow
    - Track removed files in `AssembledContext.removedFiles` ordered by relevance (least relevant first)
    - _Requirements: 8.5_

  - [x]* 10.3 Write unit tests for spec reader
    - 10 unit tests validating parsing, capping, and error handling
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 4.1, 4.2, 8.1, 8.4, 8.5**

- [x] 11. Spec validator agent (Phase 2 — Validation)
  - [x] 11.1 Implement spec validator in `src/agents/spec-validator.ts`
    - Check for undefined API contracts, missing DB schemas, missing error handling
    - Check for contradictions with architecture patterns in context
    - Produce `ValidationReport` with approved boolean, issues array, suggested fixes
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x]* 11.2 Write property test for validation output schema
    - **Property 17: Validation output conforms to ValidationReport schema**
    - **Validates: Requirements 9.5**

- [x] 12. Checkpoint — Core pipeline agents ready
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Orchestrator — the central hub
  - [x] 13.1 Implement basic orchestrator in `src/core/orchestrator.ts`
    - Wire state machine, event bus, agent registry, execution store, checkpoint manager, worktree manager, cost tracker, concurrency manager
    - Implement `startRun`: create worktree → run 8-phase pipeline sequentially → checkpoint between phases
    - Implement basic `getRunStatus`: return current phase, elapsed time, cost, phase results
    - Pass accumulated phase outputs as context to each subsequent phase
    - Reject concurrent runs for the same spec
    - Stream real-time progress events via event bus
    - _Requirements: 2.2, 2.3, 6.1, 6.2, 6.4, 6.5, 17.2, 17.3, 17.4, 27.1_

  - [x] 13.2 Implement advanced orchestrator features in `src/core/orchestrator.ts`
    - Implement `pauseRun`: complete current phase, halt before next transition
    - Implement `resumeRun`: continue from next pending phase
    - Implement `cancelRun`: terminate active agent, preserve worktree, mark cancelled
    - Implement `queueSpecUpdate`: queue re-run after current run completes
    - Implement `recoverInterruptedRuns`: on startup, find non-terminal runs, verify worktrees, resume or fail
    - Enforce phase timeouts (default 300s, configurable per phase)
    - Enforce cost budget — halt if exceeded, emit `run:budget_exceeded`
    - Append timestamped log entries and update spec status on phase transitions
    - _Requirements: 2.1, 2.4, 2.5, 3.1, 3.2, 3.3, 6.3, 16.7, 16.8, 18.1, 18.2, 18.3, 26.5, 26.6, 27.2, 27.4, 27.5_

  - [x] 13.4 Implement spec status writer in `src/infrastructure/spec-writer.ts`
    - Write timestamped execution log entries to the Spec directory (e.g. `.kiro/specs/[feature-name]/execution-log.md`)
    - Update a Spec status field to reflect the current Phase name (e.g. `.kiro/specs/[feature-name]/status.json`)
    - Write all status updates and logs in a format compatible with Kiro's spec structure
    - Integrate into orchestrator: call on phase transitions and run completion/failure
    - Handle missing spec directories gracefully (log warning, don't crash)
    - _Requirements: 2.4, 3.1, 3.2, 3.3_

  - [x] 13.5 Add `AbortSignal` support to `AgentContext` and orchestrator cancel path
    - Add optional `abortSignal: AbortSignal` field to `AgentContext` in `src/core/types.ts`
    - Create an `AbortController` per phase execution in the orchestrator
    - Pass `abortSignal` to agents via `AgentContext` so agents can check for cancellation
    - On `cancelRun`, abort the controller for the active phase to terminate the running agent
    - Agents that respect the signal can exit early; agents that don't will complete naturally (graceful degradation)
    - _Requirements: 18.3_

  - [x]* 13.3 Write property tests for orchestrator behavior
    - **Property 4: No concurrent runs for the same spec**
    - **Property 5: Run outcome updates spec status**
    - **Property 6: Phase transitions produce timestamped logs and status updates**
    - **Property 12: Execution run state is always tracked**
    - **Property 40: Pause then resume continues from correct phase**
    - **Property 41: Cancel marks run as cancelled and preserves state**
    - **Property 49: Phase timeout enforced**
    - **Property 50: Spec update mid-execution is queued**
    - **Property 54: Cost budget halts execution when exceeded**
    - **Property 62: Spec directory receives timestamped log entries on phase transitions**
    - **Property 63: Cancel with AbortSignal terminates active agent**
    - **Validates: Requirements 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 6.4, 16.7, 16.8, 18.1, 18.2, 18.3, 26.5, 26.6**

- [x] 14. Error handling and recovery
  - [x] 14.1 Implement error handling logic in orchestrator
    - Rollback for agents that support it on phase failure
    - Retry with modified strategy (reduced context / alternative backend) up to 2 additional attempts
    - Escalate after 3 consecutive failures with detailed failure report
    - Immediate escalation on security concerns or architectural deadlock
    - Preserve worktree and all phase outputs on halt
    - Phase-specific error policies: halt, loop-back to implementation, or retry
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6_

  - [x]* 14.2 Write property tests for error handling
    - **Property 31: Rollback triggered for rollback-capable agents on failure**
    - **Property 32: Phase retry capped at 2 additional attempts**
    - **Property 33: Three consecutive failures trigger escalation**
    - **Property 34: Security concerns trigger immediate escalation**
    - **Validates: Requirements 16.1, 16.2, 16.3, 16.5**

  - [x]* 14.3 Write property tests for crash recovery
    - **Property 52: Crash recovery validates worktree integrity**
    - **Validates: Requirements 27.4, 27.5**

  - [x] 14.4 Wire remaining error handling gaps
    - Apply `retryContext` from ErrorHandler in `buildAgentContext` — when `modifiedContext.reducedContext` is true, trim context; when `alternativeBackend` is set, route to that backend
    - Wire `getPhaseErrorPolicy` into `handlePhaseFailure` so phase-specific policies (halt/loopback/retry) influence the error handler's decision instead of relying solely on the state machine
    - Remove `_agentRegistry` from ErrorHandler constructor once policy wiring is complete (it was reserved for phase→agent lookups in error policies)
    - Add property tests verifying reduced context and alternative backend are actually applied on retry
    - _Requirements: 16.2, 16.6_

- [x] 15. Checkpoint — Orchestrator and error handling complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 16. Architecture guardian agent (Phase 3 & 5)
  - [ ] 16.1 Implement architecture guardian in `src/agents/architecture-guardian.ts`
    - Phase 3 (Analysis): map spec requirements to codebase modules, identify patterns, load ADRs, detect potential violations
    - Phase 5 (Review): review all modified files against ArchitectureContext patterns, check import boundaries, naming conventions, state management
    - Produce `ArchitectureContext` (Phase 3) and `ArchitectureReview` (Phase 5) outputs
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 12.1, 12.2, 12.3_

  - [ ]* 16.2 Write property tests for architecture guardian
    - **Property 18: ADRs are loaded when present**
    - **Property 22: Architecture review covers all modified files**
    - **Validates: Requirements 10.3, 12.1**

- [ ] 17. Executor agent (Phase 4 — Implementation)
  - [ ] 17.1 Implement executor agent in `src/agents/executor.ts`
    - Receive spec, ArchitectureContext, and ValidationReport as combined input
    - Delegate to configured ExecutorBackend via backend process manager
    - Self-correct on test failures: re-invoke backend with failure context, up to 3 retries (self-correction retries are handled internally by the executor agent, not the orchestrator)
    - Stream NDJSON progress events to orchestrator
    - Produce `ImplementationResult` with modified files, added tests, duration
    - All file operations confined to worktree
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [ ]* 17.2 Write property tests for executor agent
    - **Property 19: Implementation context includes spec, architecture, and validation**
    - **Property 20: Executor retries capped at 3**
    - **Validates: Requirements 11.1, 11.3**

- [ ] 18. Test engineer agent (Phase 6 — Test & Verification)
  - [ ] 18.1 Implement test engineer in `src/agents/test-engineer.ts`
    - Generate unit, integration, and edge-case tests for all modified files
    - Execute full project test suite within the worktree
    - Perform code coverage analysis on modified files
    - Produce `TestReport` with passed boolean, coverage percentage, test failures array
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [ ]* 18.2 Write property tests for test engineer
    - **Property 23: Test generation covers all modified files**
    - **Property 24: TestReport conforms to schema**
    - **Validates: Requirements 13.1, 13.4**

- [ ] 19. Review council (Phase 8 — simplified)
  - [ ] 19.1 Implement review council in `src/agents/review-council.ts`
    - Spawn 3 reviewer instances: security, performance, maintainability
    - Collect approval/rejection votes from all 3
    - Consensus logic: 3/3 = passed, 2/3 = passed-with-warnings, <2/3 = rejected
    - Enforce maxReviewRounds cap (default 2)
    - Enforce reviewBudgetUsd cost cap — stop further rounds when exceeded
    - Support parallel vs sequential execution toggle via `ReviewCouncilConfig.enableParallelReview`
    - Produce `ReviewCouncilResult` with consensus and individual votes
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 29.1, 29.2, 29.3_

  - [ ]* 19.2 Write property tests for review council
    - **Property 27: Review Council spawns 3 perspective-specific reviewers and collects all votes**
    - **Property 28: Review consensus determined by approval count**
    - **Property 58: Review council cost control**
    - **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 29.1, 29.2, 29.3**

- [ ] 20. Delivery agent (Phase 8 — PR delivery)
  - [ ] 20.1 Implement delivery agent in `src/agents/delivery.ts`
    - Create feature branch from worktree with descriptive name
    - Create commits following conventional commit format (feat:, fix:, refactor:, test:, docs:)
    - Open pull request with execution summary, test results, review council outcome
    - Use GitHub CLI (`gh`) for PR creation with graceful fallback to `git` + GitHub API if `gh` is not available
    - Append execution summary to Kiro spec directory
    - _Requirements: 15.6, 15.7, 15.8, 15.9_

  - [ ]* 20.2 Write property tests for delivery agent
    - **Property 29: Conventional commit format**
    - **Property 30: PR contains required sections**
    - **Validates: Requirements 15.7, 15.8**

- [ ] 21. Checkpoint — Quality gates complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 22. UI validator agent (Phase 7)
  - [ ] 22.1 Implement UI validator in `src/agents/ui-validator.ts`
    - Identify affected routes and components from spec
    - Capture screenshots using Playwright within worktree
    - Diff against baseline images when baselines exist
    - Create initial baselines when none exist, store under configured baselineDir by route
    - Create baseline directory structure automatically if it does not exist (mkdir -p equivalent)
    - Update baselines on developer approval of visual differences
    - Submit screenshots to AI review for visual consistency, responsive behavior, accessibility
    - Produce `UIReview` with approved boolean, screenshots array, UI issues array
    - Skip phase when spec does not modify UI components or routes
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8_

  - [ ]* 22.2 Write property tests for UI validator
    - **Property 25: UI phase skipped for non-UI specs**
    - **Property 26: UIReview conforms to schema**
    - **Property 55: UI baseline management lifecycle**
    - **Property 60: UI baselines stored under configured directory by route**
    - **Validates: Requirements 14.4, 14.5, 14.6, 14.8**

- [ ] 23. File watcher for spec monitoring
  - [ ] 23.1 Implement file watcher in `src/infrastructure/file-watcher.ts`
    - Monitor .kiro/specs/ directories for file changes using `chokidar`
    - Detect spec status transitions to "ready-for-dev"
    - Trigger orchestrator `startRun` on detection
    - _Requirements: 2.1, 2.2_

- [ ] 24. Webhook dispatcher
  - [ ] 24.1 Implement webhook dispatcher in `src/infrastructure/webhook-dispatcher.ts`
    - Send HTTP POST to registered webhook URLs on lifecycle events
    - Include event type, spec name, phase name, timestamp in JSON payload
    - Include custom headers from WebhookConfig in requests
    - Sign payloads with HMAC-SHA256 when secret is configured, send in `X-KASO-Signature` header
    - Retry failed deliveries up to 3 times with exponential backoff
    - _Requirements: 24.1, 24.2, 24.3, 24.4_

  - [ ]* 24.2 Write property tests for webhooks
    - **Property 44: Webhook payload contains required fields and auth headers**
    - **Property 45: Webhook retry with exponential backoff**
    - **Property 59: Webhook payloads are HMAC-SHA256 signed**
    - **Validates: Requirements 24.2, 24.3, 24.4**

- [ ] 25. SSE server for real-time streaming
  - [ ] 25.1 Implement SSE server in `src/streaming/sse-server.ts`
    - Stream execution events via Server-Sent Events to connected clients
    - Subscribe to event bus and forward events
    - Include current phase, agent identifier, elapsed time in each event
    - _Requirements: 17.1, 17.2_

- [ ] 26. CLI interface
  - [ ] 26.1 Implement CLI entry point and commands in `src/cli/index.ts` and `src/cli/commands.ts`
    - `kaso start <spec-path>` — initiate new Execution_Run
    - `kaso status [run-id]` — display run state, phase, elapsed time, cost; list all active runs when no id
    - `kaso pause <run-id>` — pause specified run
    - `kaso resume <run-id>` — resume paused run
    - `kaso cancel <run-id>` — cancel specified run
    - `kaso cost [run-id]` — display cost breakdown or aggregated history
    - `kaso history [--limit N]` — list past runs with status, duration, cost
    - `kaso logs <run-id> [--phase <phase-name>]` — stream/display execution logs
    - `kaso watch` — start file-watcher mode for automatic spec detection
    - Format output for terminal readability
    - _Requirements: 28.1, 28.2, 28.3, 28.4, 28.5, 28.6, 28.7, 28.8, 28.9_

  - [ ]* 26.2 Write property test for CLI command routing
    - **Property 53: CLI commands map to orchestrator operations**
    - **Validates: Requirements 28.1, 28.2, 28.3, 28.4, 28.5, 28.6, 28.7, 28.8, 28.9**

  - [ ] 26.3 Implement `kaso doctor` command
    - Verify Git installation and version (2.40+)
    - Verify Kimi Code CLI authentication status
    - Verify required API keys are present (env vars / keychain)
    - Verify database connectivity (SQLite execution store)
    - Print pass/fail status for each check with actionable remediation hints
    - _Requirements: 28.1_

- [ ] 27. Checkpoint — Polish complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 28. Plugin loader and custom phase injection
  - [ ] 28.1 Implement plugin loader in `src/plugins/plugin-loader.ts`
    - Discover and load custom agents from npm packages listed in config
    - Validate each plugin implements the Agent interface before registration
    - Reject invalid plugins with descriptive errors
    - Security note: plugins run with the same privileges as the host process — there is no sandboxing. Document this clearly in plugin API docs
    - _Requirements: 22.1, 22.2, 22.3_

  - [ ] 28.2 Implement phase injector in `src/plugins/phase-injector.ts`
    - Insert custom phases at configurable positions in the pipeline
    - Custom phases receive same AgentContext passing behavior as built-in phases
    - Custom phase failures follow same error handling as built-in phases
    - _Requirements: 23.1, 23.2, 23.3_

  - [ ]* 28.3 Write property tests for plugins and custom phases
    - **Property 43: Custom phase error handling matches built-in phases**
    - **Property 48: Plugin discovery loads configured plugins**
    - **Validates: Requirements 22.2, 22.3, 23.3**

- [ ] 29. MCP client integration
  - [ ] 29.1 Implement MCP client in `src/infrastructure/mcp-client.ts`
    - Connect to configured MCP servers, manage connections
    - List available tools, invoke tools with typed args
    - Make MCP tool definitions available in AgentContext
    - Pass MCP tools to ExecutorBackend during Implementation phase when protocol supports it
    - Handle MCP server crashes gracefully — detect connection loss, log error, mark tools as unavailable, continue execution without MCP tools
    - _Requirements: 25.1, 25.2, 25.3_

  - [ ]* 29.2 Write property test for MCP tool scoping
    - **Property 46: MCP tools scoped to Executor_Backend during Implementation only**
    - **Validates: Requirements 25.2, 25.3**

- [ ] 30. Wire everything together
  - [ ] 30.1 Create main application entry point and smoke test
    - Wire all components: config loader → credential manager → execution store → checkpoint manager → worktree manager → event bus → concurrency manager → agent registry → backend registry → cost tracker → orchestrator → file watcher → SSE server → webhook dispatcher → CLI
    - Register all built-in agents with the agent registry
    - Load plugins and register custom agents
    - Connect event bus to SSE server and webhook dispatcher
    - Run crash recovery on startup
    - Add explicit smoke test: run a simple spec end-to-end through the full pipeline with a mock backend to verify wiring
    - _Requirements: All_

  - [ ]* 30.2 Write integration tests
    - End-to-end pipeline test with mock backend — run a spec through all 8 phases and verify outputs
    - File watcher trigger test — verify spec status change triggers `startRun`
    - Git worktree isolation verification — confirm no writes to main working directory
    - SSE event streaming test — connect SSE client, run a pipeline, verify events received
    - _Requirements: All_

- [ ] 31. Final checkpoint — All systems go
  - Ensure all tests pass, ask the user if questions arise.

  - [ ] 31.1 Documentation and examples
    - Create example spec in `.kiro/specs/example/` with sample design.md, tech-spec.md, and task.md
    - Document configuration schema with annotated example `kaso.config.json`
    - Create troubleshooting guide covering common failure modes (missing API keys, git worktree errors, backend crashes, MCP connection failures)
    - _Requirements: All_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at sprint boundaries
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All 61 correctness properties are covered across optional property test sub-tasks
- All 29 requirements are covered by implementation tasks
- Implementation language: TypeScript (as specified in design)
- Key dependencies: simple-git, better-sqlite3, keytar, @fast-check/vitest, Playwright, chokidar, zod, commander