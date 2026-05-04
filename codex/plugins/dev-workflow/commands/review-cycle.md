---
allowed-tools: Bash(${HOME}/.codex/scripts/review-cycle-ralph-loop.sh:*), Bash(gh:*), Bash(git:*), Bash(cargo:*), Bash(npm:*), Bash(pnpm:*), Read, Grep, Glob, Edit, Write, Agent
description: PR의 AI 리뷰를 Ralph Loop로 반복 확인하고 반영
argument-hint: [PR번호] [--once]
---

# Review Cycle

본문만으로 기본 흐름은 수행 가능하고, 아래 문서는 판단이 애매할 때만 연다:

- `docs/references/review-cycle-playbook.md`
  - 리뷰 분류 기준을 다시 보고 싶을 때
  - 완료 판단이나 중복 방지 규칙이 헷갈릴 때

## 입력

입력: `$ARGUMENTS`

- `/review-cycle 23` → Ralph Loop로 PR #23 review-cycle 자동 반복
- `/review-cycle` → Ralph Loop로 현재 브랜치 PR 자동 감지 후 자동 반복
- `/review-cycle 23 --once` → Ralph Loop 내부에서 실행되는 단일 라운드
- PR 번호는 양의 정수만 허용

## 자동 루프 부트스트랩

`$ARGUMENTS`에 `--once`가 없으면 이 명령은 직접 리뷰를 처리하지 않는다. 먼저 아래 bootstrap을 실행해 Ralph Loop를 시작하고, 반복 prompt는 `/review-cycle ... --once`로 설정한다.

```!
"${HOME}/.codex/scripts/review-cycle-ralph-loop.sh" $ARGUMENTS
```

- bootstrap이 실행된 호출에서는 리뷰 처리, 코드 수정, commit, push를 직접 수행하지 않는다
- 이후 Ralph Loop가 `/review-cycle ... --once`를 반복 입력하면 그때 아래 단일 라운드를 수행한다
- 반복 횟수 기본값은 15회이며, 필요하면 `REVIEW_CYCLE_MAX_ITERATIONS` 환경 변수로 조정한다
- Ralph Loop 완료 신호는 반드시 `<promise>REVIEW COMPLETE</promise>` 형식으로 출력한다

## 핵심 규칙

- `gh` 명령은 항상 순차적으로 단독 실행한다
- 반영/미반영 판단을 먼저 코멘트로 남긴다
- 범위를 넘는 리팩터는 이번 PR에서 하지 않는다
- `--once` 라운드만 실제 리뷰 처리를 수행한다
- 사용자가 `/review-cycle`을 직접 실행하면 Ralph Loop가 자동으로 `/review-cycle ... --once`를 반복 실행해야 한다
- 수정/코멘트/푸시를 수행한 라운드에서는 `<promise>REVIEW COMPLETE</promise>`를 출력하지 않는다
- Story 기반 작업에서도 review-cycle은 Task PR마다 수행한다
- Task PR의 base는 `dev` 또는 repository default branch다

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
9. 라운드 결과를 출력하고 종료한다

## Story Flow 규칙

- Task PR은 AI 리뷰/CI가 clear될 때까지 반복한 뒤 `dev` 또는 repository default branch로 merge한다.
- 모든 Task PR이 merge된 뒤 Story 단위 통합 검증을 수행한다. 별도 Story PR은 만들지 않는다.
- Task PR 리뷰가 Story 전체 설계나 다른 Task 범위에 해당하면 Task PR에서 확장하지 않고 `tmp/story-handoff.md`와 Notion Story comment에 carryover로 기록한다.
- Task PR merge 후 dependent Task를 시작하기 전에 Story handoff를 갱신한다.

## 검증 명령 선택

- Rust: `cargo clippy --workspace && cargo test --workspace --lib`
- Node: `npm run lint && npm test`
- pnpm workspace: 프로젝트 스크립트 우선
- 기타: 프로젝트 문서 또는 CI 설정 기준

빌드 명령을 찾지 못하면 경고 후 중단하고 사용자에게 확인을 요청한다.

push 실패 시 한 번은 rebase 후 재시도하고, 다시 실패하면 중단한다.

## 라운드 종료

- 신규 actionable 리뷰가 없고 CI/checks가 clear면 완료로 본다
- 반복 지적/설명 완료 항목만 남아도 완료로 본다
- 수정, 코멘트, commit, push를 수행했다면 다음 리뷰가 필요하므로 완료로 보지 않는다

완료 메시지는 아래 한 줄만 출력한다:

```text
<promise>REVIEW COMPLETE</promise>
```

다음 라운드가 필요한 경우:

```text
REVIEW ROUND COMPLETE — N건 처리, 새 리뷰 확인 필요
```

reference를 안 열어도 되는 경우:

- 최신 AI 리뷰를 읽고 반영 가능한 항목을 처리하는 일반 라운드
- 완료 기준이 단순한 케이스
