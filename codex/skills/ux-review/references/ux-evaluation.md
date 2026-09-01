# Evidence-Based UI/UX Evaluation

Use the scenario only to understand the user's role, goal, starting state, and expected outcome. Evaluate the interface shown in the evidence rather than grading the scenario or caption writing.

## Evaluation basis

Use these as complementary layers, not interchangeable checklists:

- [ISO 9241-210](https://www.iso.org/standard/77520.html): verify that the declared users, goals, context, and iteration remain central to the review.
- [ISO 9241-11](https://www.iso.org/standard/63500.html): assess effectiveness, efficiency, and satisfaction as outcomes of use in the declared context.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) Level AA: treat applicable accessibility failures on the primary path as hard gates.
- [WAI-ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/): check keyboard, focus, semantics, names, states, and expected widget interaction.
- [Nielsen's usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/): diagnose status visibility, real-world language, control, consistency, error prevention, recognition, efficiency, minimalism, recovery, and help.

Standards conformance does not prove that the job is usable. Visual polish does not prove task success. The declared user's observed ability to complete and verify the job is the final integration criterion.

## Product-native consistency

Read `<scenario-directory>/consistency-baseline.md` before evaluating the review capture. Existing product behavior is the primary comparison for whether the feature belongs in the product; generic heuristics explain the usability impact but do not replace that comparison.

Compare the reviewed interface against genuinely analogous product surfaces for:

- page and navigation grammar: shell, breadcrumb, list-to-detail context, header, tabs, widgets, and return path;
- action grammar: primary and secondary placement, button labels, destructive-action treatment, menus, and confirmation dialogs;
- data grammar: tables, filters, empty/loading/error states, status badges, timestamps, audit identity, and technical identifiers;
- language grammar: domain terms, capitalization, translation, tone, and state names;
- visual grammar: spacing, density, grouping, typography, color semantics, icon use, and responsive collapse;
- workflow grammar: creation, save, approval, handoff, retry, cancellation, and success feedback.

For every material difference, classify it as one of:

- **aligned**: follows the established pattern;
- **intentional deviation**: the user's job requires a different pattern and the reason is explicit;
- **feature-local inconsistency**: an avoidable one-off that should be corrected here;
- **systemic product issue**: the reviewed feature matches an existing pattern that is itself inaccessible, unsafe, or confusing;
- **evidence gap**: no valid comparable surface was available.

Do not recommend copying an existing defect. When the baseline itself fails accessibility, safety, or task effectiveness, report the systemic issue separately and recommend the smallest shared-component correction. Do not call a purposeful job-specific difference inconsistent merely because it is visually unique.

## Hard gates

A review is not guide-ready while any applicable hard gate is unresolved. Use these stable IDs in the review decision:

- `task-completion`: the critical-path job cannot complete or its result cannot be verified;
- `data-safety`: the flow risks unintended data loss, duplicate work, or an unsafe irreversible action;
- `accessibility`: the primary action is not keyboard reachable, has unusable focus behavior, or fails an applicable WCAG 2.2 AA criterion;
- `state-visibility`: the interface hides required state, permission, validation, or recovery information;
- `runtime-reliability`: runtime errors make the observed result unreliable;
- `product-consistency`: a primary-path layout or interaction departs from the recorded product baseline without an explicit job-based reason, leaving users unable to transfer learned behavior.

## Evaluation dimensions

1. **Effectiveness**: Can the user complete the job and verify the outcome?
2. **Efficiency**: Are actions, repeated inputs, navigation changes, and waits proportionate to the job?
3. **Findability**: Can the user locate the next action and understand menu, route, breadcrumb, list, and detail context?
4. **Hierarchy**: Does the screen emphasize the decision and information needed now?
5. **Clarity**: Are labels, terminology, controls, statuses, and consequences understandable?
6. **Feedback**: Does the UI communicate loading, success, failure, empty states, and saved state at the right time?
7. **Product fit**: Does the interface follow the recorded product baseline for layout grammar, interaction sequence, terminology, state feedback, density, and responsive behavior? Are deviations intentional and justified?
8. **Error handling**: Does the UI prevent likely mistakes and preserve user work during recovery?
9. **Accessibility**: Are controls named, keyboard reachable, readable, and perceivable without color alone?
10. **Responsiveness**: Does the workflow remain usable at the declared viewport without clipping, overflow, or lost actions?
11. **Confidence**: Can the user tell what changed, what will happen next, and whether the action is reversible?

Where evidence permits, report task success, elapsed time, action count, route/context changes, errors, retries, and recovery time. Treat them as comparison signals rather than universal target numbers.

## Evidence rules

- Cite the exact journey, scenario step, and video timestamp.
- Link the matching screenshot and route.
- For consistency claims, cite the comparable baseline route, screenshot, shared component, or interaction and state why it is analogous.
- State what is observed before interpreting it.
- Explain impact in the audience role's job language.
- Separate product issues from data/configuration, harness, and environment problems.
- Mark uncertainty and evidence gaps explicitly.
- Do not infer hidden implementation or user intent beyond the scenario.
- Do not recommend a redesign when a smaller coherent correction solves the observed problem.

## Finding format

```markdown
### UX-01 · P1 · 다음 작업이 보이지 않음

- 차원: Findability
- 시나리오/단계: operator-request-to-approval / 2
- 증거: 00:18–00:25, `...-02-create-request.png`, `/requests/new`
- 관찰: 저장 후 상세가 열렸지만 승인 대기 상태와 다음 담당자가 첫 화면에 표시되지 않는다.
- 사용자 영향: 운영 담당자는 등록 성공과 인계 여부를 판단하기 위해 목록으로 돌아가야 한다.
- 권고: 저장 완료 영역에 현재 상태와 다음 담당자를 함께 표시한다.
- 신뢰도: 높음
```

## Severity

- **P0**: the job cannot complete, data is unsafe, or the primary path is inaccessible.
- **P1**: major friction, context loss, ambiguity, repeated work, or inaccessible primary action.
- **P2**: consistency, density, wording, or visual polish with measurable user impact.

End with:

- a product-consistency summary listing aligned patterns, intentional deviations, feature-local inconsistencies, systemic issues, and evidence gaps;
- top three improvements by user impact;
- findings mapped after user review to `fixed`, `deferred`, `rejected`, or `evidence-needed`;
- hard-gate status and guide-readiness recommendation, clearly labeled as an LLM recommendation rather than approval;
- whether another capture is needed before a guide is ready.
