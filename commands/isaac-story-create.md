# Story 생성 (거대한 Plan 기반)

거대한 Plan을 기반으로 새 **Notion Story** + 그 안의 **Task N개** + Github **Issue N개** + 로컬 **브랜치 N개**를 일괄 생성합니다.

작은 변경/연장 작업은 `/isaac-task-create` 또는 `/isaac-task-note` 사용.

## 사전 조건 — 현재 위치가 메인 프로젝트여야 함

이 스킬은 **메인 프로젝트 디렉토리**에서만 실행하세요.
이미 worktree 안(예: `pm-234/`)에서 실행하면 새 worktree가 이상한 위치에 생성됩니다.

hook(`copy-plan-on-accept.sh`)이 현재 위치를 감지해 worktree 안이면 이 스킬을 추천하지 않습니다. 그래도 실행하려면 먼저 메인으로 복귀:
```bash
cc m        # 현재 repo의 메인 worktree로
```

## 분리된 책임

| 단계 | 누가 | 무엇을 |
|---|---|---|
| 분석/판단 | **LLM (이 스킬)** | Plan 분해, Tag/Topic 추론, **Project 후보 제시** |
| 사용자 확인 | **LLM (이 스킬)** | **Project 선택** + 미리보기 + 수정 사항 처리 |
| 실행 (CRUD) | **`scripts/isaac-story-create-exec.sh`** | Story/Task/Issue/브랜치 일괄 생성 (병렬) |

## 실행 단계

### 1. Plan 파일 로드

```bash
[ -f tmp/current-plan.md ] && cat tmp/current-plan.md
```
없으면 인자로 받은 경로 사용. 둘 다 없으면 종료.

### 2. 컨텍스트 수집 (캐시 활용 — 빠름)

```bash
. ~/.claude/scripts/notion-api.sh

gh_user=$(gh api user --jq .login)
ASSIGNEE_ID=$(member_notion_id "$gh_user")
ASSIGNEE_NAME=$(member_name "$gh_user")

# git remote → 추론
GITHUB_REPO=$(git config --get remote.origin.url | sed -E 's|.*[:/]([^/]+/[^/]+)\.git|\1|')
REPO_NAME=$(basename "$GITHUB_REPO")
REPO_ID=$(repository_id_by_name "$REPO_NAME")

# Project 후보 (이 Repository에 연결된 모든 Project)
CANDIDATE_PROJECTS=$(repository_project_ids "$REPO_ID")

# 현재 Week
WEEK_ID=$(current_week_id)
```

### 3. LLM 분석

Plan 본문 읽고 결정:
- **Story Title**: Plan 제목/의도 첫 줄
- **Story Tag**: `Feature` / `Update` / `Refactor` / `Bug` (본문 분석)
- **Story Priority**: 사용자 입력 (기본 M)
- **Task 분해**: PR 단위 N개 (각각 name/topic/description/planned_dates)

### 4. Project 선택 (필수 — 사용자 입력)

Repository에서 추론된 Project 후보를 표시하고 선택받음:

```
이 Story가 속할 Project를 선택하세요:

  Repository(ultivis-react-library)에서 자동 추론된 후보:
    [1] Ultivis CRM
    [2] Ultivis IoT
    [3] Ultivis Edge

  또는 다른 Project:
    [a] 전체 Project 목록 보기
    [m] 직접 입력

선택 [1-3 / a / m]:
```

후보가 1개뿐이면 자동 선택하되 확인:
```
Project: Ultivis CRM (자동) — 다른 Project를 선택하려면 [c]
[Enter로 계속 / c=변경]
```

`a` 선택 시:
```bash
projects_list_json | jq -r '.[] | "\(.id) \(.name)"'
```
번호로 다시 선택.

### 5. 미리보기 + 사용자 확인

```
Story 발행 미리보기

✓ 결정됨:
  - Project: Ultivis CRM         ← 사용자가 선택
  - Repository: ultivis-react-library
  - Week: 2026-04-13 ~ 2026-04-19
  - Assignee: 궁정원
  - Story Tag: Feature           ← 본 Tag에 맞는 Notion 템플릿 자동 적용

⚠ 확인:
  - Story Title: <inferred>
  - Priority: M  (H/M/L 중)
  - Task 분해 (N개):
    1. [<Topic>] <name>
    2. [<Topic>] <name>
    ...

[y] 진행 / [e] 수정 / [c] 취소
```

### 6. JSON spec 생성 + exec 호출

```bash
SPEC=$(jq -nc \
    --arg gh "$GITHUB_REPO" \
    --argjson story "$STORY_JSON" \
    --argjson tasks "$TASKS_JSON" \
    '{github_repo: $gh, story: $story, tasks: $tasks}')

echo "$SPEC" | ~/.claude/scripts/isaac-story-create-exec.sh -
```

`STORY_JSON`:
```json
{
  "title": "...",
  "tag": "Feature",
  "priority": "Medium",
  "project_id": "<선택된 uuid>",
  "assignee_notion_id": "<uuid>",
  "body_markdown": "<Plan 본문 전체>"
}
```

`TASKS_JSON`:
```json
[{
  "name": "...",
  "topic": "Feature",
  "description": "<Github Issue body, 마크다운>",
  "planned_start": "2026-04-17",
  "planned_end": "2026-04-22",
  "repository_id": "<uuid>",
  "week_id": "<uuid>"
}]
```

### 7. 자동 적용되는 Notion 템플릿

exec 스크립트가 처리하는 부분 (LLM 개입 불필요):

- **Story 본문** = `Tag` 템플릿 + Plan 본문
  - Feature 템플릿: `요구 기능 / 완료 기준 / 기능 분석` 헤더 자동 삽입
  - Update / Refactor / Bug 템플릿도 각각 양식 다름
- **Task 본문** = `Task` 템플릿 + Description
  - 자동 헤더: `설명 / 작업 체크리스트`

템플릿은 1주 캐시 (`~/.claude/notion-cache/templates/`).

### 8. 결과 안내

exec가 출력:
```
✓ Story: <url>
✓ Task N개:
   #<num> [<topic>] <name> → <branch>
   ...
✓ 첫 Task 브랜치로 체크아웃됨
```

## 옵션

| 인자 | 동작 |
|---|---|
| (없음) | `tmp/current-plan.md` 사용 |
| `<path>` | 지정 파일 사용 |
| `--dry-run` | 미리보기만, exec 호출 안 함 |

## 주의

- gh CLI 인증 필요
- Notion 토큰 필요
- 캐시 stale 시 첫 호출 ~3초 (Project + Repository + 템플릿)
- Tag가 매핑 안 되면(Feature/Update/Refactor/Bug 외) 템플릿 없이 Plan 본문만 삽입
