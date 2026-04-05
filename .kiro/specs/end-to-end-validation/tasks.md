# Implementation Plan: End-to-End Validation

## Overview

Build a comprehensive E2E test suite that exercises KASO's full 8-phase pipeline using `initializeKASO()` with mock backends, in-memory SQLite, and temp directory fixtures. Implementation follows a bottom-up approach: foundation helpers → test infrastructure → tiered test files → property tests → CI config.

## Tasks

- [x] 1. Create foundation helpers
  - [x] 1.1 Create `tests/e2e/helpers/mock-backend.ts`
    - Implement `MockBackend` class implementing `ExecutorBackend` interface
    - Configurable per-phase responses via `setPhaseResponse(phase, response)`
    - Configurable delay via `setDelay(ms)`, availability via `setAvailable(bool)`
    - Emit at least 2 `BackendProgressEvent` objects per `execute()` call
    - Track all `execute()` calls in an execution log for assertion
    - Export `MockBackendConfig`, `MockPhaseResponse`, `MockBackendPreset` interfaces
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 1.2 Create `tests/e2e/helpers/mock-project.ts`
    - Implement `createMockProject(config?)` that creates a temp directory
    - Generate valid `kaso.config.json` passing `validateConfig()` with in-memory SQLite (`:memory:`)
    - Create `.kiro/specs/{feature}/design.md` with EARS-pattern acceptance criteria, glossary, introduction
    - Create `.kiro/specs/{feature}/tasks.md` with checkbox task items
    - Create `.kiro/steering/coding_practices.md` and `.kiro/steering/personality.md`
    - Return `MockProjectResult` with `projectDir`, `specPath`, `configPath`, `cleanup()`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 1.3 Create `tests/e2e/helpers/phase-outputs.ts`
    - Implement fixture factories for all 8 phase output types
    - `createIntakeOutput()` → `AssembledContext` with `featureName`, `designDoc`, `taskList`, `architectureDocs`, `dependencies`, `removedFiles`
    - `createValidationOutput()` → `ValidationReport` with `approved`, `issues`, `suggestedFixes`
    - `createArchitectureAnalysisOutput()` → `ArchitectureContext` with `patterns`, `moduleBoundaries`, `adrsFound`, `adrs`, `potentialViolations`
    - `createImplementationOutput()` → `ImplementationResult` with `modifiedFiles`, `addedTests`, `duration`, `backend`, `selfCorrectionAttempts`
    - `createArchitectureReviewOutput()` → `ArchitectureReview` with `approved`, `violations`, `modifiedFiles`
    - `createTestVerificationOutput()` → `TestReport` with `passed`, `testsRun`, `coverage`, `duration`, `testFailures`
    - `createUIValidationOutput()` → `UIReview` with `approved`, `uiIssues`, `screenshots`
    - `createReviewDeliveryOutput()` → `ReviewCouncilResult` with `consensus`, `votes`, `rounds`, `cost`
    - Export a `createDefaultPhaseResponses()` that returns a `Map<PhaseName, MockPhaseResponse>` wiring all factories
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

- [x] 2. Checkpoint — Ensure foundation helpers compile cleanly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Create test infrastructure helpers
  - [x] 3.1 Create `tests/e2e/helpers/event-collector.ts`
    - Implement `EventCollector` class subscribing to `EventBus.onAny()`
    - Methods: `getEvents()`, `getByType(type)`, `getByRunId(runId)`, `getByPhase(phase)`, `assertMinCount(type, min)`, `assertOrdering(before, after)`, `waitForEvent(type, timeoutMs?)`, `clear()`, `dispose()`
    - _Requirements: 3.4, 9.1, 9.4_

  - [x] 3.2 Create `tests/e2e/helpers/phase-validator.ts`
    - Implement `PhaseValidator` class querying `ExecutionStore`
    - Methods: `assertAllPhasesCompleted(runId)`, `assertSequenceOrder(runId)`, `assertValidTiming(runId)`, `assertPhaseOutputShape(runId, phase, expectedKeys)`, `getPhaseResults(runId)`
    - _Requirements: 3.3, 3.5, 3.6, 4.1–4.8_

  - [x] 3.3 Create `tests/e2e/helpers/harness.ts`
    - Implement `E2ETestHarness` with `setup(options?)` and `teardown(ctx)` methods
    - `setup()` calls `createMockProject()`, then `initializeKASO()` with the generated config
    - After init, register `MockBackend` instances via `BackendRegistry.registerBackend()`
    - Attach `EventCollector` to `EventBus`, create `PhaseValidator` from `ExecutionStore`
    - Optionally enable SSE, webhooks, file watcher, MCP based on `HarnessOptions`
    - `teardown()` calls `shutdownKASO()`, cleans up temp dirs and worktrees
    - Return `HarnessContext` with `app`, `projectDir`, `specPath`, `backends`, `eventCollector`, `phaseValidator`
    - _Requirements: 1.1–1.6, 2.1–2.7_

