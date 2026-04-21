# Review Cycle

Use this procedure when the user wants the Codex equivalent of `/review-cycle`.

## Goal

Inspect the latest AI PR feedback, classify each finding, make the required changes, and continue until there are no new actionable findings.

## Classification

- Actual bug
- Valid improvement
- Design improvement outside current PR scope
- Repeated feedback
- False positive

## Required behavior

1. Read the latest PR comments, reviews, and unresolved review threads.
2. Ignore human comments when the task is specifically about AI review follow-up.
3. Record what will be addressed before editing code.
4. Apply fixes only for actionable items inside scope.
5. Run the project's relevant verification commands.
6. Commit and push the follow-up changes.
7. Continue checking for new feedback until the review stream is exhausted or the user stops the loop.

## Boundaries

- Do not expand the PR scope for broad refactors unless the user asks.
- Do not respond repeatedly to the same invalid comment; summarize the rationale and move on.
- If build or push fails and cannot be resolved safely, stop and report the blocker clearly.
