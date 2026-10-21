---
allowed-tools: Bash(git:*), Bash(gh:*), Bash(node:*), Read, AskUserQuestion
description: Notion Task의 비어 있는 Issue URL에 GitHub Issue를 연결. Task를 찾지 못하는 다른 명령을 복구할 때 사용
argument-hint: [issue_num|issue_url] [--task <notion_task_url>]
---

# Task에 GitHub Issue 연결

GitHub Issue는 있지만 Notion Task의 `Issue URL`이 비어 있어 `/issue`, `/ult-task-note`, `/ult-task-status`가 Task를 찾지 못할 때 사용합니다.

## 실행

```bash
node ~/.codex/scripts/ult-notion.mjs task-link-issue [issue_num|issue_url] [--task <notion_task_url>]
```

인자: `$ARGUMENTS`

스크립트가 처리하는 것:
- Issue 번호가 없으면 현재 브랜치에서 issue number 추출
- GitHub Issue URL/title 조회
- 이미 연결된 Task가 있으면 확인
- `Issue URL`이 비어 있고 title이 매칭되는 Task를 찾아 URL 반영
- title 매칭이 애매하면(후보 여러 개) 후보 목록과 함께 중단한다. 사용자가 고르면 `--task <notion_task_url>`로 명시 연결

## 사용 예

```
/ult-task-link-issue #234 --task https://www.notion.so/...
/ult-task-link-issue https://github.com/org/repo/issues/234 --task https://www.notion.so/...
/ult-task-link-issue #234 --name "Token refresh 처리"
```

## 옵션

| 인자 | 동작 |
|---|---|
| `--task`, `-t` | 연결할 Notion Task page id 또는 URL |
| `--name`, `-n` | Issue title 대신 사용할 Task title 검색어 |
| `--auto` | 대화형 선택 없이 title이 유일하게 매칭될 때만 연결. 기존 Issue URL은 덮어쓰지 않고 중단 |
| `--yes`, `-y` | 기존 Issue URL 덮어쓰기 확인 생략 (이미 다른 URL이 있는 Task를 덮어쓸 때 필요) |

`/ult-task-status`, `/ult-task-note` 가 Task를 못 찾으면 내부적으로 `--auto` 와 같은 절차를 먼저 시도합니다.

## 주의

- 정상 발행 플로우에서는 Story/Task 생성 시 GitHub Issue를 만들고 Issue URL을 즉시 Task에 반영해야 합니다.
- 이 명령은 기존 데이터의 누락을 복구하는 용도입니다.
- Task 는 항상 정확한 Issue URL 로만 찾습니다. 이슈 번호만으로 추정하지 않습니다.
