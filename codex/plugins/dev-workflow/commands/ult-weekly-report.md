# 주간 작업 정리

본문만으로 기본 요약은 가능하고, 아래 문서는 출력 형식이 막막할 때만 연다:

- `docs/references/weekly-report-format.md`
  - 보고서 구조 예시가 필요할 때
  - 어떤 항목을 강조해야 하는지 애매할 때

## 목적

Notion Week 기간 기준으로 작업을 집계하고, LLM이 Weekly Review 초안으로 정리한 뒤 발행 여부를 사용자에게 확인받는다.

## 책임 분리

- 데이터 수집: `${WORKFLOW_SCRIPTS_DIR:-${CODEX_HOME:-$HOME/.codex}/scripts}/ult-weekly-collect.sh`
- 리뷰 작성: 이 명령
- 발행: `${WORKFLOW_SCRIPTS_DIR:-${CODEX_HOME:-$HOME/.codex}/scripts}/ult-weekly-publish.sh`

## 기본 원칙

- 이 명령은 리뷰/초안 작성까지만 한다. 사용자가 명시적으로 `publish` 또는 Notion 페이지 생성을 요청하기 전에는 발행하지 않는다
- 기본 대상은 직전 Week다. Week DB에서 현재 Week를 찾은 뒤 `DateFrom` 기준 바로 이전 Week를 선택한다
- 사용자가 특정 Project 리뷰를 명시하지 않으면 Project로 필터링하지 않고, 해당 Week에 본인에게 할당된 전체 Task를 대상으로 한다

## 수행 절차

1. `${WORKFLOW_SCRIPTS_DIR:-${CODEX_HOME:-$HOME/.codex}/scripts}/ult-weekly-collect.sh --week <직전 Week의 DateFrom>`으로 주간 데이터를 JSON으로 수집한다
   - 수집 실패 시 발행 단계로 가지 않고 즉시 중단한다
2. JSON을 읽고 Weekly Review `마케팅` 템플릿 형식으로 정리한다
   - `새로 추가된 기능`: 사용자에게 의미 있는 기능/신규 항목만
   - `기타 업데이트 내용`: 사용자 체감 수정, 업데이트, 리팩토링, UX 개선, 운영 변경. 통계로 채우지 않는다
   - `Task 보기`: 템플릿의 linked database/view 영역. 사용자가 요청하지 않으면 Task 목록을 본문에 중복 나열하지 않는다
   - 여러 Project가 섞이면 가독성에 도움이 될 때만 Project별로 묶는다
3. 마크다운 초안을 사용자에게 보여준다
4. 사용자 액션을 받는다
   - `s` 또는 `publish`: Notion 발행
   - `c`: 클립보드 복사
   - Enter: 종료

## 작성 규칙

- 총계, 상태 분포, 커밋 수, 토픽 수는 범위 판단용 내부 참고로만 쓰고, 사용자가 명시적으로 요구하지 않으면 보고서에 넣지 않는다
- bullet은 Notion식 짧은 구 위주로 쓴다. 설명형 문장을 피한다
- 후속/지연 항목은 완료나 다음 주 액션에 영향을 줄 때만 포함한다

## 제목 규칙

- Project별 리뷰: `<ProjectShort>-YY-MM-WW`
  - `ProjectShort`는 선택한 Project에서, `WW`는 Week DB `DateFrom` 날짜의 월중 주차
  - 예: Project `Ultivis CRM` + Week `2026-05-18 ~ 2026-05-24` → `CRM-26-05-03`
- 여러 Project를 아우르는 전체 리뷰: `Weekly-YY-MM-WW`

## 발행

- 사용자가 명시적으로 발행을 요청한 경우에만 `${WORKFLOW_SCRIPTS_DIR:-${CODEX_HOME:-$HOME/.codex}/scripts}/ult-weekly-publish.sh`를 사용한다
- 기본 템플릿은 `마케팅`이고, Project가 템플릿 기본값과 다르면 `--project <Project name|Notion page id|URL>`을 쓴다
- `Task 보기`의 linked database 필터는 Notion 템플릿/뷰 소관이다. 현재 Notion API 도구는 페이지 생성과 `❤️‍🔥 Week`/`🛡️ Project` relation 설정까지만 가능하고, linked view 필터 수정은 현재 환경에서 검증되기 전에는 가능하다고 안내하지 않는다

## 옵션

- 기본: 직전 주, 본인
- `--week <YYYY-MM-DD>`: 해당 날짜 포함 주
- `--team`: 팀 전체

reference를 안 열어도 되는 경우:

- JSON을 읽고 주간 리뷰를 쓰는 일반 케이스
