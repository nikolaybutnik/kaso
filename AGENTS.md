# KASO — Kiro-Enabled Agent Swarm Orchestrator

## Project Overview

**KASO** (Kiro-Enabled Agent Swarm Orchestrator) is a locally-run, modular orchestration system that reads Kiro-generated specification documents and coordinates specialized AI agents through an 8-phase development lifecycle. This system aims to eliminate human intervention during AI-assisted engineering execution by automating the entire pipeline from spec intake to PR delivery.

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
This project is currently in the **specification and design phase**. The repository contains comprehensive specification documents but no actual source code implementation yet. The project structure follows Kiro's spec-driven development workflow.

## Technology Stack

- **Language**: TypeScript (Node.js 18+)
- **Testing**: Vitest with @fast-check/vitest for property-based testing
- **Database**: SQLite (via better-sqlite3) or JSONL for execution store
- **Git Operations**: simple-git
- **Credentials**: keytar for OS keychain integration
- **File Watching**: chokidar
- **UI Testing**: Playwright
- **CLI**: Commander.js
- **Configuration**: Zod for schema validation

## Project Structure

```
.kiro/
├── specs/kaso-orchestrator/     # Main feature spec (requirements, design, tasks)
├── steering/                    # Kiro steering files
│   ├── coding_practices.md     # Coding standards and conventions
│   ├── personality.md          # AI agent personality guidelines
│   └── commit-conventions.md   # Git commit format standards
└── hooks/                      # Automation hooks
    ├── auto-commit-post-task.kiro.hook
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

## Development Conventions

### Code Style (from steering files)
- **Self-documenting code first** - comments only when "why" isn't obvious
- **Meaningful names** - no single-letter variables outside tight loops
- **Strict TypeScript** - `any` is banned with no exceptions
- **Guard clauses** over nested conditionals with early returns
- **Pure functions** where possible, composition over inheritance
- **No magic strings/numbers** - use constants
- **DRY principle** - extract shared logic, never copy-paste

### Commit Conventions
Format: `type(scope): short description`

**Types:**
- `feat` - new feature or capability
- `fix` - bug fix
- `refactor` - code restructuring without behavior change
- `test` - adding or updating tests
- `docs` - documentation changes
- `chore` - tooling, config, dependencies, CI
- `spec` - spec documents (requirements, design, tasks)

**Scopes:**
`core`, `agents`, `backends`, `infra`, `cli`, `config`, `plugins`, `streaming`, `hooks`, `steering`

**Rules:**
- Subject line max 72 characters
- Use imperative mood ("add feature" not "added feature")
- No period at end of subject
- Body wraps at 80 characters, explains "what" and "why" (not "how")

### AI Agent Personality (for Kiro interactions)
- **Tone**: Loose cannon energy - swearing, roasting, dark humor, inappropriate jokes all fair game
- **Communication**: Talk like a dev buddy, not a corporate chatbot
- **Style**: Be real, be blunt, be funny - sarcasm is a love language
- **References**: Drop dev slang, memes, gaming/pop culture refs when they land
- **Boundaries**: Security discussions = dead serious (no jokes), dial back when user is frustrated

## Automation Hooks

### Pre-Tool Use
- **Enforce Code Standards**: Validates code before writing (no `any` types, proper annotations, guard clauses, meaningful names)
- *Note: Skips checks for `.kiro/` folder files*

### Post-Task Execution
1. **Auto-Commit**: Stages all changes and creates conventional commit with descriptive message
2. **Test Runner**: Executes `npm test` to verify codebase health
3. **Documentation Update**: Automatically updates relevant docs (ARCHITECTURE.md, README.md, API docs) to reflect changes

## Key Requirements

### Security
- **Credential Management**: API keys loaded from environment variables or OS keychain only
- **No File Storage**: Secrets never read from git-tracked files
- **Secret Redaction**: API keys redacted from all log output
- **Git Isolation**: All changes in worktrees, main directory never modified

### Resource Management
- **Concurrency**: Limit concurrent agents based on CPU cores (default: cores - 1)
- **Cost Tracking**: Calculate estimated cost per execution run, enforce configurable budgets
- **Context Capping**: Trim context to fit executor backend limits with relevance ranking

### Error Handling
- **Rollback**: Support rollback for agents that implement `supportsRollback()`
- **Retry Logic**: Up to 2 additional attempts with modified strategies (reduced context, alternative backend)
- **Escalation**: Halt after 3 consecutive failures with detailed reports
- **Immediate Escalation**: Security concerns or architectural deadlocks trigger immediate developer notification

### Monitoring & Observability
- **Real-time Events**: WebSocket/SSE streaming of execution progress
- **Execution History**: Persisted in SQLite/JSONL with full phase details
- **Phase Tracking**: Current phase, elapsed time, token usage, and cost per phase
- **Crash Recovery**: Automatic resumption from last completed phase on restart

## Testing Strategy

### Property-Based Testing
Uses fast-check for generating test cases that validate universal correctness properties:
- Spec parsing produces structured context
- No concurrent runs for the same spec
- Phase transitions maintain sequential order
- Cost calculations are accurate
- Execution state survives process restarts

### Test Requirements
- Unit tests for all agents and infrastructure components
- Integration tests covering end-to-end pipeline execution
- Mock backend for testing without actual AI calls
- Worktree isolation verification
- SSE event streaming validation

## Build and Development Commands

*Note: Project is currently in design phase - commands are planned but not yet implemented*

### Prerequisites
- Node.js 18+
- Git 2.40+
- Kimi Code CLI (or configured alternative)

### Planned CLI Commands
- `kaso start <spec-path>` - Initiate new execution run
- `kaso status [run-id]` - Display run state and metrics
- `kaso pause <run-id>` - Pause execution
- `kaso resume <run-id>` - Resume paused run
- `kaso cancel <run-id>` - Cancel execution
- `kaso cost [run-id]` - Display cost breakdown
- `kaso history [--limit N]` - List past runs
- `kaso logs <run-id> [--phase <name>]` - View execution logs
- `kaso watch` - Start file-watcher mode
- `kaso doctor` - Verify installation and configuration

### Testing
```bash
# Run all tests
npm test

