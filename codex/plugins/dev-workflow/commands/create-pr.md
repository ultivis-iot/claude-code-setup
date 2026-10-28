---
allowed-tools: Bash(git:*), Bash(gh:*), Bash(node:*), Read, Write
description: 현재 커밋에 대한 검증 게이트를 통과한 브랜치를 push하고 PR 생성
argument-hint: [directory] [-b target-branch]
---

# Create PR

입력은 `$ARGUMENTS`다. 디렉터리와 `-b <target>`을 해석한다.

실행 전에 `~/.codex/docs/references/create-pr-contract.md`를 읽고 그 절차를 따른다.
설정 저장소에서도 설치본의 계약과 실행기를 쓴다(저장소의 사본은 리뷰 대상).
검증 실행기의 `ready` 실패 시 push/PR을 수행하지 않는다.

완료 시 PR URL, 명시적으로 사용한 base, 검증한 HEAD를 보고한다.
