# Review Cycle

Use this procedure when the user wants the Codex equivalent of `/review-cycle`.

## Goal

Inspect the latest AI PR feedback, classify each finding, and keep processing follow-up rounds through Ralph Loop until there are no new actionable findings. A direct `/review-cycle` invocation should bootstrap Ralph Loop automatically; only `/review-cycle ... --once` performs one concrete round.

## Classification

- Actual bug
- Valid improvement
- Design improvement outside current PR scope
- Repeated feedback
- False positive

## Required behavior

1. If invoked without `--once`, start Ralph Loop with `/review-cycle ... --once` as the repeated prompt and do not process reviews in the bootstrap call. The loop runs at most 15 iterations unless `REVIEW_CYCLE_MAX_ITERATIONS` says otherwise.
2. In a `--once` round, read PR checks and the latest comments, reviews, and unresolved review threads. Run `gh` commands one at a time, never concurrently.
3. Keep only AI review items: read comments first, then reviews, then unresolved threads; accept an item only when it comes from a bot account or carries an unmistakable AI review header or pattern; skip threads that are already resolved.
4. Record what will be addressed before editing code.
5. Apply fixes only for actionable items inside scope.
6. Run the project's relevant verification commands.
7. Commit and push the follow-up changes.
8. Record the last processed review ID in `tmp/last-review-id-{PR}.txt`.
9. End the round without printing `<promise>REVIEW COMPLETE</promise>` if code changes, comments, commits, or pushes were made.
10. Print `<promise>REVIEW COMPLETE</promise>` only when there are no new actionable findings and checks are clear.

## Story-based PRs

- For Task PRs, the base branch is `dev` or the repository default branch. Rerun review-cycle until AI review and CI are clear, then merge into the target base branch.
- Do not create Story PRs. After all Task PRs are merged, run Story-level integration validation.
- If Task PR feedback is Story-wide or belongs to another Task, do not expand the Task PR. Record it in `tmp/story-handoff.md` and the Notion Story.
- After each Task PR merge, update the Story handoff before starting dependent Tasks.

## Boundaries

- Do not expand the PR scope for broad refactors unless the user asks.
- Do not respond repeatedly to the same invalid comment; summarize the rationale and move on.
- If build or push fails and cannot be resolved safely, stop and report the blocker clearly.
