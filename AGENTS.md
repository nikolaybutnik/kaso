# KASO — Kiro-Enabled Agent Swarm Orchestrator

## Project Overview

**KASO** is a TypeScript-based, locally-run modular orchestration system that reads Kiro-generated specification documents and coordinates specialized AI agents through an 8-phase development lifecycle. The system automates the entire pipeline from spec intake to PR delivery with minimal human intervention.

### Key Design Goals
- Deterministic, sequential 8-phase pipeline with clear phase boundaries
- Stateless agents communicating exclusively through structured context objects
- Composition over inheritance with pure functions wherever possible
- Pluggable backends and extensible agent types via a plugin system
- Resource-conscious execution with configurable concurrency limits and cost budgets
- Real-time observability via event streaming and persisted execution history
- Crash-resilient execution with write-ahead checkpointing and automatic recovery
- Full CLI interface for controlling and inspecting all orchestration operations

### Current Status
- **Phase 1 (Infrastructure & Configuration)**: ✅ Complete
- **Phase 2 (Core Orchestration)**: 🚧 In Progress (~85% complete)
- **Phases 3-8**: 📋 Planned

The project has 21 source files (~7,000 lines of TypeScript) with 313 passing tests including comprehensive property-based tests for security and correctness.

## Technology Stack

| Component | Technology |
|-----------|------------|
| **Language** | TypeScript 5.3+ (Node.js 18+) |
| **Module System** | ESNext with path mapping via `@/` aliases |
| **Testing** | Vitest 1.1+ with @fast-check/vitest for property-based testing |
| **Database** | SQLite (via better-sqlite3) with JSONL fallback |
| **Git Operations** | simple-git |
| **Credentials** | keytar for OS keychain integration |
| **File Watching** | chokidar |
| **UI Testing** | Playwright |
| **CLI** | Commander.js |
| **Configuration** | Zod for runtime schema validation |
| **Build** | TypeScript compiler (tsc) |

## Project Structure

```
src/
├── agents/          # Agent implementations
│   ├── agent-interface.ts      # Agent contract (Agent, AgentRegistry interfaces)
│   ├── agent-registry.ts       # Agent registration and validation
│   ├── spec-reader.ts          # Phase 1: Intake - Parse Kiro specs
│   └── spec-validator.ts       # Phase 2: Validation - Validate specs
├── backends/        # Executor backend adapters
│   ├── backend-adapter.ts      # Backend interface definition
│   ├── backend-registry.ts     # Backend discovery and selection
│   └── backend-process.ts      # Subprocess management for backends
├── cli/             # CLI interface (planned)
├── config/          # Configuration loading & validation ✅
│   ├── loader.ts               # Config file I/O with deep merge
│   └── schema.ts               # Zod schemas with 260+ lines of type definitions
├── core/            # Core orchestration logic
│   ├── orchestrator.ts         # Central hub (1,155 lines)
│   ├── state-machine.ts        # Phase transitions and execution state
│   ├── event-bus.ts            # Typed pub/sub for real-time events
│   ├── concurrency-manager.ts  # Slot-based concurrency limiting
│   └── types.ts                # 443 lines of domain types
├── infrastructure/  # Core services ✅
│   ├── checkpoint-manager.ts   # Write-ahead persistence for crash recovery
│   ├── cost-tracker.ts         # Token usage and cost accumulation
│   ├── credential-manager.ts   # Secure API key handling
│   ├── execution-store.ts      # SQLite/JSONL dual-mode persistence
│   ├── log-redactor.ts         # Secret redaction from logs
│   ├── spec-writer.ts          # Write execution status to spec directories
│   └── worktree-manager.ts     # Git worktree lifecycle management
├── plugins/         # Plugin system (planned)
└── streaming/       # Event streaming (planned)

tests/
├── agents/          # Agent implementation tests
├── backends/        # Backend adapter tests
├── config/          # Config loader tests
├── core/            # Core component tests
├── infrastructure/  # Infrastructure component tests
└── property/        # Property-based tests for universal correctness

.kiro/
├── specs/kaso-orchestrator/     # Main feature spec
│   ├── requirements.md         # Detailed requirements
│   ├── design.md               # Architecture & design decisions
│   └── tasks.md                # 31 implementation tasks with status
└── steering/                    # Project conventions
    ├── coding_practices.md     # Code style & standards
    ├── commit-conventions.md   # Git commit standards
    └── personality.md          # AI agent tone guidelines
```

## Architecture

### Hub-and-Spoke Design

