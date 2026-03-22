# Requirements Document

## Introduction

KASO (Kiro-Enabled Agent Swarm Orchestrator) is a locally-run, modular orchestration system built in Node.js/TypeScript. It reads Kiro-generated spec documents and coordinates specialized AI agents through an 8-phase development lifecycle — from spec intake to PR delivery — eliminating the need for human babysitting during AI-assisted engineering execution. The system uses a hub-and-spoke architecture with a pluggable executor layer, enabling swappable AI backends (Kimi Code, Claude Code, Codex CLI, local models) and extensible agent types via a plugin system.

## Glossary

- **KASO**: Kiro-Enabled Agent Swarm Orchestrator — the top-level system being specified
- **Orchestrator**: The central hub component that coordinates agent execution through the 8-phase pipeline
- **Agent**: A specialized, stateless worker unit that implements the Agent Interface Contract and performs a discrete task within the pipeline
- **SpecReader_Agent**: Agent responsible for parsing Kiro spec files into structured execution context
- **SpecValidator_Agent**: Agent that verifies spec feasibility, completeness, and architectural alignment
- **Executor_Agent**: Agent that implements code changes per spec using a configured AI backend
- **ArchitectureGuardian_Agent**: Agent that enforces codebase patterns and prevents architectural drift
- **TestEngineer_Agent**: Agent that generates and runs test suites with coverage analysis
- **UIValidator_Agent**: Agent that performs visual regression testing via screenshot capture and AI review
- **DeliveryAgent**: Agent that handles git operations, PR creation, and commit hygiene
- **ReviewCouncil**: A composite agent that spawns multiple reviewer instances for consensus-based code review
- **Executor_Backend**: A pluggable AI coding tool (Kimi Code, Claude Code, Codex CLI, local model) that the Executor_Agent delegates implementation work to
- **Phase**: One of 8 sequential stages in the execution pipeline (Intake, Validation, Architecture Analysis, Implementation, Architecture Review, Test & Verification, UI/UX Validation, Review & Delivery)
- **AgentContext**: The structured data object passed to agents containing spec data, codebase patterns, and execution state
- **AgentResult**: The structured response object returned by agents containing outputs, status, and metadata
- **Spec**: A Kiro-generated specification consisting of design.md, tech-spec.md, and task.md files located in .kiro/specs/[feature-name]/
- **Steering_Files**: Kiro configuration files in .kiro/rules/ and .kiro/hooks/ that define project conventions and automation hooks
- **Worktree**: A git worktree used for isolated code changes, ensuring the main working directory is never modified directly
- **Review_Consensus**: The voting outcome from ReviewCouncil — 3/3 passes, 2/3 passes with warnings, less than 2/3 rejects
- **Execution_Run**: A single end-to-end processing of a spec through the 8-phase pipeline
- **Phase_Transition**: The state machine event that moves execution from one phase to the next based on phase output

## Requirements

### Requirement 1: Kiro Spec File Parsing

**User Story:** As a developer, I want KASO to automatically parse Kiro spec files, so that spec content is available as structured execution context for all downstream agents.

#### Acceptance Criteria

1. WHEN a Spec located at .kiro/specs/[feature-name]/ contains design.md, tech-spec.md, and task.md files, THE SpecReader_Agent SHALL parse all three files into a structured AgentContext object.
2. WHEN a Spec is missing one or more required files (design.md, tech-spec.md, or task.md), THE SpecReader_Agent SHALL return an error identifying each missing file by name.
3. THE SpecReader_Agent SHALL preserve all markdown structure, code blocks, and metadata from parsed Spec files in the resulting AgentContext.
4. WHEN a Spec contains task.md with checkbox-style task items, THE SpecReader_Agent SHALL parse each task into a discrete actionable item with status (complete or incomplete).

### Requirement 2: Spec Status Monitoring and Triggering

**User Story:** As a developer, I want KASO to detect when a spec transitions to ready-for-dev status, so that execution begins automatically without manual intervention.

#### Acceptance Criteria

