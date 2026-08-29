---
name: ux-review
description: Design and approve real user scenarios, iteratively capture them with Playwright as captioned WebM evidence, have an LLM evaluate the observed UI/UX against established usability and accessibility criteria, and record approved user-guide or training videos. Use for UX audits, role-based journey design, evidence-backed interface evaluations, improvement loops, WebM screen recordings, Korean captions or SRT, documentation screenshots, and UI training deliverables.
---

# UX Review

Treat the **scenario as source code** and the UI as the review target. Enforce this state machine:

`draft scenario → user scenario approval → review capture → LLM UX evaluation → user fix/defer/reject decision → improvement and recapture loop → user guide-readiness approval → guide capture`

Never skip scenario approval, let the LLM approve on the user's behalf, or turn the first review recording into a guide.

When `ultivis-flow` is available, it remains the lifecycle baseline. This skill owns scenario design, review capture, approval, guide capture, artifact validation, and UX findings.

## 1. Establish the contract

Inspect routes, menus, domain vocabulary, permissions, existing Playwright config, fixtures, authentication helpers, prior reports, and recording scripts. Read `CONTEXT.md` and relevant ADRs when present.

Make these explicit:

- product, environment, and output directory;
- audience role, experience, and permissions;
- real job trigger, outcome, and success criteria;
- viewport and locale;
- data setup and mutation policy;
- review scope and exclusions.

Default output to `tmp/ux-journry/<YYYY-MM-DD>/<NN>.<scenario-id>/`, where `NN` is a date-local two-digit scenario sequence. Start at `01`; before creating a new scenario directory, inspect sibling directories for that date and increment the greatest valid two-digit prefix by one (`01`, `02`, `03`, ...). Do not reuse a sequence even when an earlier scenario is abandoned. Keep all review and guide passes for the same approved scenario under that one numbered directory. Store credentials only in environment variables or ignored Playwright storage state.

Example:

```text
tmp/ux-journry/2026-08-30/
├── 01.field-worker-record-production/
│   ├── review-01/
│   ├── review-02/
│   └── guide-01/
└── 02.manager-order-to-production/
    ├── review-01/
    └── guide-01/
```

Completion criterion: audience, job outcome, environment, write policy, and scope are explicit.

## 2. Draft and approve the scenario first

Read [references/scenario-workflow.md](references/scenario-workflow.md), copy [assets/user-scenario.template.json](assets/user-scenario.template.json), and replace every placeholder. Build a critical path with:

1. orientation;
2. finding the relevant work;
3. creation or primary action with meaningful fields and decisions;
4. list-to-detail context;
5. state verification or handoff;
6. at least one realistic recovery path.

Every step states the goal, starting state, action, expected response, caption, and evidence slug. Avoid decorative clicks and route tours.

Validate before writing Playwright actions:

```bash
node ~/.codex/skills/ux-review/scripts/validate-scenario.mjs <scenario.json>
```

Show the complete scenario to the user before writing or running Playwright actions. Non-blocking wording edits may proceed, but role, job outcome, data mutation, and path changes require user direction. After explicit user confirmation, create the review approval:

```bash
node ~/.codex/skills/ux-review/scripts/approve-scenario.mjs \
  <scenario.json> \
  --by "<approver>"
```

Any scenario edit changes its SHA-256 and invalidates this approval. Reapprove before further review capture.

Completion criterion: scenario validation passes and `<scenario-id>-scenario-approval.json` matches its exact hash.

## 3. Record the review bundle

Use Playwright native `recordVideo`; WebM is the primary artifact. Import and adapt [assets/playwright-journey-recorder.mjs](assets/playwright-journey-recorder.mjs) with `phase: 'review'` and the matching `scenarioApproval`. The recorder must refuse an unapproved or changed scenario.

For each journey:

- fix viewport and locale;
- verify reusable authentication state;
- collect console, page, request, and GraphQL errors without secrets;
- apply `disposable-write`, `preview-only`, or `read-only` policy;
- execute scenario steps in their declared order;
- capture a clean screenshot before displaying the caption;
- display the scenario caption and write the same text to SRT;
- save observations and execution metadata beside the WebM.

Capture mobile separately when the product has a role-specific mobile workflow. Probe meaningful responsive breakpoints rather than every width.

Store each pass in `review-01`, `review-02`, and so on. Keep the scenario hash fixed across passes so evidence remains comparable.