- [x] 4. Checkpoint — Ensure test infrastructure compiles and harness can initialize/teardown
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement Tier 1 tests — Core Pipeline
  - [x] 5.1 Create `tests/e2e/tier1-core-pipeline.e2e.test.ts`
    - Test: full 8-phase pipeline completes with `run:completed` event and status `completed`
    - Test: all 8 `phase:started` and 8 `phase:completed` events emitted in order
    - Test: `ExecutionStore` contains run record with 8 `PhaseResultRecord`s, all status `success`
    - Test: phase sequence numbers are monotonically increasing 0–7
    - Test: each `PhaseResultRecord` has valid `startedAt`, `completedAt`, non-zero `duration`
    - Test: each phase output matches expected interface shape (intake → `featureName`/`designDoc`/`taskList`, validation → `approved`/`issues`, etc.)
    - Test: worktree created before pipeline, exists during run, cleaned up after completion
    - Test: `ExecutionStore.getRun(runId)` returns correct record after completion
    - Test: `ExecutionStore.getPhaseResults(runId)` returns 8 records
    - Test: `ExecutionStore.listRuns()` returns runs ordered by most recent first
    - Test: `updateRunStatus()` round-trip persists correctly
    - Test: `getInterruptedRuns()` returns only non-terminal runs
    - _Requirements: 1.1–1.6, 2.1–2.7, 3.1–3.7, 4.1–4.8, 19.1–19.6_

  - [x] 5.2 Write unit tests for mock-backend helper
    - Test `execute()` returns configured responses
    - Test progress events emitted (≥2 per call)
    - Test delay behavior
    - Test availability toggle
    - Test execution log tracking
    - _Requirements: 2.1–2.7_

  - [x] 5.3 Write unit tests for mock-project helper
    - Test generated config passes `validateConfig()`
    - Test directory structure contains expected files
    - Test cleanup removes temp directory
    - _Requirements: 1.1–1.6_

- [x] 6. Checkpoint — Ensure Tier 1 tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement Tier 2 tests — Error Handling & Recovery
  - [x] 7.1 Create `tests/e2e/tier2-error-recovery.e2e.test.ts`
    - Test: crash recovery — interrupt after implementation checkpoint, call `recoverInterruptedRuns()`, verify detection of non-terminal run
    - Test: crash recovery — missing worktree marks run as `failed`
    - Test: checkpoint exists after each phase with `runId`, `phase`, serialized `phaseOutputs`
    - Test: cost budget enforcement — configure `costBudgetPerRun: 0.05`, mock 10000 tokens/phase at 0.01/1k, verify pipeline halts before all 8 phases
    - Test: `run:budget_exceeded` event emitted on budget exceeded
    - Test: worktree preserved on budget exceeded
    - Test: concurrent run rejection — second `startRun()` for same spec throws "active run already exists"
    - Test: different spec paths can run concurrently
    - Test: pause/resume — `pauseRun()` sets status to `paused`, `resumeRun()` continues from next phase, final status `completed`
    - Test: `pauseRun()` on non-running status throws error
    - Test: retryable phase failure retries up to `maxPhaseRetries`
    - Test: non-retryable failure halts pipeline
    - Test: retry emits log containing "Retrying phase"
    - Test: all retries exhausted → run status `failed`
    - Test: `ErrorHandler` classifies errors and selects recovery strategy
    - _Requirements: 5.1–5.5, 6.1–6.5, 7.1–7.3, 17.1–17.4, 18.1–18.5_

