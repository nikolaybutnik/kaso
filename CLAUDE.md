# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build            # Compile TypeScript → dist/
npm test                 # Run all tests
npm run test:watch       # Watch mode
npm run test:property    # Property-based tests only
npm run test:integration # Integration tests only
npm run test:coverage    # Coverage report (v8)
```

To run a single test file: `npx vitest run tests/agents/executor.test.ts`

There are no lint scripts — TypeScript strict mode is the enforcer.

## Architecture

KASO is a **hub-and-spoke orchestrator**: a central `Orchestrator` drives an 8-phase sequential pipeline, coordinating stateless agents injected with an immutable `AgentContext`. All components are wired in `src/index.ts` via `initializeKASO()`.

### 8-Phase Pipeline

| Phase | Agent | Output type |
|---|---|---|
| 1. Intake | `SpecReaderAgent` | `AssembledContext` |
| 2. Validation | `SpecValidatorAgent` | `ValidationReport` |
| 3. Architecture Analysis | `ArchitectureGuardianAgent` | `ArchitectureContext` |
| 4. Implementation | `ExecutorAgent` | `ImplementationResult` |
| 5. Architecture Review | `ArchitectureGuardianAgent` | `ArchitectureReview` |
| 6. Test & Verification | `TestEngineerAgent` | `TestReport` |
| 7. UI/UX Validation | `UIValidatorAgent` | `UIReview` |
| 8. Review & Delivery | `ReviewCouncilAgent` + `DeliveryAgent` | `ReviewCouncilResult` + `DeliveryResult` |

Each phase receives the accumulated `phaseOutputs` from all prior phases via `AgentContext` (read-only). Agents produce typed output stored in `Partial<Record<PhaseName, PhaseOutput>>`.

### Key Design Patterns

**Stateless agents with DI**: All agents implement `Agent` interface (`execute`, `supportsRollback`, `estimatedDuration`, `requiredContext`). No shared mutable state between agents.

**Pluggable backends**: Executor backends communicate via NDJSON over stdio. Selection strategy is `'default'` or `'context-aware'` (picks cheapest backend that fits context window). ExecutorAgent has an internal self-correction loop (up to 3 retries with reduced context or alternative backend) before escalating to `ErrorHandler`.

**Typed event bus**: 20+ event types (`phase:started`, `run:completed`, `agent:progress`, etc.). Events fan out to SSE clients (`src/streaming/sse-server.ts`) and webhooks (`src/infrastructure/webhook-dispatcher.ts`) with HMAC-SHA256 signing.

**Crash resilience**: `CheckpointManager` writes ahead before each phase (SQLite). `recoverInterruptedRuns()` called on startup to resume non-terminal runs. `ExecutionStore` falls back to JSONL if SQLite unavailable.

**Cost enforcement**: Token usage × `costPer1000Tokens` per invocation, checked against `costBudget.maxUsdPerRun` after each phase. Exceeding budget emits `run:budget_exceeded` and halts.

**Git worktree isolation**: Each run gets a dedicated worktree under `.kaso/worktrees/` branched from main as `kaso/[specName]-[timestamp]`. `WorktreeManager` handles lifecycle.

**Plugin system**: `PluginLoader` discovers npm packages with custom agents; `PhaseInjector` inserts custom phases at configurable positions (0–8).

### Source Layout

- `src/core/` — Orchestrator, state machine, event bus, error handler, concurrency manager, types
- `src/agents/` — All 8-phase agent implementations + registry/interface
- `src/backends/` — Backend adapter interface, process spawner, registry
- `src/infrastructure/` — Execution store, checkpoints, cost tracker, credential manager, worktree manager, file watcher, webhook dispatcher, MCP client, log redactor
- `src/config/` — Zod schemas + config loader
- `src/plugins/` — Plugin loader + phase injector
- `src/streaming/` — SSE server
- `src/cli/` — Commander.js CLI (`start`, `status`, `pause`, `resume`, `cancel`, `cost`, `history`, `logs`, `watch`, `doctor`)

All types are in `src/core/types.ts`. No `any` types — ever.

## Configuration

- **`kaso.config.json`** — main config (backends, concurrency, budgets, MCP servers, plugins, webhooks, SSE, file watcher)
- **`.env`** — secrets (`KIMI_API_KEY`, `ANTHROPIC_API_KEY`, `KASO_WEBHOOK_SECRET`, `KASO_SSE_AUTH_TOKEN`)
- **`.kiro/specs/<name>/`** — spec input dirs with `requirements.md`, `design.md`, `tasks.md`; auto-generate `status.json` + `execution-log.md`
- **`.kiro/steering/`** — agent steering guides (personality, coding practices, commit conventions)

## Commit Convention

`<type>(<scope>): <description>` — imperative, ≤72 chars, no period.

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `spec`
Scopes: `core`, `agents`, `backends`, `infra`, `cli`, `config`, `plugins`, `streaming`, `hooks`, `steering`

## Testing

56 test files under `tests/`. Property-based tests (`tests/property/`, 23 files) use `@fast-check/vitest` to test invariants like phase ordering and cost accumulation. Integration tests (`tests/integration/`) exercise full pipeline flows and crash-recovery scenarios. Mock backends and file system where needed; never mock SQLite in integration tests.