The system uses a hub-and-spoke architecture where:
- **Central Orchestrator** (`src/core/orchestrator.ts`): Coordinates all agent execution through the 8-phase pipeline
- **Specialized Agents**: Stateless, single-responsibility workers implementing the Agent interface
- **Pluggable Executor Backends**: Swappable AI coding tools (Kimi Code, Claude Code, Codex CLI, local models)
- **Infrastructure Layer**: Persistence, security, and checkpointing services

### 8-Phase Execution Pipeline

1. **Intake** (`spec-reader`): Parse Kiro spec files and assemble execution context
2. **Validation** (`spec-validator`): Verify spec completeness and feasibility
3. **Architecture Analysis** (`architecture-guardian`): Map requirements to existing codebase patterns
4. **Implementation** (`executor`): Generate code changes via AI backend
5. **Architecture Review** (`architecture-guardian`): Validate code against architectural patterns
6. **Test & Verification** (`test-engineer`): Generate and execute comprehensive tests
7. **UI/UX Validation** (`ui-validator`): Perform visual regression testing for UI changes
8. **Review & Delivery** (`review-council`, `delivery`): Multi-perspective code review and PR creation

### Key Components

**Agent Interface Contract** (`src/agents/agent-interface.ts`):
```typescript
export interface Agent {
  execute(context: AgentContext): Promise<AgentResult>
  supportsRollback(): boolean
  estimatedDuration(): number
  requiredContext(): string[]
}
```

**AgentContext** (`src/core/types.ts`): Structured data object passed between phases containing spec data, architecture context, and execution state.

**Worktree Isolation**: All file modifications occur in isolated git worktrees (never in the main working directory). Worktrees are created under `.kaso/worktrees/` with branch naming pattern `kaso/[feature-name]-[YYYYMMDDTHHmmss]`.

**Event Streaming**: Real-time progress events via EventBus with types like `phase:started`, `phase:completed`, `run:failed`, etc.

**ExecutionStore**: Dual-mode persistence (SQLite primary, JSONL fallback) for runs and phase results. Tables: `runs`, `phase_results`, `checkpoints`.

**CredentialManager**: Secure API key loading from environment variables (primary) or OS keychain via keytar (fallback). Never reads from git-tracked files.

**CheckpointManager**: Write-ahead persistence before phase transitions for crash recovery. Supports automatic recovery on startup.

## Build and Test Commands

### Prerequisites
- Node.js 18+
- Git 2.40+
- Kimi Code CLI (or configured alternative backend)

### Build Commands
```bash
# Compile TypeScript
npm run build

# Run all tests
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

### Testing Strategy
- **Unit Tests**: All infrastructure and core components have comprehensive unit tests
- **Property-Based Tests**: Uses @fast-check/vitest for universal correctness properties (313 total tests)
- **Coverage**: Vitest coverage with v8 provider, targets `src/**/*.ts`

## Configuration

### Main Config File: `kaso.config.json`

The configuration file uses Zod schemas for runtime validation with sensible defaults:

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
  "maxConcurrentAgents": "auto",
  "maxPhaseRetries": 2,
  "defaultPhaseTimeout": 300,
  "contextCapping": {
    "enabled": true,
    "charsPerToken": 4,
    "relevanceRanking": ["design.md", "tech-spec.md", "task.md", "ARCHITECTURE.md"]
  },
  "uiBaseline": {
    "baselineDir": ".kiro/ui-baselines",
    "captureOnPass": true,
    "diffThreshold": 0.1,
    "viewport": { "width": 1280, "height": 720 }
  },
  "executionStore": {
    "type": "sqlite",
    "path": ".kaso/execution-store.db"
  }
}
```

### Configuration Schema (`src/config/schema.ts`)

Key configuration sections:
- `executorBackends`: Array of backend configurations with protocol selection
- `maxConcurrentAgents`: Concurrency limit (number or "auto" for CPU cores - 1)
- `contextCapping`: Automatic context trimming with relevance ranking
- `reviewCouncil`: Multi-perspective review configuration
- `uiBaseline`: Visual regression testing settings
- `webhooks`: Outbound webhook configuration with HMAC signing
- `mcpServers`: MCP (Model Context Protocol) server connections
- `plugins`: Custom agent plugins from npm packages
- `customPhases`: Pipeline extension points

### Required Environment Variables
- API keys for configured AI backends (e.g., `KIMI_API_KEY`, `ANTHROPIC_API_KEY`)
- Git credentials (if using remote operations)
- Webhook secrets (for signed webhook payloads)

## Code Style Guidelines

> Source: `.kiro/steering/coding_practices.md`

### Style & Readability
- Self-documenting code first. Comments only when the "why" isn't obvious
- Meaningful names for everything — no single-letter vars outside tight loops
- No magic strings or magic numbers. Use constants
- `any` is banned. No exceptions. Ever