- [x] 8. Checkpoint — Ensure Tier 2 tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Create advanced helpers
  - [x] 9.1 Create `tests/e2e/helpers/webhook-receiver.ts`
    - Implement `WebhookReceiver` class — local HTTP server on port 0 (OS-assigned)
    - Methods: `start()`, `stop()`, `getUrl()`, `getPayloads()`, `getByEvent(event)`, `setResponseCode(code)`, `clear()`
    - Capture `WebhookReceivedPayload` with `body`, `headers`, `receivedAt`
    - _Requirements: 10.1–10.8_

  - [x] 9.2 Create `tests/e2e/helpers/sse-client.ts`
    - Implement `SSEClient` class — test HTTP client connecting to SSE endpoint
    - Methods: `connect(options?)`, `disconnect()`, `getEvents()`, `waitForEvent(type, timeoutMs?)`, `clear()`
    - Support `runId` filtering, `lastEventId` reconnection, `authToken` auth
    - _Requirements: 9.2, 9.5, 9.6, 9.7, 9.8_

- [ ] 10. Implement Tier 3 tests — Integration Features
  - [x] 10.1 Create `tests/e2e/tier3-integration.e2e.test.ts`
    - Test: worktree lifecycle — created under `.kaso/worktrees/`, branch matches `kaso/{specName}-{timestamp}`, exists during run, cleaned up after
    - Test: worktree isolation — files in worktree don't appear in main dir
    - Test: cancelled run preserves worktree
    - Test: `retain()` prevents cleanup on success
    - Test: `isConsistent()` returns false for missing worktree
    - Test: `loadExistingWorktrees()` discovers worktrees from previous runs
    - Test: SSE streaming — connect SSE_Client, receive events during pipeline run
    - Test: SSE health endpoint returns 200 with `{ "status": "ok" }`
    - Test: SSE `runId` filtering — only matching events forwarded
    - Test: SSE client disconnect decrements client count
    - Test: SSE auth — invalid token returns 401
    - Test: SSE `Last-Event-ID` replay
    - Test: webhook delivery — receiver gets POST with `event`, `runId`, `timestamp`, `data`
    - Test: webhook HMAC-SHA256 signature verification round-trip
    - Test: webhook retry on 5xx with exponential backoff
    - Test: webhook `X-KASO-Delivery-Attempt` header on retries
    - Test: CLI `status` command with valid run ID
    - Test: CLI `status` command without run ID lists all active runs
    - Test: CLI `cost` command displays cost breakdown for a run
    - Test: CLI `history` command returns recent runs
    - Test: CLI `doctor` command reports health status of all components
    - Test: CLI `cancel` command cancels active run
    - Test: plugin loading — valid agent registered, failed plugin recorded in `getFailedLoads()`
    - Test: custom phase injection at position 3 executes between architecture-analysis and implementation
    - Test: MCP client — `getConnectionState()` reports connected, `mcpTools` in AgentContext during implementation phase
    - Test: MCP `isPhaseEligible()` returns false for non-implementation phases
    - Test: MCP `invokeTool()` returns success result
    - Test: file watcher — write `status.json` with `runStatus: "pending"`, callback triggered
    - Test: file watcher — `runStatus: "running"` does not trigger callback
    - Test: file watcher debounce — rapid writes trigger single callback
    - _Requirements: 8.1–8.8, 9.1–9.8, 10.1–10.8, 11.1–11.6, 12.1–12.4, 13.1–13.5, 14.1–14.4_

