# Merge Readiness

Read the installed workflow's `docs/references/merge-readiness.md` before merging a PR
and follow it. The workflow root is `${CODEX_HOME:-$HOME/.codex}`, also for this setup repository (its checkout's copies are review subject).

Use `"${CODEX_HOME:-$HOME/.codex}/scripts/merge-brief.mjs" tier --pr <N> --repo <o/r>` for the minimum number of understanding questions.
Merge only on the user's explicit request, after the brief and questions are recorded as a PR comment for the current head.
