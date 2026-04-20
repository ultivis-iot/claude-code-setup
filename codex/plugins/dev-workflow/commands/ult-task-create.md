# 기존 Story에 Task 추가

기존 Notion Story에 새 Task를 추가하고, Github Issue + 로컬 브랜치까지 생성합니다.

`/ult-story-create`가 새 Story부터 만든다면, 이 스킬은 **이미 존재하는 Story에 Task만 끼워넣을 때** 사용합니다.

## 데이터 소스

`/ult-story-create`와 동일.

## 실행 단계

### 1. Story 선택

옵션:
- 인자로 Story title 또는 URL 받음: `/ult-task-create "다크모드 설정 추가"`
- 인자 없으면: 본인이 Assignee이거나 Status가 "진행 중"인 Story 목록 표시 후 선택

`mcp__notion-api__API-query-data-source` (Story DB):
```json
{
  "data_source_id": "338b9757-d10f-462f-92c9-4777cb747c78",
  "filter": {
    "or": [
      {"property": "Status", "status": {"equals": "진행 중"}},
      {"property": "Assignee", "people": {"contains": "<notion_user_id>"}}
    ]
  },
  "page_size": 20
}
```

### 2. 컨텍스트 추출

선택된 Story에서:
- Project (relation) → Task에 상속
- 본문 (있으면) → 분해 시 참고

### 3. Task 정의

대화형 입력:
```
새 Task 추가 (Story: <story_title>)

✓ 추론됨:
  - Project: <name>
  - Repository: <git_remote 기반>
  - Week: <현재 Week>
  - Assignee: <current user>

⚠ 입력:
  - Task Name: <필수>
  - Topic [Feature/Fix/Update/Refactor/Style/Other]: <기본 Feature>
  - Planned Date [<today> ~ <today+3d>]:
  - Description (Github Issue body, 선택):

[y] 진행 / [c] 취소
```

### 4. Github Issue + Notion Task + (선택적) 브랜치 생성

`/ult-story-create`의 5단계와 동일 절차로 1개만 생성:

1. `gh issue create`
2. `mcp__notion-api__API-post-page` (Task DB) — Issue URL 즉시 채움
3. 브랜치 처리 분기:
   - **기본**: `git switch -c <topic>/<issue_num>-<slug> origin/<default_branch>`
   - **`--here`**: 브랜치 생성하지 않고 **현재 브랜치 유지** (이미 worktree에서 관련 작업 중인 경우)
   - **`--no-checkout`**: 새 브랜치 생성하되 체크아웃 안 함

### 5. 결과 안내

```
✓ Task 생성: #<num> <name>
✓ Github Issue: <url>
✓ 브랜치 체크아웃: <branch>

/issue 로 컨텍스트 확인
```

## 옵션

| 인자 | 동작 |
|---|---|
| `<story title or url>` | 해당 Story에 추가 |
| (없음) | Story 목록에서 선택 |
| `--here` | 브랜치 생성 안 함, 현재 브랜치 유지 (worktree 안에서 유용) |
| `--no-checkout` | 새 브랜치 생성하되 체크아웃 안 함 |

## 주의

- Story가 없으면 `/ult-story-create`를 권장 (Story부터 만들어줌)
- Topic 추론 자동화 가능 (Task name 기반 키워드 매칭) — 자신 없으면 항상 사용자 확인