- [x] 11. Checkpoint — Ensure Tier 3 tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implement Tier 4 tests — Advanced Scenarios
  - [x] 12.1 Create `tests/e2e/tier4-advanced.e2e.test.ts`
    - Test: `context-aware` backend selection picks cheapest fitting backend
    - Test: unavailable preferred backend falls back to next cheapest
    - Test: exact-fit boundary — context size equals `maxContextWindow`, backend selected
    - Test: just-over boundary — context size exceeds `maxContextWindow` by 1, backend excluded
    - Test: just-under boundary — context size is 1 under `maxContextWindow`, backend included
    - Test: no fitting backend throws "No backend available for context size"
    - Test: `phaseBackends` override forces specific backend for a phase
    - Test: `preferredBackend` (retry) overrides `phaseBackends`
    - Test: `agent:backend-selected` event emitted with valid `reason` field
    - Test: `phaseBackends` referencing non-existent backend throws `ZodError` at config validation
    - Test: `phaseBackends` referencing disabled backend throws `ZodError` at config validation
    - Test: configurable review council — custom `reviewers` array with custom roles, votes match roles
    - Test: `reviewers` takes precedence over `perspectives`
    - Test: legacy `perspectives` converted to reviewers
    - Test: single reviewer consensus logic (approve → passed, reject → rejected)
    - Test: 4 reviewers, 2 approve → `passed-with-warnings`
    - Test: per-reviewer backend assignment with `agent:backend-selected` event
    - Test: reviewer with no backend falls back to heuristic review
    - Test: `reviewBudgetUsd` cap respected
    - Test: `reviewers[].backend` referencing non-existent backend throws `ZodError` at config validation
    - Test: `reviewers[].backend` referencing disabled backend throws `ZodError` at config validation
    - Test: `reviewers` array with duplicate `role` strings throws `ZodError` mentioning uniqueness
    - Test: context capping removes files in reverse relevance order, `removedFiles` populated
    - Test: `charsPerToken` affects token estimation (lower value → more aggressive capping)
    - Test: phase timeout — configure short timeout, mock backend with long delay, verify `phase:timeout` event
    - Test: abort signal propagation — cancel run during phase, verify `AbortSignal` aborted
    - Test: `SpecWriter` writes `execution-log.md` with timestamped phase transition entries
    - Test: `SpecWriter` writes `status.json` with `currentPhase`, `runStatus`, `lastUpdated`, `runId`
    - Test: delivery agent output — `DeliveryResult` with `branch` matching `kaso/{feature}-delivery-{timestamp}`, `commits` array, `summary`
    - Test: delivery graceful fallback when `gh` CLI unavailable (`prUrl` undefined)
    - Test: cost attribution per backend — `backendCosts[name]` matches sum of that backend's invocations
    - _Requirements: 20.1–20.10, 20.11, 20.12, 21.1–21.3, 22.1–22.4, 23.1–23.3, 24.1–24.2, 25.1–25.8, 15.1–15.11, 16.1–16.5_

