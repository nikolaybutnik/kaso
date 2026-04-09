# Requirements Document

## Introduction

KASO has 38 source files, 73 test files, and 1120 passing tests — but nobody has actually used it end-to-end as a real user would. This spec defines a real-world smoke run: scaffold a simple test application, create real Kiro spec files for it, configure KASO with a mock backend, and run the full 8-phase pipeline from `initializeKASO()` through `startRun()` to completion. The goal is to prove the system works as a user would experience it, identify every gap between "tests pass" and "the thing actually works," and fix those gaps.

This is NOT an E2E test. It is an actual usage scenario executed as a scripted smoke run that a developer can invoke to validate the entire system.

## Glossary

- **Smoke_Run**: A scripted, repeatable scenario that exercises KASO's full pipeline against a real (but simple) test application, validating that every phase produces meaningful output
- **Test_App**: A minimal Express/Node.js application scaffolded specifically as the target project for the smoke run
- **Smoke_Runner**: The executable script or module that orchestrates the smoke run from setup through validation
- **Mock_Backend**: An in-process implementation of the `ExecutorBackend` interface that returns realistic, phase-appropriate responses without calling external AI services
- **Phase_Output**: The structured result object produced by each of the 8 pipeline phases (e.g., `AssembledContext`, `ValidationReport`, `ImplementationResult`)
- **Spec_Files**: The Kiro specification files (`requirements.md`, `design.md`, `tasks.md`) that describe the Test_App's feature
- **Pipeline**: The sequential 8-phase execution flow: intake → validation → architecture-analysis → implementation → architecture-review → test-verification → ui-validation → review-delivery
- **Validation_Report**: A structured summary produced at the end of the smoke run documenting which phases passed, which failed, and what gaps were found

## Requirements

### Requirement 1: Test Application Scaffolding

**User Story:** As a developer, I want the smoke run to scaffold a realistic test application, so that KASO has a real project to operate on rather than empty fixtures.

#### Acceptance Criteria

1. WHEN the Smoke_Runner starts, THE Smoke_Runner SHALL create a temporary directory containing a valid Node.js project with `package.json`, `tsconfig.json`, and at least one source file under `src/`
2. WHEN the Test_App is scaffolded, THE Smoke_Runner SHALL create a `.kiro/` directory structure within the Test_App containing `specs/` and `steering/` subdirectories
3. WHEN the Test_App is scaffolded, THE Smoke_Runner SHALL initialize a git repository in the temporary directory with at least one commit on the `main` branch
4. IF the temporary directory already exists from a previous run, THEN THE Smoke_Runner SHALL remove the previous directory before creating a new one
5. WHEN the smoke run completes or fails, THE Smoke_Runner SHALL clean up the temporary directory and all associated git worktrees and branches

### Requirement 2: Realistic Spec File Generation

**User Story:** As a developer, I want the smoke run to use realistic Kiro spec files, so that the intake and validation phases exercise real parsing logic rather than trivial stubs.

#### Acceptance Criteria

1. WHEN the Test_App is scaffolded, THE Smoke_Runner SHALL create a `requirements.md` file following EARS patterns with at least 3 requirements and 6 acceptance criteria
2. WHEN the Test_App is scaffolded, THE Smoke_Runner SHALL create a `design.md` file containing a glossary, data model with TypeScript interfaces, implementation details with request/response schemas, and at least 2 code blocks
3. WHEN the Test_App is scaffolded, THE Smoke_Runner SHALL create a `tasks.md` file with at least 2 phases, 4 top-level tasks, and 6 subtasks using checkbox syntax
4. WHEN the Test_App is scaffolded, THE Smoke_Runner SHALL create at least one steering file under `.kiro/steering/` containing coding practices

### Requirement 3: KASO Configuration and Initialization

**User Story:** As a developer, I want the smoke run to configure and initialize KASO exactly as a real user would, so that configuration loading, backend registration, and component wiring are all validated.

#### Acceptance Criteria

1. WHEN the Smoke_Runner configures KASO, THE Smoke_Runner SHALL create a valid `kaso.config.json` file in the Test_App root that passes Zod schema validation
2. WHEN the Smoke_Runner initializes KASO, THE Smoke_Runner SHALL call `initializeKASO()` with the Test_App's config path and verify that the returned `ApplicationContext` contains all required components (eventBus, executionStore, orchestrator, agentRegistry, backendRegistry)
3. WHEN the Smoke_Runner registers a Mock_Backend, THE Smoke_Runner SHALL register the backend via `backendRegistry.registerBackend()` with realistic phase responses that include properly-typed Phase_Output objects for all 8 phases
4. IF `initializeKASO()` throws an error, THEN THE Smoke_Runner SHALL report the error with full context including config path and error message, and abort the smoke run

### Requirement 4: Full Pipeline Execution

**User Story:** As a developer, I want the smoke run to execute the complete 8-phase pipeline, so that I can verify every phase runs and produces output.

#### Acceptance Criteria

1. WHEN the Smoke_Runner starts the pipeline, THE Smoke_Runner SHALL call `orchestrator.startRun({ specPath })` with the Test_App's spec directory path
2. WHEN the pipeline completes, THE Smoke_Runner SHALL verify that the returned status is `completed`
3. WHEN the pipeline completes, THE Smoke_Runner SHALL verify that the ExecutionStore contains exactly 8 PhaseResultRecords for the run, all with status `success`
4. WHEN the pipeline completes, THE Smoke_Runner SHALL verify that phase sequence numbers are monotonically increasing from 0 through 7
5. IF the pipeline fails at any phase, THEN THE Smoke_Runner SHALL capture the failing phase name, error message, and all preceding phase results for the Validation_Report

