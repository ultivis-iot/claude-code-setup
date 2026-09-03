---
name: ux-review
description: Design role-based scenarios, preserve successful or failed Playwright WebM journey evidence, evaluate product-native usability and accessibility, and produce either reviewed or directly requested guide recordings. Use for evidence-backed UX audits and training guides, not generic code review or one-off screenshots.
---

# UX Review

Treat the scenario as source code. Choose the route from the user's request:

- UX audit or reviewed guide: `scenario approval → review evidence → UX decision → guide approval → guide capture`
- Explicit guide/training/demo video request: `validated scenario → record direct request → guide capture`

An explicit user request for a guide video authorizes the direct route; do not force a UX review first. It does not claim that UX readiness was reviewed. Infer ordinary scenario details from the request and product, asking only when a material scope choice or unsafe mutation cannot be resolved. Never reuse a review recording as a guide. When `ultivis-flow` is available, it remains the lifecycle baseline.

## Contract

Every command below uses `$UX` for the skill directory, so the same instructions work wherever the skill is installed. Define it once per session:

```bash
UX=$(ls -d ~/.claude/skills/ux-review ~/.codex/skills/ux-review 2>/dev/null | head -1)
```

Write artifacts through the repository path as always:

```text
<repository-root>/tmp/ux-review/<YYYY-MM-DD>/<NN>.<scenario-id>/
├── consistency-baseline.md
├── origin.json                           # repository, branch, issue and Notion links
├── plan-snapshot.md                      # local plan copy (not published to the issue)
├── <id>-scenario.json
├── <id>-scenario-approval.json           # reviewed route
├── <id>-direct-guide-request.json        # direct route
├── review-01/
└── guide-01/
```

`tmp/ux-review` is a symlink into the central store, so the bytes survive `git worktree remove`:

```text
~/.local/share/ux-review/<parent-repository>/<worktree>/<YYYY-MM-DD>/<NN>.<scenario-id>/
```

[scripts/allocate-output.mjs](scripts/allocate-output.mjs) creates that symlink when it is missing, then captures `origin.json` and `plan-snapshot.md`. Override the location with `UX_REVIEW_STORE`. Repositories that still hold real directories are migrated by [scripts/migrate-store.mjs](scripts/migrate-store.mjs) (`--dry-run` first, then `--apply`).

All manifest paths keep `pathBase: "repository-root"`; reject absolute paths and repository escapes. Use [scripts/allocate-output.mjs](scripts/allocate-output.mjs) to allocate scenario and pass directories atomically instead of choosing or reusing numbers manually.

Scenario schema version 2 contains exactly one critical journey, at least one executable recovery journey, a fixed viewport and locale, a source-revision environment variable, and an explicit mutation policy. A different viewport or locale requires a separately approved scenario. Store credentials only in environment variables or ignored Playwright state.

Before evaluating a changed interface, build `consistency-baseline.md` from two to four analogous product surfaces using [assets/consistency-baseline.template.md](assets/consistency-baseline.template.md). Record an evidence gap when no valid comparison exists; never copy an existing accessibility or safety defect for consistency.

## 1. Define the scenario

Read [references/scenario-workflow.md](references/scenario-workflow.md). Copy [assets/user-scenario.template.json](assets/user-scenario.template.json), replace every placeholder, and validate it:

```bash
node "$UX/scripts/validate-scenario.mjs" <scenario.json>
```

For a UX review, show the complete scenario before Playwright actions. Role, outcome, environment, mutation policy, journey, and scope changes require reapproval. After explicit confirmation:

```bash
node "$UX/scripts/approve-scenario.mjs" <scenario.json> --by "<approver>"
```

For an explicit guide-video request, validate the scenario and record the request without adding a separate review gate:

```bash
node "$UX/scripts/record-guide-request.mjs" \
  <scenario.json> \
  --requested-by "<requester>" \
  --request "<the user's guide-video request>"
```

## 2. Capture review evidence

Allocate `review-NN`, then import [assets/playwright-journey-recorder.mjs](assets/playwright-journey-recorder.mjs) with `phase: 'review'`. Record the critical journey and every recovery journey separately under the same pass. The recorder enforces the approved scenario, repository path, source revision, viewport, locale, base URL, non-overwrite behavior, runtime evidence arrays, and mutation ledger.

