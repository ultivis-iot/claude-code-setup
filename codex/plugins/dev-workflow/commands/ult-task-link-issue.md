# Task에 GitHub Issue 연결

GitHub Issue는 있지만 Notion Task의 `Issue URL`이 비어 있어 `/ult:issue`, `/ult:ult-task-note`, `/ult:ult-task-status`가 Task를 찾지 못할 때 사용합니다.

## 실행

```bash
${WORKFLOW_SCRIPTS_DIR:-${CODEX_HOME:-$HOME/.codex}/scripts}/ult-task-link-issue.sh [issue_num|issue_url] [--task <notion_task_url>]
```

스크립트가 처리하는 것:
- Issue 번호가 없으면 현재 브랜치에서 issue number 추출
- GitHub Issue URL/title 조회
- 이미 연결된 Task가 있으면 확인
- `Issue URL`이 비어 있고 title이 매칭되는 Task를 찾아 URL 반영
- title 매칭이 애매하면 `--task <notion_task_url>`로 명시 연결

## 사용 예

```
/ult:ult-task-link-issue #234 --task https://www.notion.so/...
/ult:ult-task-link-issue https://github.com/org/repo/issues/234 --task https://www.notion.so/...
/ult:ult-task-link-issue #234 --name "Token refresh 처리"
```

## 주의

- 정상 발행 플로우에서는 Story/Task 생성 시 GitHub Issue를 만들고 Issue URL을 즉시 Task에 반영해야 합니다.
- 이 명령은 기존 데이터의 누락을 복구하는 용도입니다.
