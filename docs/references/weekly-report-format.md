# Weekly Report Format

`/ult-weekly-report`의 보고서 구조 예시가 필요할 때만 보는 문서.

입력:

- 전역 `ult-weekly-collect.sh`가 JSON 출력
- 기본: 직전 주, 본인 (Week DB에서 현재 Week를 찾아 `DateFrom` 기준 바로 이전 Week 사용)
- 옵션: `--week <YYYY-MM-DD>`, `--team`

수집 JSON 핵심 필드:

- `week`
- `user`
- `team_mode`
- `stats`
- `tasks`

LLM 출력 목표:

- Weekly Review `마케팅` 템플릿 형식에 맞는 리뷰 초안
- Notion식 짧은 구 bullet, 설명형 문장 지양
- `stats`(총계/상태 분포/커밋 수 등)는 범위 판단용 내부 참고로만 사용

출력 구조 (`마케팅` 템플릿):

1. `새로 추가된 기능` — 사용자에게 의미 있는 기능/신규 항목만
2. `기타 업데이트 내용` — 사용자 체감 수정, 업데이트, 리팩토링, UX 개선, 운영 변경
3. `Task 보기` — 템플릿의 linked database/view 영역. 본문에 Task 목록을 중복 나열하지 않음

제목 규칙:

- Project별: `<ProjectShort>-YY-MM-WW` (예: `CRM-26-05-03`)
- 전체: `Weekly-YY-MM-WW`
- `WW`는 Week DB `DateFrom` 날짜의 월중 주차

후속 액션:

- `s` 또는 `publish`: 전역 `ult-weekly-publish.sh`로 발행 (기본 템플릿 `마케팅`, 필요 시 `--project`)
- `c`: 클립보드 복사
- Enter: 종료