1. WHILE KASO is running, THE Orchestrator SHALL monitor .kiro/specs/ directories for file changes using a file-watcher mechanism.
2. WHEN a Spec status changes to "ready-for-dev", THE Orchestrator SHALL initiate a new Execution_Run for that Spec.
3. WHILE an Execution_Run is in progress for a given Spec, THE Orchestrator SHALL reject additional Execution_Run requests for the same Spec.
4. WHEN an Execution_Run completes or fails, THE Orchestrator SHALL update the Spec status to reflect the outcome (in-progress, completed, or failed).
5. WHEN a Spec is modified while an Execution_Run is in progress for that Spec, THE Orchestrator SHALL queue the updated Spec for a new Execution_Run after the current run completes, rather than cancelling or interrupting the active run.

### Requirement 3: Bidirectional Kiro Communication

**User Story:** As a developer, I want KASO to write execution logs and status updates back into Kiro spec files, so that I have a complete audit trail within my existing workflow.

#### Acceptance Criteria

1. WHEN a Phase completes within an Execution_Run, THE Orchestrator SHALL append a timestamped execution log entry to the Spec directory.
2. WHEN an Execution_Run transitions between phases, THE Orchestrator SHALL update the Spec status field to reflect the current Phase name.
3. THE Orchestrator SHALL write all status updates and logs in a format compatible with Kiro's spec structure.

### Requirement 4: Steering File Compliance

**User Story:** As a developer, I want KASO to read and respect Kiro steering files, so that all generated code follows my project's established conventions.

#### Acceptance Criteria

1. WHEN an Execution_Run begins, THE Orchestrator SHALL load all Steering_Files from .kiro/rules/ and .kiro/hooks/ directories.
2. THE Orchestrator SHALL include loaded Steering_Files content in the AgentContext passed to every Agent during the Execution_Run.
3. IF a Steering_Files directory (.kiro/rules/ or .kiro/hooks/) does not exist, THEN THE Orchestrator SHALL proceed with an empty steering configuration and log a warning.

### Requirement 5: Agent Interface Contract

**User Story:** As a plugin developer, I want all agents to implement a consistent interface, so that I can create custom agents that integrate seamlessly with the orchestration pipeline.

#### Acceptance Criteria

1. THE KASO system SHALL define an Agent interface requiring an execute method that accepts an AgentContext parameter and returns a Promise of AgentResult.
2. THE KASO system SHALL define an Agent interface requiring a supportsRollback method that returns a boolean indicating rollback capability.
3. THE KASO system SHALL define an Agent interface requiring an estimatedDuration method that returns a number representing expected execution time in milliseconds.
4. THE KASO system SHALL define an Agent interface requiring a requiredContext method that returns an array of strings identifying the context keys the Agent needs.
5. WHEN an Agent is registered with the Orchestrator, THE Orchestrator SHALL verify that the Agent implements all four required interface methods before accepting registration.

### Requirement 6: Hub-and-Spoke Orchestration

**User Story:** As a developer, I want a centralized orchestrator coordinating specialized agents, so that execution follows a deterministic pipeline with clear phase boundaries.

#### Acceptance Criteria

1. THE Orchestrator SHALL execute the 8-phase pipeline in sequential order: Intake, Validation, Architecture Analysis, Implementation, Architecture Review, Test & Verification, UI/UX Validation, Review & Delivery.
2. WHEN a Phase completes successfully, THE Orchestrator SHALL pass the Phase output as additional context to the next Phase via Phase_Transition.
3. WHEN a Phase fails, THE Orchestrator SHALL halt the pipeline and invoke the error handling and recovery process for that Phase.
4. THE Orchestrator SHALL track the current Phase, elapsed time, and accumulated outputs for each Execution_Run.
5. WHILE a Phase is executing, THE Orchestrator SHALL stream real-time progress events from the active Agent.

### Requirement 7: Pluggable Executor Backend

**User Story:** As a developer, I want to swap AI coding backends by changing a single configuration value, so that I can use whichever AI tool best fits my needs without modifying orchestration code.

#### Acceptance Criteria

