---
inclusion: manual
---

# Commit Conventions

## Format
```
<type>(<scope>): <short description>

<optional body>
```

## Types
- `feat` — new feature or capability
- `fix` — bug fix
- `refactor` — code restructuring without behavior change
- `test` — adding or updating tests
- `docs` — documentation changes
- `chore` — tooling, config, dependencies, CI
- `spec` — spec documents (requirements, design, tasks)

## Scope
Use the module or area affected: `core`, `agents`, `backends`, `infra`, `cli`, `config`, `plugins`, `streaming`, `hooks`, `steering`

## Rules
- Subject line max 72 chars
- Use imperative mood ("add feature" not "added feature")
- No period at end of subject
- Body wraps at 80 chars, explains "what" and "why" (not "how")
