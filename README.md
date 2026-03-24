# KASO

Kiro-Enabled Agent Swarm Orchestrator — a locally-run TypeScript system that reads Kiro spec documents and coordinates AI agents through an 8-phase development pipeline, from spec intake to PR delivery.

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
  }
}
```

Set API keys as environment variables (e.g., `KIMI_API_KEY`) or store them in your OS keychain via keytar.

See [AGENTS.md](AGENTS.md) for the full configuration reference and all available options.

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