1. THE KASO system SHALL load executor backend configuration from a JSON configuration file specifying available Executor_Backends and a default selection.
2. WHEN the default Executor_Backend is changed in configuration, THE Executor_Agent SHALL use the newly configured backend on the next Execution_Run without code changes.
3. THE KASO system SHALL define each Executor_Backend configuration with: command, arguments, protocol, maximum context window size, and cost per 1000 tokens.
4. WHEN a context-aware selection strategy is configured, THE Executor_Agent SHALL select the Executor_Backend whose maximum context window accommodates the AgentContext size at the lowest cost.
5. IF the configured Executor_Backend command is not found on the system PATH, THEN THE Executor_Agent SHALL return an error identifying the missing command.

### Requirement 8: Phase 1 — Intake and Context Assembly

**User Story:** As a developer, I want KASO to automatically assemble all relevant context before execution begins, so that agents have complete information to work with.

#### Acceptance Criteria

1. WHEN the Intake Phase begins, THE SpecReader_Agent SHALL parse all Spec files and produce a structured AgentContext.
2. WHEN the Intake Phase begins, THE SpecReader_Agent SHALL scan the repository for architecture documentation files (ARCHITECTURE.md, .cursorrules, and similar convention files).
3. WHEN the Intake Phase begins, THE SpecReader_Agent SHALL identify source files relevant to the Spec by analyzing import graphs and file references within the Spec.
4. THE SpecReader_Agent SHALL include dependency information (package.json dependencies, lock file versions) in the assembled AgentContext.
5. THE SpecReader_Agent SHALL cap the assembled AgentContext size to fit within the configured Executor_Backend maximum context window.

### Requirement 9: Phase 2 — Spec Validation

**User Story:** As a developer, I want specs to be validated for completeness and feasibility before execution, so that obvious issues are caught early rather than discovered during implementation.

#### Acceptance Criteria

1. WHEN the Validation Phase begins, THE SpecValidator_Agent SHALL check the Spec for undefined API contracts and report each as a validation issue.
2. WHEN the Validation Phase begins, THE SpecValidator_Agent SHALL check the Spec for missing database schema specifications and report each as a validation issue.
3. WHEN the Validation Phase begins, THE SpecValidator_Agent SHALL check the Spec for missing error handling strategies and report each as a validation issue.
4. THE SpecValidator_Agent SHALL check the Spec for contradictions with existing architecture patterns loaded in the AgentContext.
5. THE SpecValidator_Agent SHALL produce a ValidationReport containing an approved boolean, an array of issues, and an array of suggested fixes.
6. WHEN the ValidationReport approved field is false, THE Orchestrator SHALL halt the pipeline and report the validation issues to the developer.

### Requirement 10: Phase 3 — Architecture Analysis

**User Story:** As a developer, I want KASO to map spec requirements to existing codebase patterns before implementation, so that new code aligns with established architecture.

#### Acceptance Criteria

1. WHEN the Architecture Analysis Phase begins, THE ArchitectureGuardian_Agent SHALL map each Spec requirement to existing codebase modules.
2. THE ArchitectureGuardian_Agent SHALL identify potential pattern violations in the Spec before code is written.
3. THE ArchitectureGuardian_Agent SHALL load and incorporate architectural decision records (ADRs) from the repository when present.
4. THE ArchitectureGuardian_Agent SHALL produce an ArchitectureContext containing identified patterns and module boundaries.

### Requirement 11: Phase 4 — Implementation

**User Story:** As a developer, I want KASO to autonomously implement code changes per spec using the configured AI backend, so that I receive working code without manual coding effort.

#### Acceptance Criteria

1. WHEN the Implementation Phase begins, THE Executor_Agent SHALL receive the Spec, ArchitectureContext, and ValidationReport as combined input context.
2. THE Executor_Agent SHALL delegate code generation to the configured Executor_Backend via the backend's command-line interface and protocol.
3. WHEN the Executor_Backend reports a test failure during implementation, THE Executor_Agent SHALL attempt self-correction by re-invoking the backend with the failure context, up to 3 retry attempts.
4. WHILE the Executor_Backend is running, THE Executor_Agent SHALL stream real-time progress events to the Orchestrator as newline-delimited JSON (NDJSON) on stdout, where each line is a valid JSON object containing at minimum a type field and a timestamp field.
5. THE Executor_Agent SHALL produce an ImplementationResult containing arrays of modified files and added tests, and the total execution duration in milliseconds.
6. THE Executor_Agent SHALL perform all file modifications within a git Worktree, never modifying the main working directory.