Completion criterion: one unattended command reproduces a complete approved-scenario review bundle without exceeding the declared mutation policy.

## 4. Evaluate the UI/UX with the LLM

Read [references/ux-evaluation.md](references/ux-evaluation.md). Give the LLM the scenario JSON as evaluation context and the review WebM, SRT, screenshots, observations, and runtime errors as evidence. Use ISO 9241-11 outcomes, ISO 9241-210 human-centred context, WCAG 2.2 AA, WAI-ARIA APG, and Nielsen's heuristics as complementary lenses. Evaluate the interface for:

- task completion and efficiency;
- information hierarchy, findability, and navigation context;
- clarity of controls, terminology, state, and feedback;
- consistency, error prevention, and recovery;
- accessibility, responsiveness, density, and readability;
- user confidence, cognitive load, and avoidable friction.

Write `<scenario-id>-ux-review.md`. Every finding cites the scenario step, video timestamp, route, screenshot, observed behavior, user impact, recommendation, and confidence. Treat scenario or harness limitations as evidence gaps, not UI/UX findings. Do not grade the scenario unless the user separately asks for scenario feedback.

## 5. Improve and repeat

Present the UI/UX evaluation to the user. The user decides which findings to fix, defer, reject, or mark as needing evidence. After product changes, execute the same approved scenario and create the next numbered review bundle. Compare each finding against its earlier timestamp and screenshot. Do not close a finding from code inspection alone when the claim concerns observed interaction.

Continue until there are no unresolved hard gates and the user accepts any deferred findings. Change the scenario only when the actual job or training scope changes; then return to step 2 and obtain a new scenario approval.

Completion criterion: the latest evaluation records the disposition of every earlier P0/P1 and identifies any accepted deferrals.

## 6. Let the user decide guide readiness

When the user explicitly confirms the scenario and UI are ready for a guide, create the approval manifest:

```bash
node ~/.codex/skills/ux-review/scripts/approve-guide.mjs \
  <scenario.json> \
  --by "<approver>" \
  --ux-review "<scenario-ux-review.md>" \
  --readiness "ready|ready-with-deferred-findings"
```

The LLM never approves on the user's behalf.

Completion criterion: the guide approval contains the exact scenario SHA-256, its scenario approval, the latest reviewed UI/UX evaluation, and the user's readiness decision.

## 7. Record the approved user guide

Use the same recorder with `phase: 'guide'`, `scenarioApproval`, and `guideApproval`. The recorder must refuse a missing or mismatched approval hash.

Use clean deterministic data and the approved critical path. Remove review-only pauses and debugging UI. Keep captions instructional and use each step's optional `narration` as the future voice-over source. Produce guide WebM, SRT, chapters, caption-free screenshots, observations, execution metadata, scenario, and both approval files. Treat the screenshots as reusable documentation sources; preserve stable step and evidence slugs so `ultivis-docs` can map a guide section to the exact frame.

Store guide passes in `guide-01`, `guide-02`, and so on inside the numbered scenario directory. The validated guide directory is also the delivery location; do not duplicate final videos into a separate `tmp/guides` tree.

Do not silently repair the scenario while filming. Stop and return to review when the product no longer matches an expected result.

Completion criterion: the guide follows every approved step in order and its execution hash equals the approval hash.

## 8. Validate and deliver

Run:

```bash
node ~/.codex/skills/ux-review/scripts/validate-artifacts.mjs <output-directory> --phase review
node ~/.codex/skills/ux-review/scripts/validate-artifacts.mjs <output-directory> --phase guide
```

Open each final WebM by absolute path and inspect duration, dimensions, and first/middle/last frames. Verify caption readability and that captions do not cover active controls. Return clickable absolute WebM links for VS Code. If preview reports missing `libx264`, `preset`, or MP4 support, repair the local preview ffmpeg; keep the source artifact as WebM.

In the final response, link the role-specific WebM files from their numbered scenario directories and identify each role clearly. Do not expose a broader shared working root when a direct guide file link is available.

For UX findings, use P0 for blocked/unsafe work, P1 for major workflow friction or inaccessible primary actions, and P2 for consistency and polish. Cite journey, step or timestamp, route, screenshot, impact, and smallest coherent improvement.

Completion criterion: validators pass, the WebM files are watchable in VS Code, and the user can trace the guide back to the approved scenario.
