---
allowed-tools: Bash(gh:*), Bash(git:*), Bash(cargo:*), Bash(npm:*), Bash(pnpm:*), Read, Grep, Glob, Edit, Write, Agent
description: PR AI 리뷰 확인 → 분석 → 반영/코멘트/이슈 생성 → 커밋+push 사이클
argument-hint: [PR번호]
---

# PR 리뷰 반영 사이클

PR의 AI 리뷰를 확인하고 반영하는 자동화 사이클.

**단독 실행**: `/review-cycle 23` — 최신 리뷰 1건 처리 후 종료
**자동 반복**: `/ralph-loop /review-cycle $ARGUMENTS --completion-promise "REVIEW COMPLETE" --max-iterations 15`

## 인자 파싱

입력: `$ARGUMENTS`

- `/review-cycle 23` → PR #23
- `/review-cycle` → 현재 브랜치의 PR 자동 감지 (`gh pr view --json number`)

## 실행 모드

| 모드 | 대기 | 반복 |
|------|------|------|
| **단독** (`/review-cycle 23`) | 없음 — 최신 리뷰 1건 처리 후 즉시 종료 | 사용자가 수동 재호출 |
| **Ralph Loop** (`/ralph-loop /review-cycle 23 ...`) | ralph-loop이 외부에서 제어 | 자동 반복, promise 감지 시 종료 |

## 사이클

### 1. 상태 확인

```bash
gh pr checks <PR>                                              # CI 통과 확인
gh pr view <PR> --json comments --jq '.comments[-1]'           # 일반 코멘트 (AI 리뷰어 대부분)
gh pr view <PR> --json reviews --jq '.reviews[-1]'             # Pull Request Review
gh pr view <PR> --json reviewThreads                           # 인라인 코드 리뷰 코멘트
```

세 가지 소스를 모두 확인하여 가장 최신 항목을 기준으로 처리.
타임스탬프 비교: comments는 `createdAt`, reviews는 `submittedAt`, reviewThreads는 마지막 reply의 `createdAt` (reply 없으면 thread 자체의 `createdAt`).

**CI와 리뷰를 병렬 확인**:
- CI 실패 + 신규 리뷰 있음 → CI 수정 + 리뷰 반영 모두 처리
- CI 실패 + 신규 리뷰 없음 → CI 실패 원인만 수정 → 커밋 → push
- CI 통과 + 신규 리뷰 있음 → 리뷰 반영 처리
- CI 통과 + 신규 리뷰 없음 → 종료

**중복 리뷰 판별**:
- `tmp/last-review-id-{PR번호}.txt`에 `{source}:{comment_id}:{consecutive_count}` 형식으로 기록 (PR별 격리, 소스별 구분)
  - source: `comment`, `review`, `thread` 중 하나
- 최신 항목의 `{source}:{id}`와 비교하여 동일하면 **60초 대기 후 재확인** (리뷰 도착 대기)
- 재확인 후에도 동일하면 count 증가, 다르면 1로 리셋
- 2회 연속 동일 (count ≥ 2, 각 회차마다 60초 대기 포함) → `<promise>REVIEW COMPLETE</promise>` 출력
- 이 파일은 `.gitignore`에 추가 권장 (로컬 상태, 커밋 불필요)
- 파일이 없거나 포맷이 깨진 경우 count를 0으로 초기화하여 처리

### 2. 리뷰 분석

최신 리뷰의 각 지적을 분류:

| 분류 | 기준 | 조치 |
|------|------|------|
| **실제 버그** | panic, 데이터 손실, 보안 취약점 | 즉시 수정 |
| **유효한 개선** | 에러 처리 누락, 검증 미비, 엣지케이스 | 수정 |
| **설계 개선** | 리팩터링, 모듈 분리, 캐시 도입 등 | PR 범위 초과 시 → 이슈 생성 또는 코멘트 |
| **반복 지적** | 이전 라운드에서 이미 설명한 항목 | skip |
| **오탐** | 코드를 잘못 읽었거나 컨텍스트 부족 | 코멘트로 정정 |

### 3. 코멘트 작성

**먼저** PR 코멘트로 반영/미반영을 남김 (코드 수정 전).
N차는 PR 코멘트에서 `리뷰 반영` 패턴이 포함된 코멘트 수 + 1로 산출.

```markdown
## N차 리뷰 반영 현황

### 반영 (N건)
- **지적 요약**: 수정 내용

### 의도적 미반영 (N건, 사유)
- **지적 요약**: 미반영 사유
```

신규 지적이 전혀 없으면:
```markdown
## N차 리뷰 — 신규 지적 없음
(반복 지적 정리 테이블 포함)
```
→ 코드 수정 없이 사이클 종료

### 4. 코드 수정

"반영" 분류된 항목만 수정:

1. 코드 수정
2. 프로젝트 빌드/린트 확인 (프로젝트에 맞는 도구 사용)
   - Rust: `cargo clippy --workspace && cargo test --workspace --lib`
   - Node: `npm run lint && npm test`
   - Python: `ruff check . && pytest`
   - 기타: 프로젝트의 CLAUDE.md 또는 CI 설정 참조. 빌드 명령을 찾지 못하면 경고 후 skip하고 커밋 메시지에 `[빌드 미검증]` 표기
3. 관련 파일만 `git add` (민감 파일 제외)
4. 커밋 메시지:
   ```
   fix: N차 리뷰 반영 — 요약

   - 수정 항목 1
   - 수정 항목 2

   Co-Authored-By: Claude <noreply@anthropic.com>
   ```
5. `git push`
6. 마지막 처리한 comment ID를 `tmp/last-review-id-{PR}.txt`에 `{id}:1` 형식으로 기록

> **push 실패 시**: `git pull --rebase` 후 1회 재시도 → 재실패 시 PR 코멘트에 `[push 실패]` 표기 후 사이클 중단. 코드는 로컬에 커밋된 상태이므로 수동 push로 복구 가능.

### 5. 종료 조건

다음 중 하나를 만족하면 종료:

- 신규 지적 없음 (반복 지적만 남음)
- 모든 지적이 이전 라운드에서 설명 완료
- 3회 연속 동일 리뷰 (새 리뷰 미도착)

종료 시 출력:
```
<promise>REVIEW COMPLETE</promise>
```

## 판단 원칙

### 무조건 수정
- **CLAUDE.md 규칙 위반** — 프로젝트에서 금지한 패턴
- **실제 런타임 버그** — panic, 크래시, 데이터 손실
- **보안 취약점** — injection, path traversal, 인증 우회

### 상황 판단
- **코드 스타일/구조 개선** → PR 범위 내면 수정, 아니면 이슈 생성
- **동일 지적 3회 이상 반복** → 이전 설명 참조 안내 후 skip
- **이슈 생성 대상** → `gh issue create`로 생성 후 코멘트에 링크 포함

### 하지 않는 것
- 반영/미반영 판단 전에 코드 수정하지 않음 (코멘트 먼저)
- AI 리뷰어의 반복 지적에 무한 대응하지 않음 (3회 이상 → skip)
- PR 범위를 넘어서는 리팩터링을 이번 커밋에 포함하지 않음
