---
allowed-tools: Bash, Read, Grep, Glob, Write, Task, AskUserQuestion, mcp__claude-in-chrome__tabs_context_mcp, mcp__claude-in-chrome__tabs_create_mcp, mcp__claude-in-chrome__navigate, mcp__claude-in-chrome__computer, mcp__claude-in-chrome__read_page, mcp__claude-in-chrome__find, mcp__claude-in-chrome__javascript_tool, mcp__claude-in-chrome__read_console_messages, mcp__claude-in-chrome__read_network_requests, mcp__claude-in-chrome__form_input, mcp__claude-in-chrome__get_page_text, mcp__claude-in-chrome__upload_image, mcp__claude-in-chrome__resize_window
description: React 프론트엔드 라우트를 브라우저 자동화로 검증
argument-hint: [routes...] [--all] [--url <dev-server-url>]
---

# Visual QA

본문만으로 기본 흐름은 가능하고, 아래 문서는 세부 테스트 규칙이 필요할 때만 연다:

- `docs/references/visual-qa-playbook.md`
  - 단계별 수집 항목을 다시 볼 때
  - 안전 규칙이나 실패 처리 기준이 헷갈릴 때

## 입력 파싱

입력: `$ARGUMENTS`

- `/visual-qa` → 변경 파일 기반 자동 감지
- `/visual-qa /route-a /route-b` → 특정 라우트만 검증
- `/visual-qa --all` → 전체 라우트 스캔
- `/visual-qa --url <url>` → 개발 서버 URL 직접 지정

## 수행 절차

1. 환경을 감지한다
   - 프레임워크
   - 개발 서버 URL
   - 라우트 목록
2. 검증할 라우트를 결정한다
   - 특정 라우트 인자
   - `--all`
   - 기본 모드에서는 변경 파일 기반 영향 라우트 추론
   - 라우트가 비어 있으면 사용자에게 전체 스캔/중단 여부를 확인한다
3. 브라우저 세션을 열고 각 라우트를 순차 검증한다
4. 아래 데이터를 수집한다
   - 콘솔 에러
   - 네트워크 에러
   - DOM 상태
   - 인터랙션 결과
   - 스크롤/반응형 시각 데이터
5. `visual-qa-analyzer`에 라우트별 데이터를 전달해 판정을 받는다
6. `tmp/visual-qa-report.md`를 생성한다
7. PASS/WARN/FAIL 요약과 주요 이슈를 사용자에게 안내한다

동적 라우트 파라미터를 자동 추출하지 못하면 사용자에게 직접 입력을 요청한다.

## 안전 규칙

- 기존 데이터 수정/삭제 금지
- `[QA-TEST]` 접두어가 붙은 테스트 데이터만 CRUD 대상
- 로그인/로그아웃 자동 수행 금지
- 브라우저 조작은 순차 수행

## 산출물

- `tmp/visual-qa-report.md`

reference를 안 열어도 되는 경우:

- 변경 라우트를 정하고 브라우저로 순차 검증하는 일반 케이스
