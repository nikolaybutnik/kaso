# Requirements Document

## Introduction

KASO (Kiro-Enabled Agent Swarm Orchestrator) has 871 passing unit and property-based tests but has never been validated as a complete working system. This feature creates a comprehensive end-to-end validation test project that exercises the full 8-phase pipeline from project setup through every subsystem, proving KASO works as a real orchestration system — not just that individual components pass isolated tests.

The test project starts from complete zero: project scaffolding, configuration, mock backends, mock Kiro spec files, and runs the full pipeline end-to-end. It validates every phase transition, crash recovery, cost enforcement, concurrency rejection, worktree lifecycle, event streaming, webhook delivery, CLI operations, plugin loading, MCP tool invocation, file watcher triggers, review council consensus, delivery agent output, backend selection strategies, context capping, phase timeouts, and abort signal propagation.

### Test Execution Tier Strategy

Tests are organized into tiers to balance CI speed with comprehensive coverage:

- **Tier 1: Core Pipeline (Req 1–4, 19)** — Always run on every commit. Validates project scaffolding, mock backends, full 8-phase pipeline execution, phase output shapes, and execution store persistence.
- **Tier 2: Error Handling & Recovery (Req 5–7, 17–18)** — Run on PR. Validates crash recovery, cost budget enforcement, concurrent run rejection, pause/resume, and error handling with retries.
- **Tier 3: Integration Features (Req 8–14)** — Run on PR. Validates worktree lifecycle, SSE streaming, webhook delivery, CLI commands, plugin loading, MCP tool invocation, and file watcher triggers.
- **Tier 4: Advanced Scenarios (Req 20–24)** — Run nightly. Validates backend selection strategies, context capping, phase timeouts, spec writer output, and abort signal propagation.

## Glossary

- **E2E_Test_Harness**: The top-level test orchestration module that sets up the mock project environment, initializes KASO via `initializeKASO()`, and coordinates test execution across all validation scenarios
- **Mock_Project**: A temporary filesystem structure containing a valid `kaso.config.json`, mock Kiro spec files (design.md, tasks.md), steering files, and architecture documents that KASO can consume as a real project
- **Mock_Backend**: A custom `ExecutorBackend` implementation that simulates AI coding tool responses with configurable behavior (success, failure, token usage, delays) without spawning real processes
- **Mock_Spec**: A set of Kiro-format specification files (`design.md`, `tasks.md`) placed under `.kiro/specs/` that represent a realistic feature for the pipeline to process
- **Pipeline_Runner**: The component that invokes `Orchestrator.startRun()` with a Mock_Spec path and collects all events, phase results, and side effects during execution
- **Event_Collector**: A test utility that subscribes to the EventBus via `onAny()` and accumulates all emitted ExecutionEvents for assertion
- **Webhook_Receiver**: A local HTTP server started within the test process that receives webhook POST requests from the WebhookDispatcher and records payloads for verification
- **SSE_Client**: A test HTTP client that connects to the SSEServer endpoint and collects streamed events for assertion
- **Phase_Validator**: A test utility that inspects PhaseResultRecords from the ExecutionStore to verify correct phase ordering, status, timing, and output shapes
- **Orchestrator**: The central `Orchestrator` class from `src/core/orchestrator.ts` that drives the 8-phase pipeline
- **ApplicationContext**: The `ApplicationContext` interface from `src/index.ts` containing all wired KASO components

## Requirements

### Requirement 1: Mock Project Scaffolding

**User Story:** As a KASO developer, I want an automated test fixture that creates a realistic mock project directory, so that end-to-end tests have a valid environment to run against.

#### Acceptance Criteria

1. WHEN the E2E_Test_Harness initializes, THE E2E_Test_Harness SHALL create a temporary directory containing a valid `kaso.config.json` that passes Zod schema validation via `validateConfig()`
2. WHEN the E2E_Test_Harness initializes, THE E2E_Test_Harness SHALL create mock Kiro spec files under a `.kiro/specs/{feature-name}/` subdirectory containing at minimum a `design.md` and a `tasks.md` file
3. WHEN the E2E_Test_Harness initializes, THE E2E_Test_Harness SHALL create steering files under `.kiro/steering/` including `coding_practices.md` and `personality.md`
4. THE E2E_Test_Harness SHALL configure the `kaso.config.json` to use an in-memory SQLite execution store (path `:memory:`) to avoid filesystem pollution
5. WHEN the E2E_Test_Harness completes all tests, THE E2E_Test_Harness SHALL remove the temporary directory and all created worktrees
6. THE Mock_Spec design.md SHALL contain at least one requirement section with EARS-pattern acceptance criteria, a glossary, and an introduction section

