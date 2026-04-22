---
allowed-tools: Bash(gh:*), Bash(git:*), Bash(cargo:*), Bash(npm:*), Bash(pnpm:*), Read, Grep, Glob, Edit, Write, Agent
description: PR의 AI 리뷰를 확인하고 반영 가능한 항목을 반복 처리
argument-hint: [PR번호]
---

# Review Cycle

본문만으로 기본 루프는 수행 가능하고, 아래 문서는 판단이 애매할 때만 연다:

- `docs/references/review-cycle-playbook.md`
  - 리뷰 분류 기준을 다시 보고 싶을 때
  - 종료 조건이나 중복 방지 규칙이 헷갈릴 때

## 입력

입력: `$ARGUMENTS`

- `/review-cycle 23` → PR #23
- `/review-cycle` → 현재 브랜치 PR 자동 감지
- PR 번호는 양의 정수만 허용

## 핵심 규칙

- `gh` 명령은 항상 순차적으로 단독 실행한다
- 반영/미반영 판단을 먼저 코멘트로 남긴다
- 범위를 넘는 리팩터는 이번 PR에서 하지 않는다
- Story 기반 작업에서는 Task PR과 Story PR 모두 review-cycle을 수행한다
- Task PR의 base는 Story branch이고, Story PR의 base는 `dev`다

## 수행 절차

1. PR checks, 최신 comments, reviews, unresolved review threads를 확인한다
2. AI 리뷰만 필터링하고 최신 actionable 항목을 추린다
   - 우선순위는 comments → reviews → unresolved threads
   - bot 계정이거나 AI 리뷰 헤더/패턴이 명확한 항목만 대상으로 본다
   - unresolved thread만 보고, 이미 해결된 thread는 제외한다
3. 항목을 아래 다섯 분류로 나눈다
   - 실제 버그
   - 유효한 개선
   - 범위 밖 설계 개선
   - 반복 지적
   - 오탐
4. PR 코멘트로 이번 라운드의 반영/미반영 계획을 남긴다
5. 반영 항목만 수정한다
6. 프로젝트에 맞는 검증 명령을 실행한다
7. commit + push 한다
8. 마지막 처리 리뷰 ID를 `tmp/last-review-id-{PR}.txt`에 기록한다
9. 60초 대기 후 새 리뷰를 다시 확인한다
10. 연속 5회 새 리뷰가 없으면 종료한다

## Story Flow 규칙

- Task PR은 AI 리뷰/CI가 clear될 때까지 반복한 뒤 Story branch로 merge한다.
- Story PR은 모든 Task가 Story branch에 merge된 뒤 `dev` 대상으로 열고 다시 review-cycle을 반복한다.
- Task PR 리뷰가 Story 전체 설계나 다른 Task 범위에 해당하면 Task PR에서 확장하지 않고 `tmp/story-handoff.md`와 GitHub Story Issue에 carryover로 기록한다.
- Task PR merge 후 dependent Task를 시작하기 전에 Story handoff를 갱신한다.

## 검증 명령 선택

- Rust: `cargo clippy --workspace && cargo test --workspace --lib`
- Node: `npm run lint && npm test`
- pnpm workspace: 프로젝트 스크립트 우선
- 기타: 프로젝트 문서 또는 CI 설정 기준

빌드 명령을 찾지 못하면 경고 후 중단하고 사용자에게 확인을 요청한다.

push 실패 시 한 번은 rebase 후 재시도하고, 다시 실패하면 중단한다.

## 종료

- 신규 리뷰 없음 5회 연속
- 또는 반복 지적/설명 완료 항목만 남음

종료 메시지:

```text
REVIEW COMPLETE — N건 리뷰 처리, M회 대기 후 종료
```

reference를 안 열어도 되는 경우:

- 최신 AI 리뷰를 읽고 반영 가능한 항목을 처리하는 일반 루프
- 종료 기준이 단순한 케이스
