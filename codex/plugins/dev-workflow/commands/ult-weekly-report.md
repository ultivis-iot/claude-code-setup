# 주간 작업 정리

본문만으로 기본 요약은 가능하고, 아래 문서는 출력 형식이 막막할 때만 연다:

- `docs/references/weekly-report-format.md`
  - 보고서 구조 예시가 필요할 때
  - 어떤 항목을 강조해야 하는지 애매할 때

## 목적

Notion Week 기간 기준으로 작업을 집계하고, LLM이 마크다운 주간 보고서로 요약한 뒤 발행 여부를 사용자에게 확인받는다.

## 책임 분리

- 데이터 수집: `${WORKFLOW_SCRIPTS_DIR:-${CODEX_HOME:-$HOME/.codex}/scripts}/ult-weekly-collect.sh`
- 요약 작성: 이 명령
- 발행: `${WORKFLOW_SCRIPTS_DIR:-${CODEX_HOME:-$HOME/.codex}/scripts}/ult-weekly-publish.sh`

## 수행 절차

1. `${WORKFLOW_SCRIPTS_DIR:-${CODEX_HOME:-$HOME/.codex}/scripts}/ult-weekly-collect.sh`로 주간 데이터를 JSON으로 수집한다
   - 수집 실패 시 발행 단계로 가지 않고 즉시 중단한다
2. JSON을 읽고 아래 내용을 중심으로 요약한다
   - 완료/진행 현황
   - Project 또는 Story별 주요 작업
   - 지연/과투입/정체 이슈
   - 필요한 메모/결정사항
3. 마크다운 보고서를 사용자에게 보여준다
4. 사용자 액션을 받는다
   - `s`: Notion 발행
   - `c`: 클립보드 복사
   - Enter: 종료

발행 시 제목과 기준 날짜는 수집된 week 범위를 사용한다.

## 옵션

- 기본: 이번 주, 본인
- `--week <YYYY-MM-DD>`: 해당 날짜 포함 주
- `--team`: 팀 전체

reference를 안 열어도 되는 경우:

- JSON을 읽고 주간 요약을 쓰는 일반 케이스
