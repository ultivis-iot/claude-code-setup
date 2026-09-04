# Changelog

## v0.10.0 (2026-09-04)

- `ux-review` 뷰어 페이지에 favicon 추가. 탭 표시가 기본 아이콘이라 여러 pass 를 띄워 두면 어느 탭이 뷰어인지 구분이 안 됐음. 뷰어는 표준 라이브러리만 쓰는 단일 페이지라 파일·라우트를 늘리지 않도록 인라인 SVG data URI 로 심었음: 파란 라운드 사각형(`#175DCF`, 뷰어의 `--link` 토큰값) 위에 흰 소문자 `ux`. 소문자는 어센더·디센더가 없어 16px 박스 높이를 꽉 채울 수 있고 로고 표기와도 맞음. 실제 16/32/64px 로 렌더해 비교한 뒤 `font-size` 를 22 로 잡음(19 는 여백 과다, 25 는 박스에 붙음). 라이트/다크 탭바 양쪽에서 보이도록 배경을 유채색으로 잡음.
- `viewer.mjs` 에 `--restart` 추가. 페이지 HTML 이 `PAGE` 상수로 프로세스 메모리에 상주해서 파일을 고쳐도 떠 있는 인스턴스는 옛 페이지를 계속 서빙하는데, `--ensure` 는 이미 떠 있으면 주소만 출력하고 끝나 재기동 수단이 없었음. 실제로 favicon 을 넣고도 반영이 안 되는 걸로 드러남.
- 끌 대상은 PID 파일(`$TMPDIR/ux-review-viewer-<포트>.pid`)로만 특정. `pgrep -f viewer.mjs` 류의 패턴 매칭은 다른 포트에서 도는 뷰어까지 죽이므로 쓰지 않음. PID 파일은 listen 성공 시 쓰고 `exit`/`SIGINT`/`SIGTERM`/`SIGHUP` 에서 자기 PID 일 때만 지움. PID 파일이 없는 예전 인스턴스가 떠 있으면 조용히 실패하지 않고 직접 종료하라는 메시지와 함께 종료 코드 1 을 냄.

## v0.9.1 (2026-09-03)

- `ux-review` 자막을 좁은 뷰포트(768px 이하)에서 가운데 알약 대신 좌우 폭을 다 쓰는 밴드로 그림. 자막 박스가 1920 기준(최대 폭 `100vw-32px`, 18px)으로만 튜닝돼 있어 `390×844` 에서는 텍스트 폭 326px 에 줄당 18자, 하단 28px 틈까지 남기며 탭바·CTA 자리를 덮었음. 밴드는 `bottom: 0` 에 붙고 `box-sizing: border-box` 로 앱 CSS 와 무관하게 가로 스크롤이 생기지 않음. 데스크톱 알약은 그대로.
- 자막이 두 줄을 넘으면 글꼴을 줄이는 대신 어절 경계에서 여러 큐로 나눠 순차 재생. recorder 가 그 페이지에 숨은 프로브를 띄워 실제 렌더 높이로 재므로 폰트·언어와 무관하게 정확하고, 스텝의 자막 시간(`dwell ?? readingTime`)을 글자 수 비율로 나눠 쓰므로 녹화 길이는 변하지 않음. 가이드는 첫 큐 → 1.8초 리드 → 액션 → 나머지 큐가 결과 유지 중 이어지고, 리뷰는 큐마다 `dwell ?? 1200` 을 온전히 줌. 큐 최소 노출 `minCaptionSegmentMs: 900`.
- 아티팩트 계약 변경: SRT 큐와 스텝의 1:1 을 1:N 으로 완화. 관찰의 `captionSegments` 로 매핑하고 큐를 공백 하나로 이어 붙인 결과가 승인 자막과 다르면 거부. 챕터는 스텝당 하나로 첫 큐 시각에 걺. `normalizeCaption`/`captionSegmentsMatch` 를 `scenario-contract.mjs` 에 두어 recorder 와 validator 가 같은 규칙을 씀. `captionSegments` 가 없는 기존 번들은 예전 규칙으로 통과시켜 `approve-review-decision` 재검증이 깨지지 않음.
- `scripts/test-ux-review-skill.mjs` 에 분할 경로 케이스 추가: 자막을 반으로 쪼갠 가이드 번들은 통과, 큐를 승인되지 않은 문장으로 바꾼 번들은 거부.

## v0.9.0 (2026-09-03)

