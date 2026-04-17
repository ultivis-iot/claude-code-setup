# 현재 브랜치의 작업 컨텍스트 확인

현재 git 브랜치에서 이슈 번호를 추출하고, **GitHub 이슈 + Notion Task/Story/Project** 정보를 함께 보여줍니다.

## 데이터 소스

- **Github**: `gh` CLI
- **Task DB**: `b89060b1-037c-480d-8671-f206aec117b6`
- **Story DB**: `338b9757-d10f-462f-92c9-4777cb747c78`
- **Project DB**: `0848664d-6ecf-441e-b3d5-6b1f4fd540f8`

## 실행

### 1. Github 이슈 조회

```bash
~/.claude/scripts/issue.sh
```

→ `브랜치`, `이슈 번호`, `gh issue view` JSON 출력.

### 2. Notion Task 조회

`mcp__notion-api__API-query-data-source` (Task DB)로 `Issue Number` formula 필드가 1단계의 이슈 번호와 일치하는 Task 검색:

```json
{
  "data_source_id": "b89060b1-037c-480d-8671-f206aec117b6",
  "filter": {
    "property": "Issue Number",
    "formula": {"string": {"equals": "<ISSUE_NUM>"}}
  },
  "page_size": 1
}
```

매치 없으면 Notion 섹션 생략하고 Github 정보만 출력.

### 3. Story / Project 조회

Task에서 다음 relation 추출:
- `📜 Story` → `mcp__notion-api__API-retrieve-a-page`로 Story 페이지 가져오기
- `🛡️ Project` → 같은 방식

Story에서 가져올 필드: Title, Tag, Priority, Status, Work Progress
Project에서 가져올 필드: Title, Manager, Project Duration, Status, Work Progress

### 4. 출력 형식

```
### Issue #<번호>: <제목>

- **상태**: <open/closed>
- **브랜치**: <branch>
- **URL**: <github_url>
- **작성자**: <author>
- **라벨**: <labels>
- **담당자**: <assignees>

#### 본문
<body>

---

### 📋 Notion Task

- **이름**: <task_name>
- **상태**: <task_status>
- **Topic**: <topic>
- **Repository**: <repository>
- **Planned Date**: <planned_date_range>
- **Working Time**: <working_time>h (계획 <planned_time>h, On Time Rate <rate>%)
- **First Commit**: <first_commit_date>
- **Last Commit**: <last_commit_date>

#### 📜 Story: <story_title>
- **Tag**: <tag>
- **Priority**: <priority>
- **Status**: <status>
- **Work Progress**: <progress>% (이 Story 내 다른 Task 진행도 합산)

#### 🛡️ Project: <project_title>
- **Manager**: <manager>
- **Duration**: <duration>
- **Status**: <status>
- **Work Progress**: <progress>%

---

#### 코멘트 (Github)
시간순 정리:
- **<author>** (<date>): <body>
```

### 5. 컨텍스트 안내

마지막에 한 줄 요약 추가:
```
이 작업은 [<Project>] 의 [<Story>] 일부로, 마감 D-<n>일입니다.
```

## 주의

- mcp__notion-api__* 도구가 로드되어 있어야 함 (없으면 ToolSearch로 로드)
- Task가 Notion에 없으면 Github 정보만 출력
- Issue Number formula는 Task의 Issue URL이 채워졌을 때만 작동
