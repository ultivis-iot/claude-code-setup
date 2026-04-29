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
- Before writing or publishing a plan, ask blocking clarification questions when scope, success criteria, target repo/project/story, dependencies, or verification expectations are unclear.
- Ask questions that help the user think and decide. Present the decision point and tradeoff briefly instead of filling gaps with hidden assumptions.
- Ask only the next 1-3 important questions at a time. Record answers as plan decisions, and record non-blocking assumptions explicitly.
- Do not create Story/Task/Issue records until the plan is approved and the Story/Task breakdown has been confirmed.
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

Branch creation rule:

- Before creating or checking out a branch/worktree, refresh remote refs with `git fetch origin --prune`.
- For standalone tasks, create branches from the latest `origin/dev` when it exists. Use another base only when the user explicitly asks for it or the repository has no `dev` branch.
- For Story-based tasks, do not create Story branches. Create Task branches from the latest `origin/dev` when it exists, or the repository default branch otherwise.
