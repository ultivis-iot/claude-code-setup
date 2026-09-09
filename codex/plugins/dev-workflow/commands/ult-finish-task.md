---
allowed-tools: Bash(git:*), Bash(gh:*), Bash(node:*), Read, Grep, Glob, Write, Task
description: 현재 코드의 검증 상태를 실행기로 확인하고 검증 후 PR까지 마무리
argument-hint: [directory] [commit-message]
---

# 작업 마무리

현재 요청과 브랜치의 작업을 마무리한다.

1. create-pr 계약에 따라 target ref를 갱신하고 결정한다.
2. `~/.codex/scripts/validation-gate.mjs ready`에 결과 파일·저장소·base를 전달한다.
3. 파일이 없거나 ready가 실패하면 commit-and-verify 계약으로 검증한다. 기존 커밋을 다시 만들 필요는 없다.
4. ready가 성공하면 create-pr 계약으로 push와 PR 생성을 진행한다.

상태의 오래됨 여부를 날짜나 모델 판단으로 추정하지 않는다. 실행기가 확인한 검증 결과와 PR URL 또는 실패 원인을 보고한다.