### Architecture & Patterns
- Follow existing project patterns and conventions. Don't reinvent the wheel
- DRY — extract shared logic, don't copy-paste
- Pure functions wherever possible. Minimize side effects
- Single responsibility — functions and modules do one thing well
- Favor composition over inheritance
- Keep dependencies explicit and injection-friendly

### Quality
- Type annotations everywhere. No implicit any, no untyped boundaries
- Docstrings on public APIs and non-obvious functions
- Handle errors explicitly — no silent catches, no swallowed exceptions
- Guard clauses over nested conditionals
- Early returns to reduce nesting and improve readability

### Structure
- Small, focused files. If it's getting long, it's doing too much
- Consistent file and folder organization matching project conventions
- Separate concerns — business logic, data access, presentation
- Keep imports clean and organized

## Commit Conventions

> Source: `.kiro/steering/commit-conventions.md`

Format:
```
<type>(<scope>): <short description>

<optional body>
```

**Types:**
- `feat` — new feature or capability
- `fix` — bug fix
- `refactor` — code restructuring without behavior change
- `test` — adding or updating tests
- `docs` — documentation changes
- `chore` — tooling, config, dependencies, CI
- `spec` — spec documents (requirements, design, tasks)

**Scopes:**
`core`, `agents`, `backends`, `infra`, `cli`, `config`, `plugins`, `streaming`, `hooks`, `steering`

**Rules:**
- Subject line max 72 chars
- Use imperative mood ("add feature" not "added feature")
- No period at end of subject
- Body wraps at 80 chars, explains "what" and "why" (not "how")

## Security Considerations

1. **Worktree Isolation**: Ensures main working directory is never modified during execution
2. **Credential Security**: No secrets in code or tracked files; environment variables or OS keychain only
3. **Log Redaction**: All API keys automatically redacted from log output via `CredentialManager`
4. **Webhook Security**: HMAC-SHA256 payload signing for webhooks
5. **Review Council**: Multi-perspective security review for all changes (Phase 8)
6. **Audit Trail**: Complete execution logs and phase history persisted in SQLite

## Resource Management

- **Concurrency**: Limit concurrent agents based on CPU cores (default: cores - 1)
- **Cost Tracking**: Per-run cost calculation with configurable budgets
- **Context Capping**: Automatic context trimming with relevance ranking
- **Phase Timeouts**: Configurable timeouts per phase with retry logic

## Error Handling

- **Rollback**: Support for agents implementing `supportsRollback()`
- **Retry Logic**: Up to 2 additional attempts with modified strategies
- **Escalation**: Halt after 3 consecutive failures with detailed reports
- **Immediate Escalation**: Security concerns trigger immediate developer notification
- **Crash Recovery**: Automatic resumption from last completed phase on restart

## Key Files for AI Agents

**When working on this codebase, always refer to:**
- `.kiro/steering/coding_practices.md` - Code style and quality standards
- `.kiro/steering/personality.md` - Communication tone guidelines
- `.kiro/steering/commit-conventions.md` - Git commit message format
- `src/core/types.ts` - All domain types and interfaces (443 lines)
- `src/config/schema.ts` - Configuration schemas and validation
- `.kiro/specs/kaso-orchestrator/tasks.md` - Implementation task tracker

**Useful commands:**
```bash
# After any changes
npm run build && npm test

# Check test coverage
npm run test:coverage

# Run specific test suites
npm run test:property  # Security property tests
```

## Implementation Status

See `.kiro/specs/kaso-orchestrator/tasks.md` for the complete 31-task implementation plan. Key milestones:

| Task | Description | Status |
|------|-------------|--------|
| 1.1-1.5 | Project scaffolding, core types, config | ✅ Complete |
| 2.1-2.3 | Credential manager, log redactor | ✅ Complete |
| 3.1-3.3 | Execution store, checkpoint manager | ✅ Complete |
| 4.1-4.2 | Worktree manager | ✅ Complete |
| 6.1-6.3 | Event bus, concurrency manager | ✅ Complete |
| 7.1-7.4 | Agent interface, registry, cost tracker | ✅ Complete |
| 8.1-8.2 | State machine | ✅ Complete |
| 9.1-9.4 | Backend adapters | ✅ Complete |
| 10.1-10.3 | Spec reader agent | ✅ Complete |
| 11.1-11.2 | Spec validator agent | ✅ Complete |
| 13.1-13.5 | Orchestrator | ✅ Complete |
| 14.1-14.3 | Error handling and recovery | 🚧 In Progress |
| 16-31 | Remaining phases, CLI, plugins, MCP | 📋 Planned |