# Run property tests
npm run test:property

# Run integration tests
npm run test:integration

# Generate coverage report
npm run test:coverage
```

## Configuration

### Main Config File: `kaso.config.json`
- Executor backend definitions and selection strategy
- Concurrency limits and phase timeouts
- Webhook URLs and authentication headers
- MCP server connections
- Plugin packages and custom phases
- Cost budgets and context capping strategy
- UI baseline configuration for visual regression testing

### Required Environment Variables
- API keys for configured AI backends
- Git credentials (if using remote operations)
- Webhook secrets (for signed webhook payloads)

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

## Security Considerations

1. **Worktree Isolation**: Ensures main working directory is never modified
2. **Credential Security**: No secrets in code or tracked files
3. **Webhook Security**: HMAC-SHA256 payload signing
4. **Review Council**: Multi-perspective security review for all changes
5. **Audit Trail**: Complete execution logs and phase history in Kiro specs

## Next Steps for Implementation

This project is currently in the design/specification phase. The next steps would be:

1. Initialize project structure with TypeScript configuration
2. Implement core type definitions and configuration loading
3. Build credential management and execution store
4. Create worktree manager and agent interface
5. Implement state machine and orchestrator
6. Build agents for each phase (SpecReader, Validator, ArchitectureGuardian, etc.)
7. Add executor backend adapters
8. Implement file watcher and webhook dispatcher
9. Build CLI interface
10. Add plugin system and MCP integration
11. Write comprehensive tests and documentation

See `.kiro/specs/kaso-orchestrator/tasks.md` for detailed implementation plan organized into 31 incremental tasks across multiple checkpoints.
