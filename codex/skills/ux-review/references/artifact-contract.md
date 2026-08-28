# UX Review Artifact Contract

## Review bundle

```text
tmp/ux-journeys/<date>-<scenario-id>/review-01/
├── <id>-scenario.json
├── <id>-scenario-approval.json
├── <id>-review.webm
├── <id>-review.srt
├── <id>-review-execution.json
├── <id>-review-observations.json
├── <id>-review-01-<step>.png
└── <id>-ux-review.md
```

The scenario and matching user approval exist before Playwright code. Later passes use sibling directories such as `review-02` and retain the same scenario hash. The review bundle provides evidence for evaluating how the interface supports that job.

## Approved guide bundle

```text
tmp/ux-journeys/<date>-<scenario-id>/guide/
├── <id>-scenario.json
├── <id>-scenario-approval.json
├── <id>-guide-approval.json
├── <id>-guide.webm
├── <id>-guide.srt
├── <id>-guide-chapters.json
├── <id>-guide-execution.json
├── <id>-guide-observations.json
└── <id>-guide-01-<step>.png
```

The guide execution, both approvals, and canonical scenario must have the same SHA-256. Guide approval also records the latest UI/UX evaluation reviewed by the user and their guide-readiness decision. Editing the scenario invalidates both approvals.

## Observation JSON

Each step includes its scenario fields plus runtime evidence:

```json
{
  "sequence": 1,
  "step": 1,
  "stage": "orientation",
  "goal": "오늘 처리할 업무를 파악한다",
  "evidenceSlug": "work-overview",
  "caption": "먼저 처리할 요청과 현재 상태를 확인합니다.",
  "url": "https://example.test/work",
  "viewportWidth": 1440,
  "documentWidth": 1440,
  "horizontalOverflow": 0,
  "unnamedButtons": 0,
  "consoleErrors": [],
  "pageErrors": [],
  "failedRequests": [],
  "graphqlErrors": []
}
```

Keep authorization headers, request bodies, tokens, credentials, and personal data out of observations.

## Caption and narration

- `caption` is the concise on-screen instruction and SRT text.
- `narration` is optional long-form voice-over source for future training production.
- Describe user goals and decisions, not pointer movement.
- Use the product's domain language.
- Keep captions short enough to read without pausing.
- Keep the overlay away from the active control and disable pointer events.

## Storage

Use ignored `tmp/` storage by default because videos and screenshots can contain development data. Publish or commit them only after an explicit request and data review.