### Requirement 12: Phase 5 — Architecture Review

**User Story:** As a developer, I want implemented code to be reviewed against architecture patterns before testing, so that architectural drift is caught immediately.

#### Acceptance Criteria

1. WHEN the Architecture Review Phase begins, THE ArchitectureGuardian_Agent SHALL review all files modified during the Implementation Phase against the ArchitectureContext patterns.
2. THE ArchitectureGuardian_Agent SHALL check import boundaries, naming conventions, and state management consistency across modified files.
3. THE ArchitectureGuardian_Agent SHALL produce an ArchitectureReview containing an approved boolean and an array of violations.
4. WHEN the ArchitectureReview approved field is false, THE Orchestrator SHALL return the pipeline to the Implementation Phase with the violations as additional context for correction.

### Requirement 13: Phase 6 — Test and Verification

**User Story:** As a developer, I want KASO to generate and run comprehensive tests for implemented code, so that I have confidence in the delivered changes.

#### Acceptance Criteria

1. WHEN the Test & Verification Phase begins, THE TestEngineer_Agent SHALL generate unit tests, integration tests, and edge-case tests for all modified files.
2. THE TestEngineer_Agent SHALL execute the full project test suite within the Worktree.
3. THE TestEngineer_Agent SHALL perform code coverage analysis on the modified files.
4. THE TestEngineer_Agent SHALL produce a TestReport containing a passed boolean, a coverage percentage number, and an array of test failures.
5. WHEN the TestReport passed field is false, THE Orchestrator SHALL return the pipeline to the Implementation Phase with the test failures as additional context for correction.

### Requirement 14: Phase 7 — UI/UX Validation

**User Story:** As a developer, I want visual regression testing on UI changes, so that visual bugs are caught before delivery.

#### Acceptance Criteria

1. WHEN the UI/UX Validation Phase begins and the Spec modifies UI components or routes, THE UIValidator_Agent SHALL identify all affected routes and components.
2. THE UIValidator_Agent SHALL capture screenshots of affected routes using Playwright within the Worktree.
3. THE UIValidator_Agent SHALL perform screenshot diffing against baseline images when baselines exist.
4. WHEN no baseline images exist for an affected route, THE UIValidator_Agent SHALL capture screenshots and store them as the initial baseline for that route.
5. WHEN a developer approves a UIReview that contains visual differences, THE UIValidator_Agent SHALL update the baseline images with the newly captured screenshots.
6. THE UIValidator_Agent SHALL submit captured screenshots to an AI review for visual consistency, responsive behavior, and accessibility assessment.
7. THE UIValidator_Agent SHALL produce a UIReview containing an approved boolean, an array of screenshots, and an array of UI issues.
8. WHEN the Spec does not modify UI components or routes, THE Orchestrator SHALL skip the UI/UX Validation Phase and proceed to the next Phase.

### Requirement 15: Phase 8 — Review Council and Delivery

**User Story:** As a developer, I want multi-perspective code review and automated PR delivery, so that I review finished PRs rather than intermediate steps.

#### Acceptance Criteria

1. WHEN the Review & Delivery Phase begins, THE ReviewCouncil SHALL spawn 3 reviewer agent instances focused on security, performance, and maintainability perspectives respectively.
2. THE ReviewCouncil SHALL collect approval or rejection votes from all 3 reviewer instances.
3. WHEN 3 out of 3 reviewers approve, THE ReviewCouncil SHALL mark the Review_Consensus as passed.
4. WHEN 2 out of 3 reviewers approve, THE ReviewCouncil SHALL mark the Review_Consensus as passed with warnings and include the dissenting review.
5. WHEN fewer than 2 out of 3 reviewers approve, THE ReviewCouncil SHALL mark the Review_Consensus as rejected and THE Orchestrator SHALL return the pipeline to the Implementation Phase with all review feedback.
6. WHEN Review_Consensus is passed or passed with warnings, THE DeliveryAgent SHALL create a feature branch from the Worktree with a descriptive branch name.
7. THE DeliveryAgent SHALL create commits following conventional commit format (feat:, fix:, refactor:, test:, docs:).
8. THE DeliveryAgent SHALL open a pull request containing an execution summary, test results, and review council outcome.
9. THE DeliveryAgent SHALL append the execution summary to the Kiro Spec directory.

