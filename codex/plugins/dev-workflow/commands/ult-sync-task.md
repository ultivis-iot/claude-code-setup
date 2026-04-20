---
allowed-tools: Bash(git:*), Bash(gh:*), Read, Grep, Glob, Write
description: 현재 Task를 Notion/GitHub 컨텍스트와 동기화. 메모 추가, 상태 변경, 이슈 컨텍스트 확인을 하나의 진입점으로 제공
argument-hint: [note-or-action]
---

# Task 동기화

사용자가 현재 Task 정보를 동기화하거나 맥락을 업데이트하려 할 때 사용하는 단일 진입점.

## 선택 규칙

1. 인자가 없으면:
   - `/issue`와 동일하게 현재 브랜치의 Issue + Task 컨텍스트를 보여준다.

2. 인자가 `cancel`, `reopen`, `todo`, `in-progress`, `done` 중 하나면:
   - `/ult-task-status`와 동일하게 현재 Task 상태를 갱신한다.

3. 그 외 자유 텍스트가 들어오면:
   - `/ult-task-note`와 동일하게 현재 Task에 메모 코멘트를 추가한다.

## 출력

- 어떤 동기화 동작을 수행했는지 먼저 명시한다.
- 변경된 Task 상태나 추가된 메모를 마지막에 요약한다.