### Requirement 2: Mock Backend Configuration

**User Story:** As a KASO developer, I want configurable mock executor backends that simulate real AI tool responses, so that the pipeline can execute without real AI services.

#### Acceptance Criteria

1. THE Mock_Backend SHALL implement the `ExecutorBackend` interface with `execute()`, `isAvailable()`, `onProgress()`, `name`, `protocol`, `maxContextWindow`, and `costPer1000Tokens` properties
2. WHEN the Mock_Backend receives an execute request, THE Mock_Backend SHALL return a `BackendResponse` with configurable `success`, `tokensUsed`, `duration`, and `output` fields
3. THE Mock_Backend SHALL emit at least two `BackendProgressEvent` objects via registered `onProgress` callbacks during execution to validate NDJSON streaming
4. WHEN the Mock_Backend is configured to fail, THE Mock_Backend SHALL return `{ success: false }` with an error message and a configurable `retryable` flag
5. THE Mock_Backend SHALL be registerable via `BackendRegistry.registerBackend()` so the Orchestrator uses the mock instead of spawning real processes
6. THE Mock_Backend SHALL report configurable `tokensUsed` values so cost tracking can be validated with known expected costs
7. WHEN the Mock_Backend is configured with a delay, THE Mock_Backend SHALL wait the specified milliseconds before returning to enable timeout testing

### Requirement 3: Full 8-Phase Pipeline Execution

**User Story:** As a KASO developer, I want to run the complete 8-phase pipeline end-to-end with mock backends, so that I can verify every phase executes in order and produces correct outputs.

#### Acceptance Criteria

1. WHEN the Pipeline_Runner starts a run with a valid Mock_Spec, THE Orchestrator SHALL execute all 8 phases in order: intake, validation, architecture-analysis, implementation, architecture-review, test-verification, ui-validation, review-delivery
2. WHEN the pipeline completes successfully, THE Orchestrator SHALL emit a `run:completed` event with the run ID
3. WHEN the pipeline completes successfully, THE ExecutionStore SHALL contain a run record with status `completed` and 8 PhaseResultRecords each with status `success`
4. FOR EACH phase in the pipeline, THE Orchestrator SHALL emit a `phase:started` event before execution and a `phase:completed` event after successful execution
5. WHEN the pipeline completes, THE Phase_Validator SHALL verify that each PhaseResultRecord has a non-zero `duration`, a valid `startedAt` timestamp, and a valid `completedAt` timestamp
6. WHEN the pipeline completes, THE Phase_Validator SHALL verify that phase sequence numbers are monotonically increasing from 0 to 7
7. THE Orchestrator SHALL create a git worktree before phase execution begins and the worktree path SHALL exist on disk during the run

### Requirement 4: Phase Output Validation

**User Story:** As a KASO developer, I want to verify that each phase produces correctly-shaped output objects, so that downstream phases receive the data they expect.

#### Acceptance Criteria

