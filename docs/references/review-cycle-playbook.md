# Review Cycle Playbook

`/review-cycle`에서 리뷰 분류나 완료 판단이 애매할 때만 보는 문서.

핵심 원칙:

- `gh` 명령은 반드시 순차적으로 단독 실행
- 먼저 반영/미반영 판단을 남기고, 그 다음 코드 수정
- PR 범위를 넘는 리팩터는 이번 사이클에서 하지 않음

리뷰 분류:

- 실제 버그
- 유효한 개선
- 범위 밖 설계 개선
- 반복 지적
- 오탐

기본 라운드:

1. PR 상태, 최신 AI 리뷰, review thread 확인
2. 신규 actionable 항목 분류
3. PR 코멘트로 반영 계획 작성
4. 필요한 코드 수정
5. 프로젝트 검증
6. commit + push
7. 마지막 처리 리뷰를 기록하고 라운드 종료

자동 반복:

- 사용자는 `/review-cycle [PR번호]`만 실행한다
- `/review-cycle` 기본 호출은 Ralph Loop를 자동으로 시작하고, 반복 prompt를 `/review-cycle [PR번호] --once`로 설정한다
- `/review-cycle --once`만 한 라운드를 처리한다
- 수정/코멘트/푸시를 수행한 라운드에서는 `<promise>REVIEW COMPLETE</promise>`를 출력하지 않음
- 신규 actionable 리뷰가 없고 CI/checks가 clear일 때만 `<promise>REVIEW COMPLETE</promise>`를 출력해 Ralph Loop를 종료한다

기계 리뷰 읽기:

- `node ~/.claude/scripts/review-findings.mjs status --pr <N>` 의 `state` 로 라운드를 정한다. 마크다운을 직접 파싱하지 않는다
- 현재 PR HEAD 를 리뷰한 보고서만 완료 증거다. 이전 HEAD 보고서(`waiting`)나 블록 없는 예전 보고서(`legacy`)는 아니다
- 자동으로 고치는 것은 `to_fix`(반증을 거친 지적)뿐이다. 기존 코드(`pre_existing`), 오탐 판정(`rejected`), 해결됨, 이미 기록한 판단(`declined`)은 고치지 않는다

완료 조건:

- `status` 의 `complete: true`(현재 HEAD 의 complete 보고서, 고칠 지적 없음, checks 통과)
- 다른 AI 리뷰는 신규 actionable 리뷰가 없거나 반복 지적만 남음

멈추는 조건(완료 아님):

- `needs_user`: 자동으로 고치지 않을 지적만 남음 → 사용자에게 보고
- `round_cap_reached`: 기계 리뷰 3번째 라운드 → 접근 재검토 필요로 보고. 수정-리뷰 반복은 리뷰어가 이전부터 있던 문제를 하나씩 더 찾아낼 뿐 수렴하지 않는다
- 멈출 때는 `review-findings.mjs stop-loop` 로 Ralph Loop 를 끝낸다

중복 방지:

- 지적마다 `review-findings.mjs record` 로 처리 결과(`fixed`·`wrong`·`intentional`·`irrelevant`)를 남긴다. 기록은 `tmp/review-findings-{PR}.json`
- 틀림·의도됨·상관없음으로 기록한 지적은 id 나 별칭으로 다시 나와도 건너뛴다. 고쳤다고 기록했는데 다시 나오면 `reopened` 로 다시 확인한다
