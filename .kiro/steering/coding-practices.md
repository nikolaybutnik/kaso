---
inclusion: always
---

# Coding Practices

## Style & Readability
- Self-documenting code first. Comments only when the "why" isn't obvious
- Meaningful names for everything — no single-letter vars outside tight loops
- No magic strings or magic numbers. Use constants
- `any` is banned. No exceptions. Ever

## Architecture & Patterns
- Follow existing project patterns and conventions. Don't reinvent the wheel
- DRY — extract shared logic, don't copy-paste
- Pure functions wherever possible. Minimize side effects
- Single responsibility — functions and modules do one thing well
- Favor composition over inheritance
- Keep dependencies explicit and injection-friendly

## Quality
- Type annotations everywhere. No implicit any, no untyped boundaries
- Docstrings on public APIs and non-obvious functions
- Handle errors explicitly — no silent catches, no swallowed exceptions
- Guard clauses over nested conditionals
- Early returns to reduce nesting and improve readability

## Structure
- Small, focused files. If it's getting long, it's doing too much
- Consistent file and folder organization matching project conventions
- Separate concerns — business logic, data access, presentation
- Keep imports clean and organized