### Requirement 16: Error Handling and Recovery

**User Story:** As a developer, I want failed phases to be recoverable with clear escalation paths, so that partial work is preserved and I can take over when needed.

#### Acceptance Criteria

1. WHEN a Phase fails, THE Orchestrator SHALL trigger a rollback to the last known good state for agents that report supportsRollback as true.
2. WHEN a Phase fails, THE Orchestrator SHALL retry the Phase with a modified strategy (reduced context window size or alternative Executor_Backend) up to 2 additional attempts.
3. WHEN 3 consecutive Phase failures occur within an Execution_Run, THE Orchestrator SHALL escalate to the developer with a detailed failure report and halt the pipeline.
4. WHEN the ArchitectureGuardian_Agent detects an architectural deadlock (contradictory pattern requirements), THE Orchestrator SHALL escalate to the developer immediately.
5. WHEN any Agent detects a security concern in generated code, THE Orchestrator SHALL escalate to the developer immediately and halt the pipeline.
6. WHEN a Phase fails and the pipeline halts, THE Orchestrator SHALL preserve all Worktree changes and phase outputs for manual recovery.
7. THE Orchestrator SHALL enforce a default timeout of 300 seconds per Phase, configurable per Phase via the KASO configuration file.
8. WHEN a Phase exceeds its configured timeout, THE Orchestrator SHALL cancel the active Agent, record the timeout as a Phase failure, and apply the standard retry and escalation logic for that Phase.

### Requirement 17: Real-Time Observability

**User Story:** As a developer, I want real-time visibility into execution progress, so that I can monitor agent activity and intervene when necessary.

#### Acceptance Criteria

1. WHILE an Execution_Run is in progress, THE Orchestrator SHALL stream log events via WebSocket or Server-Sent Events to connected clients.
2. THE Orchestrator SHALL include the current Phase name, active Agent identifier, and elapsed time in each streamed log event.
3. THE Orchestrator SHALL track and report token usage and API call counts per Executor_Backend invocation.
4. THE Orchestrator SHALL record the duration of each Phase and the success or failure rate per Agent type as performance metrics.
5. THE Orchestrator SHALL persist all Execution_Run history to a local SQLite database or JSONL file.

### Requirement 18: Workflow Control

**User Story:** As a developer, I want to pause, resume, and cancel running workflows, so that I maintain control over the orchestration process.

#### Acceptance Criteria

1. WHEN a developer issues a pause command, THE Orchestrator SHALL complete the currently executing Phase and halt before the next Phase_Transition.
2. WHEN a developer issues a resume command on a paused Execution_Run, THE Orchestrator SHALL continue from the next pending Phase.
3. WHEN a developer issues a cancel command, THE Orchestrator SHALL terminate the active Agent, preserve Worktree state, and mark the Execution_Run as cancelled.
4. THE Orchestrator SHALL expose pause, resume, and cancel controls via a CLI interface.

### Requirement 19: Git Worktree Isolation

**User Story:** As a developer, I want all KASO changes to happen in git worktrees, so that my working directory is never modified by automated agents.

#### Acceptance Criteria

1. WHEN an Execution_Run begins, THE Orchestrator SHALL create a new git Worktree for the Execution_Run with a branch name following the format kaso/[feature-name]-[timestamp], where timestamp is an ISO 8601 compact format (YYYYMMDDTHHmmss).
2. THE Orchestrator SHALL direct all Agent file operations to the Worktree path, never to the main working directory.
3. WHEN an Execution_Run completes successfully, THE DeliveryAgent SHALL push the Worktree branch to the remote repository.
4. WHEN an Execution_Run is cancelled or fails permanently, THE Orchestrator SHALL retain the Worktree for manual inspection and log its path.

