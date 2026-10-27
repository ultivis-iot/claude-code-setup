---
allowed-tools: Bash(node:*), Bash(gh:*), Bash(git:*), Bash(cargo:*), Bash(npm:*), Bash(pnpm:*), Read, Grep, Glob, Edit, Write, Agent
description: PR의 AI 리뷰를 Ralph Loop로 반복 확인하고 반영
argument-hint: [PR번호] [--once]
---

# Review Cycle

본문만으로 기본 흐름은 수행 가능하고, 아래 문서는 판단이 애매할 때만 연다:

- `~/.claude/docs/references/review-cycle-playbook.md`
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
node ~/.claude/scripts/review-cycle-ralph-loop.mjs $ARGUMENTS
```

- bootstrap이 실행된 호출에서는 리뷰 처리, 코드 수정, commit, push를 직접 수행하지 않는다
- 이후 Ralph Loop가 `/review-cycle ... --once`를 반복 입력하면 그때 아래 단일 라운드를 수행한다
- 반복 횟수 기본값은 15회이며, 필요하면 `REVIEW_CYCLE_MAX_ITERATIONS` 환경 변수로 조정한다. 이 횟수는 리뷰를 기다리는 반복까지 포함한 상한이고, **리뷰 라운드 상한(기본 3)은 따로** 지킨다(아래 라운드 종료)
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

1. 기계 리뷰 상태를 읽는다. 기계 리뷰(`isaac-notion-bot` 의 "🤖 AI Code Review Report")는 이 도구로만 읽고 마크다운을 직접 파싱하지 않는다.

   ```bash
   node ~/.claude/scripts/review-findings.mjs status --pr <N>
   ```

   출력의 `state` 로 이번 라운드를 정한다.
   - `no_review`·`waiting`: 현재 PR HEAD 를 리뷰한 보고서가 아직 없다. 아무것도 고치지 않고 `REVIEW ROUND COMPLETE — 현재 HEAD 리뷰 대기` 를 출력한다. 이전 HEAD 의 보고서로 완료를 판단하지 않는다.
   - `legacy`: 블록 없는 예전 형식 보고서뿐이다. `needs_user` 의 지적을 참고로 사용자에게 보여 주고, 완료 증거로 쓰지 않는다.
   - `needs_user`: 자동으로 고치지 않을 지적(반증을 거치지 않았거나 partial 보고서)만 남았다. 목록을 사용자에게 보고하고 루프를 멈춘다(라운드 종료).
   - `actionable`: `to_fix` 를 이번 라운드에 처리한다. `reopened` 가 붙은 지적은 고쳤다고 기록했는데 리뷰가 아직 남아 있다고 본 것이니 다시 확인한다.
   - `clear`: 고칠 지적이 없다. `complete` 가 `true` 면 완료다.
   - `pre_existing`(이 PR 이 만들지 않은 코드)·`rejected`(통합 단계가 오탐으로 판정)·`resolved`·`declined`(이미 틀림·의도됨·상관없음으로 기록) 는 고치지 않는다. `pre_existing` 은 아래 Story Flow 의 carryover 와 같은 방식으로 남긴다.
2. 기계 리뷰 외의 AI 리뷰(다른 bot 의 reviews, unresolved review threads)가 있으면 함께 본다
   - bot 계정이거나 AI 리뷰 헤더/패턴이 명확한 항목만 대상으로 본다
   - unresolved thread만 보고, 이미 해결된 thread는 제외한다
3. 항목을 아래 다섯 분류로 나눈다. 한 지적의 `locations` 가 여러 곳이면 같은 원인이므로 모든 위치를 한 번에 고친다
   - 실제 버그
   - 유효한 개선
   - 범위 밖 설계 개선
   - 반복 지적
   - 오탐
4. PR 코멘트로 이번 라운드의 반영/미반영 계획을 남긴다. 기계 리뷰 지적은 `id` 를 함께 적는다
5. 반영 항목만 수정한다
6. 프로젝트에 맞는 검증 명령을 실행한다
7. commit + push 한다
8. 기계 리뷰 지적마다 처리 결과를 기록한다. 이 기록으로 같은 지적을 다시 고치지 않고, 오탐률을 센다.

   ```bash
   node ~/.claude/scripts/review-findings.mjs record --pr <N> --id <id> --decision fixed --reason "<무엇을 고쳤는지>" --commit <sha>
   node ~/.claude/scripts/review-findings.mjs record --pr <N> --id <id> --decision wrong|intentional|irrelevant --reason "<근거>"
   ```

   - `fixed`: 고쳤다. 다음 리뷰가 그 지적을 `resolved` 로 판정하는지 확인한다
   - `wrong`: 오탐(코드가 그 실패를 막는다는 근거와 함께)
   - `intentional`: 의도된 동작(PR 본문·문서의 근거와 함께)
   - `irrelevant`: 맞지만 이 PR 에서 고칠 가치가 낮다
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

- `status` 의 `complete` 가 `true` 일 때만 완료로 본다. 현재 HEAD 의 complete 보고서에 고칠 지적이 없고 checks 가 모두 통과한 상태다
- 다른 AI 리뷰도 신규 actionable 항목이 없어야 한다. 반복 지적/설명 완료 항목만 남은 경우는 완료로 본다
- 수정, 코멘트, commit, push를 수행했다면 다음 리뷰가 필요하므로 완료로 보지 않는다
- **라운드 상한**: `round_cap_reached` 가 `true`(기계 리뷰 3번째 라운드 이상)면 더 고치지 않는다. 남은 지적, 현재 HEAD, 리뷰 라운드를 정리해 사용자에게 "접근 재검토 필요"로 보고하고 루프를 멈춘다. 수정-리뷰를 계속 반복하면 리뷰어가 이전부터 있던 코드의 문제를 하나씩 더 찾아낼 뿐 수렴하지 않는다
- `needs_user`·라운드 상한으로 멈출 때는 완료 신호를 내지 않고 아래 명령으로 Ralph Loop 를 멈춘다

  ```bash
  node ~/.claude/scripts/review-findings.mjs stop-loop
  ```

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