- `ux-review` 산출물을 중앙 저장소 `~/.local/share/ux-review/<부모 저장소>/<worktree>/<날짜>/<NN.시나리오>/`로 옮기고 저장소 쪽 `tmp/ux-review`는 심볼릭 링크로 남김. 산출물 5곳 중 3곳이 worktree 였고 `tmp/`가 gitignore 대상이라 `git worktree remove` 한 번에 증거 237MB 가 사라질 수 있었음. 경로 문자열과 `pathBase: "repository-root"`가 그대로 유효해 기존 매니페스트와 해시 검증은 손대지 않음. `UX_REVIEW_STORE`로 위치 재정의 가능.
- `scripts/store-link.mjs` 추가: `allocate-output.mjs`가 시나리오를 할당할 때 링크가 없으면 만들어 새 worktree 도 처음부터 중앙에 저장. `scripts/migrate-store.mjs` 추가: 기존 산출물 이관(`--dry-run` 기본, `--apply` 로 실행), 같은 파일시스템이면 `rename`, 아니면 복사 후 삭제로 폴백.
- `scripts/capture-origin.mjs` 추가: 시나리오 할당 시 `origin.json`(저장소·worktree·브랜치·리비전·GitHub Issue·Notion Task 링크)과 `plan-snapshot.md` 를 남김. Plan 은 `ult-story-create-exec.sh`가 Notion Story blocks 에만 넣고 GitHub Issue 본문에는 올리지 않으므로 로컬 파일을 복사함. GitHub·Notion 조회는 best-effort 라 실패하면 해당 필드만 비우고 저장은 성공.
- `scripts/viewer.mjs` 추가: 표준 라이브러리만 쓰는 HTTP 뷰어. `python3 -m http.server`가 Range 요청을 무시하고 전체를 재전송해 영상 seek 이 불가능하므로 206 을 직접 구현. 해시 라우팅(`#/<저장소>/<worktree>/<날짜>/<시나리오>/<pass>/<탭>/<여정>`), 여정별 영상과 시나리오 단계 병렬 표시, SRT 타임코드로 단계 클릭 시 해당 시점 이동, Plan·리뷰 결과·시나리오 렌더, 스크린샷 갤러리, 다운로드, pass·시나리오 삭제, 이전 pass 일괄 정리, 다크/라이트 전환. `--ensure` 는 떠 있으면 재사용하고 없을 때만 기동하며 접근 가능한 주소(localhost, `.local`, LAN, Tailscale)를 출력.
- 색·간격·형태 규격을 `@ultivis-iot/react` 의 light/dark 토큰과 button/badge 규격에서 가져오고 아이콘은 lucide 를 따름. 라이브러리를 의존성으로 들이지 않고 값만 이식. 심각도(P0/P1/P2)와 링크 색은 `--chart-*` 에서 분리했는데, light 의 chart-5 가 연주황이고 dark 는 핑크여서 같은 토큰이 테마마다 다른 의미가 되어 대비가 무너졌기 때문.
- 데스크톱 시나리오 기본 뷰포트를 `1920 × 1080` 으로 통일. 기존 기본값 `1440×1000`(1.44:1)과 변형 `1600×1000`(1.60:1)은 실제 화면 비율과 맞지 않고 시나리오마다 달라 같은 화면을 비교하기 어려웠음. 뷰포트가 곧 녹화 크기라 WebM 이 1.44배가 됨. 모바일은 기기 실제 비율(`390×844`)을 유지. 승인된 시나리오는 뷰포트가 `scenarioHash` 에 묶여 있어 바꾸지 않음.
- 시나리오 작성의 기본 입력을 `plan-snapshot.md` 로 지정. 전역 Plan 형식이 의도 섹션을 요구하므로 그 의도를 `job.outcome` 과 `successCriteria` 로 옮기면, 리뷰가 화면 반응이 아니라 승인된 의도의 충족 여부를 답하게 됨. Plan 이 없거나 다른 작업을 다루면 기존대로 요청과 제품에서 추론. 승인 화면에서 각 성공 기준의 출처를 밝히도록 하고 스키마는 바꾸지 않음.
- `SKILL.md` 와 `references/scenario-workflow.md` 의 `~/.codex/skills/...` 하드코딩 15곳을 `$UX` 로 정리해 설치 위치와 무관하게 동작하도록 하고, 결과 보고를 파일 절대경로 대신 뷰어 딥링크로 변경.
- 뷰어 자신을 대상으로 `ux-review` 를 수행해 P2 4건을 찾아 수정(준비도 ready, 하드 게이트 6/6): 세로 영상에서 좌측 컬럼이 비고 단계 목록이 눌리던 문제, pass·여정 버튼의 접근성 이름이 `review-017.1MB` 처럼 붙어 읽히던 문제, 정리된 리뷰 링크 진입 시 콘솔에 404 가 남던 문제, 녹화가 끝나지 않아 크기가 0인 WebM 을 재생하려다 416 이 나던 문제.