### Requirement 20: Secure Credential Management

**User Story:** As a developer, I want API keys and secrets to be handled securely, so that credentials are never exposed in logs or configuration files checked into version control.

#### Acceptance Criteria

1. THE KASO system SHALL load API keys from environment variables or OS keychain, never from files tracked by git.
2. THE Orchestrator SHALL redact API keys and secret values from all log output and streamed events.
3. THE KASO system SHALL include a .gitignore entry preventing .env files and credential stores from being committed.
4. IF a required API key is not found in environment variables or OS keychain, THEN THE KASO system SHALL report the missing key by name and halt startup.

### Requirement 21: Resource-Conscious Parallel Execution

**User Story:** As a developer, I want KASO to manage system resources responsibly, so that agent execution does not overwhelm my local machine.

#### Acceptance Criteria

1. THE Orchestrator SHALL limit the number of concurrently executing Agents to a configurable maximum based on available CPU cores and memory.
2. THE Orchestrator SHALL default the maximum concurrent Agent count to the number of available CPU cores minus one.
3. WHILE the concurrent Agent limit is reached, THE Orchestrator SHALL queue additional Agent executions until a slot becomes available.

### Requirement 22: Plugin Architecture for Custom Agents

**User Story:** As a plugin developer, I want to create and distribute custom agents as npm packages, so that the KASO ecosystem can be extended for specialized use cases.

#### Acceptance Criteria

1. THE KASO system SHALL support loading custom Agents from npm packages that export a class implementing the Agent interface.
2. THE KASO system SHALL discover and load custom Agents listed in the KASO configuration file under a plugins section.
3. WHEN a custom Agent fails to implement the required Agent interface, THE KASO system SHALL reject the plugin and log a descriptive error.
4. THE KASO system SHALL provide a plugin development kit (types package) that exports the Agent interface, AgentContext type, and AgentResult type.

### Requirement 23: Custom Phase Injection

**User Story:** As a developer in a regulated industry, I want to inject custom phases into the pipeline, so that I can add compliance or domain-specific review steps.

#### Acceptance Criteria

1. THE KASO system SHALL support inserting custom Phases at configurable positions within the 8-phase pipeline via configuration.
2. WHEN a custom Phase is configured, THE Orchestrator SHALL execute the custom Phase Agent at the specified pipeline position with the same AgentContext passing behavior as built-in Phases.
3. WHEN a custom Phase Agent fails, THE Orchestrator SHALL apply the same error handling and recovery process as built-in Phases.

### Requirement 24: Webhook and External Integration

**User Story:** As a developer, I want KASO to notify external services of execution events, so that I can integrate with my existing communication and project management tools.

#### Acceptance Criteria

1. THE KASO system SHALL support configuring webhook URLs for execution lifecycle events (run started, phase completed, run completed, run failed).
2. WHEN a configured lifecycle event occurs, THE Orchestrator SHALL send an HTTP POST request to each registered webhook URL with a JSON payload containing the event type, Spec name, Phase name, and timestamp. WHEN a webhook has custom headers configured, those headers SHALL be included in the request.
3. IF a webhook delivery fails, THEN THE Orchestrator SHALL retry delivery up to 3 times with exponential backoff and log the failure.
4. WHEN a webhook has a secret configured, THE Orchestrator SHALL sign the JSON payload using HMAC-SHA256 with the secret and include the signature in the `X-KASO-Signature` header.

### Requirement 25: MCP Tool Integration

**User Story:** As a developer, I want KASO to support Model Context Protocol for tool integration, so that agents can leverage external tools and data sources during execution.

#### Acceptance Criteria

1. THE KASO system SHALL support configuring MCP server connections in the KASO configuration file.
2. WHEN MCP servers are configured, THE Orchestrator SHALL make MCP tool capabilities available to Agents via the AgentContext.
3. THE Executor_Agent SHALL pass configured MCP tool definitions to the Executor_Backend when the backend protocol supports MCP.

### Requirement 26: Cost Tracking

**User Story:** As a developer, I want to track the cost of each execution run, so that I can monitor and optimize my AI spending.

