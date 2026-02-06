---
allowed-tools: Bash, Read, Grep, Glob, Write, Task, AskUserQuestion, mcp__claude-in-chrome__tabs_context_mcp, mcp__claude-in-chrome__tabs_create_mcp, mcp__claude-in-chrome__navigate, mcp__claude-in-chrome__computer, mcp__claude-in-chrome__read_page, mcp__claude-in-chrome__find, mcp__claude-in-chrome__javascript_tool, mcp__claude-in-chrome__read_console_messages, mcp__claude-in-chrome__read_network_requests, mcp__claude-in-chrome__form_input, mcp__claude-in-chrome__get_page_text, mcp__claude-in-chrome__upload_image, mcp__claude-in-chrome__resize_window
description: React 프론트엔드 Visual QA 검증 (브라우저 자동화)
argument-hint: [routes...] [--all] [--url <dev-server-url>]
---

## 개요

React 프론트엔드 프로젝트의 UI/UX를 Chrome MCP 브라우저 자동화로 검증합니다.
변경 파일 기반으로 영향 라우트를 동적으로 추적하고, 각 라우트에 대해 로딩/UI/인터랙션/디자인 품질 테스트를 수행합니다.

**스크린샷 역할 분담**:
- **초기 페이지 캡처**: 서브에이전트(`visual-qa-analyzer`)가 각 라우트를 직접 `navigate` → `screenshot`하여 시각 분석 수행 — 메인에서는 초기 스크린샷을 찍지 않음
- **인터랙션/반응형 캡처**: 메인에서 스크롤, 뷰포트 변경 등 조작 후 캡처 (서브에이전트는 조작 불가)

## 인자 파싱

입력된 인자: `$ARGUMENTS`

**인자 형식**:
- `/visual-qa` → 변경 파일 기반 자동 감지
- `/visual-qa /companies /contacts/:id` → 특정 라우트만 검증
- `/visual-qa --all` → 모든 라우트 전체 스캔
- `/visual-qa --url http://localhost:8080` → 개발 서버 URL 직접 지정
- `/visual-qa --url http://localhost:8080 /dashboard` → URL 지정 + 특정 라우트

**파싱 규칙**:
1. `--all` 플래그가 있으면 전체 라우트 스캔 모드
2. `--url <url>` 이 있으면 해당 URL을 개발 서버로 사용
3. `/`로 시작하는 인자는 검증할 라우트 경로
4. 나머지는 무시

## Phase 1: 환경 감지

`templates/visual-qa/env-detection.md`를 Read하여 절차대로 수행합니다.
프레임워크 감지 → 개발 서버 URL 감지 → 라우트 설정 파일 탐색 → 라우트 파싱 순서로 진행.
파싱 후 발견된 전체 라우트 수를 표시합니다.

## Phase 2: 변경 파일 감지

- **특정 라우트 인자**: 해당 라우트만 검증, 변경 감지 건너뜀
- **`--all` 플래그**: 모든 라우트 검증, 변경 감지 건너뜀
- **기본 모드**: `git diff --name-only HEAD` + `git diff --name-only --staged`로 수집
  - `.jsx`, `.tsx`, `.js`, `.ts`, `.css`, `.scss` 확장자만 필터링
  - `node_modules`, `package.json`, `*.config.*` 제외
  - 변경 파일 없으면 AskUserQuestion으로 전체 스캔/특정 라우트/중단 선택

## Phase 3: 영향 라우트 매핑

1. **직접 매핑**: 변경 파일이 라우트 페이지 컴포넌트 → 해당 라우트 추가
2. **간접 매핑**: Grep으로 import 추적 (최대 3단계: 변경파일 → 중간 컴포넌트 → 페이지)
3. **사용자 확인**: AskUserQuestion으로 검증 대상 라우트 확인 ("전체 검증" / "선택 수정" / "중단")

## Phase 4: 테스트 URL 생성

- **정적 라우트**: `<base_url><route_path>` 그대로 사용
- **동적 라우트** (`:param`): 리스트 페이지에서 `javascript_tool`로 첫 항목 링크 추출, 실패 시 사용자 입력 요청
- **빈 데이터**: 항목 0개면 AskUserQuestion으로 "파라미터 직접 입력" / "건너뛰기" 선택

## Phase 5: 데이터 수집 + 분석

**브라우저 세션 시작**: `tabs_context_mcp` → `tabs_create_mcp`
각 라우트에 대해 5-1~5-4를 순차 수행한 뒤, 5-5(서브에이전트) → 5-6(취합).

### 5-1. 페이지 로딩 데이터 수집

1. `navigate(url)` → 페이지 이동
2. **인증 리다이렉트 감지**: URL에 `login`, `auth`, `signin`, `sign-in` 포함 시
   - 첫 감지 시 AskUserQuestion으로 세션 정책 결정: "모두 건너뛰기" / "지금 로그인 후 진행" / "라우트별 개별 판단"
   - 이후 선택한 정책에 따라 자동 처리