Review captures perform the action first, then save a caption-free result screenshot and show the caption. Harness limitations become evidence gaps, not product findings.

Always preserve review evidence. Finalize a fully executed journey with `status: 'completed'`; if the product fails, use `status: 'failed'`; if environment, permission, data, or harness limitations stop it, use `status: 'blocked'` with a category and message. Failed and blocked review bundles keep the partial SRT, completed-step observations, terminal evidence, mutation ledger, and WebM. They may have explicit recovery-coverage gaps and cannot authorize a reviewed guide.

## 3. Evaluate and record the user's decision

Read [references/ux-evaluation.md](references/ux-evaluation.md). Evaluate the approved scenario against the WebM, SRT, screenshots, observations, runtime errors, mutation ledger, and product baseline. Write `<id>-ux-review.md` in the review pass and cite every finding to its journey, step, timestamp, route, and screenshot.

Copy [assets/review-decision.template.json](assets/review-decision.template.json) and present all finding dispositions and hard-gate statuses to the user. Only after explicit confirmation run:

```bash
node "$UX/scripts/approve-review-decision.mjs" \
  <decision-draft.json> \
  --scenario <scenario.json> \
  --review-directory <review-NN> \
  --ux-review <id-ux-review.md> \
  --baseline <consistency-baseline.md> \
  --by "<approver>"
```

The script rejects unresolved hard gates, evidence-needed findings, deferred P0/P1 findings, and a readiness value inconsistent with deferred findings. It binds the baseline, review bundle, UX review, source revision, and environment fingerprint by hash.

## 4. Capture a reviewed or directly requested guide

For the reviewed route, create guide approval from the approved review decision:

```bash
node "$UX/scripts/approve-guide.mjs" \
  <scenario.json> \
  --by "<approver>" \
  --review-decision <id-review-decision.json>
```

For the direct route, pass `directGuideRequest` instead of `scenarioApproval` and `guideApproval`. For either route, allocate `guide-NN` and record only the critical journey with `phase: 'guide'`. A guide is finalized only when every critical step completes; failed attempts are not delivered as guide artifacts.

The action callback receives `(expectedStep, ui)`. Use `ui.fill(locator, value)`, `ui.click(locator)`, `ui.selectOption(locator, value)`, `ui.check(locator)`, and `ui.uncheck(locator)` for every visible guide interaction. These helpers scroll the target into view, show a high-contrast amber pulse before the action, type character by character, slow the click, hold the result, and remove the highlight before the clean screenshot. Use direct Locator actions only for invisible setup outside the recorded journey. Guide capture shows the instructional caption before the action and keeps it visible through the interaction. Keep captions visible for 4–8 seconds and reposition only the affected step when the lower third covers its control or result.

## 5. Validate and deliver

Read [references/artifact-contract.md](references/artifact-contract.md), then run:

```bash
node "$UX/scripts/validate-artifacts.mjs" <review-NN> --phase review
node "$UX/scripts/validate-artifacts.mjs" <guide-NN> --phase guide
```

The validator checks semantic step/caption/evidence correspondence, recovery coverage, SRT and chapter timing, PNG/WebM validity, media metadata, environment/source consistency, mutation policy, and approval hashes. Inspect each final WebM at normal speed and verify first/middle/last frames and caption placement.

Start the viewer and return links that open in a browser instead of filesystem paths:

```bash
node "$UX/scripts/viewer.mjs" --ensure --host 0.0.0.0
```

`--ensure` reuses a running viewer and starts one only when none answers. It prints every reachable address (localhost, hostname `.local`, LAN interfaces, Tailscale when present); pick the one the reader can open. Deep-link the reviewed pass:

```text
http://<host>:7830/#/<parent-repository>/<worktree>/<YYYY-MM-DD>/<NN>.<scenario-id>/<review-NN>/video
```

Also state the P-level counts. P0 blocks or makes work unsafe/inaccessible, P1 causes major primary-path friction, and P2 covers measurable consistency or polish issues.
