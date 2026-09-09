# Commit And Verify

Use this procedure when the user wants the Codex equivalent of `/commit-and-verify`.

## Inputs

- Optional working directory
- Optional commit message
- Existing plan artifact if available

## Required behavior

1. Determine the target repository directory.
2. Inspect git status, current branch, staged diff, and branch diff against the base branch.
3. Ensure the approved plan is available as `tmp/current-plan.md` when the project uses that workflow. Select it this way: list the five most recent plans; use the only one after confirming; ask the user to choose when several match; when none exists, ask whether to proceed without one and say that intent validation is weaker without it.
4. Create a conventional commit. When no message is given, ask the user for one. Stop when nothing is staged.
5. Run intent validation first as the **Spec Review**. Check the approved Plan and linked Task/Issue for missing behavior, wrong behavior, scope creep, and concrete verification evidence.
6. If intent validation passes, run quality validation for:
   - documentation
   - security
   - code simplicity as the **Standards Review**, applying repository standards first and code-smell checks second
   - tests
   - CLI sync when `.cli-sync.json` exists with `enabled: true`. When the file is missing or disabled, detect whether the project ships a CLI and ask whether to create the file — do not run the check.
7. If frontend files changed, ask whether to perform Visual QA or mark it pending/skipped.
8. Write the aggregated result to `tmp/validation-status.json`.

## Subagent limits

Validation subagents validate only. They do not call other commands, do not write files, and return their result as JSON text. Only the main procedure writes `tmp/validation-status.json`.

## Validation result expectations

- `PASS`: ready to continue
- `WARN`: acceptable with user visibility
- `FAIL`: stop and fix before proceeding

When intent validation fails, stop immediately and record every remaining validator as `SKIP`. Both the Spec Review and the Standards Review must pass before the review counts as complete.

Do not create a PR inside this procedure. PR creation is a separate gate.

The Spec Review and Standards Review are the two review axes adapted from Matt Pocock's `code-review` skill. Keep them separate so a standards-clean change cannot hide a spec failure, and a spec-complete change cannot hide maintainability problems.
