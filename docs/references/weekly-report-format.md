# Weekly Report Format

`/ult-weekly-report`의 보고서 구조 예시가 필요할 때만 보는 문서.

입력:

- 전역 `ult-weekly-collect.sh`가 JSON 출력
- 기본: 이번 주, 본인
- 옵션: `--week <YYYY-MM-DD>`, `--team`

수집 JSON 핵심 필드:

- `week`
- `user`
- `team_mode`
- `stats`
- `tasks`

LLM 출력 목표:

- 한 주의 완료/진행 현황 요약
- Project/Story 단위로 묶어 정리
- 시간 초과, 지연, 정체된 작업 식별
- 필요한 경우 메모/결정사항 요약

권장 출력 구조:

1. 기간 + 사용자
2. 전체 요약
3. Project 또는 Story별 작업 묶음
4. 이슈/리스크
5. 메모/결정사항

후속 액션:

- `s`: 전역 `ult-weekly-publish.sh`로 발행
- `c`: 클립보드 복사
- Enter: 종료
