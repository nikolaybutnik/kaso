# Implementation Plan: Real-World Smoke Run

## Overview

Build a standalone smoke runner script (`scripts/smoke-run.ts`) that scaffolds a realistic test project, runs KASO's full 8-phase pipeline with a mock backend, validates every phase output and system behavior, and prints a structured pass/fail report. Reuses existing E2E helpers. Includes a thin Vitest wrapper for CI.

## Tasks

- [ ] 1. Add `tsx` devDependency and `smoke` npm script
  - Run `npm install --save-dev tsx` to add the zero-config TS executor
  - Add `"smoke": "tsx scripts/smoke-run.ts"` to `package.json` scripts
  - _Requirements: 10.1_

- [ ] 2. Create core types and SmokeRunner class skeleton
  - [ ] 2.1 Define `CheckResult`, `SmokeReport`, `SmokeProjectContext`, `KASOContext`, and `PipelineResult` interfaces in `scripts/smoke-run.ts`
    - `CheckResult`: `name`, `passed`, `expected?`, `actual?`, `description?`, `requirement?`
    - `SmokeReport`: `checks`, `durationMs`, `runId?`, `allPassed`, `passedCount`, `failedCount`, `fatalError?`
    - _Requirements: 9.1, 9.2_

  - [ ] 2.2 Implement `SmokeRunner` class with `run()` method that wraps `runInternal()` in a `Promise.race()` with a 60-second timeout
    - On timeout: capture timeout error into report, proceed to cleanup and report generation
    - `run()` returns `SmokeReport`
    - _Requirements: 10.2_

  - [ ] 2.3 Implement report formatting and `main()` entry point
    - `formatReport(report: SmokeReport): string` — produces the box-drawing stdout report with ✓/✗ per check, expected/actual on failures, summary line with counts and duration
    - `main()` — instantiates `SmokeRunner`, calls `run()`, prints report, exits with code 0 (all pass) or 1 (any fail)
    - Top-level try/catch in `main()` for unhandled exceptions: print diagnostic to stderr, attempt cleanup, exit 1
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 10.5_

- [ ] 3. Implement `scaffoldSmokeProject()`
  - [ ] 3.1 Create the scaffolding function that calls `createMockProject()` with rich spec content
    - Import `createMockProject` from `tests/e2e/helpers/mock-project`
    - Provide realistic `requirements.md` content: 3+ requirements, 6+ EARS WHEN/THEN/SHALL acceptance criteria, glossary, data model with TypeScript interface code block
    - Provide realistic `design.md` content: glossary, implementation details with request/response JSON schemas (2+ code blocks), data model with TypeScript interfaces, security section
    - Provide realistic `tasks.md` content: 2+ phases, 4+ top-level tasks, 6+ subtasks, mix of `[x]` and `[ ]` items
    - Pass config overrides for `:memory:` execution store
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 2.4_

  - [ ] 3.2 Layer `git init` + initial commit on top of the mock project directory
    - Run `git init` in the temp directory
    - Run `git add .` and `git commit -m "Initial commit"` to create a valid repo with a `main` branch
    - This is a hard blocker for worktree creation — worktrees require a git repo with at least one commit
    - _Requirements: 1.3_

  - [ ] 3.3 Create additional realistic source files in the scaffolded project
    - Write `src/index.ts` and `src/app.ts` with minimal valid TypeScript
    - Write `tsconfig.json` in the project root
    - Stage and commit these files so the git repo is clean
    - _Requirements: 1.1_

- [ ] 4. Implement KASO initialization and mock backend registration
  - [ ] 4.1 Implement `initializeKASOForSmoke()` that calls `initializeKASO()` with the scaffolded project's config path
    - Verify the returned `ApplicationContext` contains: `eventBus`, `executionStore`, `orchestrator`, `agentRegistry`, `backendRegistry`
    - Create `EventCollector` from `tests/e2e/helpers/event-collector` subscribed to the event bus
    - Create `PhaseValidator` from `tests/e2e/helpers/phase-validator` with the execution store
    - _Requirements: 3.1, 3.2_

  - [ ] 4.2 Register mock backend with realistic phase responses
    - Import `MockBackend` from `tests/e2e/helpers/mock-backend` and `createDefaultPhaseResponses` from `tests/e2e/helpers/phase-outputs`
    - Register via `backendRegistry.registerBackend('mock-backend', backend)`
    - Override UI validation response: `approved: true`, `uiIssues: []`, `skipped: true` (non-UI spec)
    - Ensure `implementation.backend` value in the mock response matches `'mock-backend'`
    - _Requirements: 3.3, 5.4, 5.7_

  - [ ] 4.3 Handle initialization failures
    - If `initializeKASO()` throws, capture error with full context (config path, error message) into a `CheckResult` with `passed: false`
    - Skip all pipeline and validation checks, proceed to cleanup and report
    - _Requirements: 3.4_

