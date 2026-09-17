# Review Cycle

Use this procedure when the user wants the Codex equivalent of `/review-cycle`.

## Goal

Inspect the latest AI PR feedback and process follow-up rounds in the current Codex session. Ralph Loop is a Claude-specific integration and is not a Codex dependency. Use the product's monitoring/wait capability when waiting for external reviews or checks; do not pretend that a Claude hook schedules Codex turns.

## Classification

- Actual bug
- Valid improvement
- Design improvement outside current PR scope
- Repeated feedback
- False positive

## Required behavior

1. Process one round when `--once` is requested. Otherwise continue within the current session, up to 15 rounds by default, recording round number and PR head SHA in the local handoff. Reaching the limit is an incomplete result, never a completion signal.
2. Read PR checks and the latest comments, reviews, and unresolved review threads. Tie review/check evidence to the current PR head SHA. Independent read-only queries may run concurrently; writes remain ordered.
3. Keep only AI review items: read comments first, then reviews, then unresolved threads; accept an item only when it comes from a bot account or carries an unmistakable AI review header or pattern; skip threads that are already resolved.
4. Record what will be addressed before editing code.
5. Apply fixes only for actionable items inside scope.
6. Run the project's relevant verification commands.
7. Commit and push the follow-up changes.
8. Record the last processed review ID in `tmp/last-review-id-{PR}.txt`.
9. End the round without printing `<promise>REVIEW COMPLETE</promise>` if code changes, comments, commits, or pushes were made.
10. Report completion only when there are no new actionable findings and required checks for the current head have completed successfully. An absent, pending, inaccessible or stale check is not a successful check. If review completion cannot be established, report what is still pending.

## Story-based PRs

- For Task PRs, the base branch is `dev` or the repository default branch. Rerun review-cycle until AI review and CI are clear, then merge into the target base branch.
- Do not create Story PRs. After all Task PRs are merged, run Story-level integration validation.
- If Task PR feedback is Story-wide or belongs to another Task, do not expand the Task PR. Record it in `tmp/story-handoff.md` and the Notion Story.
- After each Task PR merge, update the Story handoff before starting dependent Tasks.
- When merge or pull updates the local target/main worktree, refresh its Graft graph. The managed `post-merge` hook normally performs this automatically; a remote-only merge is refreshed when the local worktree is next updated.

## Boundaries

- Do not expand the PR scope for broad refactors unless the user asks.
- Do not respond repeatedly to the same invalid comment; summarize the rationale and move on.
- If build or push fails and cannot be resolved safely, stop and report the blocker clearly.
