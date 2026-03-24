# KASO Troubleshooting Guide

Common issues and solutions when using KASO (Kiro-Enabled Agent Swarm Orchestrator).

## Quick Diagnostics

Run `kaso doctor` to check your environment:

```bash
npx kaso doctor
```

This verifies:
- Node.js version (requires 18+)
- Git installation and version (requires 2.40+)
- Kimi Code CLI availability
- API key configuration
- Database connectivity

---

## Missing API Keys

### Symptoms
```
Error: Missing API key for backend 'kimi-code'
       Set KIMI_API_KEY environment variable
```

### Solutions

1. **Environment Variable (Recommended)**
   ```bash
   export KIMI_API_KEY="your-api-key-here"
   ```
   
   Add to `~/.bashrc`, `~/.zshrc`, or project `.env` file (not committed).

2. **OS Keychain (Fallback)**
   KASO will attempt to read from the OS keychain using `keytar`.
   ```bash
   # macOS example
   security add-generic-password -s "kaso-kimi-api-key" -a "$USER" -w "your-key"
   ```

### Backend-Specific Variables

| Backend | Variable Name |
|---------|---------------|
| kimi-code | `KIMI_API_KEY` |
| claude-code | `ANTHROPIC_API_KEY` |
| codex | `OPENAI_API_KEY` |

---

## Git Worktree Errors

### Symptom: "Worktree already exists"
```
Error: Worktree for branch 'kaso/feature-20260324T120000' already exists
```

### Solution
Clean up orphaned worktrees:

```bash
# List all worktrees
git worktree list

# Remove specific worktree
git worktree remove .kaso/worktrees/feature-name-20260324T120000

# Or remove all and prune
cd .kaso/worktrees && rm -rf * && cd ../..
git worktree prune
```

### Symptom: "Branch already exists"
```
Error: A branch named 'kaso/feature-name' already exists
```

### Solution
Branch names include timestamps to avoid conflicts. If you see this error:

1. Wait 1 second (timestamps are second-precision)
2. Retry the operation
3. Or manually delete the old branch:
   ```bash
   git branch -D kaso/feature-name-20260324T120000
   ```

---

## Backend Crashes

### Symptom: "Backend process exited with code 1"
```
Error: Backend 'kimi-code' crashed during execution
       Exit code: 1
       Stderr: Command not found: kimi
```

### Solutions

1. **Verify CLI Installation**
   ```bash
   which kimi
   kimi --version
   ```

2. **Check PATH**
   Ensure the backend CLI is in your PATH:
   ```bash
   export PATH="$PATH:/path/to/kimi/bin"
   ```

3. **Verify Backend Configuration**
   Check `kaso.config.json`:
   ```json
   {
     "executorBackends": [{
       "name": "kimi-code",
       "command": "kimi",  // <-- Must be in PATH
       "enabled": true
     }]
   }
   ```

### Symptom: "Backend timeout"
```
Error: Phase timeout exceeded (300s)
```

### Solution
Increase timeout in config:
```json
{
  "defaultPhaseTimeout": 600  // 10 minutes
}
```

Or per-phase override via custom config (requires code change).

---

## MCP Connection Failures

### Symptom: "MCP server disconnected"
```
Warn: MCP server 'filesystem' disconnected unexpectedly
      Tools from this server are now unavailable
```

### Solutions

1. **Verify MCP Server Installation**
   ```bash
   npx -y @modelcontextprotocol/server-filesystem --help
   ```

2. **Check MCP Configuration**
   ```json
   {
     "mcpServers": [{
       "name": "filesystem",
       "command": "npx",
       "args": ["-y", "@modelcontextprotocol/server-filesystem", "/valid/path"]
     }]
   }
   ```

3. **Review MCP Server Logs**
   MCP errors are logged at debug level:
   ```bash
   KASO_LOG_LEVEL=debug npx kaso start ./spec
   ```

