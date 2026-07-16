---
name: ultivis-flow
description: Baseline workflow and query router for repositories using this setup. Use for planning, implementation, GitHub/Notion Story and Task work, validation, commits, PRs, reviews, or whenever a focused engineering overlay should be selected from the user's natural-language request.
---

# Development Workflow

This is the always-on baseline for repositories using this setup. It owns lifecycle and tracking; focused skills are temporary overlays and never replace this workflow.

## Default behavior

1. Make the plan explicit before implementation.
2. Keep the user's intent visible and validate against it after code changes.
3. Treat commit, validation, PR creation, and review follow-up as separate gates.
4. Prefer the repository's existing scripts, docs, and temp artifacts over inventing a new process.
5. Route the request to at most one primary overlay before doing specialized work.

## Which reference to read

- For the overall flow, read [references/core-workflow.md](references/core-workflow.md).
- For natural-language overlay selection, read [references/overlay-routing.md](references/overlay-routing.md).
- For commit and validation behavior, read [references/commit-and-verify.md](references/commit-and-verify.md).
- For PR creation, read [references/create-pr.md](references/create-pr.md).
- For AI review handling, read [references/review-cycle.md](references/review-cycle.md).
- For issue lookup and Ultivis/Notion task support, read [references/ult-notion.md](references/ult-notion.md).

Load only the reference that matches the user's current request.
