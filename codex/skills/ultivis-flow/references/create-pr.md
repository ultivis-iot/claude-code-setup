# Create PR

Use this procedure when the user wants the Codex equivalent of `/create-pr`.

## Preconditions

- `tmp/validation-status.json` exists
- Intent validation passed
- Quality validation contains only `PASS` or `WARN`
- The summary indicates the branch is ready for PR

## Procedure

1. Confirm validation status before pushing.
2. Check the current branch, remote, and target branch.
3. Push the branch.
4. Create the PR with a concise title and body.

For Story-based work, do not assume every PR targets `dev`:

- Task PRs target the Story branch.
- Story PRs target `dev`.
- If the current branch is a Task branch under an active Story, confirm or infer the Story branch from the task context before creating the PR.
- After creating a Task PR, store the PR URL on the Notion Task when available.
- After creating a Story PR, store the PR URL on the Notion Story `PR URL`.

## PR body structure

- `Summary`: what changed
- `Changes`: key files or behaviors
- `Test Plan`: how it was verified
- `Validation`: intent/docs/security/code quality/test status

If validation is incomplete, stop and tell the user to rerun the commit-and-verify flow first.
