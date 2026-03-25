# Implementation Plan: Configurable Backends & Review Council

## Overview

Incremental implementation of per-phase backend selection and configurable review council. Tasks are ordered foundation-first: types → schema → registry → orchestrator → review council → tests. Each task builds on the previous and references specific requirements and design properties.

## Tasks

- [x] 1. Update core types and add new event type
  - [x] 1.1 Add `agent:backend-selected` to `EventType` union in `src/core/types.ts`
    - Add `'agent:backend-selected'` to the `EventType` union type
    - Verify `ExecutionEvent` interface automatically includes new type (uses `EventType` union — no changes needed to event payload interface)
    - _Requirements: 11.1, 11.2_

  - [x] 1.2 Widen `ReviewCouncilResult.votes[].perspective` to `string` in `src/core/types.ts`
    - Change `perspective: 'security' | 'performance' | 'maintainability'` to `perspective: string` in the `ReviewCouncilResult` interface
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 1.3 Deprecate `ReviewPerspective` type and widen `ReviewVote` in `src/agents/review-council.ts`
    - Add `@deprecated` JSDoc annotation to the `ReviewPerspective` type export
    - Widen `ReviewVote.perspective` from `ReviewPerspective` to `string` (internal agent interface)
    - Note: This is separate from 1.2 which updates the public `ReviewCouncilResult` output type in `types.ts`
    - _Requirements: 8.4, 9.1, 9.2_

- [x] 2. Extend configuration schema with `phaseBackends` and `reviewers`
  - [x] 2.1 Add `ReviewerConfigSchema` and `PhaseNameSchema` to `src/config/schema.ts`
    - Create `ReviewerConfigSchema` with required `role: string.min(1)` and optional `backend: string.min(1)`
    - Create `PhaseNameSchema` as a union of the 8 built-in phase literals and `custom-[a-z0-9-]+` regex
    - Export `ReviewerConfig` type
    - _Requirements: 4.1, 4.5, 4.6, 8.1_

  - [x] 2.2 Add `reviewers` field to `ReviewCouncilConfigSchema` in `src/config/schema.ts`
    - Add optional `reviewers` array with `min(1)` and unique-role `.refine()` validation
    - Keep existing `perspectives` field for backward compatibility
    - _Requirements: 4.1, 4.5, 4.6, 4.7, 5.3_

  - [x] 2.3 Add `phaseBackends` field and `.superRefine()` cross-field validation to `KASOConfigSchema` in `src/config/schema.ts`
    - Add `phaseBackends: z.record(PhaseNameSchema, z.string().min(1)).default({})` to the schema
    - Add `.superRefine()` that validates all `phaseBackends` values and `reviewers[].backend` values reference enabled backends in `executorBackends`
    - Validation order: (1) check if backend exists in `allBackends` — error "not found" if missing, (2) check if backend is in `enabledBackends` — error "disabled" if not enabled
    - Include >10 reviewers warning
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 6.3, 6.4, 10.1, 10.2, 10.3_

  - [x] 2.4 Update `getDefaultConfig()` in `src/config/schema.ts`
    - Add `phaseBackends: {}` to the default config object
    - Ensure `reviewCouncil` defaults still work with legacy `perspectives` (no `reviewers` in defaults)
    - _Requirements: 1.2, 1.6_

  - [x] 2.5 Write property tests for config validation in `tests/property/config-validation.property.test.ts` (new file)
    - **Property 1: Valid config schema round-trip**
    - **Validates: Requirements 1.1, 1.2, 1.5, 4.1, 5.3**
    - **Property 2: Cross-field backend reference rejection**
    - **Validates: Requirements 1.3, 1.4, 6.3, 6.4, 10.1, 10.2, 10.3**
    - **Property 10: Unique role validation rejects duplicates**
    - **Validates: Requirement 4.7**