1. WHEN the intake phase completes, THE Phase_Validator SHALL verify the output contains `featureName`, `designDoc`, and `taskList` fields matching the `AssembledContext` interface
2. WHEN the validation phase completes, THE Phase_Validator SHALL verify the output contains an `approved` boolean and an `issues` array matching the `ValidationReport` interface
3. WHEN the architecture-analysis phase completes, THE Phase_Validator SHALL verify the output contains `patterns`, `moduleBoundaries`, and `adrsFound` fields matching the `ArchitectureContext` interface
4. WHEN the implementation phase completes, THE Phase_Validator SHALL verify the output contains `modifiedFiles`, `addedTests`, `duration`, and `backend` fields matching the `ImplementationResult` interface
5. WHEN the architecture-review phase completes, THE Phase_Validator SHALL verify the output contains `approved` and `violations` fields matching the `ArchitectureReview` interface
6. WHEN the test-verification phase completes, THE Phase_Validator SHALL verify the output contains `passed`, `testsRun`, `coverage`, and `duration` fields matching the `TestReport` interface
7. WHEN the ui-validation phase completes, THE Phase_Validator SHALL verify the output contains `approved` and `uiIssues` fields matching the `UIReview` interface, AND when a baseline screenshot exists, the `diffPercentage` field SHALL be calculated and present in the screenshot metadata
8. WHEN the review-delivery phase completes, THE Phase_Validator SHALL verify the output contains `consensus` and `votes` fields matching the `ReviewCouncilResult` interface
9. WHEN the implementation phase returns `success: false` with `retryable: true`, THE ExecutorAgent SHALL retry up to 3 times passing failure context from the previous attempt to the backend
10. WHEN the implementation phase completes after self-correction retries, THE `ImplementationResult.selfCorrectionAttempts` field SHALL equal the number of retry attempts performed
11. WHEN the `diffPercentage` of a UI screenshot exceeds the `uiBaseline.diffThreshold` configured in `kaso.config.json`, THE `UIReview.approved` field SHALL be false

### Requirement 5: Crash Recovery Validation

**User Story:** As a KASO developer, I want to verify that KASO can recover from a mid-pipeline crash, so that interrupted runs resume from the last checkpoint rather than restarting.

#### Acceptance Criteria

1. WHEN a run is interrupted after the implementation phase checkpoint is saved, THE Orchestrator SHALL have a checkpoint record in the ExecutionStore for that run ID
2. WHEN `recoverInterruptedRuns()` is called after a simulated crash, THE Orchestrator SHALL detect the non-terminal run record in the ExecutionStore
3. WHEN recovery is attempted for a run with a valid worktree, THE Orchestrator SHALL verify the worktree path exists on disk via `WorktreeManager.isConsistent()`
4. WHEN recovery is attempted for a run with a missing or corrupted worktree, THE Orchestrator SHALL mark the run as `failed` in the ExecutionStore
5. THE CheckpointManager SHALL have a checkpoint containing the run ID, current phase, and serialized phase outputs after each phase completion

### Requirement 6: Cost Budget Enforcement

**User Story:** As a KASO developer, I want to verify that KASO halts execution when the cost budget is exceeded, so that runaway costs are prevented.

#### Acceptance Criteria

1. WHEN the `kaso.config.json` specifies a `costBudgetPerRun` of 0.05 USD and the Mock_Backend reports 10000 tokens per phase at 0.01 USD per 1000 tokens, THE Orchestrator SHALL halt the pipeline before all 8 phases complete
2. WHEN the cost budget is exceeded, THE Orchestrator SHALL emit a `run:budget_exceeded` event
3. WHEN the cost budget is exceeded, THE ExecutionStore SHALL contain a run record with status `failed`
4. WHEN the cost budget is exceeded, THE Orchestrator SHALL preserve the worktree for manual inspection rather than cleaning it up
5. THE CostTracker SHALL accurately accumulate costs across phases using the formula `(tokensUsed / 1000) * costPer1000Tokens`

### Requirement 7: Concurrent Run Rejection

**User Story:** As a KASO developer, I want to verify that KASO rejects concurrent runs for the same spec, so that conflicting modifications are prevented.

#### Acceptance Criteria

1. WHILE a run is active for spec path `/mock/specs/feature-a`, WHEN a second `startRun()` is called with the same spec path, THE Orchestrator SHALL throw an error containing the text "active run already exists"
2. WHEN the first run completes, THE Orchestrator SHALL accept a new `startRun()` call for the same spec path without error
3. WHILE a run is active for spec path `/mock/specs/feature-a`, WHEN a `startRun()` is called for a different spec path `/mock/specs/feature-b`, THE Orchestrator SHALL accept the second run without error

### Requirement 8: Worktree Lifecycle Validation

**User Story:** As a KASO developer, I want to verify the complete worktree lifecycle (creation, isolation, cleanup), so that file modifications are safely isolated from the main working directory.

#### Acceptance Criteria

