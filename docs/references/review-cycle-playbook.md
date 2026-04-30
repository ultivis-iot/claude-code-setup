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

- `/review-cycle`은 한 라운드만 처리
- 새 리뷰 대기와 재실행은 `/ralph-loop /review-cycle ... --completion-promise "REVIEW COMPLETE"`가 담당
- 수정/코멘트/푸시를 수행한 라운드에서는 `REVIEW COMPLETE`를 출력하지 않음

완료 조건:

- 신규 actionable 리뷰가 없고 CI/checks가 clear
- 또는 반복 지적만 남음

중복 방지:

- `tmp/last-review-id-{PR}.txt`로 마지막 처리 리뷰를 기록