- [x] 3. Checkpoint — Schema and types complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Add phase-aware selection to BackendRegistry
  - [x] 4.1 Add `phaseOverrides` map and constructor initialization in `src/backends/backend-registry.ts`
    - Add `private phaseOverrides: Map<string, string>` field
    - Initialize from `config.phaseBackends ?? {}` in constructor
    - _Requirements: 3.4_

  - [x] 4.2 Implement `selectBackendForPhase()`, `hasPhaseOverride()`, and `getPhaseOverride()` in `src/backends/backend-registry.ts`
    - `selectBackendForPhase(phase, context?)`: check phase override first, then delegate to `selectBackend(context)`
    - Throw on override referencing unavailable backend (fail-fast — do NOT fall back to default)
    - Note: `isAvailable()` on `ExecutorBackend` is synchronous in the current codebase. If it becomes async, this method signature must change to `Promise<ExecutorBackend>`
    - `hasPhaseOverride(phase)`: returns boolean
    - `getPhaseOverride(phase)`: returns string | undefined
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 3.7_

  - [x] 4.3 Write property tests for BackendRegistry phase selection in `tests/property/backend-registry.property.test.ts`
    - **Property 3: Phase override returns configured backend**
    - **Validates: Requirements 2.1, 3.1, 3.2**
    - **Property 4: No-override fallback to selection strategy**
    - **Validates: Requirements 2.2, 2.6, 3.3**
    - **Property 6: Phase override map consistency**
    - **Validates: Requirements 3.4, 3.6, 3.7**

- [ ] 5. Integrate phase-aware backend selection into Orchestrator
  - [ ] 5.1 Update `executePhase()` in `src/core/orchestrator.ts` to use `selectBackendForPhase()`
    - Replace direct `selectBackend()` call with `selectBackendForPhase(phase, context)` when no `preferredBackend` override
    - Record the resolved backend name in the cost tracking invocation so per-backend cost breakdowns remain accurate (Req 2.5)
    - Emit `agent:backend-selected` event with resolved backend name and selection reason
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.7, 11.1, 11.2_

  - [ ] 5.2 Update `buildAgentContext()` in `src/core/orchestrator.ts` to set `preferredBackend` from phase override
    - When no retry-context `preferredBackend` exists, check `backendRegistry.getPhaseOverride(phase)` and set it
    - _Requirements: 2.4_

  - [ ]* 5.3 Write property tests for orchestrator backend selection in `tests/property/orchestrator.property.test.ts`
    - **Property 5: preferredBackend takes priority over phase override**
    - **Validates: Requirements 2.3, 2.4**
    - **Property 14: Backend selection event reason validity**
    - **Validates: Requirements 11.1, 11.2, 11.3**

- [ ] 6. Checkpoint — Backend selection pipeline complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Refactor ReviewCouncilAgent for configurable reviewers
  - [ ] 7.1 Update constructor dependencies and add `getEffectiveReviewers()` in `src/agents/review-council.ts`
    - Replace `backendResolver` dependency with `backendRegistry: BackendRegistry` (required)
    - Add `getEffectiveReviewers(config)`: returns `reviewers` array if present, else converts `perspectives` to `ReviewerConfig[]`
    - Update `createReviewCouncilAgent` factory function signature
    - Verify and update all call sites that create ReviewCouncilAgent (orchestrator wiring in `src/index.ts`, any CLI wiring, existing tests) to pass the required `BackendRegistry`
    - _Requirements: 4.2, 4.3, 4.4, 5.1, 5.2, 6.5_

  - [ ] 7.2 Implement per-reviewer backend resolution and event emission in `src/agents/review-council.ts`
    - Add `resolveReviewerBackend(reviewer, context)`: follows chain `reviewer.backend` → `phaseBackends['review-delivery']` → `defaultBackend`
    - Emit `agent:backend-selected` event with `reviewer-override` reason when reviewer has explicit backend
    - Update `executePerspectiveReview()` to accept `ReviewerConfig` instead of `ReviewPerspective`
    - _Requirements: 6.1, 6.2, 6.5, 6.6, 11.3_

  - [ ] 7.3 Generalize consensus logic and add heuristic fallback in `src/agents/review-council.ts`
    - Replace hardcoded 2/3 threshold with `Math.floor(totalCount * 2 / 3)` formula
    - Verify edge cases: 1 reviewer approve/reject (Req 7.4, 7.5), 2 reviewers with 1 approve (Req 7.7) and 0 approve (Req 7.8), 4 reviewers with 2 approve (Req 7.9)
    - Add `executeGenericHeuristicReview(role, reviewContext)` for custom roles without backend
    - Include warning in heuristic feedback indicating heuristic review was used
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 8.2, 8.3_

  - [ ]* 7.4 Write property tests for review council in `tests/property/review-council.property.test.ts`
    - **Property 7: Reviewer count matches votes with correct perspectives**
    - **Validates: Requirements 4.2, 8.2, 8.4, 9.1**
    - **Property 8: Legacy perspectives conversion**
    - **Validates: Requirements 5.1, 5.3**
    - **Property 9: Reviewers take precedence over perspectives**
    - **Validates: Requirements 4.3, 5.2**
    - **Property 11: Generalized consensus formula**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.6**
    - **Property 12: Reviewer backend fallback chain**
    - **Validates: Requirements 6.1, 6.2, 6.6**
    - **Property 13: Custom role heuristic fallback includes warning**
    - **Validates: Requirement 8.3**