1. WHEN a run starts, THE WorktreeManager SHALL create a worktree under `.kaso/worktrees/` with a branch name matching the pattern `kaso/{specName}-{timestamp}`
2. WHILE a run is executing, THE worktree directory SHALL exist on disk and be a valid git worktree
3. WHEN a run completes successfully, THE WorktreeManager SHALL remove the worktree directory from disk
4. WHEN a run is cancelled, THE WorktreeManager SHALL preserve the worktree directory for manual inspection
5. THE worktree SHALL be isolated from the main working directory such that files created in the worktree do not appear in the main directory
6. WHEN `retain(runId)` is called on a worktree, THE WorktreeManager SHALL prevent cleanup of that worktree on successful run completion
7. WHEN `isConsistent(runId)` is called on a corrupted or missing worktree, THE WorktreeManager SHALL return false
8. WHEN `loadExistingWorktrees()` is called after a process restart, THE WorktreeManager SHALL discover worktrees from previous runs on disk and populate its internal registry for recovery

### Requirement 9: Event Bus and SSE Streaming Validation

**User Story:** As a KASO developer, I want to verify that execution events are emitted correctly and streamed to SSE clients, so that real-time observability works end-to-end.

#### Acceptance Criteria

1. WHEN a full pipeline run executes, THE Event_Collector SHALL receive at minimum: 1 `run:started` event, 8 `phase:started` events, 8 `phase:completed` events, and 1 `run:completed` event
2. WHEN the SSEServer is enabled and a SSE_Client connects to the `/events` endpoint, THE SSE_Client SHALL receive events as `data:` lines containing JSON-serialized event payloads
3. WHEN the SSEServer receives a request to `/health`, THE SSEServer SHALL respond with HTTP 200 and a JSON body containing `{ "status": "ok" }`
4. THE Event_Collector SHALL verify that all events have a non-empty `runId`, a valid ISO 8601 `timestamp`, and a valid `type` from the `EventType` union
5. WHEN a SSE_Client disconnects, THE SSEServer SHALL decrement the client count and the `getClientCount()` method SHALL reflect the updated count
6. WHEN a SSE_Client connects with a `?runId=xxx` query parameter, THE SSEServer SHALL only forward events matching that run ID to the client
7. WHEN a SSE_Client connects with an invalid Bearer token and `authToken` is configured, THE SSEServer SHALL respond with HTTP 401 Unauthorized
8. WHEN a SSE_Client reconnects with a `Last-Event-ID` header, THE SSEServer SHALL replay missed events from the EventBus history starting after the specified event ID

### Requirement 10: Webhook Delivery Validation

**User Story:** As a KASO developer, I want to verify that webhooks are delivered correctly during pipeline execution, so that external systems can be notified of run lifecycle events.

#### Acceptance Criteria

1. WHEN the `kaso.config.json` configures a webhook URL pointing to the Webhook_Receiver, THE WebhookDispatcher SHALL deliver POST requests to that URL for configured event types
2. WHEN a webhook is delivered, THE Webhook_Receiver SHALL receive a JSON payload containing `event`, `runId`, `timestamp`, and `data` fields matching the `WebhookPayload` interface
3. WHEN a webhook is configured with a `secret`, THE WebhookDispatcher SHALL include an `X-KASO-Signature` header containing a valid HMAC-SHA256 signature of the payload
4. WHEN the Webhook_Receiver verifies the signature using the shared secret, THE signature SHALL match the computed HMAC-SHA256 of the received payload body
5. THE Webhook_Receiver SHALL receive at minimum a `run:started` and a `run:completed` (or `run:failed`) webhook during a full pipeline run
6. WHEN the Webhook_Receiver returns an HTTP 5xx response, THE WebhookDispatcher SHALL retry delivery with exponential backoff capped at 30 seconds
7. WHEN all retry attempts are exhausted for a webhook delivery, THE WebhookDispatcher SHALL mark the delivery as failed and the `WebhookDeliveryResult.success` field SHALL be false
8. WHEN the WebhookDispatcher retries a delivery, THE request SHALL include an `X-KASO-Delivery-Attempt` header containing the current attempt number

### Requirement 11: CLI Command Validation

**User Story:** As a KASO developer, I want to verify that CLI commands work correctly against a live orchestrator, so that the command-line interface is validated end-to-end.

#### Acceptance Criteria

