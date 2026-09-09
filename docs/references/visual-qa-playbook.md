# Visual QA Playbook

`/visual-qa`의 세부 절차와 판정 기준이 필요할 때만 보는 문서.

목표:

- 변경된 프론트엔드 라우트의 기능/시각/UI 품질을 검증

## 왜 Playwright 인가

수집을 브라우저 확장에 의존하면 확장 연결과 사이트별 권한 승인이 매번 필요하고, 사용자의 창을 점유하며, 샌드박스 안에서는 로컬 개발 서버에 닿지 못하는 경우가 있다. 커밋 직전 게이트는 그 마찰만큼 건너뛰게 된다. 헤드리스 Playwright 는 사전 조건이 대상 저장소의 의존성 하나뿐이고 백그라운드에서 돈다.

Playwright 를 이 저장소의 의존성으로 들이지 않는다. `ux-review` 의 recorder 와 같은 방식으로 **대상 저장소의 `node_modules`** 를 찾아 쓴다. 프론트엔드 저장소는 대부분 이미 갖고 있고, 없으면 수집기가 설치 명령을 안내하고 종료 코드 2 로 끝난다.

## 핵심 단계

1. 환경 감지 (프레임워크, 라우트 목록, 개발 서버 URL, Playwright 유무)
2. 변경 파일 감지
3. 영향 라우트 매핑
4. 수집기 실행 — `visual-qa-collect.mjs`
5. `visual-qa-analyzer` 서브에이전트 판정
6. `tmp/visual-qa-report.md` 생성

## 수집기

```bash
node ~/.claude/scripts/visual-qa-collect.mjs \
  --url http://localhost:5173 \
  --routes /,/orders,/settings \
  --out tmp/visual-qa
```

| 옵션 | 기본값 | 비고 |
|---|---|---|
| `--url` | `$VISUAL_QA_URL` | 필수 |
| `--routes` | `/` | 쉼표 구분 |
| `--out` | `tmp/visual-qa` | `collected.json` 과 스크린샷 위치 |
| `--viewports` | `1440x900,390x844` | `WxH` 쉼표 구분 |
| `--storage-state` | `$VISUAL_QA_STORAGE_STATE` | 인증이 필요한 라우트 |
| `--timeout` | `20000` | 라우트당 이동 제한 |
| `--repo` | 현재 디렉토리 | Playwright 를 찾을 기준 저장소 |
| `--playwright` | 자동 탐지 | `index.mjs` 경로 직접 지정 |

## 수집 항목

라우트 × 뷰포트마다:

- 이동 결과와 소요 시간
- 처리되지 않은 JS 예외 (`pageErrors`)
- 콘솔 `error`·`warning`
- 4xx/5xx 응답과 요청 실패 (`networkErrors`)
- 정상 취소된 요청 (`abortedRequests`) — 결함으로 세지 않는다. 페이지를 닫을 때 끊기는 미디어 preload 가 여기 들어온다
- DOM 요약: 제목 구조, 텍스트 길이, 컨트롤 수, 이름 없는 컨트롤, `alt` 없는 이미지, 폼 수, 가로 넘침
- 스타일 지문 (`style`) — 화면에 실제로 쓰인 `color`·`backgroundColor`·`fontFamily`·`fontSize`·`fontWeight`·`borderRadius`·`boxShadow` 의 값별 사용 횟수와 종류 수, 그리고 컨트롤(button·link·input)의 높이·패딩·라운드·글자크기 규격
- 전체 페이지 스크린샷

같은 항목이 반복되면 `count` 로 묶인다.

## 화면 간 통일성

라우트가 둘 이상이면 `consistency` 절이 생긴다. 뷰포트가 다르면 값이 갈리는 게 정상이므로 **같은 뷰포트끼리만** 비교한다.

| 필드 | 의미 |
|---|---|
| `onlyOnOneRoute` | 그 속성값이 한 화면에서만 나타났다 |
| `controlSpread` | 화면마다 컨트롤 규격이 몇 갈래인지 |

`onlyOnOneRoute` 는 **결함이 아니라 질문거리**다. "왜 이 화면만 다른가"에 답이 있으면(그 화면 고유의 강조색, 지도 오버레이) 정상이고, 답이 없으면 일회성 스타일이다. 판정에 올릴 때는 반드시 값과 화면을 함께 인용한다.

`controlSpread` 의 갈래 수가 한 화면에서만 크게 튀면 그 화면이 버튼 규격을 여러 개 쓰고 있다는 뜻이다.

디자인 시스템에 컴포넌트가 있는데 안 쓴 경우는 여기서 잡히지 않는다. `Button` 을 쓰든 원시 `<button>` 을 손으로 꾸미든 렌더 결과는 같기 때문이다. 그건 소스를 봐야 알 수 있고 `code-simplifier`(Standards Review) 가 맡는다.

## 인증이 필요한 라우트

에이전트가 로그인을 대신 수행하지 않는다. 사람이 한 번 만들어 둔 Playwright storageState 를 넘긴다.

```bash
# 사람이 직접 1회 수행
npx playwright open --save-storage=.auth/state.json http://localhost:5173
# 이후
node ~/.claude/scripts/visual-qa-collect.mjs --url ... --routes /orders --storage-state .auth/state.json
```

`.auth/` 는 gitignore 대상이어야 한다. 자격증명을 커맨드 인자나 리포트에 남기지 않는다.

## 중요 규칙

- 수집기는 이동과 읽기만 한다. 클릭·입력·제출이 없으므로 기존 데이터가 바뀌지 않는다
- 라우트는 순차 수행한다. 동시 요청으로 개발 서버를 흔들면 수집값의 원인을 가릴 수 없다
- 개발 서버를 대신 띄우거나 종료하지 않는다
- 상태를 바꿔야 검증되는 흐름은 `ux-review` 로 간다. 그쪽은 승인된 시나리오와 변경 정책(`mutationPolicy`)을 갖는다

## 판정 기준

- **FAIL** — 이동 실패, `pageErrors` 1건 이상, 5xx, 빈 화면
- **WARN** — 4xx, 콘솔 `error`, 모바일 뷰포트 가로 넘침, 이름 없는 컨트롤, `alt` 없는 이미지, 제목이 보이는데 `h1Count` 0, 느린 로드, 근거 없는 `onlyOnOneRoute` 값
- **PASS** — 위에 해당 없음

## 실패 처리

- 이동 타임아웃은 해당 라우트의 `navigation` 에 사유가 남고 나머지 라우트는 계속 수집된다
- 개발 서버가 죽어 전 라우트가 실패하면 판정을 내지 말고 서버 상태를 먼저 알린다
- Playwright 미설치는 종료 코드 2. 임의로 설치하지 말고 사용자에게 알린다
