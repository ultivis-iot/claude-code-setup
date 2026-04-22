# Isaac 개발 워크플로우

Notion + Github + Claude Code + n8n 자동화가 한 몸으로 움직이는 워크플로우. 개발자는 Claude 안에서 Plan부터 PR 머지까지 끝냅니다.

## 초기 설정 (1회)

### 사전 요구사항
- `gh` CLI 인증 (`gh auth login`)
- `jq` 설치
- `tmux` (cc 명령어용, 선택)
- Notion Integration 토큰 — [발급 가이드](https://www.notion.so/profile/integrations)

### 설치

```bash
git clone https://github.com/ultivis-iot/claude-code-setup.git
cd claude-code-setup
./setup.sh
```

setup.sh가 대화형으로 묻는 것:

1. **Notion Integration 토큰** — `ntn_...` 또는 `secret_...` 입력 (Enter로 건너뛰기 가능)
2. **WORKTREE_ROOT** — worktree 둘 디렉토리 (기본: `$HOME/Git`)

### Claude Code 재시작

설치 후 새 명령/스크립트 로드를 위해 `/exit` 후 재실행합니다. Notion 연동은 기본적으로 설치된 workflow 스크립트가 API를 직접 호출하며, MCP 도구는 보조 경로입니다.

### 프로젝트별 셋업 (선택, 필요 시)

```bash
cd <your-project>
ult-init dw-hook    # dw 환경 전환 스크립트 생성 (대화형)
```

팀 공유(`.isaac/dw.sh`) 또는 개인(`~/.claude/dev-tools/hooks/<repo>.sh`) 선택.

### 검증

```bash
ult-init            # 상태 확인
ult-init check      # 필수 요소 검증
/ult-my-tasks       # 첫 호출 시 Member 캐시 자동 빌드 (~2s)
```

---

## 큰 그림

```
[Claude Code]                    [n8n 자동화]
  Plan 모드 → 승인                 Github webhook → Notion
        ↓                               ↑
  Claude가 Plan 분류                  PR 생성 → AI 리뷰
        ↓                               ↑
  Story/Task/Issue/브랜치            commit / push
  (exec 스크립트)                      ↑
        ↓                          개발자 코드 작성
  worktree로 진입 (cc)               ↓
        ↓                          /commit-and-verify → /create-pr
  코드 작성
```

---

## Plan 승인 흐름

Plan 모드(`Shift+Tab×2`)에서 작성 → 승인하면 hook이 `tmp/current-plan.md`를 저장하고, 그 다음 단계는 AI가 먼저 제안합니다.

| Plan 성격 | 기본 제안 |
|---|---|
| 새 Story로 관리할 작업 | `ult-story-create` 흐름 제안 |
| 기존 Story 추가 작업 | `ult-task-create` 흐름 제안 |
| 현재 Task의 보완 | `ult-task-note` 흐름 제안 |
| 작은 일회성 변경 | 발행 없이 Build 제안 |

기본 UX는 `명령어 입력`보다 `AI 제안 → 사용자 확인 → AI 실행`입니다.

- AI는 추천 흐름 1개와 이유 1줄을 먼저 제시
- 사용자는 발행 방식을 확인만 하면 됨
- 확인되면 AI가 해당 흐름을 직접 이어서 수행

**현재 worktree 안이면** 새 worktree 생성은 건너뛰는 쪽을 우선 제안합니다.

---

## Story 기반 Agent Worktree Flow

여러 Task로 나뉘는 작업은 Story를 조율 단위로 사용합니다. Story는 목적과 통합 기준을 유지하고, Task는 실제 실행 단위로 분리합니다.

핵심 규칙:

- Story는 orchestration unit이고, Task는 execution unit입니다.
- 메인 에이전트는 Notion Story, GitHub Story Issue, Story branch, Story worktree, dependency map, handoff, integration, final review를 담당합니다.
- 각 서브에이전트는 정확히 하나의 Notion Task, GitHub Issue, Task branch, Task worktree, implementation, verification, Task PR을 담당합니다.
- Task branch는 Story branch에서 만들고, Task PR은 Story branch를 target으로 합니다. 최종 Story PR만 `dev`를 target으로 합니다.
- `Parent Task`는 hierarchy가 아니라 prerequisite/dependency입니다. dependency가 충족된 Task만 병렬 실행합니다.
- Task `Repository` relation이 repo ownership의 source of truth입니다. cross-repo reference는 bare issue number가 아니라 `repo#issue` 또는 Issue URL을 씁니다.
- `tmp/story-handoff.md`와 `tmp/story-handoff.json`을 유지합니다. 초기 handoff는 Notion Story와 GitHub Story Issue에 동일하게 남기고, 이후 변경은 GitHub Story Issue에 반영합니다.
- review-cycle은 두 번 돕니다. Task PR마다 Story branch merge 전에 한 번, Story PR에서 `dev` merge 전에 한 번 돕니다.

```text
dev
└── Story branch
    ├── Task branch -> PR to Story branch
    ├── Task branch -> PR to Story branch
    └── Task branch -> PR to Story branch

Story branch -> PR to dev
```

### 역할

| 단위 | 담당 | 작업 공간 |
|---|---|---|
| Story | 메인 에이전트 | Story branch + Story worktree |
| Task | 서브에이전트 | Task branch + Task worktree |

메인 에이전트는 Story context, Task dependency, file ownership, review/merge 순서, 최종 통합 검증을 관리합니다. 서브에이전트는 자기 Task worktree만 수정하고, 완료 시 테스트 결과와 handoff를 남깁니다.

### Branch / PR 규칙

- Story 생성 시 Story GitHub Issue를 만들고 Notion Story의 `Issue URL`에 기록합니다.
- Story branch는 `dev`에서 만듭니다.
- Task branch는 같은 repository의 Story branch에서 만듭니다.
- Task PR은 Story branch를 target으로 합니다.
- 모든 Task가 Story branch에 merge되고 통합 검증이 끝난 뒤 Story PR을 `dev`로 보냅니다.
- Story PR URL은 Notion Story의 `PR URL`에 기록합니다.
- branch ancestry는 `branch.<name>.gh-merge-base`, 초기 Notion comment, GitHub Story Issue handoff에 남깁니다.
- 브랜치 이름에 `story/`, `task/` prefix는 필수 아닙니다. 중요한 기준은 branch base와 PR target입니다.

### Dependency 규칙

Notion의 `Parent Task`를 선행관계로 사용합니다.

- `Parent Task`는 ownership hierarchy가 아니라 prerequisite/dependency입니다.
- Parent Task가 없으면 시작 가능 상태입니다.
- Parent Task가 있으면 모든 parent가 완료되거나 Story branch에 merge될 때까지 Blocked입니다.
- 병렬 실행은 dependency가 없는 Task 또는 dependency가 충족된 Task만 대상으로 합니다.
- 같은 파일을 수정할 가능성이 있으면 병렬화하지 않습니다.

### Cross-Repo Story

하나의 Story가 여러 repository를 건드릴 수 있습니다.

- Story 자체에 direct Repository relation은 필요 없습니다.
- Task의 `Repository` relation이 repository ownership의 source of truth입니다.
- Story가 건드리는 repository는 연결된 Task들의 Repository로 판단합니다.
- cross-repo dependency도 `Parent Task`로 표현합니다.
- GitHub issue 번호는 repository별 namespace이므로 cross-repo 문서에서는 bare `#123` 대신 `repo#issue` 또는 Issue URL을 사용합니다.

### Handoff / Review Cycle

Story 기반 작업은 Story worktree의 `tmp/story-handoff.md`와 `tmp/story-handoff.json`을 유지합니다. 초기 handoff는 Notion Story comment와 GitHub Story Issue comment에 동일하게 남겨 확인 가능하게 만들고, 이후 실행 중 변경사항은 GitHub Story Issue에만 반영합니다. `/ult-story-run`은 로컬/GitHub handoff를 먼저 읽고 Notion은 handoff가 없을 때만 fallback으로 조회합니다.

리뷰 사이클은 두 단계입니다.

- Task PR review-cycle: 각 Task PR에서 AI 리뷰/CI가 통과할 때까지 반복하고, 통과 후 Story branch로 merge합니다.
- Story PR review-cycle: 모든 Task가 Story branch에 들어온 뒤 전체 통합 PR에서 다시 AI 리뷰/CI를 반복합니다.

Task PR의 리뷰 코멘트가 Story 전체 설계나 다른 Task 범위에 해당하면, 해당 Task에서 임의로 확장하지 않고 Story handoff와 GitHub Story Issue에 기록합니다.

---

## 주요 명령어

### Claude 스킬 (`/ult-*`)

| 명령어 | 역할 | 속도 |
|---|---|---|
| `/ult-my-tasks` | 본인 Task 조회 + worktree 자동 생성 | ~2s |
| `/ult-story-create` | Plan → Story + Task N + Issue N + worktree N | LLM + 3s |
| `/ult-story-run` | Story Task dependency 분석 + Ready Task subagent prompt 생성 | ~2s |
| `/ult-task-create` | 기존 Story에 Task 1개 추가 | ~2s |
| `/ult-task-note` | 현재 Task에 메모 코멘트 | ~1s |
| `/ult-task-status` | 비정형 상태 변경 (취소/재개) | ~1.5s |
| `/ult-weekly-report` | 주간 작업 정리 + 발행 | 5s + LLM |

### 작업 중심 진입점

| 명령어 | 역할 |
|---|---|
| `/ult-start-task` | 내 Task 조회, Story 발행, Task 추가 중 상황에 맞는 시작 흐름 선택 |
| `/ult-finish-task` | 검증 상태 확인 후 필요 시 검증 + PR 생성까지 연결 |
| `/ult-sync-task` | Task 메모, 상태 변경, Issue 컨텍스트 확인을 한 진입점으로 통합 |

### 기존 확장

| 명령어 | 역할 |
|---|---|
| `/issue` | 현재 브랜치의 Github Issue + Notion 컨텍스트 |
| `/commit-and-verify` | 검증 5종 + Task 코멘트 자동 동기화 |
| `/create-pr` | PR 생성 |

### 셸 명령어 (dev-tools, 사용자 주도)

| 명령어 | 역할 |
|---|---|
| `wt` | 현재 repo worktree 목록 |
| `wa [branch]` | worktree 생성 (대화형 또는 인자) |
| `wr` | worktree 삭제 (대화형) |
| `cc <name\|num\|m>` | tmux 세션 + Claude Code 진입 |
| `ccs` / `cca` | 세션 상태 / 모든 worktree에 세션 |
| `dw <name\|num\|m>` | 환경 전환 (docker/DB/dev server) |
| `ult-init [setup\|check\|dw-hook]` | dev-tools 설정 |

---

## 하루 시나리오

```bash
# 아침
/ult-my-tasks                    # 오늘 할 일 확인 → 선택
# → worktree 자동 생성 (예: ub-234)
cc ub-234                          # tmux 세션 + Claude Code

# 새 환경 필요할 때 (docker restart 등)
dw ub-234                          # 프로젝트별 .isaac/dw.sh 실행

# 작업 중 기록
/ult-task-note "Token 이슈 백엔드 확인 대기"

# 컨텍스트 재확인
/issue

# 마무리
/commit-and-verify                 # 검증 5종 + Task 코멘트
/create-pr                         # PR 생성
# → n8n이 AI 리뷰 자동 수행, 머지 시 Task 완료 처리

# 주간 회고 (금요일)
/ult-weekly-report
```

---

## 설정 파일 위치

### 전역 (`~/.claude/`)
- `dev-tools/.env` — `WORKTREE_ROOT` (기본 `$HOME/Git`)
- `dev-tools/.worktree-active` — 현재 활성 worktree
- `dev-tools/hooks/<repo>.sh` — 개인용 dw hook
- `notion-cache/` — Members/Projects/Repositories/Schemas/Templates 캐시

### 프로젝트별 (`<repo>/`)
- `.isaac/dw.sh` — 팀 공유 dw hook (커밋 권장)
- `.isaac/dw.local.sh` — 개인 오버라이드 (gitignore)
- `tmp/current-plan.md` — 승인된 Plan
- `tmp/validation-status.json` — 검증 결과

---

## Worktree 이름 규칙

repo 이름의 하이픈 세그먼트 첫 글자 + 번호:

| repo | abbr | worktree 예 |
|---|---|---|
| project-maker | `pm` | `pm-583` |
| ultivis-base | `ub` | `ub-583` |
| ultivis-react-library | `url` | `url-583` |
| claude-code-setup | `ccs` | `ccs-583` |

`dw 583` / `cc 583` → 현재 repo abbr 우선. 여러 repo에 `*-583*` 있으면 선택 프롬프트.

---

## dw hook 2-tier 조회

```
dw <target>
    ↓
1. <wt>/.isaac/dw.sh                       ← 팀 공유 (커밋)
2. ~/.claude/dev-tools/hooks/<repo>.sh     ← 개인
3. 레거시 자동 감지 (alembic+apps)
4. fallback (env var만)
```

`ult-init dw-hook`이 프로젝트 타입을 감지해 템플릿 생성:
- compose / pnpm / django / nextjs / project-maker / generic

---

## n8n 자동화 (Github → Notion)

| 트리거 | 동작 |
|---|---|
| 브랜치 생성 | Task → `진행 중` |
| push | Commit DB 적재 |
| PR opened | Task → `AI검토중` + Claude Code AI 리뷰 |
| PR merged/closed | Task → `완료` / `미완료` |

파일 export는 `n8n/` 디렉토리 참고.

---

## 책임 분리

| 레이어 | 담당 | 예시 |
|---|---|---|
| 데이터/프로세스 | Claude | Plan, Notion, Github Issue, 브랜치, worktree 생성 |
| 파일시스템 | 사용자 | worktree 관리, tmux |
| 런타임 | 사용자 | docker, DB 전환 (`dw`) |
| Github 이벤트 동기화 | n8n | 단방향 자동 |

---

## 개발자 하루 액션 횟수

| 시점 | 액션 | 횟수 |
|---|---|---|
| 출근 | `/ult-my-tasks` | 1 |
| 환경 진입 | `cc <name>` | 1 |
| 작업 시작 | Plan 승인 → 분류 따라가기 | 1~3 |
| 환경 전환 필요 시 | `dw <name>` | 0~N |
| 작업 중 기록 | `/ult-task-note` | 0~N |
| 마무리 | `/commit-and-verify` → `/create-pr` | 1~3 |
| 금요일 | `/ult-weekly-report` | 1/주 |
| **Notion 진입** | — | **0** |

---

## 참고

- 자세한 Notion DB 스키마: `/ult-my-tasks`, `/ult-story-create` 등 각 커맨드 md 참조
- n8n 워크플로우 상세: [`n8n/README.md`](../n8n/README.md)
- Notion MCP 연동: 설치 시 `setup.sh` 가 자동 안내