#### Acceptance Criteria

1. THE Orchestrator SHALL calculate the estimated cost of each Executor_Backend invocation using the configured cost per 1000 tokens and the actual token count.
2. THE Orchestrator SHALL accumulate total cost per Execution_Run across all Executor_Backend invocations.
3. THE Orchestrator SHALL include the total estimated cost in the Execution_Run summary and persisted history.
4. THE Orchestrator SHALL expose cost data via the CLI interface for querying historical execution costs.
5. THE Orchestrator SHALL support a configurable cost budget per Execution_Run in the KASO configuration file.
6. WHEN the accumulated cost of an Execution_Run exceeds the configured cost budget, THE Orchestrator SHALL halt the pipeline, preserve the Worktree, and report the budget exceeded condition to the developer.

### Requirement 27: State Persistence and Crash Recovery

**User Story:** As a developer, I want KASO execution state to survive process restarts, so that a crash or restart does not lose progress on long-running pipelines.

#### Acceptance Criteria

1. WHEN a Phase completes within an Execution_Run, THE Orchestrator SHALL persist the Execution_Run state (current phase, accumulated outputs, cost data, and worktree path) to the execution store before transitioning to the next Phase.
2. WHEN KASO starts and detects an Execution_Run in a non-terminal state (running or paused) in the execution store, THE Orchestrator SHALL resume that Execution_Run from the last completed Phase.
3. THE Orchestrator SHALL use write-ahead persistence so that no completed Phase output is lost in the event of an unexpected process termination.
4. WHEN resuming an Execution_Run after a crash, THE Orchestrator SHALL verify that the associated git Worktree still exists and is in a consistent state before continuing.
5. IF the Worktree for a resumed Execution_Run is missing or corrupted, THEN THE Orchestrator SHALL mark the Execution_Run as failed and report the condition to the developer.

### Requirement 28: CLI Interface

**User Story:** As a developer, I want a comprehensive CLI to control and inspect KASO, so that I can manage orchestration without leaving my terminal.

#### Acceptance Criteria

1. THE KASO system SHALL provide a CLI command `kaso start <spec-path>` that initiates a new Execution_Run for the specified Spec.
2. THE KASO system SHALL provide a CLI command `kaso status [run-id]` that displays the current state, phase, elapsed time, and cost of an Execution_Run, or lists all active runs when no run-id is provided.
3. THE KASO system SHALL provide a CLI command `kaso pause <run-id>` that pauses the specified Execution_Run.
4. THE KASO system SHALL provide a CLI command `kaso resume <run-id>` that resumes a paused Execution_Run.
5. THE KASO system SHALL provide a CLI command `kaso cancel <run-id>` that cancels the specified Execution_Run.
6. THE KASO system SHALL provide a CLI command `kaso cost [run-id]` that displays cost breakdown for a specific run, or aggregated cost history when no run-id is provided.
7. THE KASO system SHALL provide a CLI command `kaso history [--limit N]` that lists past Execution_Runs with their status, duration, and cost.
8. THE KASO system SHALL provide a CLI command `kaso logs <run-id> [--phase <phase-name>]` that streams or displays execution logs for a run, optionally filtered by phase.
9. THE KASO system SHALL provide a CLI command `kaso watch` that starts the file-watcher mode for automatic spec detection and execution.

### Requirement 29: Review Council Cost Control

**User Story:** As a developer, I want to control the cost and duration of the Review Council phase, so that multi-reviewer consensus doesn't burn through my AI budget.

#### Acceptance Criteria

1. THE KASO system SHALL support a ReviewCouncilConfig in the KASO configuration file with maxReviewRounds (default: 2), enableParallelReview (boolean), and an optional reviewBudgetUsd cost cap.
2. WHEN the Review Council has executed maxReviewRounds rounds without reaching consensus, THE ReviewCouncil SHALL stop and return the best available consensus from completed rounds.
3. WHEN the accumulated cost of the Review Council phase exceeds the configured reviewBudgetUsd, THE ReviewCouncil SHALL stop further rounds and return the best available consensus from completed rounds.
