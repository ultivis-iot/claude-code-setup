# Scenario-First Workflow

## 1. Draft the job story

Start from work, not navigation. Establish:

- **Audience**: role, experience level, and permissions.
- **Trigger**: the real event that makes the user start.
- **Outcome**: the observable state that means the job is complete.
- **Success criteria**: facts the user can verify, not “the page opened.”
- **Prerequisites**: access, configuration, and domain knowledge.
- **Data setup**: realistic records and states needed before step one.
- **Critical path**: the shortest complete path from trigger to outcome.
- **Recovery path**: at least one likely validation, empty, permission, or retry case.
- **Exclusions**: nearby work intentionally left out.

Copy [../assets/user-scenario.template.json](../assets/user-scenario.template.json) into the review output directory and replace every placeholder. Keep credentials, tokens, and personal data out of the file.

## 2. Write teachable steps

Every step contains:

- `stage`: `orientation`, `action`, `verification`, `handoff`, or `recovery`;
- `goal`: why the user performs the step;
- `startingState`: what must already be visible or true;
- `action`: what the user does, in product language;
- `expected`: the observable UI or data response;
- `caption`: the concise on-screen instruction;
- optional `narration`: a fuller future voice-over script;
- `evidenceSlug`: stable filename-safe identifier.

The first step is orientation. The last critical-path step verifies the outcome or hands work to the next role. Describe fields and decisions that matter; omit decorative pointer movement.

## 3. Approve the review contract

The user must approve the scenario before Playwright actions are written or executed. Approval freezes audience, job outcome, mutation policy, steps, recovery paths, and exclusions under one SHA-256.

```bash
node ~/.codex/skills/ux-review/scripts/approve-scenario.mjs \
  <scenario.json> \
  --by "<approver>"
```

Wording changes also change the hash. Reapproval is cheap and preferable to presenting evidence from an unreviewed path.

## 4. Produce evidence for UI/UX evaluation

Record the scenario in `review` phase. The bundle includes WebM, SRT, caption-free screenshots, execution JSON, automated observations, and the scenario copy. Review footage may pause on defects and recovery states.

The scenario tells the LLM what job the user is attempting. It is not the review target. Evaluate the observed interface using [ux-evaluation.md](ux-evaluation.md) and create `<scenario-id>-ux-review.md`.

If the capture cannot exercise a step because of missing permissions, data, or harness behavior, record an evidence gap. Do not turn that gap into a product UX finding without interface evidence.

The user reviews the LLM evaluation and decides which product findings to fix, defer, reject, or investigate. Re-run the same scenario after product changes as `review-02`, `review-03`, and so on. Keep the hash unchanged for before/after comparison. Change and reapprove the scenario only when the underlying job or training scope changes.

## 5. Approve guide readiness

Approval is explicit. After the user says the scenario is approved, run:

```bash
node ~/.codex/skills/ux-review/scripts/approve-guide.mjs \
  <scenario.json> \
  --by "<approver>" \
  --ux-review "<scenario-ux-review.md>" \
  --readiness "ready|ready-with-deferred-findings"
```

The guide approval stores the canonical scenario SHA-256, scenario approval, latest UX review path, and user readiness decision. Editing any scenario field invalidates both approvals. Re-run UI/UX evaluation after meaningful product changes before producing a guide.

## 6. Record the user guide

Record `guide` phase only when the approval hash matches. Use clean deterministic data, hide debugging overlays, and follow the approved critical path exactly. Captions explain user intent and decisions. Use `narration` as the voice-over source when audio production is requested.

The guide bundle contains:

- `<id>-guide.webm` for VS Code review and delivery;
- matching SRT;
- chapter JSON derived from step timestamps;
- caption-free screenshots;
- execution and observation JSON;
- the exact scenario and approval files used.

If product behavior changes, treat the guide as stale when its scenario hash or expected UI no longer matches.
