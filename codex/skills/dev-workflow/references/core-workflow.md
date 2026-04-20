# Core Workflow

Apply this sequence by default:

1. Plan
2. Build
3. Commit
4. Validation stage 1: intent validation
5. Validation stage 2: quality validation
6. Optional Visual QA for frontend changes
7. PR creation

Key expectations:

- The plan must include the user's intent, expected outcome, and meaningful constraints.
- Preserve the approved plan in `tmp/current-plan.md` when the project already uses that artifact.
- Validation is a gate, not a summary. If intent validation fails, stop and fix the implementation before moving on.
- Quality validation should cover docs, security, code simplicity, tests, and CLI sync when relevant.
- Frontend changes should trigger a suggestion for Visual QA instead of being ignored.

Commit message convention:

```text
type: subject

body
```

Use conventional commit types such as `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, and `perf`.
