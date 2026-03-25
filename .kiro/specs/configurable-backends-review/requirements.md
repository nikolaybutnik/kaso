# Requirements Document

## Introduction

This feature adds two related capabilities to KASO: per-phase backend selection and a fully configurable review council. Currently, KASO uses a global `defaultBackend` with an optional `context-aware` selection strategy, and the review council is locked to 3 fixed perspectives (security, performance, maintainability). These changes give users granular control over which AI backend runs each pipeline phase and full customization of the review council's composition, including reviewer count, per-reviewer backend assignment, and custom review perspectives. Both features share the same backend name reference space from the backend registry.

## Glossary

- **Backend_Registry**: The `BackendRegistry` class that manages registered executor backends, provides backend lookup by name, and implements selection strategies
- **Backend_Name**: A string identifier referencing a registered backend in the `executorBackends` array (e.g., `"claude-code"`, `"kimi-code"`)
- **Phase_Backend_Map**: A configuration object mapping `PhaseName` keys to `Backend_Name` values, providing per-phase backend overrides
- **Config_Schema**: The Zod-based configuration schema (`KASOConfigSchema`) that validates `kaso.config.json` at runtime
- **Review_Council**: The `ReviewCouncilAgent` that spawns reviewer instances, collects votes, and applies consensus logic
- **Reviewer_Config**: An object specifying a single reviewer's `role` (string) and optional `backend` (Backend_Name)
- **Review_Perspective**: A free-form string describing the review focus area (e.g., `"security"`, `"accessibility"`, `"compliance"`)
- **Consensus_Logic**: The algorithm that determines the review outcome from individual reviewer votes
- **Orchestrator**: The central `Orchestrator` class that drives the 8-phase pipeline and passes `AgentContext` to each agent
- **Default_Backend**: The globally configured `defaultBackend` string that serves as the fallback when no per-phase or per-reviewer override is specified
- **Selection_Strategy**: The `backendSelectionStrategy` setting (`"default"` or `"context-aware"`) used as a fallback when no manual override is set

## Requirements

### Requirement 1: Per-Phase Backend Override Configuration

**User Story:** As a KASO user, I want to specify which AI backend to use for each pipeline phase individually, so that I can optimize cost, quality, and speed per phase.

#### Acceptance Criteria

1. THE Config_Schema SHALL accept an optional `phaseBackends` field of type `Record<PhaseName, Backend_Name>` in the top-level configuration object
2. WHEN the `phaseBackends` field is omitted from the configuration, THE Config_Schema SHALL validate successfully and THE Orchestrator SHALL use the existing Default_Backend and Selection_Strategy fallback behavior
3. WHEN a `phaseBackends` entry references a Backend_Name that does not exist in the `executorBackends` array, THE Config_Schema SHALL reject the configuration with a descriptive validation error identifying the invalid backend name and the phase it was assigned to
4. WHEN a `phaseBackends` entry references a backend that exists but has `enabled: false`, THE Config_Schema SHALL reject the configuration with a descriptive validation error
5. WHEN a custom phase name (matching `custom-[a-z0-9-]+` pattern) is used as a key in `phaseBackends`, THE Config_Schema SHALL validate it as a valid phase name
6. WHEN `phaseBackends` is an empty object `{}`, THE Orchestrator SHALL use fallback behavior for all phases (same as omitting it)

### Requirement 2: Per-Phase Backend Resolution at Runtime

**User Story:** As a KASO user, I want the orchestrator to use my per-phase backend overrides during execution, so that each phase runs on the backend I chose.

#### Acceptance Criteria

1. WHEN a phase has an entry in `phaseBackends`, THE Orchestrator SHALL use the specified backend for that phase, ignoring the Default_Backend and Selection_Strategy
2. WHEN a phase has no entry in `phaseBackends`, THE Orchestrator SHALL fall back to the Selection_Strategy (either `"default"` or `"context-aware"`) to select a backend
3. WHEN a `preferredBackend` is set on the `AgentContext` (e.g., from error handler retry logic), THE Orchestrator SHALL use the `preferredBackend` over the `phaseBackends` override
4. THE Orchestrator SHALL pass the resolved backend name to the agent via the `AgentContext` so that agents can delegate to the correct backend
5. THE Orchestrator SHALL record the backend name used for each phase in the cost tracking invocation so that per-backend cost breakdowns remain accurate
6. WHEN a custom phase has no entry in `phaseBackends`, THE Orchestrator SHALL fall back to the Selection_Strategy
7. THE Orchestrator SHALL include the resolved backend name in the `phase:started` event payload for observability

