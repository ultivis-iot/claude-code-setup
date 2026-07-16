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
| Important ambiguity, competing decisions, or an under-specified plan | `grilling` |
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
| Authoring or revising a reusable skill | `writing-great-skills` |

`grill-me` is the explicit shortcut for starting `grilling`; the router normally selects `grilling` directly.

## Normal transitions

- `diagnosing-bugs` → `tdd` when the correct regression-test seam is known.
- `wayfinder` → `research` or `grilling` for one unresolved decision.
- `improve-codebase-architecture` → `codebase-design` → `grilling` when a candidate needs interface design and user choice.
- `resolving-merge-conflicts` → `commit-and-verify` after the repository is coherent again.
- Any implementation overlay → `commit-and-verify` before PR creation.

Transitions do not authorize new Notion Tasks, GitHub Issues, branches, worktrees, subagents, or external writes. Follow the approval rules in the core workflow.
