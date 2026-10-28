---
allowed-tools: Bash(git:*), Bash(node:*), Task, Read, Grep, Glob, Write
description: 현재 커밋의 의도와 품질을 검증하고 스냅샷에 연결된 결과를 생성
argument-hint: [directory] [commit-message]
---

# Commit And Verify

입력은 `$ARGUMENTS`다. 첫 인자가 디렉터리면 대상으로 사용하고 나머지는 커밋 메시지로 해석한다. 아니면 현재 디렉터리를 사용한다.

실행 전에 `~/.codex/docs/references/validation-contract.md`를 읽고 그 절차를 따른다.
설정 저장소(claude-code-setup)를 검증할 때도 설치본(`~/.claude`)의 계약·실행기·검증 agent 정의를 쓴다. 저장소의 사본은 리뷰 대상이며, 바꾼 브랜치가 자기 실행기로 검증받지 않게 하기 위해서다(저장소 사본은 `scripts/verify-workflow.sh` 테스트에서만 쓴다).

완료 기준은 실행기의 `ready` 성공이다. 결과 파일 생성만으로 완료를 선언하지 않는다.
실패 시 validator 상태·근거·수정 지점을 보고한다. 이 명령은 PR을 생성하지 않는다.
