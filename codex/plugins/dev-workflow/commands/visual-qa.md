---
allowed-tools: Bash, Read, Grep, Glob, Write, Task, AskUserQuestion
description: 프론트엔드 라우트를 Playwright 로 검증
argument-hint: [routes...] [--all] [--url <dev-server-url>]
---

# Visual QA

본문만으로 기본 흐름은 가능하고, 아래 문서는 세부 테스트 규칙이 필요할 때만 연다:

- `~/.codex/docs/references/visual-qa-playbook.md`
  - 수집 항목의 의미나 판정 기준을 다시 볼 때
  - 로그인이 필요한 라우트를 다룰 때
  - 실패 처리 기준이 헷갈릴 때

수집은 `~/.codex/scripts/visual-qa-collect.mjs`(Codex 는 `~/.codex/scripts/`)가 헤드리스 Playwright 로 수행한다. 브라우저 확장이나 사용자의 열린 창에 기대지 않으므로 백그라운드·샌드박스에서도 돌아간다.

## 입력 파싱

입력: `$ARGUMENTS`

- `/visual-qa` → 변경 파일 기반 자동 감지
- `/visual-qa /route-a /route-b` → 특정 라우트만 검증
- `/visual-qa --all` → 전체 라우트 스캔
- `/visual-qa --url <url>` → 개발 서버 URL 직접 지정

## 수행 절차

1. 환경을 감지한다
   - 프레임워크와 라우트 목록
   - 개발 서버 URL — 떠 있지 않으면 사용자에게 띄워 달라고 요청한다. 대신 띄우지 않는다
   - 대상 저장소의 Playwright 유무 (`node_modules/@playwright/test`)
2. 검증할 라우트를 결정한다
   - 특정 라우트 인자
   - `--all`
   - 기본 모드에서는 변경 파일 기반 영향 라우트 추론
   - 라우트가 비어 있으면 사용자에게 전체 스캔/중단 여부를 확인한다
3. 수집기를 실행한다

   ```bash
   node ~/.codex/scripts/visual-qa-collect.mjs \
     --url <dev-server-url> \
     --routes /a,/b \
     --out tmp/visual-qa
   ```

   - 뷰포트 기본값은 `1440x900,390x844`. 다른 값이 필요하면 `--viewports`
   - 로그인이 필요한 라우트는 `--storage-state <file>` 로 사람이 만들어 둔 세션을 넘긴다
   - Playwright 가 없으면 스크립트가 설치 명령을 안내하고 종료 코드 2 로 끝난다. 임의로 설치하지 말고 사용자에게 알린다
4. `tmp/visual-qa/collected.json` 과 라우트별 스크린샷이 생긴다
5. `visual-qa-analyzer`에 그 경로를 전달해 라우트별 판정을 받는다
6. `tmp/visual-qa-report.md`를 생성한다
7. PASS/WARN/FAIL 요약과 주요 이슈를 사용자에게 안내한다

동적 라우트 파라미터를 자동 추출하지 못하면 사용자에게 직접 입력을 요청한다.

## 안전 규칙

- 수집기는 이동과 읽기만 한다. 클릭·입력·제출을 하지 않으므로 데이터가 바뀌지 않는다
- 로그인/로그아웃을 자동 수행하지 않는다. 인증이 필요하면 `--storage-state` 로 받는다
- 자격증명은 환경변수나 gitignore 된 상태 파일에만 둔다. 인자로 남기지 않는다
- 개발 서버를 대신 띄우거나 종료하지 않는다
- 상태를 바꾸는 검증이 필요하면 이 커맨드가 아니라 `ux-review` 로 간다. 그쪽은 승인된 시나리오와 변경 정책을 갖는다

## 산출물

- `tmp/visual-qa/collected.json` · 라우트별 스크린샷 (수집)
- `tmp/visual-qa-report.md` (판정)

reference를 안 열어도 되는 경우:

- 변경 라우트를 정하고 인증 없이 수집·판정하는 일반 케이스
