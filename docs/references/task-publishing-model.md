# Task Publishing Model

`/ult-story-create`나 `/ult-task-create`에서 Story/Task/Issue 관계가 헷갈릴 때만 보는 문서.

핵심 관계:

- `Story`는 여러 `Task`를 묶는 상위 단위
- `Task 1개 = GitHub Issue 1개`
- 필요하면 각 Issue 기준으로 브랜치/worktree를 만든다

명령 선택 기준:

- 새 Story가 필요하면 `/ult-story-create`
- 기존 Story에 Task 1개를 추가하면 `/ult-task-create`
- 현재 Task에 메모만 남기면 `/ult-task-note`

`/ult-story-create` 최소 출력 spec:

```json
{
  "github_repo": "owner/name",
  "story": {
    "title": "...",
    "tag": "Feature|Update|Refactor|Bug",
    "priority": "High|Medium|Low",
    "project_id": "uuid",
    "assignee_notion_id": "uuid",
    "body_markdown": "..."
  },
  "tasks": [
    {
      "name": "...",
      "topic": "Feature|Fix|Update|Refactor|Style|Other",
      "description": "...",
      "planned_start": "YYYY-MM-DD",
      "planned_end": "YYYY-MM-DD",
      "repository_id": "uuid",
      "week_id": "uuid"
    }
  ]
}
```

`/ult-story-create`의 LLM 책임:

- Plan을 읽고 Story 1개와 Task N개로 분해
- Story tag/priority와 Task topic을 추론
- Project 후보를 사용자에게 제시하고 선택받음
- 위 JSON spec만 확정하면 실행은 `scripts/ult-story-create-exec.sh`에 위임