- [x] 13. Checkpoint — Ensure Tier 4 tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Implement property-based tests
  - [x] 14.1 Create `tests/property/e2e-validation.property.test.ts` — scaffolding and config properties
    - **Property 1: Scaffolded config always passes schema validation**
    - **Validates: Requirements 1.1**

  - [x] 14.2 Write property tests for mock backend contract
    - **Property 2: Mock backend contract — execute() returns configured values, ≥2 progress events**
    - **Validates: Requirements 2.2, 2.3**
    - **Property 3: Mock backend delay is respected**
    - **Validates: Requirements 2.7**

  - [x] 14.3 Write property tests for pipeline event invariants
    - **Property 4: Phase events are paired for every phase**
    - **Validates: Requirements 3.4, 9.1**
    - **Property 5: Phase result timing invariants**
    - **Validates: Requirements 3.5**
    - **Property 6: Phase sequence numbers are monotonically increasing**
    - **Validates: Requirements 3.6**
    - **Property 13: All events have valid structure**
    - **Validates: Requirements 9.4**

  - [x] 14.4 Write property tests for phase output shapes
    - **Property 7: Phase output shapes match their interfaces**
    - **Validates: Requirements 4.1–4.8**
    - **Property 8: UI diff threshold controls approval**
    - **Validates: Requirements 4.11**

  - [x] 14.5 Write property tests for checkpoint and cost tracking
    - **Property 9: Checkpoint exists after each phase**
    - **Validates: Requirements 5.5**
    - **Property 10: Cost accumulation formula**
    - **Validates: Requirements 6.5**
    - **Property 35: Cost attribution per backend**
    - **Validates: Requirements 25.8**

  - [x] 14.6 Write property tests for worktree behavior
    - **Property 11: Worktree branch naming convention**
    - **Validates: Requirements 8.1**
    - **Property 12: Worktree filesystem isolation**
    - **Validates: Requirements 8.5**

  - [x] 14.7 Write property tests for SSE and webhook behavior
    - **Property 14: SSE runId filtering**
    - **Validates: Requirements 9.6**
    - **Property 15: Webhook payload structure**
    - **Validates: Requirements 10.2**
    - **Property 16: Webhook signature round-trip**
    - **Validates: Requirements 10.3, 10.4**

  - [x] 14.8 Write property tests for plugins and MCP
    - **Property 17: Custom phase injection position**
    - **Validates: Requirements 12.2**
    - **Property 18: MCP tools scoped to implementation phase only**
    - **Validates: Requirements 13.4**
    - **Property 19: FileWatcher debounce**
    - **Validates: Requirements 14.4**

  - [x] 14.9 Write property tests for review council and delivery
    - **Property 20: Review council votes match configured reviewers**
    - **Validates: Requirements 15.4, 15.6**
    - **Property 21: Delivery branch naming convention**
    - **Validates: Requirements 16.2**
    - **Property 33: Per-reviewer backend assignment**
    - **Validates: Requirements 25.1**

  - [x] 14.10 Write property tests for error handling and retries
    - **Property 22: Retry count bounded by maxPhaseRetries**
    - **Validates: Requirements 18.1**

  - [x] 14.11 Write property tests for execution store
    - **Property 23: Execution store run and phase records persist**
    - **Validates: Requirements 19.1, 19.2**
    - **Property 24: Execution store ordering**
    - **Validates: Requirements 19.3**
    - **Property 25: Status update round-trip**
    - **Validates: Requirements 19.4**
    - **Property 26: getInterruptedRuns returns only non-terminal runs**
    - **Validates: Requirements 19.5**

  - [x] 14.12 Write property tests for backend selection
    - **Property 27: Context-aware selection picks cheapest fitting backend**
    - **Validates: Requirements 20.1, 20.3, 20.4, 20.5**
    - **Property 28: Backend selection event reason is valid**
    - **Validates: Requirements 20.10**
    - **Property 34: Backend-selected events match expected backends per phase**
    - **Validates: Requirements 25.7**

  - [x] 14.13 Write property tests for context capping
    - **Property 29: Context capping removes files in reverse relevance order**
    - **Validates: Requirements 21.1, 21.3**
    - **Property 30: charsPerToken affects token estimation**
    - **Validates: Requirements 21.2**

  - [x] 14.14 Write property tests for spec writer
    - **Property 31: SpecWriter phase transition entries**
    - **Validates: Requirements 23.2**
    - **Property 32: SpecWriter status.json fields**
    - **Validates: Requirements 23.3**

- [x] 15. Checkpoint — Ensure property tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 16. Add CI configuration and npm scripts
  - [x] 16.1 Add E2E npm scripts to `package.json`
    - Add `test:e2e` script running all E2E tiers
    - Add `test:e2e:tier1` script: `vitest run tests/e2e/tier1-*.e2e.test.ts`
    - Add `test:e2e:tier2` script: `vitest run tests/e2e/tier2-*.e2e.test.ts`
    - Add `test:e2e:tier3` script: `vitest run tests/e2e/tier3-*.e2e.test.ts`
    - Add `test:e2e:tier4` script: `vitest run tests/e2e/tier4-*.e2e.test.ts`
    - Configure appropriate timeouts per tier (60s/120s/180s/300s)
    - _Requirements: Tier strategy from design_

  - [ ] 16.2 Write a smoke test verifying each npm script glob matches expected files
    - _Requirements: CI execution strategy_

- [ ] 17. Final checkpoint — Ensure all E2E tests, property tests, and existing tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (35 properties across 14 sub-tasks)
- All helpers go in `tests/e2e/helpers/` without `.test.ts` extension
- MockBackend is the ONLY mock — everything else uses real components via `initializeKASO()`
- In-memory SQLite (`:memory:`) for execution store, temp directories for mock projects