### Requirement 3: Backend Registry Phase-Aware Selection

**User Story:** As a KASO developer, I want the BackendRegistry to support phase-aware backend selection, so that the orchestrator can resolve backends per phase cleanly.

#### Acceptance Criteria

1. THE Backend_Registry SHALL expose a `selectBackendForPhase(phase: PhaseName, context?: AgentContext)` method that accepts a phase name and optional agent context
2. WHEN a phase override exists in the configuration, THE `selectBackendForPhase` method SHALL return the backend specified by the override
3. WHEN no phase override exists, THE `selectBackendForPhase` method SHALL delegate to the existing `selectBackend(context)` method preserving current fallback behavior
4. THE Backend_Registry SHALL accept the `phaseBackends` map during construction from the `KASOConfig` object
5. WHEN `selectBackendForPhase()` is called with a phase that has an override referencing a backend that is temporarily unavailable, THE Backend_Registry SHALL throw an error with a descriptive message including the backend name and phase
6. THE Backend_Registry SHALL expose a `hasPhaseOverride(phase: PhaseName): boolean` method that returns whether a phase has a configured backend override
7. THE Backend_Registry SHALL expose a `getPhaseOverride(phase: PhaseName): string | undefined` method that returns the configured backend name for a phase or `undefined` if no override exists

### Requirement 4: Configurable Review Council — Reviewer Definitions

**User Story:** As a KASO user, I want to define exactly how many reviewers the review council spawns and what role each reviewer assumes, so that I can tailor code review to my project's needs.

#### Acceptance Criteria

1. THE Config_Schema SHALL accept an optional `reviewers` array inside the `reviewCouncil` configuration object, where each element is a Reviewer_Config with a required `role` string and an optional `backend` Backend_Name
2. WHEN the `reviewers` array is provided, THE Review_Council SHALL spawn one reviewer instance per entry in the array, using each entry's `role` as the review perspective
3. WHEN the `reviewers` array is provided, THE Config_Schema SHALL ignore the legacy `perspectives` array
4. WHEN neither `reviewers` nor `perspectives` is provided, THE Review_Council SHALL default to three reviewers with roles `"security"`, `"performance"`, and `"maintainability"`
5. THE Config_Schema SHALL validate that the `reviewers` array contains at least 1 entry when it is provided
6. THE Config_Schema SHALL validate that each `role` string in the `reviewers` array is non-empty
7. THE Config_Schema SHALL validate that each `role` string in the `reviewers` array is unique within the array
8. THE Config_Schema SHALL warn (via validation warning, not error) when the `reviewers` array contains more than 10 entries, as the recommended maximum is 10 reviewers

### Requirement 5: Backward Compatibility with Legacy Perspectives

**User Story:** As an existing KASO user, I want my current config using the `perspectives` array to continue working without changes, so that I do not need to migrate immediately.

#### Acceptance Criteria

1. WHEN the `perspectives` array is provided and `reviewers` is not, THE Review_Council SHALL convert each perspective string into a Reviewer_Config with the perspective as the `role` and no `backend` override
2. WHEN both `reviewers` and `perspectives` are provided, THE Config_Schema SHALL use `reviewers` and ignore `perspectives`
3. WHEN a legacy config with only `perspectives` is loaded, THE Config_Schema SHALL validate successfully without requiring the `reviewers` field

### Requirement 6: Per-Reviewer Backend Assignment

**User Story:** As a KASO user, I want to assign different AI backends to different reviewers, so that I can use specialized models for specific review perspectives.

#### Acceptance Criteria

1. WHEN a Reviewer_Config includes a `backend` field, THE Review_Council SHALL use the specified backend for that reviewer's execution
2. WHEN a Reviewer_Config omits the `backend` field, THE Review_Council SHALL fall back to the phase backend for `review-delivery` (from `phaseBackends`), then to the Default_Backend
3. WHEN a Reviewer_Config references a Backend_Name that does not exist in the Backend_Registry, THE Config_Schema SHALL reject the configuration with a descriptive validation error identifying the invalid backend name and the reviewer role it was assigned to
4. WHEN a Reviewer_Config references a backend that exists but has `enabled: false`, THE Config_Schema SHALL reject the configuration with a descriptive validation error
5. THE Review_Council SHALL receive a Backend_Registry reference (via constructor or factory function) to resolve per-reviewer backends at runtime
6. THE Review_Council fallback chain SHALL be: `reviewer.backend` → `phaseBackends['review-delivery']` → Default_Backend

### Requirement 7: Variable Reviewer Count Consensus Logic