3. `computer(wait, 2초)` → 로딩 대기
4. `read_console_messages(pattern: "error|Error|TypeError|ReferenceError|Uncaught|Warning")`
5. `javascript_tool`로 DOM 상태 수집 (errorBoundary, isEmpty, is404, isLoading, bodyLength)
6. `read_network_requests(urlPattern: "/api/", clear: true)` → 4xx/5xx 에러 수집

### 5-2. UI/UX 시각 데이터 수집

**스크롤**: `computer(scroll, down, 3)` → `screenshot` → `computer(scroll, up, 3)` 복귀

**반응형** (가장 복잡한 라우트 1개): 인터랙티브 요소가 가장 많은 라우트 자동 선정
- `resize_window(768, 1024)` → screenshot → `resize_window(375, 812)` → screenshot → `resize_window(1280, 800)` 복원
- 나머지 라우트는 데스크탑만 검증

### 5-3. 디자인 분석용 DOM 데이터 수집

`templates/visual-qa/dom-collect.js`를 Read하여 `javascript_tool`로 실행합니다.
버튼 스타일, 간격/정렬, 타이포그래피, 색상, 정보 구조, 상태 처리 6개 항목을 단일 호출로 수집.

### 5-4. 인터랙션 테스트

1. `find`로 인터랙티브 요소 탐색 (버튼, 링크, 탭, 드롭다운, 입력)
2. **탭 전환**: 클릭 → 콘텐츠 변경 확인 → screenshot → 콘솔 에러 확인
3. **버튼 hover**: `computer(hover)` → 시각적 변화 확인
4. **CRUD 플로우**: `templates/visual-qa/crud-procedure.md`를 Read하여 절차대로 수행. `[QA-TEST]` 접두어로 생성한 항목만 대상
5. **모달** (CRUD 외): 열고 screenshot → ESC로 닫기
6. **네비게이션**: 검증 대상 라우트 간 링크 이동 확인 → 복귀

인터랙션 중 콘솔 에러도 수집합니다.

### 5-5. 서브에이전트 분석

**전체 라우트 데이터를 1회 배치 호출**로 `visual-qa-analyzer` 서브에이전트에 전달합니다.

```
Task(subagent_type: "visual-qa-analyzer"):
  라우트별 수집 데이터 + 현재 탭 ID
```

서브에이전트: 라우트 순회 + screenshot → 라우트별 판정(PASS/WARN/FAIL + 디자인 등급) → 크로스페이지 비교 → 개선 제안.

> **15개 초과 시**: 10개씩 배치 분할, `previous_batches_summary` 전달하여 전체 일관성 유지.

### 5-6. 라우트별 최종 판정

서브에이전트 JSON 결과를 취합: `verdict`, `design_grades`, `issues`, `improvements`.

## Phase 6: 결과 리포트 생성

`templates/visual-qa/report-template.md`를 Read하여 템플릿을 참조하고, `tmp/visual-qa-report.md`에 Write합니다.

## Phase 7: 결과 안내

1. **기능 요약**: PASS/WARN/FAIL 개수
2. **디자인 품질 요약**: 항목별 등급 + 종합 등급
3. **FAIL/WARN 항목** 강조
4. **디자인 개선 제안**: C/D 등급 항목
5. **CRUD 잔여 데이터 경고** (`crud_residual` 있으면 수동 정리 안내)
6. **산출물 경로**: `tmp/visual-qa-report.md`

## 중요 제한 사항

### 안전 규칙
- **기존 데이터 수정/삭제 금지** — `[QA-TEST]` 접두어 항목만 CRUD 대상
- **`[QA-TEST]` 확인 없이 수정/삭제 클릭 금지**
- **로그인/로그아웃 수행 금지**
- CRUD 외 모달은 ESC로 닫음, alert/confirm은 CRUD 삭제 확인만 허용

### 실행 규칙
- 라우트 검증은 순차 수행 (단일 브라우저 탭)
- 각 라우트 검증 전 이전 상태 정리 확인

### MCP 에러 핸들링

| 에러 유형 | 복구 전략 | 최대 재시도 |
|-----------|----------|------------|
| Tab ID 무효 | `tabs_context_mcp` 재확인 → 새 탭 생성 | 2회 |
| 익스텐션 미응답 | 5초 대기 → 사용자에게 상태 확인 안내 | 1회 |
| 네비게이션 타임아웃 | 5초 대기 → 동일 URL 재시도 | 2회 |
| JS 실행 에러 | 2초 대기 → 해당 수집 건너뛰기 | 1회 |

**연속 3회 FAIL 시** 자동 중단 → AskUserQuestion: "계속" / "현재까지 리포트" / "중단"

### 성능 고려
- 20개 이상 라우트: 사용자 확인 후 진행
- 동적 라우트 파라미터 추출 실패: 즉시 사용자 입력 요청
