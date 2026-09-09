# Commit And Verify

For the Codex equivalent of commit-and-verify, read the installed workflow's
`docs/references/validation-contract.md` before acting and follow it.
The workflow root is `${CODEX_HOME:-$HOME/.codex}`, or this setup repository when working from its checkout.

The shared contract owns inputs, review roles, snapshot/record/ready commands,
required evidence, failure handling, and completion criteria. Use its executable
`scripts/validation-gate.mjs`; do not reconstruct the result schema or readiness rules.
Do not create a PR as part of validation.