1. WHEN the `status` command is called with a valid run ID, THE CLI SHALL display the run status, current phase, elapsed time, and cost
2. WHEN the `status` command is called without a run ID, THE CLI SHALL list all active runs
3. WHEN the `cost` command is called with a valid run ID, THE CLI SHALL display the cost breakdown for that run
4. WHEN the `history` command is called, THE CLI SHALL display recent run records from the ExecutionStore
5. WHEN the `doctor` command is called, THE CLI SHALL report the health status of all KASO components
6. WHEN the `cancel` command is called with a valid active run ID, THE CLI SHALL cancel the run and the run status SHALL become `cancelled`

### Requirement 12: Plugin Loading and Custom Phase Injection

**User Story:** As a KASO developer, I want to verify that plugins can be loaded and custom phases injected into the pipeline, so that the extensibility system works end-to-end.

#### Acceptance Criteria

1. WHEN a plugin package exports a valid `Agent` implementation, THE PluginLoader SHALL load the agent and register it with the AgentRegistry
2. WHEN a `customPhases` entry specifies a phase name matching `custom-{name}` and a valid position, THE PhaseInjector SHALL insert the custom phase at the specified position in the pipeline
3. WHEN a custom phase is injected at position 3, THE pipeline SHALL execute the custom phase between architecture-analysis (phase 3) and implementation (phase 4)
4. IF a plugin package fails to load, THEN THE PluginLoader SHALL record the failure in `getFailedLoads()` and continue loading remaining plugins without halting

### Requirement 13: MCP Client Tool Invocation

**User Story:** As a KASO developer, I want to verify that MCP tools are available during the implementation phase and can be invoked, so that the MCP integration works end-to-end.

#### Acceptance Criteria

1. WHEN the MCPClient is initialized with a mock server configuration, THE MCPClient SHALL report the server as connected via `getConnectionState()`
2. WHEN the implementation phase executes, THE AgentContext SHALL include `mcpTools` containing the tools registered for the mock MCP server
3. WHEN `invokeTool()` is called with a valid tool name and arguments, THE MCPClient SHALL return an `MCPInvocationResult` with `success: true` and the tool output
4. WHEN a non-implementation phase executes, THE AgentContext SHALL have `mcpTools` as undefined or empty, AND `MCPClient.isPhaseEligible(phase)` SHALL return false for that phase, confirming phase-scoped tool access
5. IF the MCP server becomes unavailable during execution, THEN THE MCPClient SHALL mark tools as unavailable and the pipeline SHALL continue execution without halting

### Requirement 14: File Watcher Trigger Validation

**User Story:** As a KASO developer, I want to verify that the file watcher detects spec status changes and triggers pipeline runs, so that automatic run triggering works end-to-end.

#### Acceptance Criteria

1. WHEN a `status.json` file is written to a spec directory with `{ "runStatus": "pending" }`, THE FileWatcher SHALL detect the change and invoke the registered callback with the spec path and spec name
2. WHEN a `status.json` file is written with `{ "runStatus": "running" }`, THE FileWatcher SHALL not trigger the callback because the spec is not in a ready state
3. WHEN the FileWatcher is stopped via `stop()`, THE FileWatcher SHALL cease monitoring and `isWatching()` SHALL return false
4. THE FileWatcher SHALL debounce rapid status changes using the configurable `debounceMs` window from `FileWatcherConfig` so that multiple writes within the debounce window trigger only one callback invocation

### Requirement 15: Review Council Consensus Logic

**User Story:** As a KASO developer, I want to verify the review council's multi-perspective consensus logic with mock reviewers, so that the code review gate works correctly.

#### Acceptance Criteria

1. WHEN all 3 reviewer perspectives (security, performance, maintainability) approve, THE ReviewCouncilAgent SHALL produce a `ReviewCouncilResult` with `consensus: "passed"`
2. WHEN exactly 2 of 3 reviewer perspectives approve, THE ReviewCouncilAgent SHALL produce a `ReviewCouncilResult` with `consensus: "passed-with-warnings"`
3. WHEN fewer than 2 of 3 reviewer perspectives approve, THE ReviewCouncilAgent SHALL produce a `ReviewCouncilResult` with `consensus: "rejected"`
4. THE ReviewCouncilResult SHALL contain a `votes` array with one entry per configured perspective, each containing `perspective`, `approved`, `feedback`, and `severity` fields
5. WHEN the `reviewBudgetUsd` is configured, THE ReviewCouncilAgent SHALL respect the budget cap and stop additional review rounds when the budget is exhausted