### Requirement 5: Phase Output Validation

**User Story:** As a developer, I want the smoke run to validate that each phase produces meaningful, correctly-shaped output, so that I can confirm the pipeline is doing real work rather than passing through empty objects.

#### Acceptance Criteria

1. WHEN the intake phase completes, THE Smoke_Runner SHALL verify that the `AssembledContext` output contains a non-empty `featureName`, a `designDoc` with at least one section, a `taskList` with at least one task item, and loaded steering files
2. WHEN the validation phase completes, THE Smoke_Runner SHALL verify that the `ValidationReport` output contains an `approved` boolean and an `issues` array
3. WHEN the architecture-analysis phase completes, THE Smoke_Runner SHALL verify that the `ArchitectureContext` output contains a `patterns` array, a `moduleBoundaries` array, and an `adrsFound` number
4. WHEN the implementation phase completes, THE Smoke_Runner SHALL verify that the `ImplementationResult` output contains a `modifiedFiles` array, a `backend` string matching the registered Mock_Backend name, and a numeric `duration`
5. WHEN the architecture-review phase completes, THE Smoke_Runner SHALL verify that the `ArchitectureReview` output contains an `approved` boolean and a `violations` array
6. WHEN the test-verification phase completes, THE Smoke_Runner SHALL verify that the `TestReport` output contains `passed` boolean, `testsRun` number, and `coverage` number
7. WHEN the ui-validation phase completes, THE Smoke_Runner SHALL verify that the `UIReview` output contains an `approved` boolean and a `uiIssues` array
8. WHEN the review-delivery phase completes, THE Smoke_Runner SHALL verify that the `ReviewCouncilResult` output contains a `consensus` string and a `votes` array with at least one vote

### Requirement 6: Event Stream Validation

**User Story:** As a developer, I want the smoke run to validate that the event bus emits the correct lifecycle events, so that I can confirm observability works for real usage.

#### Acceptance Criteria

1. WHEN the pipeline completes, THE Smoke_Runner SHALL verify that the EventBus emitted at least one `run:started` event and one `run:completed` event for the run
2. WHEN the pipeline completes, THE Smoke_Runner SHALL verify that the EventBus emitted `phase:started` and `phase:completed` events for all 8 phases
3. WHEN the pipeline completes, THE Smoke_Runner SHALL verify that `run:started` was emitted before the first `phase:started`, and the last `phase:completed` was emitted before `run:completed`

### Requirement 7: Execution Persistence Validation

**User Story:** As a developer, I want the smoke run to validate that execution state is properly persisted, so that I can confirm crash recovery and audit trail features work.

#### Acceptance Criteria

1. WHEN the pipeline completes, THE Smoke_Runner SHALL verify that `executionStore.getRun(runId)` returns a record with status `completed`, the correct specPath, and a non-empty worktreePath
2. WHEN the pipeline completes, THE Smoke_Runner SHALL verify that `executionStore.getPhaseResults(runId)` returns 8 records with valid timestamps where `completedAt` is not before `startedAt` for each record
3. WHEN the pipeline completes, THE Smoke_Runner SHALL verify that the SpecWriter wrote an `execution-log.md` file to the spec directory containing at least one log entry
4. WHEN the pipeline completes, THE Smoke_Runner SHALL verify that the SpecWriter wrote a `status.json` file to the spec directory containing the runId and a terminal status

### Requirement 8: Worktree Lifecycle Validation

**User Story:** As a developer, I want the smoke run to validate that git worktrees are created and cleaned up correctly, so that I can confirm isolation and cleanup work.

#### Acceptance Criteria

1. WHEN the pipeline starts, THE Smoke_Runner SHALL verify that a git worktree was created under `.kaso/worktrees/` with a branch name matching the `kaso/` prefix pattern
2. WHEN the pipeline completes successfully, THE Smoke_Runner SHALL verify that the worktree is cleaned up after `shutdownKASO()` is called
3. IF worktree creation fails, THEN THE Smoke_Runner SHALL report the failure with the git error message and the attempted branch name

### Requirement 9: Validation Report Generation

**User Story:** As a developer, I want the smoke run to produce a clear pass/fail report, so that I can quickly see what works and what is broken.

#### Acceptance Criteria

1. WHEN the smoke run completes, THE Smoke_Runner SHALL print a Validation_Report to stdout listing each validation check with a pass/fail status
2. WHEN any validation check fails, THE Smoke_Runner SHALL include the expected value, actual value, and a description of the gap in the Validation_Report
3. WHEN the smoke run completes, THE Smoke_Runner SHALL exit with code 0 if all checks passed, or exit with code 1 if any check failed
4. THE Smoke_Runner SHALL report the total wall-clock time for the smoke run in the Validation_Report

### Requirement 10: Executable Smoke Run Script

**User Story:** As a developer, I want to run the smoke run with a single command, so that I can quickly validate the system after making changes.

#### Acceptance Criteria

1. THE Smoke_Runner SHALL be executable via an npm script (e.g., `npm run smoke`)
2. THE Smoke_Runner SHALL complete within 60 seconds under normal conditions using the Mock_Backend
3. THE Smoke_Runner SHALL require no external services, API keys, or network access to execute
4. THE Smoke_Runner SHALL be idempotent — running the smoke run twice in succession SHALL produce the same pass/fail results
5. IF the Smoke_Runner encounters an unhandled exception, THEN THE Smoke_Runner SHALL catch the exception, print a diagnostic message, clean up temporary resources, and exit with code 1
