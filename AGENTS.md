# KASO — Kiro-Enabled Agent Swarm Orchestrator

## Project Overview

**KASO** (Kiro-Enabled Agent Swarm Orchestrator) is a TypeScript-based, locally-run modular orchestration system that reads Kiro-generated specification documents and coordinates specialized AI agents through an 8-phase development lifecycle. The system automates the entire pipeline from spec intake to PR delivery with minimal human intervention.

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
The project has completed Phase 1 (Infrastructure & Configuration) and is actively implementing Phase 2 (Core Orchestration). Core infrastructure components including configuration management, credential handling, execution persistence, and checkpoint management are fully implemented and tested.

## Technology Stack

- **Language**: TypeScript 5.3+ (Node.js 18+)
- **Module System**: ESNext with path mapping via `@/` aliases
- **Testing**: Vitest 1.1+ with @fast-check/vitest for property-based testing
- **Database**: SQLite (via better-sqlite3) with JSONL fallback
- **Git Operations**: simple-git
- **Credentials**: keytar for OS keychain integration
- **File Watching**: chokidar
- **UI Testing**: Playwright
- **CLI**: Commander.js
- **Configuration**: Zod for runtime schema validation
- **Build**: TypeScript compiler (tsc)

## Project Structure

```
src/
├── agents/          # Agent implementations (Phase 2+)
├── backends/        # Executor backend adapters (Phase 2+)
├── cli/             # CLI interface (Phase 2+)
├── config/          # Configuration loading & validation ✅
│   ├── loader.ts    # Config file I/O with deep merge
│   └── schema.ts    # Zod schemas with 260+ lines of type definitions
├── core/            # Core type definitions ✅
│   └── types.ts     # 429 lines - all execution & domain types
├── infrastructure/  # Core services ✅
│   ├── checkpoint-manager.ts  # Write-ahead persistence
│   ├── credential-manager.ts  # Secure secret handling
│   ├── execution-store.ts     # SQLite/JSONL persistence
│   └── log-redactor.ts        # Secret redaction
├── plugins/         # Plugin system (Phase 3)
└── streaming/       # Event streaming (Phase 2+)

tests/
├── config/          # Config loader tests
└── infrastructure/  # Infrastructure component tests
    └── *property*   # Property-based tests for security

.kiro/
├── specs/kaso-orchestrator/     # Main feature spec
│   ├── requirements.md         # Detailed requirements
│   ├── design.md               # Architecture & design decisions
│   └── tasks.md                # 31 implementation tasks
├── steering/                    # Project conventions
│   ├── coding_practices.md     # Code style & standards
│   ├── personality.md          # AI agent tone guidelines
│   └── commit-conventions.md   # Git commit standards
└── hooks/                      # Automation hooks
    ├── enforce-code-standards.kiro.hook
    ├── run-tests-post-task.kiro.hook
    └── update-docs-post-task.kiro.hook
```

## Architecture

### Hub-and-Spoke Design
The system uses a hub-and-spoke architecture where:
- **Central Orchestrator**: Coordinates all agent execution through the 8-phase pipeline
- **Specialized Agents**: Stateless, single-responsibility workers that implement the Agent Interface Contract
- **Pluggable Executor Backends**: Swappable AI coding tools (Kimi Code, Claude Code, Codex CLI, local models)
- **Infrastructure Layer**: Persistence, security, and checkpointing services

### 8-Phase Execution Pipeline
1. **Intake** - Parse Kiro spec files and assemble execution context
2. **Validation** - Verify spec completeness and feasibility
3. **Architecture Analysis** - Map requirements to existing codebase patterns
4. **Implementation** - Generate code changes via AI backend
5. **Architecture Review** - Validate code against architectural patterns
6. **Test & Verification** - Generate and execute comprehensive tests
7. **UI/UX Validation** - Perform visual regression testing for UI changes
8. **Review & Delivery** - Multi-perspective code review and PR creation

### Key Components
- **Agent Interface Contract**: All agents must implement `execute()`, `supportsRollback()`, `estimatedDuration()`, and `requiredContext()` methods
- **AgentContext**: Structured data object passed between phases containing spec data, architecture context, and execution state
- **Worktree Isolation**: All file modifications occur in isolated git worktrees (never in the main working directory)
- **Event Streaming**: Real-time progress events via WebSocket/SSE with persisted execution history
- **ExecutionStore**: Dual-mode persistence (SQLite primary, JSONL fallback) for runs and phase results
- **CredentialManager**: Secure API key loading from environment variables or OS keychain
- **CheckpointManager**: Write-ahead persistence before phase transitions for crash recovery

## Development Conventions

### Coding Practices

> Source: `.kiro/steering/coding_practices.md`

#### Style & Readability
- Self-documenting code first. Comments only when the "why" isn't obvious
- Meaningful names for everything — no single-letter vars outside tight loops
- No magic strings or magic numbers. Use constants
- `any` is banned. No exceptions. Ever

#### Architecture & Patterns
- Follow existing project patterns and conventions. Don't reinvent the wheel
- DRY — extract shared logic, don't copy-paste
- Pure functions wherever possible. Minimize side effects
- Single responsibility — functions and modules do one thing well
- Favor composition over inheritance
- Keep dependencies explicit and injection-friendly