**User Story:** As a KASO user, I want the review council's consensus logic to adapt to any number of reviewers, so that the outcome is fair regardless of how many reviewers I configure.

#### Acceptance Criteria

1. WHEN all reviewers approve, THE Consensus_Logic SHALL return `"passed"`
2. WHEN at least two-thirds of reviewers approve (rounded down), THE Consensus_Logic SHALL return `"passed-with-warnings"`
3. WHEN fewer than two-thirds of reviewers approve, THE Consensus_Logic SHALL return `"rejected"`
4. WHEN exactly 1 reviewer is configured and that reviewer approves, THE Consensus_Logic SHALL return `"passed"`
5. WHEN exactly 1 reviewer is configured and that reviewer rejects, THE Consensus_Logic SHALL return `"rejected"`
6. THE Consensus_Logic SHALL use `Math.floor(totalReviewers * 2 / 3)` as the threshold for `"passed-with-warnings"`
7. WHEN exactly 2 reviewers are configured and 1 approves, THE Consensus_Logic SHALL return `"passed-with-warnings"` (since `Math.floor(2 * 2 / 3)` equals 1)
8. WHEN exactly 2 reviewers are configured and 0 approve, THE Consensus_Logic SHALL return `"rejected"`
9. WHEN exactly 4 reviewers are configured and 2 approve, THE Consensus_Logic SHALL return `"passed-with-warnings"` (since `Math.floor(4 * 2 / 3)` equals 2)

### Requirement 8: Custom Review Perspectives

**User Story:** As a KASO user, I want to define custom review perspectives beyond the built-in three, so that I can enforce project-specific quality gates.

#### Acceptance Criteria

1. THE Review_Council SHALL accept any non-empty string as a valid `role` in a Reviewer_Config, including custom values such as `"accessibility"`, `"scalability"`, `"compliance"`, and `"testing-quality"`
2. WHEN a custom role is used, THE Review_Council SHALL pass the role string as the review perspective in the prompt sent to the backend
3. WHEN a custom role is used and no backend is available, THE Review_Council SHALL fall back to a generic heuristic review that performs generic checks (architecture violations, test pass/fail status from prior phases) and provides a warning indicating heuristic review was used for the custom perspective
4. THE `ReviewCouncilResult.votes` array SHALL use the reviewer's `role` string as the `perspective` field instead of being restricted to the `ReviewPerspective` union type

### Requirement 9: Review Council Result Type Update

**User Story:** As a KASO developer, I want the ReviewCouncilResult type to support variable reviewer counts and custom perspectives, so that downstream consumers can process results from any council configuration.

#### Acceptance Criteria

1. THE `ReviewCouncilResult.votes` array SHALL contain one entry per reviewer per round, with the `perspective` field typed as `string` instead of the current `'security' | 'performance' | 'maintainability'` union
2. THE `ReviewVote.perspective` field SHALL be typed as `string` to accommodate custom review roles
3. THE `ReviewCouncilResult` interface SHALL remain backward compatible such that existing code reading `votes[n].perspective` continues to compile and function correctly

### Requirement 10: Configuration Validation — Cross-Field Backend References

**User Story:** As a KASO user, I want the config validator to catch invalid backend references across all new config fields at load time, so that I get clear errors before execution starts.

#### Acceptance Criteria

1. WHEN the configuration is loaded, THE Config_Schema SHALL validate that every Backend_Name referenced in `phaseBackends` values exists as an enabled entry in the `executorBackends` array
2. WHEN the configuration is loaded, THE Config_Schema SHALL validate that every Backend_Name referenced in `reviewers[].backend` values exists as an enabled entry in the `executorBackends` array
3. IF a Backend_Name reference is invalid, THEN THE Config_Schema SHALL produce a validation error message that includes the invalid backend name, the field path where it was referenced, and the list of available enabled backend names

### Requirement 11: Event Bus Integration for Backend Selection

**User Story:** As a KASO operator, I want observability into which backend was selected for each phase and why, so that I can debug unexpected behavior and optimize my backend configuration.

#### Acceptance Criteria

1. WHEN a backend is selected for a phase (via phase override, selection strategy, or default), THE Orchestrator SHALL emit an event with type `agent:backend-selected` containing the runId, phase name, backend name, and selection reason
2. THE selection reason field SHALL be one of `"phase-override"`, `"context-aware"`, `"default"`, or `"reviewer-override"`
3. WHEN a per-reviewer backend override is used during review council execution, THE Review_Council SHALL emit an `agent:backend-selected` event with the reason `"reviewer-override"` and the reviewer role in the event data
