---
allowed-tools: Bash(git:*), Bash(gh:*), Read, Grep, Glob, Write, Task
description: 작업 마무리 진입점. 검증 상태를 확인하고 필요 시 검증 후 PR 생성까지 이어감
argument-hint: [directory] [commit-message]
---

# 작업 마무리

사용자가 "끝내자", "PR까지 마저 해줘"처럼 작업 종료 관점으로 요청할 때 사용하는 명령.

## 선택 규칙

1. `<directory>/tmp/validation-status.json`이 없거나 오래되었으면:
   - `/commit-and-verify`와 동일한 절차를 먼저 수행한다.

2. 검증 결과가 PR 가능 상태면:
   - `/create-pr`와 동일한 절차로 push 및 PR 생성을 진행한다.

3. 검증 실패 항목이 있으면:
   - PR 생성은 중단하고 실패 원인과 다음 수정 지점을 안내한다.

## 출력

- 검증 재실행 여부
- 최종 검증 상태
- PR 생성 여부 또는 중단 사유
