# KASO

Kiro-Enabled Agent Swarm Orchestrator — a locally-run TypeScript system that reads Kiro spec documents and coordinates AI agents through an 8-phase development pipeline, from spec intake to PR delivery.

## Features

- 8-phase sequential pipeline: Intake → Validation → Architecture Analysis → Implementation → Architecture Review → Test & Verification → UI/UX Validation → Review & Delivery
- Pluggable AI backends (Kimi Code, Claude Code, Codex CLI, local models)
- MCP (Model Context Protocol) integration for external tool access during implementation
- Multi-perspective code review via Review Council (security, performance, maintainability)
- Visual regression testing with Playwright screenshot capture and baseline management
- Git worktree isolation — your working directory is never touched
- Real-time observability via SSE streaming and webhook notifications
- Crash-resilient execution with write-ahead checkpointing
- Plugin system for custom agents and phase injection
- Cost tracking with configurable per-run budgets
- Full CLI for controlling and inspecting all operations

## Prerequisites

- Node.js 18+
- Git 2.40+
- A configured AI backend (e.g., Kimi Code CLI)

## Setup

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run build
```

## Configuration

Create a `kaso.config.json` in the project root. Minimal example:

```json
{
  "executorBackends": [
    {
      "name": "kimi-code",
      "command": "kimi",
      "protocol": "cli-json",
      "maxContextWindow": 128000,
      "costPer1000Tokens": 0.01
    }
  ],
  "defaultBackend": "kimi-code",
  "uiBaseline": {
    "viewport": { "width": 1280, "height": 720 }
  },
  "mcpServers": [
    {
      "name": "my-tools",
      "transport": "stdio",
      "command": "npx",
      "args": ["my-mcp-server"]
    }
  ]
}
```

MCP tools are automatically scoped to the Implementation phase — other phases don't receive them.

Set API keys as environment variables (e.g., `KIMI_API_KEY`) or store them in your OS keychain via keytar.

See [AGENTS.md](AGENTS.md) for the full configuration reference and all available options.

## CLI Usage

```bash
kaso start <spec-path>        # Start a new execution run
kaso status [run-id]          # Show run status or list active runs
kaso pause <run-id>           # Pause after current phase
kaso resume <run-id>          # Resume a paused run
kaso cancel <run-id>          # Cancel and preserve worktree
kaso cost [run-id]            # Cost breakdown or history
kaso history [--limit N]      # List past runs
kaso logs <run-id> [--phase]  # Stream execution logs
kaso watch                    # Auto-detect specs in .kiro/specs/
kaso doctor                   # Verify prerequisites
```

## Testing

```bash
npm test                # Run all tests
npm run test:property   # Property-based tests only
npm run test:coverage   # With coverage report
```

## Project Documentation

See [AGENTS.md](AGENTS.md) for the complete project reference including:
- Architecture and 8-phase pipeline design
- Module-by-module API reference
- Configuration schema
- Implementation status
- Security model and error handling

## License

ISC
