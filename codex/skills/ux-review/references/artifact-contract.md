# UX Review Artifact Contract

## Repository tree

Every path stored in a manifest is relative to the Git repository root containing `.git`. Never resolve a manifest path from a `review-*` or `guide-*` directory.

```text
<repository-root>/tmp/ux-review/<YYYY-MM-DD>/<NN>.<scenario-id>/
├── consistency-baseline.md
├── <id>-scenario.json
├── <id>-scenario-approval.json
├── <id>-direct-guide-request.json
├── <id>-review-decision.json
├── <id>-guide-approval.json
├── review-01/
│   ├── <id>-scenario.json
│   ├── <id>-scenario-approval.json
│   ├── <id>-review.webm
│   ├── <id>-review.srt
│   ├── <id>-review-execution.json
│   ├── <id>-review-observations.json
│   ├── <id>-review-mutation-ledger.json
│   ├── <id>-review-terminal.json          # failed or blocked only
│   ├── <id>-review-terminal-NN-<slug>.png # best-effort terminal state
│   ├── <id>-review-01-<slug>.png
│   ├── <id>-review-<recovery>.webm
│   ├── <id>-review-<recovery>.srt
│   ├── <id>-review-<recovery>-execution.json
│   ├── <id>-review-<recovery>-observations.json
│   ├── <id>-review-<recovery>-mutation-ledger.json
│   ├── <id>-review-<recovery>-01-<slug>.png
│   └── <id>-ux-review.md
└── guide-01/
    ├── <id>-scenario.json
    ├── <id>-scenario-approval.json
    ├── <id>-guide-approval.json
    ├── <id>-direct-guide-request.json     # direct route instead of guide approval
    ├── <id>-guide.webm
    ├── <id>-guide.srt
    ├── <id>-guide-chapters.json
    ├── <id>-guide-execution.json
    ├── <id>-guide-observations.json
    ├── <id>-guide-mutation-ledger.json
    └── <id>-guide-01-<slug>.png
```

A completed review pass contains the critical journey and every recovery journey. A failed or blocked review preserves every journey reached and declares missing recovery coverage. A guide pass contains only a completed critical journey. The allocator creates numbered directories atomically; the recorder refuses to overwrite an existing journey prefix.

## Approval chain

- Scenario approval schema version 2 binds the scenario hash and repository-relative scenario file.
- Review decision binds the scenario approval, consistency baseline hash, complete review-directory hash, UX-review hash, source revision, environment fingerprint, finding dispositions, hard gates, and user readiness decision.
- Guide approval binds the exact approved review decision and repeats its evidence hashes and environment identity.
- Guide execution must use the same scenario hash, source revision, and environment fingerprint.
- A direct-guide request binds the scenario and requester text, explicitly claims no UX-review readiness, and replaces the reviewed approval chain for that guide only.

Editing any bound file invalidates downstream approval. Do not repair an approval JSON manually; recreate it after explicit user confirmation.

## Execution and observations

Each journey writes one execution JSON containing:

- scenario and journey identity;
- phase and ordered step/evidence slugs;
- source revision and environment fingerprint;
- approved environment and mutation mode;
- start, completion, and duration.
- `completed`, `failed`, or `blocked` status and its authorization mode.

A failed or blocked review additionally writes terminal JSON for the next attempted step. It records a sanitized category and message, best-effort runtime evidence, and a terminal screenshot or an explicit capture error. Completed observations and SRT cues remain a strict ordered prefix of the approved journey. Mutation-policy violations remain visible evidence instead of causing the failed WebM to be discarded.

Each observation repeats the complete approved step and records URL, locale, viewport, overflow, unnamed-control count, cue timing, and arrays for console, page, request, response, and GraphQL errors. Authorization headers, request bodies, credentials, tokens, query secrets, and personal data must not be stored.

## Mutation ledger

Every journey supplies:

```json
{
  "mutations": [
    {
      "description": "검증용 요청 생성",
      "allowed": true,
      "cleanedUp": true
    }
  ],
  "cleanupCompleted": true
}
```

`read-only` and `preview-only` journeys must report no mutations. Every `disposable-write` mutation must be explicitly allowed and cleanup must complete. The ledger is operational evidence, not permission to broaden the user's requested scope.

## Media and captions

- Review captions describe the result after the action; guide captions instruct before the action.
- SRT text must equal the approved step caption and cues must be ordered and positive in duration. A review cue starts when its post-action caption is actually shown, after the clean result screenshot.
- Screenshots are caption-free PNGs named from their exact journey step and evidence slug.
- WebM is the source artifact. Validation requires a valid container, positive duration and dimensions, and readable first/middle/last frames.
- Guide chapters start at the matching SRT cue.

## Storage and publication

Use ignored repository `tmp/` storage because artifacts can contain development data. Publish or commit them only after an explicit request and data review. Keep every pass in its original scenario directory; do not create a second delivery-only copy.
