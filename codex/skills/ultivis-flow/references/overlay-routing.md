# Overlay Routing

`ultivis-flow` remains active for the entire task. An overlay supplies a focused working method; it cannot bypass plan approval, GitHub/Notion ownership, branch rules, validation, or PR gates.

## Selection contract

1. Inspect the user's request and the relevant repository state.
2. An explicit skill invocation has priority (`$skill-name` in Codex, `/skill-name` in Claude).
3. When one route clearly fits, select it automatically and announce the overlay in one short sentence.
4. When two or more routes would materially change the outcome, ask one routing question with 2–3 mutually exclusive choices. Put the recommended choice first and give each choice a brief tradeoff.
5. Use at most one primary overlay at a time. Move to a follow-up overlay only after the current overlay reaches its completion criterion.
6. If no overlay adds value, continue with `ultivis-flow` alone.

## Route map

| Signal in the request or repository | Primary overlay |
|---|---|
| 조사 후 남은 중요한 제품·범위 결정, 또는 명시적인 심층 인터뷰 요청 | `grilling` |
| Concrete behavior to implement test-first | `tdd` |
| Unknown bug, regression, intermittent failure, or performance degradation | `diagnosing-bugs` |
| External documentation, API facts, standards, or primary-source investigation | `research` |
| Domain terms, invariants, bounded contexts, or durable terminology decisions | `domain-modeling` |
| Module interface, seam, dependency direction, or testability design | `codebase-design` |
| Repository-wide structural improvement candidates | `improve-codebase-architecture` |
| A large, foggy, multi-session effort that needs a decision map | `wayfinder` |
| Merge or rebase conflicts | `resolving-merge-conflicts` |
| Transfer of unfinished context to another session | `handoff` |
| A dedicated, stateful learning workspace | `teach` |
| Role-based user journey, UI/UX audit, Playwright WebM evidence, captions, or training guide | `ux-review` |
| Frontend routes changed and need a regression sweep — console, network, DOM, responsive | `visual-qa` |
| Authoring or revising a reusable skill | `writing-great-skills` |

`grill-me` is the explicit shortcut for starting `grilling`; the router normally selects `grilling` directly.

짧은 신규 요청은 같은 설치 루트의 `docs/references/request-to-plan.md`에 따라 프로젝트·Graft 조사부터 한다. 요청이 짧다는 이유만으로 긴 인터뷰를 시작하지 않는다.

`visual-qa` and `ux-review` both open a browser and are easy to confuse. `visual-qa` asks whether the change broke a route — it sweeps routes with no scenario and no approval, and it is the gate `commit-and-verify` offers when frontend files change. `ux-review` asks whether an approved journey meets its intent, and it requires a scenario the user approved before Playwright runs. Reach for `visual-qa` for regression, `ux-review` for judgment. `visual-qa` is a Claude command and is not installed for Codex.

## Normal transitions

- `diagnosing-bugs` → `tdd` when the correct regression-test seam is known.
- `wayfinder` → `research` or `grilling` for one unresolved decision.
- `improve-codebase-architecture` → `codebase-design` → `grilling` when a candidate needs interface design and user choice.
- `resolving-merge-conflicts` → `commit-and-verify` after the repository is coherent again.
- Any implementation overlay → `commit-and-verify` before PR creation.

Transitions do not authorize new Notion Tasks, GitHub Issues, branches, worktrees, subagents, or external writes. Follow the approval rules in the core workflow.