#### Quality
- Type annotations everywhere. No implicit any, no untyped boundaries
- Docstrings on public APIs and non-obvious functions
- Handle errors explicitly — no silent catches, no swallowed exceptions
- Guard clauses over nested conditionals
- Early returns to reduce nesting and improve readability

#### Structure
- Small, focused files. If it's getting long, it's doing too much
- Consistent file and folder organization matching project conventions
- Separate concerns — business logic, data access, presentation
- Keep imports clean and organized

### Commit Conventions

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

### AI Agent Personality

> Source: `.kiro/steering/personality.md`

#### Vibe
- Loose cannon energy. Swearing, roasting, dark humor, inappropriate jokes — all fair game
- Talk like a dev buddy, not a corporate chatbot. Be real, be blunt, be funny
- Sarcasm is a love language. Use it freely
- Celebrate clever solutions, ruthlessly mock bad code
- Drop dev slang, memes, gaming/pop culture refs when they land
- Use emojis sparingly but effectively 🚀
- Keep it concise and punchy. No walls of text, no hand-holding

#### Know When to Chill
- Security discussions: dead serious, no jokes
- Complex technical explanations: clarity over comedy
- User is frustrated or stressed: dial it back, be supportive
- Code comments: always professional, only where genuinely needed

## Automation Hooks

### Pre-Tool Use
- **Enforce Code Standards**: Validates code before writing (no `any` types, proper annotations, guard clauses, meaningful names)
- *Note: Skips checks for `.kiro/` folder files*

### Post-Task Execution
1. **Auto-Commit**: Stages all changes and creates conventional commit with descriptive message
2. **Test Runner**: Executes `npm test` to verify codebase health
3. **Documentation Update**: Automatically updates relevant docs (ARCHITECTURE.md, README.md, API docs) to reflect changes

## Build and Development Commands

### Prerequisites
- Node.js 18+
- Git 2.40+
- Kimi Code CLI (or configured alternative)

### Build Commands
```bash
# Compile TypeScript
npm run build

# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run property-based tests
npm run test:property

# Run integration tests
npm run test:integration

# Generate coverage report
npm run test:coverage
```

### Testing Strategy
- **Unit Tests**: All infrastructure components have comprehensive unit tests
- **Property-Based Tests**: Uses fast-check for universal correctness properties (credential security, phase transitions, cost calculations)
- **Integration Tests**: End-to-end pipeline execution tests (planned via `test:integration` script)
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

### Required Environment Variables
- API keys for configured AI backends (e.g., `KIMI_API_KEY`, `ANTHROPIC_API_KEY`)
- Git credentials (if using remote operations)
- Webhook secrets (for signed webhook payloads)

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

## Extensibility

### Plugin System
KASO supports custom agents via npm packages:
- Plugins must export a class implementing the Agent interface
- Plugins discovered and loaded from config `plugins` section
- Custom phases can be injected at configurable pipeline positions
- No sandboxing - plugins run with same privileges as host process

### Executor Backend Protocols
Supports multiple AI backend connection methods:
- `cli-stdout` - Simple CLI with stdout
- `cli-json` - JSON protocol over stdin/stdout
- `acp` - Agent Communication Protocol
- `mcp` - Model Context Protocol (for tool integration)

## Monitoring & Observability

- **Real-time Events**: WebSocket/SSE streaming of execution progress
- **Execution History**: Persisted in SQLite with full phase details
- **Phase Tracking**: Current phase, elapsed time, token usage, and cost per phase
- **Event Types**: 15+ event types covering all execution states
- **Metrics**: Cost, duration, token usage, retry counts, success rates

## Implementation Status

### ✅ Completed (Phase 1)
- Core type definitions (429 lines in `src/core/types.ts`)
- Configuration schema & validation (261 lines, Zod-based)
- Config loader with deep merge and defaults
- Execution store (SQLite/JSONL dual mode)
- Credential manager with OS keychain support
- Checkpoint manager for crash recovery
- Log redaction for secrets
- Comprehensive unit tests for all infrastructure
- Property-based security tests

### 🚧 In Progress (Phase 2)
- Agent interface and base implementations
- Orchestrator state machine
- Executor backend adapters
- CLI interface
- Event streaming system

### 📋 Planned (Phases 3-8)
- Plugin system
- Custom agents
- UI testing integration
- Review council implementation
- Webhook dispatcher
- File watcher mode

See `.kiro/specs/kaso-orchestrator/tasks.md` for the complete 31-task implementation plan organized into multiple checkpoints.

## Key Files for AI Agents

**When working on this codebase, always refer to:**
- `.kiro/steering/coding_practices.md` - Code style and quality standards
- `.kiro/steering/personality.md` - Communication tone guidelines
- `.kiro/steering/commit-conventions.md` - Git commit message format
- `src/core/types.ts` - All domain types and interfaces (429 lines)
- `src/config/schema.ts` - Configuration schemas and validation
- `src/infrastructure/` - Core services (all implemented and tested)

**Useful commands:**
```bash
# After any changes
npm run build && npm test

# Check test coverage
npm run test:coverage

# Run specific test suites
npm run test:property  # Security property tests
npm run test:integration # Integration tests
```
