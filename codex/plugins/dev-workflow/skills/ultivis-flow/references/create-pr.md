# Create PR

Use this procedure when the user wants the Codex equivalent of `/create-pr`.

## Preconditions

- `tmp/validation-status.json` exists
- `overall` is `PASS` or `WARN`
- `results.intent-validator` is `PASS`
- No validator reports `FAIL`

## Procedure

1. Confirm validation status before pushing.
2. Check the current branch, remote, and target branch.
3. Push the branch.
4. Create the PR with a concise title and body.

Target branch rules:

- Prefer `dev` when `origin/dev` exists; otherwise use the repository default branch.
- Do not infer a PR target from local handoff, stale branch config, old PRs, or old work branches.
- If the target is the current branch or a non-default work branch, stop and ask for explicit confirmation.

For Story-based work, GitHub PRs still belong to Tasks:

- Task PRs target `dev` or the repository default branch.
- Do not create Story PRs.
- After creating a Task PR, store the PR URL on the Notion Task when available.

## PR body structure

- `Summary`: what changed
- `Changes`: key files or behaviors
- `Test Plan`: how it was verified
- `Validation`: intent/docs/security/code quality/test status

If validation is incomplete, stop and tell the user to rerun the commit-and-verify flow first.

When `git push` or PR creation fails, summarize the cause in one line and stop. Do not retry with different arguments.
