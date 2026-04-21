# 기존 Story에 Task 추가

기존 Notion Story에 Task 1개, GitHub Issue 1개, Issue URL 연결, 브랜치/worktree 생성을 한 번에 처리합니다.

## 실행

```bash
~/.codex/scripts/ult-task-create.sh [story-title-or-url] [--name <task>] [--topic <topic>] [--description <body>]
```

스크립트가 처리하는 것:
- Story 선택 또는 title/URL/id로 Story 조회
- 현재 GitHub 계정, repository, Week, Story의 Project relation 추론
- Task 내용으로 GitHub Issue 생성
- Notion Task 생성과 동시에 `Issue URL` 반영
- `<issue_num>-<topic>-<slug>` 브랜치/worktree 생성

## 사용 예

```
/ult:ult-task-create "다크모드 설정 추가" --name "설정 화면 토글 추가" --topic Feature
/ult:ult-task-create --story https://www.notion.so/... --name "토큰 갱신 오류 수정" --topic Fix --description "..."
/ult:ult-task-create --name "문구 정리" --here
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