- [ ] 8. Checkpoint — Review council refactoring complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Integration tests (strongly recommended)
  - [ ]* 9.1 Write backend selection integration test in `tests/integration/backend-selection.integration.test.ts` (new file)
    - Full pipeline run with `phaseBackends` configuration
    - Verify correct backend used per phase via `agent:backend-selected` events
    - Strongly recommended — validates end-to-end backend resolution chain
    - _Requirements: 2.1, 2.2, 3.1, 3.3, 11.1_

  - [ ]* 9.2 Write review council custom reviewers integration test in `tests/integration/review-council-custom.integration.test.ts` (new file)
    - Review council execution with custom `reviewers` and per-reviewer backends
    - Verify consensus determination and `agent:backend-selected` event emission with correct reasons
    - Strongly recommended — validates configurable review council end-to-end
    - _Requirements: 4.2, 6.1, 6.2, 7.1, 8.2, 11.3_

- [ ] 10. Update existing unit tests
  - [ ]* 10.1 Update `tests/config/loader.test.ts` with cross-field validation tests
    - Test invalid backend references in `phaseBackends` and `reviewers[].backend`
    - Test disabled backend references
    - Test empty `phaseBackends`, >10 reviewers warning
    - _Requirements: 1.3, 1.4, 4.8, 10.1, 10.2, 10.3_

  - [ ]* 10.2 Update `tests/backends/backend-registry.test.ts` with phase selection tests
    - Test `selectBackendForPhase()` with override, without override, and unavailable backend error
    - Test `hasPhaseOverride()` and `getPhaseOverride()` basic behavior
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 3.7_

  - [ ]* 10.3 Update `tests/agents/review-council.test.ts` with configurable reviewer tests
    - Test default 3-reviewer fallback (Req 4.4)
    - Test single reviewer consensus edge cases (Req 7.4, 7.5)
    - Test 2-reviewer edge cases (Req 7.7, 7.8)
    - Test 4-reviewer edge case (Req 7.9)
    - Test heuristic fallback for custom roles
    - Test `agent:backend-selected` event emission with `reviewer-override` reason
    - _Requirements: 4.4, 7.4, 7.5, 7.7, 7.8, 7.9, 8.3, 11.3_

  - [ ]* 10.4 Update `tests/core/event-bus.test.ts` to verify `agent:backend-selected` event type
    - Verify EventBus accepts and emits the new event type
    - _Requirements: 11.1_

- [ ] 11. Final checkpoint — All tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP (integration tests 9.1/9.2 are strongly recommended despite being optional)
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests go in `tests/property/` directory
- Unit tests go in their respective `tests/{module}/` directories (e.g., `tests/config/`, `tests/backends/`, `tests/agents/`, `tests/core/`)
- Integration tests go in `tests/integration/` directory
- The implementation language is TypeScript (matching the existing codebase)