- [ ] 5. Checkpoint — Verify scaffolding and initialization work
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement pipeline execution and validation checks
  - [ ] 6.1 Implement `executePipeline()` that calls `orchestrator.startRun({ specPath })`
    - Capture `runId` and `status` from the result
    - If status is not `completed`, capture failing phase name and error into `CheckResult`
    - _Requirements: 4.1, 4.2, 4.5_

  - [ ] 6.2 Implement scaffolding validation checks
    - Verify temp dir exists with `package.json`, `tsconfig.json`, `src/` directory
    - Verify `.kiro/` directory with `specs/` and `steering/` subdirectories
    - Verify git repo initialized with at least one commit on `main`
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ] 6.3 Implement spec file content validation checks
    - Verify `requirements.md` has EARS patterns (WHEN/THEN/SHALL), 3+ requirements, 6+ acceptance criteria
    - Verify `design.md` has 2+ code blocks
    - Verify `tasks.md` has checkbox syntax, 2+ phases, 6+ subtasks
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 6.4 Implement pipeline completion validation checks
    - Verify run status is `completed`
    - Verify `executionStore.getPhaseResults(runId)` returns exactly 8 records
    - Verify all 8 phase results have status `success`
    - Verify sequence numbers are monotonically increasing 0–7
    - _Requirements: 4.2, 4.3, 4.4_

  - [ ] 6.5 Implement phase output shape and content validation checks
    - For each of the 8 phases, verify output contains all required keys per `PHASE_OUTPUT_SHAPES` from `phase-validator.ts`
    - Content checks beyond shape: `intake.featureName` is non-empty string, `intake.designDoc` has at least one section, `intake.taskList` has at least one item
    - `implementation.backend` matches `'mock-backend'`
    - `review-delivery.votes` has `length >= 1`
    - `ui-validation.approved === true` with either `uiIssues: []` or `skipped: true`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [ ] 6.6 Implement event stream validation checks
    - Verify at least one `run:started` and one `run:completed` event
    - Verify `phase:started` and `phase:completed` events for all 8 phases
    - Verify ordering: `run:started` before first `phase:started`, last `phase:completed` before `run:completed`
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ] 6.7 Implement execution persistence validation checks
    - Verify `executionStore.getRun(runId)` returns record with status `completed`, correct specPath, non-empty `worktreePath`
    - Verify `executionStore.getPhaseResults(runId)` returns 8 records with valid timestamps (`completedAt` not before `startedAt`)
    - Verify `execution-log.md` exists in spec directory with at least one log entry
    - Verify `status.json` exists in spec directory with `runId` and terminal status
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ] 6.8 Implement worktree lifecycle validation checks
    - Verify a worktree was created under `.kaso/worktrees/` with a `kaso/` branch prefix (check via event collector for `worktree:created` or run record's `worktreePath`)
    - Verify worktree is cleaned up after `shutdownKASO()` (directory no longer exists)
    - _Requirements: 8.1, 8.2_

- [ ] 7. Implement cleanup logic
  - [ ] 7.1 Implement `cleanup()` method using finally-block pattern
    - Call `shutdownKASO()` if KASO was initialized (handles worktree cleanup)
    - Remove temp directory via `rmSync(dir, { recursive: true, force: true })`
    - Clean up any `kaso/*` git branches created during the run
    - All cleanup operations are best-effort (errors logged but don't prevent other cleanup steps)
    - _Requirements: 1.4, 1.5_

- [ ] 8. Checkpoint — Verify full smoke run works end-to-end
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Wire `runInternal()` to orchestrate the full flow
  - [ ] 9.1 Implement `runInternal()` that sequences: scaffold → init → execute → validate → cleanup
    - Collect all `CheckResult` objects from each phase
    - Build `SmokeReport` with aggregated results, duration, runId
    - Ensure cleanup runs in `finally` block regardless of success/failure
    - _Requirements: 9.1, 9.4, 10.3, 10.4_

- [ ] 10. Create thin Vitest wrapper for CI integration
  - [ ] 10.1 Create `tests/smoke/smoke-run.integration.test.ts`
    - Import `SmokeRunner` from `scripts/smoke-run`
    - Single test: instantiate runner, call `run()`, assert `report.allPassed === true` and `report.failedCount === 0`
    - Set 60s timeout on the test
    - _Requirements: 10.1_

- [ ]* 10.2 Write unit tests for report formatting
    - Test `formatReport()` produces correct output for all-pass scenario
    - Test `formatReport()` produces correct output for mixed pass/fail scenario with expected/actual values
    - Test exit code mapping: `allPassed: true` → 0, `allPassed: false` → 1
    - _Requirements: 9.1, 9.2, 9.3_

- [ ]* 10.3 Write property test for scaffolding completeness (Property 1)
    - **Property 1: Scaffolding completeness invariant**
    - Generate random valid kebab-case feature names, call `scaffoldSmokeProject()`, verify all required files/dirs exist, clean up after each iteration
    - **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 3.1**

- [ ]* 10.4 Write property test for exit code mapping (Property 7)
    - **Property 7: Exit code reflects report status**
    - Generate random `SmokeReport` objects with varying `allPassed` values, verify exit code mapping is correct
    - **Validates: Requirements 9.3**

- [ ] 11. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The smoke runner is a standalone script (`scripts/smoke-run.ts`), NOT a Vitest test — but has a thin Vitest wrapper (task 10.1) for CI
- `tsx` is required as a devDependency for running the script directly
- The scaffolding MUST include `git init` + initial commit — this is a hard blocker for worktree creation
- UI phase will be skipped by the pipeline (non-UI spec) — validation checks should accept `approved: true` with empty `uiIssues` or `skipped: true`
- Phase output validation includes content checks, not just shape: `votes.length >= 1`, non-empty `featureName`, `backend` name match
- 60s timeout via `Promise.race()` in `SmokeRunner.run()`
- Reuses existing E2E helpers: `mock-backend`, `mock-project`, `phase-outputs`, `event-collector`, `phase-validator`
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