## v0.8.1 (2026-09-03)

- `ux-review` 가이드 녹화에 interaction helper 도입: action 콜백이 `(expectedStep, ui)`를 받고 `ui.fill`/`click`/`selectOption`/`check`/`uncheck`가 대상 스크롤, 앰버 펄스 하이라이트, 한 글자씩 타이핑, 감속 클릭, 결과 홀드, 스크린샷 전 하이라이트 제거를 담당. 보이는 조작은 헬퍼를 쓰고 직접 Locator 조작은 녹화 대상 밖 setup에만 허용.
- 가이드 페이싱 기본값과 계약 명문화: 타깃 인지 900ms, 클릭 220ms, 타이핑 90ms/자, 캡션 1.8초 선행. `interactionPacing`으로 연장만 허용하고, 증거 스크린샷은 캡션뿐 아니라 타깃 하이라이트도 없어야 하며 실행 메타데이터에 pacing과 헬퍼 호출 수를 기록.
- `ult-story-run.sh`에 남아 있던 Story 브랜치 모델 잔재 제거: handoff에서 더 이상 생성되지 않는 `story.github_issue_url`/`pr_url`/`branch`/`worktree` 조회를 걷어내고, 산출물 경로를 현재 worktree 기준 `tmp/story-run/<Notion Story id>/`로 고정. 기존에는 `run_key`가 항상 `story`로 고정돼 Story가 여러 개일 때 summary/prompts를 서로 덮어썼음.
- Story 브랜치·Story GitHub Issue 모델을 v0.6.4에서 제거한 이유(Story 브랜치는 단일 repository 안에만 존재할 수 있어 cross-repo Story에서 Task PR의 target이 성립하지 않음)를 `docs/workflow.md`, `docs/references/task-publishing-model.md`, `ult-notion.md`의 Cross-Repo 절에 명시.
- 문서-스크립트 드리프트 정리: `/ult-task-create`에 `--project`, `/ult-task-link-issue`에 `--auto`/`--yes`, `/ult-weekly-report`에 발행용 `--template` 옵션을 문서화하고, `ult-notion.md`의 Global scripts 목록에 `ult-story-run.sh`/`ult-wt-add.sh`/`ult-cache-refresh.sh` 추가.
- `verify-workflow.sh`가 `ult-weekly-collect.sh`, `ult-weekly-publish.sh`도 문법 검사하도록 확장.

## v0.8.0 (2026-08-28)

- `ux-review` 스킬 추가: 사용자 업무 시나리오 승인 → Playwright WebM·스크린샷·SRT 증거 수집 → ISO 9241/WCAG 2.2/ARIA APG/Nielsen 기준의 LLM UI/UX 평가 → 개선 반복 → 사용자 승인 교육 영상 제작 흐름을 제공.
- 시나리오 승인과 가이드 제작 승인을 SHA-256 기반의 별도 계약으로 분리하고, 반복 리뷰 증거와 최종 문서용 스크린샷을 같은 시나리오 단계에 연결.
- Codex 직접 설치, Codex `ult` 플러그인, Claude Code 스킬 설치 경로에 동일한 `ux-review` 번들을 배포하고 `ultivis-flow` 자연어 라우터에 UX 리뷰 신호를 추가.

## v0.7.2 (2026-07-19)

- `setup.sh`/`setup.ps1`에 구버전 파일 정리 단계 추가: 과거 이 저장소가 설치했다가 isaac → ult rename으로 사라진 commands 6개, scripts 7개를 설치/업데이트 시 `~/.claude`에서 제거. 명시적 목록 기반이라 사용자가 직접 만든 로컬 전용 파일은 건드리지 않음.

## v0.7.1 (2026-07-19)

- 설치본(`~/.claude`)에서만 수정되어 있던 `wayfinder` 티켓 모델 변경을 repo로 백포트: decision ticket을 해소 즉시 닫는 대신, 티켓 하나가 조사 → 확정 스펙 → 구현 전 과정을 담고 확정된 작업은 같은 티켓의 issue-keyed branch로 구현에 핸드오프 ("One ticket, plan through build"). `codex/skills/`와 `codex/plugins/dev-workflow/skills/` 두 사본 모두 갱신.
- `/ult-start-task`에 기존 Task/Issue가 지목된 경우의 분기 백포트: 새 Task/Issue/Story를 만들지 않고 해당 이슈 기준 브랜치(`ult-wt-add.sh`)에서 바로 구현하며, 이슈 코멘트의 확정 스펙을 Plan으로 사용.