### Requirement 16: Delivery Agent Output Validation

**User Story:** As a KASO developer, I want to verify that the delivery agent creates branches, commits, and PR metadata correctly, so that the final delivery step works end-to-end.

#### Acceptance Criteria

1. WHEN the delivery phase executes in a worktree, THE DeliveryAgent SHALL produce a `DeliveryResult` containing a `branch` name, a `commits` array, and a `summary` string
2. THE DeliveryResult `branch` field SHALL match the pattern `kaso/{feature}-delivery-{timestamp}`
3. THE DeliveryResult `commits` array SHALL contain at least one entry representing the conventional commit created for the implementation changes
4. WHEN the `gh` CLI is not available, THE DeliveryAgent SHALL gracefully skip PR creation and the `prUrl` field SHALL be undefined rather than causing a pipeline failure
5. WHEN the `gh` CLI is available (mocked via `CommandRunner`), THE DeliveryAgent SHALL invoke it to create a PR and the `DeliveryResult.prUrl` field SHALL contain the returned PR URL

### Requirement 17: Pause and Resume Validation

**User Story:** As a KASO developer, I want to verify that runs can be paused and resumed correctly, so that the workflow control system works end-to-end.

#### Acceptance Criteria

1. WHEN `pauseRun()` is called on an active run, THE Orchestrator SHALL complete the current phase and then set the run status to `paused`
2. WHEN `resumeRun()` is called on a paused run, THE Orchestrator SHALL set the run status to `running` and continue execution from the next pending phase
3. WHEN `pauseRun()` is called on a run that is not in `running` status, THE Orchestrator SHALL throw an error
4. WHEN a run is paused and then resumed, THE final run status SHALL be `completed` if all remaining phases succeed

### Requirement 18: Error Handling and Retry Validation

**User Story:** As a KASO developer, I want to verify that phase failures trigger correct error handling and retry behavior, so that the recovery system works end-to-end.

#### Acceptance Criteria

1. WHEN a phase fails with a retryable error and `maxPhaseRetries` is greater than 0, THE Orchestrator SHALL retry the phase up to the configured maximum
2. WHEN a phase fails with a non-retryable error, THE Orchestrator SHALL not retry and SHALL proceed according to the phase failure policy (halt, loopback, or skip)
3. WHEN the implementation phase fails, THE ErrorHandler SHALL classify the error and select a recovery strategy from: retry, rollback-retry, loopback, escalate, or halt
4. WHEN a phase is retried, THE Orchestrator SHALL emit a log entry containing the text "Retrying phase"
5. WHEN all retries are exhausted for a required phase, THE Orchestrator SHALL halt the pipeline and set the run status to `failed`

### Requirement 19: Execution Store Persistence Validation

**User Story:** As a KASO developer, I want to verify that all run data is correctly persisted to the execution store, so that the audit trail is complete and queryable.

#### Acceptance Criteria

1. WHEN a run completes, THE ExecutionStore SHALL contain a run record retrievable by run ID via `getRun()`
2. WHEN a run completes, THE ExecutionStore SHALL contain PhaseResultRecords for every executed phase retrievable via `getPhaseResults()`
3. THE ExecutionStore `getRuns()` method SHALL return runs ordered by most recent first
4. WHEN `updateRunStatus()` is called, THE ExecutionStore SHALL persist the new status and subsequent `getRun()` calls SHALL reflect the updated status
5. THE ExecutionStore SHALL support the `getInterruptedRuns()` query returning runs with non-terminal status for crash recovery
6. THE E2E_Test_Harness SHALL verify ExecutionStore functionality with both `sqlite` and `jsonl` store types to ensure dual-mode persistence works correctly

### Requirement 20: Backend Selection Strategy Testing

**User Story:** As a KASO developer, I want to verify that the backend selection strategy correctly picks backends based on context size and cost, so that the context-aware selection logic works end-to-end.

#### Acceptance Criteria

