# Create PR

Read the installed workflow's `docs/references/create-pr-contract.md` before acting
and follow it. The workflow root is `${CODEX_HOME:-$HOME/.codex}`, or this setup repository.

Use `scripts/validation-gate.mjs ready` with the actual target base before pushing.
Always pass the selected target to `gh pr create --base`, including an automatically selected target.
Task PRs target the selected repository base; Story PRs are not created.
