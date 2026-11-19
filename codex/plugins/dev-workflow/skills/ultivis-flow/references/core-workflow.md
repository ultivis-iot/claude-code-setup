# Core Workflow

Apply this sequence by default:

1. Route the request and announce the selected overlay when one is useful
2. Plan
3. Build
4. Commit
5. Validation stage 1: intent validation
6. Validation stage 2: quality validation
7. Optional Visual QA for frontend changes
8. PR creation

Key expectations:

- The plan must include the user's intent, expected outcome, and meaningful constraints.
- An explicit skill invocation wins. For an ambiguous route, ask one question with 2–3 choices and put the recommendation first.
- 짧은 신규 요청의 Plan은 같은 설치 루트의 `docs/references/request-to-plan.md`를 따른다. 프로젝트·Graft 조사로 사실을 먼저 확인하고 중요한 미결 결정만 질문한다. 가정을 명시한 초안은 제시할 수 있으며 확정·발행 전에 중요한 결정을 해소한다.
- Ask questions that help the user think and decide. Present the decision point and tradeoff briefly instead of filling gaps with hidden assumptions.
- Ask only the next 1-3 important questions at a time. Record answers as plan decisions, and record non-blocking assumptions explicitly.
- 비기능 제약은 작업에 해당할 때만 확인한다: 보안(인증·권한, 외부 입력 검증, 비밀값 보관 위치), 성능(예상 데이터 양·부하, 허용 지연), 접근성·반응형(모바일, 키보드·스크린리더 지원 수준), DB(마이그레이션 방식, 기존 데이터 이전, 롤백 가능 여부). 기존 구현을 먼저 조사하고 코드로 정할 수 없는 정책·목표치만 질문하며, 정한 값은 plan decisions에 남겨 구현 뒤 품질 검증의 기준으로 쓴다.
- Do not create Story/Task/Issue records until the plan is approved and the Story/Task breakdown has been confirmed.
- At breakdown, if the Task list can't be written yet, several open decisions depend on each other, and no single session can reach a conclusion, recommend charting a `wayfinder` map instead of publishing fixed Tasks.
- For an implementation Task that is a reproducible bug fix, a logic change, or a public interface change in a repository with a runnable test setup, use `tdd` and name the seams under test in the plan's verification.
- Preserve the approved plan in `tmp/current-plan.md` (see "Plan 승인 뒤" below).
- Validation is a gate, not a summary. If intent validation fails, stop and fix the implementation before moving on.
- Quality validation should cover docs, security, code simplicity, tests, and CLI sync when relevant.
- Frontend changes should trigger a suggestion for Visual QA instead of being ignored.

## Plan 작성

- Plan에는 반드시 `의도` 섹션을 둔다: 사용자가 원하는 것, 기대 결과물. 사용자가 자기 의도가 정확히 문서화됐는지 확인하게 한다.
- Plan이 크거나 애매하면 Story/Task를 만들기 전에 질문한다. 최소 확인 항목: 목표와 성공 기준, 포함/제외 범위, 대상 repo·Project·Story, 데이터/API/UI 영향 범위, 선행 Task/dependency, 검증/리뷰 기준, 해당할 때만 비기능 제약(위 항목).
- 답은 `결정사항`에, 답이 없지만 진행 가능한 내용은 `가정`에 적는다. 위험한 가정이면 진행하지 않는다.
- **UI 변경은 목업 전·후 비교부터.** UI(화면 배치·스타일·컴포넌트·문구 위치)를 바꾸면 Plan 단계에서 바꾸는 화면마다 현재(실제 앱 캡처)와 변경 후 목업을 나란히 보여주고, 사용자 확인 뒤에 구현한다. 목업은 png나 HTML로 로컬에 만들고 절대경로를 알려준다. 데스크톱·모바일 폭, 라이트·다크 등 영향받는 경우를 함께 보이고, 작은 조정이라도 눈에 보이는 변화면 전·후 캡처를 보인다. 구현 중 목업과 달라지는 결정이 생기면 다시 보여준다.

## Plan 승인 뒤

1. Plan 모드 진입 시 프로젝트 루트에 `tmp/`가 없으면 만든다. 승인 뒤 Build 전에 현재 대화의 정확한 Plan을 `tmp/current-plan.md`로 저장한다. Hook에 명시 경로가 없으면 메인 에이전트가 저장하며 전역 최신 Plan 파일을 추측하지 않는다. Build 중에는 Plan을 고치지 않는다(원본 의도 보존).
2. Plan 성격을 분류해 다음 흐름을 제안한다. 이미 승인된 범위는 이어서 수행한다.

| Plan 성격 | 기본 제안 |
|---|---|
| Task 목록을 아직 쓸 수 없고 선후 관계가 있는 미결 결정이 여러 개인 작업 | `wayfinder` 지도 작성 — Notion Story를 지도로, 결정 티켓을 Task + Issue로 |
| 새 Story로 관리할 작업 | `ult-story-create` — Story 1개 + Task N개 + Issue N개 + 필요 시 브랜치/worktree |
| 기존 Story의 추가 작업 | `ult-task-create` — Task 1개 + Issue 1개 + 필요 시 브랜치/worktree |
| 현재 Task의 보완/메모 | `ult-task-note` |
| 발행 없이 바로 구현할 작업 | 바로 Build 시작 |

3. 사용자에게 명령을 고르게 떠넘기지 않는다. 추천 흐름 1개와 이유 1줄, 대안은 최대 2개를 짧게 제시하고, **사용자 확인을 받은 뒤** 그 흐름을 직접 이어서 수행한다. 다른 흐름을 고르면 따르고, 명시적으로 거부하면 그대로 Build를 시작한다.

```text
Plan 승인 완료.

추천 다음 단계: 새 Story 발행
이유: 독립된 작업 단위가 여러 개라 Story 아래 Task로 나누는 편이 적절합니다.

확인되면 제가 이어서 진행하겠습니다.
대안:
- 기존 Story에 Task 1개 추가
- 발행 없이 바로 구현
```

## Task 생성 제한

- 작업 중 새 Notion Task, GitHub Issue, 하위 Task를 임의로 만들지 않는다. `ult-task-create`는 사용자가 명시적으로 "Task를 추가/생성하라"고 승인한 경우에만 실행한다.
- 현재 Task 범위를 벗어난 후속 작업, 리뷰·구현 중 발견한 추가 범위는 새 Task를 만들지 말고 Story handoff와 Notion Story 페이지 본문에 carryover로 기록한다. 사용자가 승인하기 전까지 Task/Issue/branch/worktree를 새로 만들지 않는다.

## Codebase navigation

- When Graft is available, read [graft-code-map.md](graft-code-map.md) before broad codebase exploration and use its structural CLI before opening large file sets.
- Graft is an accelerator, not a blocker. If Node.js 20+, the CLI, or a compatible native module is unavailable, recommend installation once and fall back to `rg` and normal source inspection. LTS Node 24 is a compatibility fallback, not a requirement.
- Keep every `graft/` graph local to its PC and worktree. Never commit it or share it across worktrees.

Commit message convention:

```text
type: subject

body
```

Use conventional commit types such as `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, and `perf`.

Branch creation rule:

- Before creating or checking out a branch/worktree, refresh remote refs with `git fetch origin --prune`.
- For standalone tasks, create branches from the latest `origin/dev` when it exists. Use another base only when the user explicitly asks for it or the repository has no `dev` branch.
- For Story-based tasks, do not create Story branches. Create Task branches from the latest `origin/dev` when it exists, or the repository default branch otherwise.