1. WHEN the `backendSelectionStrategy` is set to `context-aware` and multiple Mock_Backends are registered with different `maxContextWindow` and `costPer1000Tokens` values, THE BackendRegistry SHALL select the cheapest backend whose `maxContextWindow` fits the estimated context size
2. WHEN the preferred backend is unavailable (via `isAvailable()` returning false), THE BackendRegistry SHALL fall back to the next cheapest available backend that fits the context window
3. WHEN the estimated context size equals a backend's `maxContextWindow` exactly, THE BackendRegistry SHALL consider that backend eligible for selection (boundary: exact fit)
4. WHEN the estimated context size is one token over a backend's `maxContextWindow`, THE BackendRegistry SHALL exclude that backend from selection (boundary: just over)
5. WHEN the estimated context size is one token under a backend's `maxContextWindow`, THE BackendRegistry SHALL include that backend in selection (boundary: just under)
6. WHEN no registered backend has a `maxContextWindow` sufficient for the estimated context size, THE BackendRegistry SHALL throw an error containing the text "No backend available for context size"

### Requirement 21: Context Capping Validation

**User Story:** As a KASO developer, I want to verify that context capping correctly removes low-relevance files to fit within backend context windows, so that the intake phase produces right-sized context.

#### Acceptance Criteria

1. WHEN the assembled context exceeds the backend's `maxContextWindow`, THE SpecReaderAgent SHALL remove files in reverse `relevanceRanking` order (lowest relevance removed first) until the context fits
2. WHEN `charsPerToken` is configured to a non-default value in `ContextCappingStrategy`, THE SpecReaderAgent SHALL use that value for token estimation, affecting which files get removed
3. WHEN files are removed during context capping, THE `AssembledContext.removedFiles` array SHALL contain the paths of all removed files in the order they were removed
4. THE SpecReaderAgent SHALL apply context capping before the assembled context is passed to subsequent phases, ensuring no downstream phase receives an oversized context

### Requirement 22: Phase Timeout Enforcement

**User Story:** As a KASO developer, I want to verify that phase timeouts are enforced correctly, so that runaway phases are terminated and the pipeline fails gracefully.

#### Acceptance Criteria

1. WHEN a phase exceeds the `defaultPhaseTimeout` configured in `kaso.config.json`, THE Orchestrator SHALL emit a `phase:timeout` event and abort the phase execution
2. WHEN a `phaseTimeouts` entry overrides the default timeout for a specific phase, THE Orchestrator SHALL use the custom timeout value for that phase instead of the default
3. WHEN a phase times out, THE Orchestrator SHALL mark the run as `failed` in the ExecutionStore and preserve the worktree for manual inspection
4. WHEN a backend process exceeds its timeout, THE CLIProcessBackend SHALL escalate from SIGTERM to SIGKILL to ensure the process is terminated

### Requirement 23: Spec Writer Output Validation

**User Story:** As a KASO developer, I want to verify that the SpecWriter correctly writes execution logs and status files to spec directories, so that the bidirectional Kiro communication works end-to-end.

#### Acceptance Criteria

1. WHEN a run starts, THE SpecWriter SHALL create an `execution-log.md` file in the spec directory containing a `run:started` entry with the run ID and worktree path
2. WHEN a phase transition occurs, THE SpecWriter SHALL append a timestamped entry to `execution-log.md` containing the phase name and transition result (started, completed, or failed)
3. WHILE a run is executing, THE SpecWriter SHALL maintain a `status.json` file in the spec directory containing `currentPhase`, `runStatus`, `lastUpdated`, and `runId` fields matching the `SpecStatus` interface
4. WHEN a run completes or fails, THE SpecWriter SHALL append a summary entry to `execution-log.md` containing the final status and total cost

### Requirement 24: Abort Signal Propagation

**User Story:** As a KASO developer, I want to verify that cancelling a run correctly propagates an abort signal to the active agent, so that cooperative cancellation works end-to-end.

#### Acceptance Criteria

1. WHEN `cancelRun(runId)` is called on an active run, THE Orchestrator SHALL abort the `phaseAbortController` for the current phase, propagating an `AbortSignal` to the active agent
2. WHEN the Mock_Backend receives an aborted `AbortSignal` via the `AgentContext`, THE Mock_Backend SHALL stop execution and return a result with `success: false`
3. WHEN a run is cancelled, THE `AgentContext.abortSignal.aborted` property SHALL be `true` for the cancelled phase's context