## v0.7.0 (2026-07-16)

- `ultivis-flow`를 상시 기반으로 유지하면서 자연어 질의를 13개 독립 오버레이 스킬로 자동 라우팅하는 기본 라우터 추가.
- 경로가 명확하면 자동 선택하고, 결과를 바꾸는 복수 경로에서는 추천안을 먼저 둔 2~3개 선택지로 사용자 결정을 받도록 정리.
- Matt Pocock의 `tdd`, `diagnosing-bugs`, `research`, `domain-modeling`, `codebase-design`, `improve-codebase-architecture`, `wayfinder`, `resolving-merge-conflicts`와 productivity 스킬을 고정 커밋 기준으로 도입.
- `wayfinder`를 Notion Story → Notion Task + GitHub Issue 구조와 `Parent Task` dependency에 맞게 조정.
- `code-review`의 Spec Review/Standards Review를 `commit-and-verify`의 intent-validator/code-simplifier에 흡수.
- Claude/Codex 설치 스크립트와 Codex plugin이 전체 스킬 세트를 설치하도록 확장.

## v0.6.7 (2026-07-13)

- Codex skill에만 있던 Weekly Review 규칙(직전 Week 기본 대상, `마케팅` 템플릿 3섹션, 제목 규칙, 명시적 발행 요청 시에만 publish)을 `/ult-weekly-report` 명령과 Codex plugin 명령, `weekly-report-format.md`에 백포트.
- `ult-weekly-collect.sh`에서 Story/Project 캐시 파일이 없을 때 `jq` glob 확장 실패로 매핑이 깨지던 문제 수정.
- Codex 설치/문서를 현재 plugin/skill 구조에 맞춰 정리하고, 기본 사용법을 `/ult:...` slash command 대신 `ultivis-flow` skill과 자연어 요청 중심으로 수정.
- Codex plugin 설치 위치를 `~/.codex/plugins/ult`로 정리하고 marketplace entry가 해당 plugin을 가리키도록 수정.

## v0.6.6 (2026-05-04)

- `/review-cycle` 기본 실행이 Ralph Loop를 자동으로 시작하고, 내부 반복 라운드는 `/review-cycle ... --once`로 수행하도록 명령 프롬프트와 문서를 수정.
- Ralph Loop 완료 감지에 맞춰 review-cycle 완료 신호를 `<promise>REVIEW COMPLETE</promise>` 형식으로 정리.

## v0.6.5 (2026-04-30)
- `/review-cycle`을 한 라운드 처리 명령으로 정리하고, 자동 반복은 Ralph Loop가 `REVIEW COMPLETE` 완료 신호를 기준으로 담당하도록 문서와 설치본 프롬프트를 통일.
- Story/Task 선택 시 완료/미완료/취소된 과거 Story를 재사용하지 않도록 필터와 검증을 강화하고, 오래된 branch base나 과거 worktree 기반 Story 추론을 제거.
- PR 생성 target을 `origin/dev` 또는 repository default branch로 고정하고, local handoff/branch config/과거 PR에서 작업 브랜치를 target으로 추론하지 않도록 명시.
- `ult-my-tasks.sh`와 `ult-wt-add.sh`가 이슈 번호 포함 브랜치나 기존 worktree 경로를 잘못 재사용하지 않도록 방어 로직 추가.

