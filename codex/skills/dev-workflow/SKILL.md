---
name: dev-workflow
description: Use when working in repositories that follow this setup's development workflow and the user wants the same flow in Codex. Covers plan intent capture, commit-and-verify style validation, PR creation, AI review-cycle handling, visual QA prompting, issue lookup, and Isaac/Notion task flow.
---

# Development Workflow

Use this skill when the repository follows the workflow from this setup project and the user wants Codex to apply the same operating model.

## Default behavior

1. Make the plan explicit before implementation.
2. Keep the user's intent visible and validate against it after code changes.
3. Treat commit, validation, PR creation, and review follow-up as separate gates.
4. Prefer the repository's existing scripts, docs, and temp artifacts over inventing a new process.

## Which reference to read

- For the overall flow, read [references/core-workflow.md](references/core-workflow.md).
- For commit and validation behavior, read [references/commit-and-verify.md](references/commit-and-verify.md).
- For PR creation, read [references/create-pr.md](references/create-pr.md).
- For AI review handling, read [references/review-cycle.md](references/review-cycle.md).
- For issue lookup and Ultivis/Notion task support, read [references/ult-notion.md](references/ult-notion.md).

Load only the reference that matches the user's current request.
