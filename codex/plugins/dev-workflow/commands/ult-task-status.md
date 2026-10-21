---
allowed-tools: Bash(git:*), Bash(gh:*), Bash(node:*), Read, AskUserQuestion
description: Notion Task 상태를 수동으로 전이. n8n이 자동 처리하지 못하는 비정형 전이에만 사용
argument-hint: [status] [--reason <사유>]
---

# Task 상태 변경

n8n이 자동 처리하지 못하는 비정형 상태 전이를 수동으로 적용합니다.

## 자동 처리되는 전이 (n8n) — 이 스킬 불필요

| 트리거 | 전이 |
|---|---|
| 브랜치 생성 | 시작 전 → 진행 중 |
| PR merged | * → 완료 |
| PR closed (not merged) | * → 미완료 |

## 이 스킬이 필요한 경우

- **취소**: 작업이 더 이상 필요 없음
- **재개**: 미완료/취소된 Task를 다시 진행
- **강제 전환**: 디버깅/실수 복구

## 실행

```bash
node ~/.codex/scripts/ult-notion.mjs task-status [<issue_num>] [<action>] [--reason "<사유>"]
```

인자: `$ARGUMENTS`

- action 이 없으면 현재 Task 와 전이 옵션이 출력되고 오류로 끝난다. 그 출력으로 AskUserQuestion 을 해서 action 을 받은 뒤 다시 실행한다. 사유는 사용자에게 한 번 묻고 있으면 `--reason` 으로 넘긴다.

### 사용 예

```
/ult-task-status                 # 현재 브랜치 Task, 옵션 확인 후 선택
/ult-task-status #234 cancel     # Task #234 미완료 처리
/ult-task-status #234 reopen     # 시작 전으로 되돌림
/ult-task-status #234 in-progress
/ult-task-status #234 done --reason "수동 확인 완료"
```

### action 매핑

| action | 새 상태 |
|---|---|
| `cancel` | 미완료 |
| `reopen`, `todo` | 시작 전 |
| `in-progress` | 진행 중 |
| `done` | 완료 |

## 동작

1. Issue 번호 → Issue URL → 정확히 일치하는 Notion Task 검색
2. 검색 실패 시 title 매칭으로 Issue URL 자동 연결 시도
3. 현재 상태 표시 + 전이 선택
4. Status 속성 업데이트
5. `[<이름>] 상태 변경: <old> → <new>` 코멘트 추가 (사유 포함 가능)

## 주의

- 자주 사용해야 하면 n8n 자동화 검토 필요
- Status 옵션이 DB에서 변경되면 스크립트의 action → status 매핑 갱신 필요