## v0.6.4 (2026-04-29)
- Story는 Notion 조율 단위로 유지하고 GitHub Issue/PR은 Task 단위에만 만들도록 Story 생성, Task 추가, Story runner, PR/review 문서를 정리.
- workflow 스크립트와 Notion cache를 전역 설치 경로(`~/.codex`/`~/.claude`) 기준으로 해석하도록 강화해 작업 repo-local `scripts/` 탐색을 피하도록 수정.
- 브랜치/worktree 생성 전에 항상 `git fetch origin --prune`로 원격 refs를 최신화하고, 새 브랜치를 최신 원격 base 기준으로 만들도록 `ult-wt-add.sh`와 workflow 문서를 강화.
- Notion Story/Task 생성 시 template block 복사 대신 Notion template API를 사용하고, markdown body를 `설명` block 뒤에 삽입하도록 수정.
- Task 실행 중 사용자 승인 없이 후속 Task/Issue/branch/worktree를 생성하지 않고 carryover로 기록하도록 Story runner prompt와 workflow 문서를 강화.
- Story 기반 agent/worktree flow, cross-repo Story, `Parent Task` dependency 규칙을 workflow 문서와 Codex skill/plugin reference에 반영.
- Plan 작성/발행 전에 blocking question을 먼저 묻고, 사용자가 스스로 판단할 수 있도록 decision tradeoff를 제시하는 규칙을 추가.
- Story 생성 시 GitHub Story Issue와 Story branch/worktree를 만들지 않고, Task별 Issue/branch/worktree와 Task worktree handoff만 생성하도록 수정.
- `ult-story-run.sh` / `/ult-story-run`을 추가해 Story의 Ready/Blocked Task를 분석하고 subagent 실행 프롬프트를 생성하도록 지원.
- Story 생성 시 Task worktree별 `tmp/story-handoff.json`을 함께 만들고, `ult-story-run.sh`이 로컬 handoff를 먼저 사용한 뒤 Notion은 fallback으로 조회하도록 개선.
- `ult-task-create.sh`가 기존 Story를 GitHub Task Issue URL, current branch, local handoff에서 더 안정적으로 찾고 최신 원격 base를 기본 base로 사용하도록 개선.
- `ult-cache-refresh.sh`를 추가하고 `setup.sh`, `setup-codex.sh`, `setup.ps1` 설치 시 사용자별 `~/.claude/notion-cache` / `~/.codex/notion-cache`를 자동 준비하도록 개선.
- `verify-workflow.sh`가 Claude Code 설치본과 Codex 설치본을 구분해 검증하도록 수정.
- branch ancestry를 `gh-merge-base`, Notion Story comment, Task worktree handoff에 기록하고 review-cycle은 Task PR 기준으로 수행하도록 문서화.
- Notion Story/Task 생성 시 template 적용 실패를 감지하고, markdown body를 heading/list/todo Notion block으로 변환하도록 개선.
- `ult-task-create.sh`가 `--parent-task` 옵션으로 선행 Task relation을 설정할 수 있도록 확장.
- Codex skill display name/path renamed from `dev-workflow` to `ultivis-flow`.
- `setup-codex.sh --update` now removes the legacy `~/.codex/skills/dev-workflow` directory before installing `~/.codex/skills/ultivis-flow`.
- `ult-task-create.sh` now supports `--project` as an explicit recovery path when a Notion Repository has no Project relation.
- Ultivis task branch creation now prefers `origin/dev` when available instead of blindly following the remote default branch.

## v0.6.2 (2026-04-20)
- Codex command discovery 실험 정리:
  - `setup-codex.sh`가 Codex용 로컬 plugin marketplace와 workflow plugin 설치를 함께 처리하도록 확장
  - Codex용 workflow plugin 번들을 `codex/plugins/dev-workflow`에 추가
  - README에 Codex command/plugin 제약과 현재 설치 구조를 반영

## v0.6.1 (2026-04-20)
- Codex rules 안전성 정리:
  - `codex/rules/dev-workflow.rules`를 유효한 최소 Starlark 파일로 정리해 startup parse error 방지
  - Codex 워크플로우의 실제 책임이 `dev-workflow` skill에 있음을 README와 설치 안내에 명시
  - `setup-codex.sh` 출력 문구를 skill 중심 흐름에 맞게 조정

## v0.6.0 (2026-04-20)
- Codex 지원 추가:
  - `setup-codex.sh` 신설 — `~/.codex/rules`, `~/.codex/skills`, `~/.codex/dev-tools` 설치
  - `codex/rules/dev-workflow.rules` 추가 — 개발 플로우를 Codex 규칙으로 적용
  - `codex/skills/dev-workflow` 추가 — commit/validate/PR/review/Ultivis 흐름을 Codex skill로 제공
- Ultivis 명령 프리픽스 및 문서 정리:
  - `isaac-*` 명령/스크립트를 `ult-*`로 정리
  - Plan 승인 후 흐름을 `AI 제안 + 사용자 확인 + 실행` 방식으로 재구성
  - README와 workflow 문서의 진입점/온보딩 문구 정리
- 워크플로우 명령 슬림화 및 검증 보강:
  - `commit-and-verify`, `create-pr`, `review-cycle`, `visual-qa`, `ult-story-create` 문서 토큰 최적화
  - validation contract/reference 및 `verify-workflow.sh` 기반 검증 추가

