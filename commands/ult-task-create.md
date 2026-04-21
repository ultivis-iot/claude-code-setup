# 기존 Story에 Task 추가

기존 Notion Story에 Task 1개, GitHub Issue 1개, Issue URL 연결, 브랜치/worktree 생성을 한 번에 처리합니다.

## 실행

```bash
~/.claude/scripts/ult-task-create.sh [story-title-or-url] [--name <task>] [--topic <topic>] [--description <body>]
```

스크립트가 처리하는 것:
- 현재 GitHub 계정, repository, repository에 연결된 Project, Week 조회
- Story 선택 또는 title/URL/id로 Story 조회
- Story는 현재 repository의 Project에 연결된 후보만 허용
- Task 내용으로 GitHub Issue 생성
- Notion Task 생성과 동시에 `Issue URL` 반영
- `<issue_num>-<topic>-<slug>` 브랜치/worktree 생성

## Story 선택 원칙

Story는 전역 분류가 아니라 Project 산하 작업 단위입니다.

- Story 선택 전에 현재 repository의 Notion Project를 먼저 확인합니다.
- 후보 Story는 해당 Project에 연결된 것만 유효합니다.
- 후보가 애매하면 Story를 고르거나 만들기 전에 사용자 확인을 받습니다.
- Project가 불명확하면 아무 Story나 고르지 말고 중단합니다.

## 사용 예

```
/ult-task-create "다크모드 설정 추가" --name "설정 화면 토글 추가" --topic Feature
/ult-task-create --story https://www.notion.so/... --name "토큰 갱신 오류 수정" --topic Fix --description "..."
/ult-task-create --name "문구 정리" --here
```

## 옵션

| 인자 | 동작 |
|---|---|
| `<story title or url>` | 해당 Story에 추가 |
| `--name` | Task 이름 |
| `--topic` | `Feature`, `Fix`, `Update`, `Refactor`, `Style`, `Other` |
| `--description` | GitHub Issue body 및 Task 본문 |
| `--planned-start`, `--planned-end` | Planned Date |
| `--here` | Issue/Task만 만들고 현재 브랜치 유지 |
| `--no-checkout` | worktree 없이 로컬 브랜치만 생성 |
