# Commit And Verify

Use this procedure when the user wants the Codex equivalent of `/commit-and-verify`.

## Inputs

- Optional working directory
- Optional commit message
- Existing plan artifact if available

## Required behavior

1. Determine the target repository directory.
2. Inspect git status, current branch, staged diff, and branch diff against the base branch.
3. Ensure the approved plan is available as `tmp/current-plan.md` when the project uses that workflow.
4. Create a conventional commit.
5. Run intent validation first.
6. If intent validation passes, run quality validation for:
   - documentation
   - security
   - code simplicity
   - tests
   - CLI sync when the project has `.cli-sync.json`
7. If frontend files changed, ask whether to perform Visual QA or mark it pending/skipped.
8. Write the aggregated result to `tmp/validation-status.json`.

## Validation result expectations

- `PASS`: ready to continue
- `WARN`: acceptable with user visibility
- `FAIL`: stop and fix before proceeding

Do not create a PR inside this procedure. PR creation is a separate gate.