### Note on MCP Failures
MCP failures are non-fatal. The orchestrator continues execution without MCP tools if a server disconnects.

---

## Database Issues

### Symptom: "SQLite database is locked"
```
Error: database is locked (SQLITE_BUSY)
```

### Solution
This occurs with concurrent access. KASO uses busy timeout handling, but:

1. Ensure only one KASO instance is running
2. Check for zombie processes:
   ```bash
   ps aux | grep kaso
   ```
3. Restart to clear locks

### Symptom: "JSONL fallback activated"
```
Warn: SQLite unavailable, falling back to JSONL storage
```

### Solution
Install native dependencies:
```bash
npm rebuild better-sqlite3
```

Or use JSONL intentionally (slower but no native deps):
```json
{
  "executionStore": {
    "type": "jsonl",
    "path": ".kaso/execution-store.jsonl"
  }
}
```

---

## Spec Not Found

### Symptom: "No spec files found"
```
Error: No design.md or tech-spec.md found in ./my-feature
```

### Solution
KASO expects spec files following Kiro structure:

```
.kiro/specs/my-feature/
├── design.md       # Required: feature design
├── tech-spec.md    # Required: technical specification
└── task.md         # Required: implementation tasks
```

Verify:
1. Directory exists and contains markdown files
2. Files have `.md` extension
3. Spec directory is readable

---

## Rate Limiting / Cost Budget

### Symptom: "Cost budget exceeded"
```
Error: Run halted - cost budget exceeded ($10.50 / $10.00)
```

### Solution
Adjust budget in config:
```json
{
  "costBudget": {
    "enabled": true,
    "maxUsdPerRun": 25.0
  }
}
```

Or disable budget checking:
```json
{
  "costBudget": {
    "enabled": false
  }
}
```

---

## SSE Connection Issues

### Symptom: "Cannot connect to SSE server"
```
Error: Connection refused on localhost:PORT
```

### Solutions

1. **Check if SSE is enabled**
   ```json
   {
     "sse": {
       "enabled": true,
       "port": 3001  // or 0 for auto
     }
   }
   ```

2. **Check authentication**
   If `authToken` is configured, include it:
   ```javascript
   const eventSource = new EventSource(
     'http://localhost:3001/events?token=YOUR_TOKEN'
   );
   ```

3. **Verify port availability**
   ```bash
   lsof -i :3001  # macOS/Linux
   netstat -ano | findstr :3001  # Windows
   ```

---

## Plugin Loading Failures

### Symptom: "Plugin does not implement Agent interface"
```
Error: Plugin 'kaso-plugin-example' validation failed
       Missing required method: 'execute'
```

### Solution
Plugins must export an object implementing the `Agent` interface:

```typescript
export default {
  name: 'my-custom-agent',
  execute: async (context: AgentContext) => { /* ... */ },
  supportsRollback: () => true,
  estimatedDuration: () => 60,
  requiredContext: () => ['spec', 'architecture']
};
```

Verify:
1. Plugin package exports the agent correctly
2. All required methods are present
3. Method signatures match the interface

---

## Debug Mode

Enable debug logging for detailed diagnostics:

```bash
# Environment variable
KASO_LOG_LEVEL=debug npx kaso start ./spec

# Or in config
{
  "logLevel": "debug"
}
```

Debug output includes:
- Phase transitions
- Backend invocations
- MCP tool calls
- Event bus messages
- Checkpoint saves

---

## Getting Help

1. **Run diagnostics**: `kaso doctor`
2. **Check logs**: Look in `.kaso/logs/`
3. **Review execution history**: `kaso history`
4. **File an issue**: Include `kaso doctor` output and relevant logs

---

## Common Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Configuration error |
| 3 | Missing prerequisites |
| 10 | Run cancelled |
| 11 | Phase timeout |
| 12 | Cost budget exceeded |
| 20 | Backend unavailable |
| 21 | Backend crashed |
| 30 | Git error |
| 40 | Database error |
