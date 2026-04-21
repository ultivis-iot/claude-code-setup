---
allowed-tools: Bash(git:*), Bash(gh:*), Read, Grep, Glob, Write
description: 현재 Task를 Notion/GitHub 컨텍스트와 동기화. 메모 추가, 상태 변경, 이슈 컨텍스트 확인을 하나의 진입점으로 제공
argument-hint: [note-or-action]
---

# Task 동기화

현재 Task 컨텍스트 확인, 상태 변경, 메모 추가를 하나의 스크립트로 처리합니다.

## 실행

```bash
~/.claude/scripts/ult-sync-task.sh [note-or-action]
```

동작:
- 인자 없음 → `issue.sh`로 Issue + Notion 컨텍스트 출력
- `cancel`, `reopen`, `todo`, `in-progress`, `done` → Task 상태 변경
- 그 외 텍스트 → 현재 Task에 Notion 코멘트 추가