## v0.5.0 (2026-04-17)
- **Notion MCP 연동** — setup.sh/ps1에 Internal Integration Token 등록 단계 추가 (user scope)
- **Isaac 스킬 6개 추가**:
  - `/isaac-my-tasks` — 본인 Task 조회 + worktree 자동 생성
  - `/isaac-story-create` — Plan → Story + Task N + Issue N + worktree N 일괄
  - `/isaac-task-create` — 기존 Story에 Task 추가
  - `/isaac-task-note` — Task에 메모 코멘트
  - `/isaac-task-status` — 비정형 상태 변경 (취소/재개)
  - `/isaac-weekly-report` — 주간 작업 정리 + 발행
- **공통 헬퍼**:
  - `scripts/notion-api.sh` — 토큰/캐시(members/projects/repos/schemas/templates)/lookup
  - `scripts/isaac-wt-add.sh` — repo abbr 기반 worktree 생성
- **기존 스킬 확장**:
  - `/issue` — Notion Task/Story/Project 컨텍스트 추가
  - `/commit-and-verify` — 검증 결과를 Task 코멘트로 자동 동기화
- **dev-tools 리팩터**:
  - `MAIN_PROJECT` 제거, `WORKTREE_ROOT`로 통합 (다중 프로젝트 지원)
  - repo 이니셜 축약 기반 폴더명 (`pm` / `ub` / `url` / `ccs` 등)
  - `dw` 2-tier hook 조회 (`.isaac/dw.sh` → `~/.claude/dev-tools/hooks/<repo>.sh` → 레거시)
  - `isaac-init` 명령어 신설 (status/setup/check/dw-hook)
- **Plan 승인 hook**: worktree 감지 + Plan 성격별 스킬 분류 추천

## v0.4.0 (2026-04-02)
- Docker 멀티유저 격리 지원 — 사용자명 해시 기반 포트 자동 할당 및 COMPOSE_PROJECT_NAME 자동 설정
- dev-commands.sh에서 하드코딩된 포트 제거, 사용자별 자동 계산으로 대체
- dw 명령어에 사용자별 --env-file 지원 추가
- setup.sh .env 생성 시 Docker 멀티유저 격리 안내 포함

## v0.3.0 (2026-02-06)
- visual-qa 커맨드 추가 — Chrome MCP 브라우저 자동화로 React 프론트엔드 UI/UX 검증
- visual-qa-analyzer 에이전트 추가 — 수집 데이터 기반 디자인 품질 평가 및 이슈 판정
- commit-and-verify에 visual-qa 선택적 3단계 통합 — 프론트엔드 변경 감지 시 사용자에게 제안
- validation-status.schema.json에 visual-qa 필드 추가

## v0.2.1 (2025-01-25)
- commit-and-verify에서 Plan 파일 선택 기능 추가 - 최근 5개 Plan 중 사용자가 직접 선택
- 동시 세션 환경에서 정확한 Plan 선택 지원

## v0.2.0 (2025-01-25)
- test-validator 추가 - 테스트 커버리지 및 테스트 통과 여부 검증
- test-validator를 검증 플로우(commit-and-verify)에 통합

## v0.1.2 (2025-01-25)
- Plan 복사 hook 수정 - `~/.claude/plans/`에서 최신 Plan 파일 복사 방식으로 변경
- ExitPlanMode 도구에 plan 파라미터가 없는 문제 해결

## v0.1.1 (2025-01-18)
- 버전 정책 도입 및 문서화
- setup.sh에 버전 비교 및 업데이트 내역 출력 기능 추가
- VERSION 파일 추가

## v0.1.0 (2025-01-18)
- Plan 복사 hook 개선 - tool_input.plan에서 직접 추출 방식으로 변경
- .gitignore 추가

## v0.0.x (2025-01-08 ~ 2025-01-15)
- subagent 결과 취합 방식 개선 - 메인에서 validation-status.json 생성
- templates/ 디렉토리 분리, 업데이트 검증 문서화
- 업데이트 시 원격 저장소 자동 pull 기능 추가
- security-validator commit-and-verify 호출 금지 강화
- Plan 승인 시 자동 복사 hook 추가
- --update 옵션 추가
- 커밋 메시지 컨벤션 문서화
- validation-status 스키마 및 브랜치별 검증 추가
- 서브에이전트 제한사항 명시
- PowerShell 한글 인코딩 수정
- Windows PowerShell 설치 스크립트 추가
- 최초 릴리스
