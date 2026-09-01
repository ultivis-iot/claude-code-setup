# Scenario-First Workflow

## Scenario schema version 2

Start from the user's job rather than navigation. Define audience, trigger, observable outcome, success criteria, prerequisites, realistic data, exclusions, one critical journey, and at least one recovery journey.

The environment fixes one locale and viewport and names environment variables for the base URL and reviewed source revision. Use a separate approved scenario ID for another mobile/desktop viewport or locale so evidence never silently departs from its approval.

The mutation policy is one of:

- `read-only`: no application mutation;
- `preview-only`: local or preview interaction without persisted application mutation;
- `disposable-write`: only the listed writes, followed by the listed cleanup.

`prerequisites`, `dataSetup`, permissions, and exclusions may be empty arrays when none apply. Success criteria must contain at least one observable outcome.

## Executable journeys

The scenario has exactly one `critical` journey and one or more `recovery` journeys. Every journey has its own ordered steps starting at 1. Every step includes stage, goal, starting state, action, expected response, caption, optional narration, and stable evidence slug.

The critical journey starts with orientation, contains an action, and ends with verification or handoff. A recovery journey names its trigger, contains a recovery stage, and ends with verification that work can safely continue. Recovery is executable evidence, not a prose note attached to a critical step.

## Directory allocation

Allocate a new scenario directory from any path inside the reviewed repository:

```bash
node ~/.codex/skills/ux-review/scripts/allocate-output.mjs \
  scenario <path-inside-repository> <scenario-id>
```

Allocate passes without reusing or overwriting numbers:

```bash
node ~/.codex/skills/ux-review/scripts/allocate-output.mjs pass <scenario-directory> review
node ~/.codex/skills/ux-review/scripts/allocate-output.mjs pass <scenario-directory> guide
```

The allocator uses atomic directory creation so concurrent runs cannot claim the same number.

## Scenario approval

Validate, show the complete scenario to the user, and obtain explicit confirmation before writing or running Playwright actions:

```bash
node ~/.codex/skills/ux-review/scripts/validate-scenario.mjs <scenario.json>
node ~/.codex/skills/ux-review/scripts/approve-scenario.mjs <scenario.json> --by "<approver>"
```

The approval binds the exact canonical scenario and its repository-relative path. Any scenario edit requires reapproval.

## Direct guide request

When the user explicitly asks for a guide, training, or demonstration video, the request itself authorizes production without a preceding UX review or readiness decision. Validate a best-fit scenario, stay within the requested scope and mutation policy, and record the request:

```bash
node ~/.codex/skills/ux-review/scripts/record-guide-request.mjs \
  <scenario.json> \
  --requested-by "<requester>" \
  --request "<request summary>"
```

The resulting manifest binds the exact scenario and states `claimsUxReviewReadiness: false`. Do not describe a directly requested guide as UX-approved. Ask before recording only if the request leaves a material product path ambiguous or would require a mutation beyond its reasonable scope.

## Review, evaluation, and decision

Record every declared journey in the same review pass when execution permits. Finalize journeys as `completed`, `failed`, or `blocked`; preserve a failed product path and a harness/environment block as review evidence rather than discarding the WebM. A non-completed critical journey may leave explicit recovery coverage gaps. After capture, write `<id>-ux-review.md`. Harness, permission, environment, or data limitations are evidence gaps rather than UI findings.

When a step cannot continue, finalize from the harness catch path instead of abandoning the context:

```js
await recorder.finish({
  status: 'failed', // use 'blocked' for environment, permission, data, or harness limits
  failure: { category: 'product', message: error.message },
});
```

Present findings and all hard gates to the user. After their explicit decision, approve a completed copy of `review-decision.template.json`:

```bash
node ~/.codex/skills/ux-review/scripts/approve-review-decision.mjs \
  <decision-draft.json> \
  --scenario <scenario.json> \
  --review-directory <review-NN> \
  --ux-review <id-ux-review.md> \
  --baseline <consistency-baseline.md> \
  --by "<approver>"
```

Allowed finding dispositions are `fixed`, `deferred`, `rejected`, and `evidence-needed`. Evidence-needed findings block a guide. P0/P1 findings cannot be deferred. `ready` permits no deferred findings; `ready-with-deferred-findings` permits user-approved P2 deferrals. Every hard gate must be `resolved` or `not-applicable`, and both statuses require concrete evidence or rationale so `not-applicable` cannot bypass review.

The resulting decision hashes the baseline, complete review bundle, and UX review and records their source revision and environment fingerprint.

## Guide approval and capture

Generate guide approval only from the approved decision:

```bash
node ~/.codex/skills/ux-review/scripts/approve-guide.mjs \
  <scenario.json> \
  --by "<approver>" \
  --review-decision <id-review-decision.json>
```

Record only the critical journey. If the source revision, base URL, locale, viewport, scenario, baseline, UX review, review bundle, or decision changes, return to review rather than repairing the guide approval.

For a direct guide request, pass its manifest to the recorder instead of the reviewed approval pair. Direct guides still require the exact scenario, repository boundary, environment, and mutation policy, but do not require baseline, review evidence, findings, or readiness approval. Both guide routes finalize only after the critical journey completes.
