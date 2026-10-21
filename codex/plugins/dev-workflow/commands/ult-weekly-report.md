---
allowed-tools: Bash(git:*), Bash(gh:*), Bash(node:*), Read, Write, AskUserQuestion
description: Notion Week 기간의 작업을 집계해 Weekly Review 초안을 만들고 발행 여부를 확인받음
argument-hint: [week] [--publish]
---

# 주간 작업 정리

본문만으로 기본 요약은 가능하고, 아래 문서는 출력 형식이 막막할 때만 연다:

- `~/.codex/docs/references/weekly-report-format.md`
  - 보고서 구조 예시가 필요할 때
  - 어떤 항목을 강조해야 하는지 애매할 때

인자: `$ARGUMENTS` (`[week 날짜] [--team] [--publish]`)

## 목적

Notion Week 기간 기준으로 작업을 집계하고, LLM이 Weekly Review 초안으로 정리한 뒤 발행 여부를 사용자에게 확인받는다.

## 책임 분리

- 데이터 수집: `node ~/.codex/scripts/ult-notion.mjs weekly-collect`
- 리뷰 작성: 이 명령 (LLM)
- 발행: `node ~/.codex/scripts/ult-notion.mjs weekly-publish`

## 기본 원칙

- 이 명령은 리뷰/초안 작성까지만 한다. 사용자가 명시적으로 `publish` 또는 Notion 페이지 생성을 요청하기 전에는 발행하지 않는다
- 기본 대상은 직전 Week다. Week DB에서 현재 Week를 찾은 뒤 `DateFrom` 기준 바로 이전 Week를 선택한다
- 사용자가 특정 Project 리뷰를 명시하지 않으면 Project로 필터링하지 않고, 해당 Week에 본인에게 할당된 전체 Task를 대상으로 한다

## 수행 절차

1. 직전 Week 의 `DateFrom` 을 구한다. `weekly-collect` 를 한 번 실행해 현재 Week 의 `week.date_from` 을 얻고, 그 7일 전 날짜로 다시 실행하면 직전 Week 데이터가 나온다.
   ```bash
   node ~/.codex/scripts/ult-notion.mjs weekly-collect --week <직전 Week의 DateFrom>
   ```
   - 수집 실패(`{"error": ...}`) 시 발행 단계로 가지 않고 즉시 중단한다
2. JSON을 읽고 Weekly Review `마케팅` 템플릿 형식으로 정리한다
   - `새로 추가된 기능`: 사용자에게 의미 있는 기능/신규 항목만
   - `기타 업데이트 내용`: 사용자 체감 수정, 업데이트, 리팩토링, UX 개선, 운영 변경. 통계로 채우지 않는다
   - `Task 보기`: 템플릿의 linked database/view 영역. 사용자가 요청하지 않으면 Task 목록을 본문에 중복 나열하지 않는다
   - 여러 Project가 섞이면 가독성에 도움이 될 때만 Project별로 묶는다
3. 마크다운 초안을 사용자에게 보여준다
4. 사용자 액션을 받는다
   - `s` 또는 `publish`: Notion 발행
   - `c`: 클립보드 복사용 텍스트 출력
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
- 제목을 따로 주지 않으면 `weekly-publish` 가 위 규칙으로 만든다

## 발행

- 사용자가 명시적으로 발행을 요청한 경우에만 `weekly-publish` 를 사용한다. 마크다운은 표준입력으로 넘긴다.
  ```bash
  node ~/.codex/scripts/ult-notion.mjs weekly-publish <YYYY-MM-DD> [--project <Project name|page id|URL>] <<'MD'
  ## 새로 추가된 기능
  - ...
  MD
  ```
  (Windows PowerShell 처럼 heredoc 이 없는 환경에서는 `tmp/weekly.md` 에 Write 한 뒤 `node ... weekly-publish <날짜> < tmp/weekly.md` 로 넘긴다.)
- 첫 번째 위치 인자는 Weekly Review 가 속할 Week 를 정하는 날짜(`YYYY-MM-DD`)다. 제목을 직접 정하려면 `weekly-publish "<제목>" <날짜>` 순서로 쓴다.
- 기본 템플릿은 `마케팅`이고, Project가 템플릿 기본값과 다르면 `--project <Project name|Notion page id|URL>`을 쓴다
- 다른 Weekly Review 템플릿으로 발행할 때만 `--template <이름|template id>`을 쓴다
- `Task 보기`의 linked database 필터는 Notion 템플릿/뷰 소관이다. 현재 Notion API 도구는 페이지 생성과 `❤️‍🔥 Week`/`🛡️ Project` relation 설정까지만 가능하고, linked view 필터 수정은 현재 환경에서 검증되기 전에는 가능하다고 안내하지 않는다

## 옵션

수집 (`weekly-collect`):

- 기본: 오늘이 속한 주, 본인 (이 명령의 기본 대상은 직전 주이므로 위 절차대로 `--week` 를 준다)
- `--week <YYYY-MM-DD>`: 해당 날짜 포함 주
- `--team`: 팀 전체

발행 (`weekly-publish`):

- 마크다운은 표준입력으로 넘긴다
- `--project <name|page id|URL>`: Weekly Review의 `🛡️ Project` relation
- `--template <이름|template id>`: 기본 `마케팅`. 세 번째 위치 인자로도 지정 가능

reference를 안 열어도 되는 경우:

- JSON을 읽고 주간 리뷰를 쓰는 일반 케이스
