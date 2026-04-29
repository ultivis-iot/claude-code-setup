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
