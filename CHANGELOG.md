# Changelog

## v0.9.4 (2026-09-09)

- `/visual-qa` 의 수집 계층을 claude-in-chrome 에서 헤드리스 Playwright 로 교체. 확장 연결과 사이트별 권한 승인이 매번 필요하고 사용자의 창을 점유하며 샌드박스에서는 로컬 개발 서버에 닿지 못해, 커밋 직전 게이트인데도 실제로 잘 안 쓰이고 있었음. `scripts/visual-qa-collect.mjs` 를 추가해 라우트 × 뷰포트마다 이동 결과·JS 예외·콘솔·4xx/5xx·DOM 요약·전체 페이지 스크린샷을 모아 `tmp/visual-qa/collected.json` 으로 남김. Playwright 는 이 저장소의 의존성으로 들이지 않고 `ux-review` recorder 와 같은 방식으로 대상 저장소의 `node_modules` 를 찾아 쓰며, 없으면 설치 명령을 안내하고 종료 코드 2 로 끝냄.
- 수집기는 이동과 읽기만 한다. 클릭·입력·제출이 없으므로 `[QA-TEST]` 접두어 규칙 없이도 데이터가 바뀌지 않고, 인증이 필요한 라우트는 사람이 만들어 둔 Playwright `storageState` 를 `--storage-state` 로 받는다(에이전트가 로그인을 대신 수행하지 않는다는 기존 규칙을 수단까지 갖춰 옮김).
- 페이지를 닫을 때 끊기는 미디어 preload 가 `net::ERR_ABORTED` 로 잡혀 오탐이 되던 것을 `abortedRequests` 로 분리하고 결함 집계에서 뺌. 실제 뷰어로 돌려 확인함. 같은 항목이 반복되면 `count` 로 묶음.
- 스크린샷 파일명이 `[^a-zA-Z0-9]` 를 전부 `-` 로 바꾸는 슬러그라 한글 라우트가 통째로 `root` 가 되어 앞 라우트의 스크린샷을 덮던 버그 수정. 유니코드 문자·숫자를 남기고 순번을 앞에 붙여 반드시 갈라 둠.
- `visual-qa-analyzer` 에서 Chrome MCP 도구를 걷어내고 `Read`/`Grep`/`Glob` 만 남김. 브라우저를 직접 몰지 않게 되면서 "screenshot 액션만 허용" 같은 금지 규칙이 필요 없어졌고, 대신 `collected.json` 의 필드별 의미와 FAIL/WARN/PASS 판정 기준을 명시함.
- `docs/references/visual-qa-playbook.md` 를 수집기 옵션표·인증 절차·판정 기준 중심으로 다시 씀.
- 설치 스크립트 세 개(`setup.sh`·`setup-codex.sh`·`setup.ps1`)가 `scripts/*.sh` 만 복사해 `.mjs` 가 설치되지 않던 것을 고침. 저장소 전용 테스트인 `test-*.mjs` 는 제외.
- 수집기에 스타일 지문을 추가해 화면 간 통일성을 잼. 라우트마다 실제로 쓰인 `color`·`backgroundColor`·`fontFamily`·`fontSize`·`fontWeight`·`borderRadius`·`boxShadow` 의 값별 사용 횟수와 종류 수, 컨트롤(button·link·input)의 높이·패딩·라운드·글자크기 규격을 모으고, 라우트를 다 모은 뒤 같은 뷰포트끼리 비교해 `consistency.onlyOnOneRoute`(한 화면에서만 나타난 값)와 `controlSpread`(화면별 규격 갈래 수)를 냄. 뷰포트가 다르면 값이 갈리는 게 정상이라 뷰포트를 섞지 않음. twin-studio 2개 라우트로 확인했고 `collected.json` 은 12KB.
- 지문 노이즈 두 가지 제거: 값이 많으면 자주 쓰인 순으로 잘라 `distinct` 로 종류 수만 남기고, Tailwind 계열이 `box-shadow` 앞에 붙이는 완전 투명한 ring 자리표시자를 정규화해서 뺌. 자리표시자 개수만 달라도 다른 값으로 세어져 종류 수가 부풀고 리포트가 읽히지 않았음.
- `visual-qa-analyzer` 의 description 이 "디자인 품질 평가"라고 과장돼 있던 것을 "라우트별 회귀 판정, 디자인 품질 평가는 하지 않는다"로 정정. 수집값으로 판정할 수 있는 범위를 넘어선 문구였음. `onlyOnOneRoute` 는 결함이 아니라 질문거리이므로 스크린샷에서 다를 이유를 찾지 못한 것만 WARN 으로 올리도록 명시.
- `code-simplifier`(Standards Review)에 디자인 시스템 미사용 검사 추가. `Button` 이 있는데 원시 `<button>` 을 손으로 만든 자리는 렌더 결과가 같아 브라우저로는 드러나지 않으므로 소스 검사 쪽에 둠. 실제로 twin-studio 에서 DS 가 `Button` 을 내보내고 앱이 19개 파일에서 쓰는데도 5개 파일이 원시 `<button>` 을 쓰고 있었음. 다만 캔버스 오버레이처럼 DS 가 맞지 않는 자리가 있으므로 후보로 올리고 근거를 함께 적도록 하고, export 를 확인한 뒤에만 지적하도록 규정.

## v0.9.3 (2026-09-08)

- `ux-review` 뷰어의 색·글꼴·컴포넌트를 HerdRabbit 의 공통 UI 킷으로 교체. 킷(`ui.css`·`tokens.css`·`base.css`·`components.css`)을 `assets/ui/` 에 복사하고 서버가 `/ui/` 로 서빙함. 기존 shadcn HSL 토큰(`hsl(var(--background))`)과 `.dark` 클래스 방식을 킷의 직접 색상값·`data-theme` 속성으로 바꾸고, 사이드바는 `ui-sidebar`, 시나리오 항목은 `ui-nav-item`+`ui-status`, 버튼은 `ghost-button`/`icon-button`/`ui-menu` 로 옮김. 브랜드색만 킷 뒤에서 핑크로 재정의(다크 `#ff9ecf`, 라이트 `#b01e5f`)해 원본 갱신 시 폴더만 교체하면 되도록 함. `.css` MIME 이 표에 없어 스타일시트로 읽히지 않던 것도 함께 고침.
- 페이지를 `PAGE` 상수에서 `assets/viewer-page.html` 로 분리하고 요청마다 읽음. 상수는 프로세스 메모리에 상주해 마크업·CSS 를 고칠 때마다 `--restart` 가 필요했음. 이제 새로고침만으로 반영되고 재기동은 서버 코드를 고칠 때만 필요함. `SKILL.md` 의 안내도 그에 맞게 정정.
- 페이지 전체가 스크롤되던 문제 수정. 킷의 `base.css` 는 body 높이를 정하지 않는데(그 처리는 HerdRabbit 앱 전용 `styles.css` 에 있어 가져오지 않음) `#main` 에 `min-height:0` 도 없어 그리드 항목이 콘텐츠 높이만큼 늘어났음. 목록과 본문이 각자 스크롤하도록 바꾸고, 본문도 제목·배지·pass·탭을 `.mainhead` 로 고정한 뒤 그 아래만 흐르게 함. 영상 탭의 `.vright` 자체 스크롤을 없애 이중 스크롤도 정리.
- 반응형을 HerdRabbit 과 같은 off-canvas 드로어로 교체(≤760px). 위아래 분할은 목록에 두 항목밖에 안 보였음. 목록을 화면 밖에 두고 떠 있는 토끼 버튼으로 열며, scrim·ESC·항목 선택으로 닫음. 모바일에서 머리가 12줄을 먹던 것은 배지·pass·탭을 각각 한 줄로 눕혀 가로 스크롤로 바꾸고 선택 항목을 가운데로 굴려 해결. `#app` 이 `display:block` 이 되면서 `#main` 의 그리드 열이 `auto` 로 잡혀 본문이 가로로 잘리던 버그도 같이 잡음.
- 사이드바를 최신순으로 정렬하고 날짜를 `오늘`·`어제`·`4일 전` 상대 표기로 바꿈. 저장소 순서가 디렉토리 읽는 순서라 어느 것이 최근인지 알 수 없었음. 마커는 P0·ready 상태 대신 그 저장소에서 가장 나중에 손댄 시나리오 하나만 알리고, 심각도는 옆의 pill 이 맡음. 기준을 전역 최대 날짜로 두면 어제 A 저장소에서 작업했다는 이유로 B~G 저장소는 자기 최신 항목에도 마커가 없어(7개 중 1개만 켜졌음) 저장소를 훑는 용도로 쓸 수 없었으므로 저장소마다 따로 잡음. 날짜 폴더 이름은 같은 날 안에서 순서를 못 가리고 사흘 전 시나리오에 오늘 pass 를 얹은 경우도 놓치므로, 인덱스에 `activeAt`(시나리오 직속 항목의 mtime 중 최댓값 — pass 디렉토리 mtime 은 그 안 마지막 파일이 쓰인 시각)을 넣고 정렬·강조·첫 진입을 모두 그 값으로 옮김. 목록 표기도 `오늘 06:10`·`어제 14:39` 처럼 시각을 드러내고 정확한 시각은 툴팁에 둠. `/api/index` 응답은 36건 기준 20ms 로 유지됨.
- 삭제·정리를 본문 머리에서 사이드바의 작업 메뉴(`ui-menu`)로 옮김. 위험한 조작이 제목 옆에 늘 펼쳐져 있었고 모바일에서는 두 줄을 차지했음.
- PWA 지원 추가: `manifest.webmanifest`(standalone), 서비스 워커, 아이콘 192/512/180. 산출물(WebM 수십 MB)과 `/api/` 는 캐시하지 않고 껍데기만 네트워크 우선으로 다룸 — 오래된 목록을 보여주는 쪽이 더 나쁨. 캐시 정리는 `ux-review-` 접두사 안에서만 하는데, 같은 오리진을 다른 앱과 나눠 쓸 때 남의 캐시를 지우기 때문. `.js` 가 MIME 표에서 `text/plain`(산출물을 소스로 보여주려는 의도)이라 `/sw.js` 만 `text/javascript` 로 따로 내보냄.
- 아이콘을 토끼 마크에 `UX` 를 넣은 형태로 통일. 글자를 `<text>` 로 두면 폰트 렌더링에 기대 서브픽셀 안티앨리어싱으로 파랑·주황 색 번짐이 생기므로 도형(path)으로 그림. PNG 는 4배로 렌더한 뒤 Lanczos 로 줄여 가장자리를 매끄럽게 함.
- 삭제·정리를 항목마다 붙였음. 처음엔 사이드바 머리에 메뉴 하나로 몰았는데, 그러면 목록의 다른 시나리오를 지우려고 먼저 선택해야 했음. HerdRabbit 의 `.session-row` 와 같은 `minmax(0,1fr) 26px` 그리드로 항목 옆에 두고, pass 정리·pass 삭제는 대상이 로드된 시나리오여야 계산되므로 본문 pass 줄 끝에 둠. 메뉴 아이콘은 `…` 글리프가 baseline 근처에 그려져 세로 가운데가 맞지 않아 도형으로 그림.
- PC 에서 목록 접기 추가. 토끼 마크로 토글하고 접힘은 `localStorage` 에 남김. HerdRabbit 의 레일(64px 남기고 아이콘만) 방식은 항목마다 아이콘이 있어야 성립하는데 이 뷰어의 상태 마커는 최신 항목에만 있어 레일이 비므로, 완전히 접고 떠 있는 버튼으로 여는 방식을 택함. 접기·펼치기 버튼은 같은 26×34 마크로 통일하고 hover 에 실루엣을 채우되(HerdRabbit 과 동일) 눈은 배경색으로 파냄.
- 테마 버튼이 현재 테마를 보여주던 것을 '누르면 될 테마'로 바꿈. HerdRabbit 은 `data-next-theme` 로 그렇게 하는데 반대로 만들어 두었음. 아이콘도 그쪽 `theme-icon` 도형으로 맞추고 `aria-label` 을 동작 문구로 바꿈.
- `manifest.id` 를 `/` 에서 `/?app=ux-review` 로 바꿈. HerdRabbit 과 같은 노드에서 Tailscale Serve 로 서비스할 때 두 앱의 `id` 가 모두 `/` 라, 포트가 갈리기 전이나 WebAPK 갱신 과정에서 같은 앱으로 묶일 여지가 있었음.
- 목록에서 시나리오를 연달아 지우면 화면이 갱신되지 않던 것 수정. `del()` 이 `SC.path` 를 무조건 읽는데, 앞서 열어 둔 시나리오를 지우면 `SC` 가 비워지므로 두 번째 삭제부터 `Cannot read properties of null` 로 끊겨 서버에서는 지워졌는데 목록에는 남아 있었음. 합성 저장소에 헤드리스 크로뮴을 붙여 수정 전/후를 나란히 확인(전 3→2→2 + 예외, 후 3→2→1).
- 시나리오 항목의 `aria-label` 에 pass 수와 심각도를 담음. `aria-label` 은 자식 텍스트를 통째로 덮으므로 옆의 P0·P1·P2 pill 이 스크린리더에 전혀 읽히지 않았음. 이 목록에서 심각도가 핵심 정보인데 눈으로 보는 사람에게만 있었음.
- 확대 보기를 Escape 로 닫도록 함. 기존 Escape 처리는 모바일 드로어만 맡아 키보드로는 닫을 수단이 없었음. 스크린샷 `<img>` 의 빠진 `alt=""` 도 채움 — 파일명이 읽히는데 같은 내용이 `figcaption` 에 이미 있음.
- `data-del` 두 곳과 pass 정리 버튼의 `title` 이 `esc()` 를 거치지 않던 것 수정. 나머지 삽입점은 전부 이스케이프하는데 여기만 원본이라 저장소·worktree 이름에 `"` 가 들어가면 마크업이 깨졌음.
- 해시 라우팅을 세그먼트마다 따로 디코드. 통째로 풀면 `enc()` 가 `%2F` 로 넣은 이름 속 슬래시가 구분자로 되살아났음. `go()` 도 대칭이 되게 인코딩해서 돌려줌.
- 목록을 못 읽으면 `불러오는 중…` 에 멈추던 것 수정. `loadIndex()` 실패가 잡히지 않아 초기화가 통째로 중단됐음. 이제 사유를 띄우고, `renderTree()` 도 인덱스가 없으면 그리지 않음.
- 영상 분기에서 바깥 `base` 를 가리던 같은 이름의 `const` 와, `<track>` 을 붙이지 않아 효과가 없던 `crossorigin` 제거.
- `viewer.mjs` 사용법 주석 정정. 기본 HOST 가 이미 `0.0.0.0` 인데 `--host 0.0.0.0  # LAN 공개` 라고 적혀 있어 옵트인처럼 읽혔음. 기본이 LAN 공개인 이유(휴대폰 열람)와 함께 인증 없는 `DELETE /api/entry`·`/api/passes` 도 같이 열린다는 점, `--host 127.0.0.1`·`--read-only` 로 좁히는 방법을 적음. 기본값 자체는 그대로 둠.
- `assets/ui/SOURCE.md` 의 "뷰어 고유 스타일은 `viewer.mjs` 의 `PAGE` 상수 안에" 안내를 `assets/viewer-page.html` 의 `<style>` 로 갱신. 페이지를 파일로 분리하면서 어긋나 있었음.
- 세부화면 pass 줄 끝의 `…` 작업 메뉴를 없애고 그 안의 `이전 pass 정리`·`pass 삭제` 를 목록 항목 메뉴로 옮김. 작업 메뉴가 목록과 본문 두 곳에 흩어져 있었음. pass 크기·승인 여부는 목록 인덱스에 없는 값이라 메뉴를 열 때 `/api/scenario` 를 읽어 항목을 채우고, 이미 읽은 시나리오는 캐시를 씀. 개별 pass 삭제는 대상이 정해져야 성립하므로 지금 보고 있는 시나리오의 행에만 붙고 나머지 행에는 정리만 나옴. 본문과 메뉴가 같은 pass 를 보도록 `currentPassName()` 으로 모음.

## v0.9.2 (2026-09-04)

- `ux-review` 뷰어 페이지에 favicon 추가. 탭 표시가 기본 아이콘이라 여러 pass 를 띄워 두면 어느 탭이 뷰어인지 구분이 안 됐음. 뷰어는 표준 라이브러리만 쓰는 단일 페이지라 파일·라우트를 늘리지 않도록 인라인 SVG data URI 로 심었음: 파란 라운드 사각형(`#175DCF`, 뷰어의 `--link` 토큰값) 위에 흰 소문자 `ux`. 소문자는 어센더·디센더가 없어 16px 박스 높이를 꽉 채울 수 있고 로고 표기와도 맞음. 실제 16/32/64px 로 렌더해 비교한 뒤 `font-size` 를 22 로 잡음(19 는 여백 과다, 25 는 박스에 붙음). 라이트/다크 탭바 양쪽에서 보이도록 배경을 유채색으로 잡음.
- `viewer.mjs` 에 `--restart` 추가. 페이지 HTML 이 `PAGE` 상수로 프로세스 메모리에 상주해서 파일을 고쳐도 떠 있는 인스턴스는 옛 페이지를 계속 서빙하는데, `--ensure` 는 이미 떠 있으면 주소만 출력하고 끝나 재기동 수단이 없었음. 실제로 favicon 을 넣고도 반영이 안 되는 걸로 드러남.
- 끌 대상은 PID 파일(`$TMPDIR/ux-review-viewer-<포트>.pid`)로만 특정. `pgrep -f viewer.mjs` 류의 패턴 매칭은 다른 포트에서 도는 뷰어까지 죽이므로 쓰지 않음. PID 파일은 listen 성공 시 쓰고 `exit`/`SIGINT`/`SIGTERM`/`SIGHUP` 에서 자기 PID 일 때만 지움. PID 파일이 없는 예전 인스턴스가 떠 있으면 조용히 실패하지 않고 직접 종료하라는 메시지와 함께 종료 코드 1 을 냄.

## v0.9.1 (2026-09-03)

- `ux-review` 자막을 좁은 뷰포트(768px 이하)에서 가운데 알약 대신 좌우 폭을 다 쓰는 밴드로 그림. 자막 박스가 1920 기준(최대 폭 `100vw-32px`, 18px)으로만 튜닝돼 있어 `390×844` 에서는 텍스트 폭 326px 에 줄당 18자, 하단 28px 틈까지 남기며 탭바·CTA 자리를 덮었음. 밴드는 `bottom: 0` 에 붙고 `box-sizing: border-box` 로 앱 CSS 와 무관하게 가로 스크롤이 생기지 않음. 데스크톱 알약은 그대로.
- 자막이 두 줄을 넘으면 글꼴을 줄이는 대신 어절 경계에서 여러 큐로 나눠 순차 재생. recorder 가 그 페이지에 숨은 프로브를 띄워 실제 렌더 높이로 재므로 폰트·언어와 무관하게 정확하고, 스텝의 자막 시간(`dwell ?? readingTime`)을 글자 수 비율로 나눠 쓰므로 녹화 길이는 변하지 않음. 가이드는 첫 큐 → 1.8초 리드 → 액션 → 나머지 큐가 결과 유지 중 이어지고, 리뷰는 큐마다 `dwell ?? 1200` 을 온전히 줌. 큐 최소 노출 `minCaptionSegmentMs: 900`.
- 아티팩트 계약 변경: SRT 큐와 스텝의 1:1 을 1:N 으로 완화. 관찰의 `captionSegments` 로 매핑하고 큐를 공백 하나로 이어 붙인 결과가 승인 자막과 다르면 거부. 챕터는 스텝당 하나로 첫 큐 시각에 걺. `normalizeCaption`/`captionSegmentsMatch` 를 `scenario-contract.mjs` 에 두어 recorder 와 validator 가 같은 규칙을 씀. `captionSegments` 가 없는 기존 번들은 예전 규칙으로 통과시켜 `approve-review-decision` 재검증이 깨지지 않음.
- `scripts/test-ux-review-skill.mjs` 에 분할 경로 케이스 추가: 자막을 반으로 쪼갠 가이드 번들은 통과, 큐를 승인되지 않은 문장으로 바꾼 번들은 거부.

## v0.9.0 (2026-09-03)

- `ux-review` 산출물을 중앙 저장소 `~/.local/share/ux-review/<부모 저장소>/<worktree>/<날짜>/<NN.시나리오>/`로 옮기고 저장소 쪽 `tmp/ux-review`는 심볼릭 링크로 남김. 산출물 5곳 중 3곳이 worktree 였고 `tmp/`가 gitignore 대상이라 `git worktree remove` 한 번에 증거 237MB 가 사라질 수 있었음. 경로 문자열과 `pathBase: "repository-root"`가 그대로 유효해 기존 매니페스트와 해시 검증은 손대지 않음. `UX_REVIEW_STORE`로 위치 재정의 가능.
- `scripts/store-link.mjs` 추가: `allocate-output.mjs`가 시나리오를 할당할 때 링크가 없으면 만들어 새 worktree 도 처음부터 중앙에 저장. `scripts/migrate-store.mjs` 추가: 기존 산출물 이관(`--dry-run` 기본, `--apply` 로 실행), 같은 파일시스템이면 `rename`, 아니면 복사 후 삭제로 폴백.
- `scripts/capture-origin.mjs` 추가: 시나리오 할당 시 `origin.json`(저장소·worktree·브랜치·리비전·GitHub Issue·Notion Task 링크)과 `plan-snapshot.md` 를 남김. Plan 은 `ult-story-create-exec.sh`가 Notion Story blocks 에만 넣고 GitHub Issue 본문에는 올리지 않으므로 로컬 파일을 복사함. GitHub·Notion 조회는 best-effort 라 실패하면 해당 필드만 비우고 저장은 성공.
- `scripts/viewer.mjs` 추가: 표준 라이브러리만 쓰는 HTTP 뷰어. `python3 -m http.server`가 Range 요청을 무시하고 전체를 재전송해 영상 seek 이 불가능하므로 206 을 직접 구현. 해시 라우팅(`#/<저장소>/<worktree>/<날짜>/<시나리오>/<pass>/<탭>/<여정>`), 여정별 영상과 시나리오 단계 병렬 표시, SRT 타임코드로 단계 클릭 시 해당 시점 이동, Plan·리뷰 결과·시나리오 렌더, 스크린샷 갤러리, 다운로드, pass·시나리오 삭제, 이전 pass 일괄 정리, 다크/라이트 전환. `--ensure` 는 떠 있으면 재사용하고 없을 때만 기동하며 접근 가능한 주소(localhost, `.local`, LAN, Tailscale)를 출력.
- 색·간격·형태 규격을 `@ultivis-iot/react` 의 light/dark 토큰과 button/badge 규격에서 가져오고 아이콘은 lucide 를 따름. 라이브러리를 의존성으로 들이지 않고 값만 이식. 심각도(P0/P1/P2)와 링크 색은 `--chart-*` 에서 분리했는데, light 의 chart-5 가 연주황이고 dark 는 핑크여서 같은 토큰이 테마마다 다른 의미가 되어 대비가 무너졌기 때문.
- 데스크톱 시나리오 기본 뷰포트를 `1920 × 1080` 으로 통일. 기존 기본값 `1440×1000`(1.44:1)과 변형 `1600×1000`(1.60:1)은 실제 화면 비율과 맞지 않고 시나리오마다 달라 같은 화면을 비교하기 어려웠음. 뷰포트가 곧 녹화 크기라 WebM 이 1.44배가 됨. 모바일은 기기 실제 비율(`390×844`)을 유지. 승인된 시나리오는 뷰포트가 `scenarioHash` 에 묶여 있어 바꾸지 않음.
- 시나리오 작성의 기본 입력을 `plan-snapshot.md` 로 지정. 전역 Plan 형식이 의도 섹션을 요구하므로 그 의도를 `job.outcome` 과 `successCriteria` 로 옮기면, 리뷰가 화면 반응이 아니라 승인된 의도의 충족 여부를 답하게 됨. Plan 이 없거나 다른 작업을 다루면 기존대로 요청과 제품에서 추론. 승인 화면에서 각 성공 기준의 출처를 밝히도록 하고 스키마는 바꾸지 않음.
- `SKILL.md` 와 `references/scenario-workflow.md` 의 `~/.codex/skills/...` 하드코딩 15곳을 `$UX` 로 정리해 설치 위치와 무관하게 동작하도록 하고, 결과 보고를 파일 절대경로 대신 뷰어 딥링크로 변경.
- 뷰어 자신을 대상으로 `ux-review` 를 수행해 P2 4건을 찾아 수정(준비도 ready, 하드 게이트 6/6): 세로 영상에서 좌측 컬럼이 비고 단계 목록이 눌리던 문제, pass·여정 버튼의 접근성 이름이 `review-017.1MB` 처럼 붙어 읽히던 문제, 정리된 리뷰 링크 진입 시 콘솔에 404 가 남던 문제, 녹화가 끝나지 않아 크기가 0인 WebM 을 재생하려다 416 이 나던 문제.

## v0.8.1 (2026-09-03)

- `ux-review` 가이드 녹화에 interaction helper 도입: action 콜백이 `(expectedStep, ui)`를 받고 `ui.fill`/`click`/`selectOption`/`check`/`uncheck`가 대상 스크롤, 앰버 펄스 하이라이트, 한 글자씩 타이핑, 감속 클릭, 결과 홀드, 스크린샷 전 하이라이트 제거를 담당. 보이는 조작은 헬퍼를 쓰고 직접 Locator 조작은 녹화 대상 밖 setup에만 허용.
- 가이드 페이싱 기본값과 계약 명문화: 타깃 인지 900ms, 클릭 220ms, 타이핑 90ms/자, 캡션 1.8초 선행. `interactionPacing`으로 연장만 허용하고, 증거 스크린샷은 캡션뿐 아니라 타깃 하이라이트도 없어야 하며 실행 메타데이터에 pacing과 헬퍼 호출 수를 기록.
- `ult-story-run.sh`에 남아 있던 Story 브랜치 모델 잔재 제거: handoff에서 더 이상 생성되지 않는 `story.github_issue_url`/`pr_url`/`branch`/`worktree` 조회를 걷어내고, 산출물 경로를 현재 worktree 기준 `tmp/story-run/<Notion Story id>/`로 고정. 기존에는 `run_key`가 항상 `story`로 고정돼 Story가 여러 개일 때 summary/prompts를 서로 덮어썼음.
- Story 브랜치·Story GitHub Issue 모델을 v0.6.4에서 제거한 이유(Story 브랜치는 단일 repository 안에만 존재할 수 있어 cross-repo Story에서 Task PR의 target이 성립하지 않음)를 `docs/workflow.md`, `docs/references/task-publishing-model.md`, `ult-notion.md`의 Cross-Repo 절에 명시.
- 문서-스크립트 드리프트 정리: `/ult-task-create`에 `--project`, `/ult-task-link-issue`에 `--auto`/`--yes`, `/ult-weekly-report`에 발행용 `--template` 옵션을 문서화하고, `ult-notion.md`의 Global scripts 목록에 `ult-story-run.sh`/`ult-wt-add.sh`/`ult-cache-refresh.sh` 추가.
- `verify-workflow.sh`가 `ult-weekly-collect.sh`, `ult-weekly-publish.sh`도 문법 검사하도록 확장.

## v0.8.0 (2026-08-28)

- `ux-review` 스킬 추가: 사용자 업무 시나리오 승인 → Playwright WebM·스크린샷·SRT 증거 수집 → ISO 9241/WCAG 2.2/ARIA APG/Nielsen 기준의 LLM UI/UX 평가 → 개선 반복 → 사용자 승인 교육 영상 제작 흐름을 제공.
- 시나리오 승인과 가이드 제작 승인을 SHA-256 기반의 별도 계약으로 분리하고, 반복 리뷰 증거와 최종 문서용 스크린샷을 같은 시나리오 단계에 연결.
- Codex 직접 설치, Codex `ult` 플러그인, Claude Code 스킬 설치 경로에 동일한 `ux-review` 번들을 배포하고 `ultivis-flow` 자연어 라우터에 UX 리뷰 신호를 추가.

## v0.7.2 (2026-07-19)

- `setup.sh`/`setup.ps1`에 구버전 파일 정리 단계 추가: 과거 이 저장소가 설치했다가 isaac → ult rename으로 사라진 commands 6개, scripts 7개를 설치/업데이트 시 `~/.claude`에서 제거. 명시적 목록 기반이라 사용자가 직접 만든 로컬 전용 파일은 건드리지 않음.

## v0.7.1 (2026-07-19)

- 설치본(`~/.claude`)에서만 수정되어 있던 `wayfinder` 티켓 모델 변경을 repo로 백포트: decision ticket을 해소 즉시 닫는 대신, 티켓 하나가 조사 → 확정 스펙 → 구현 전 과정을 담고 확정된 작업은 같은 티켓의 issue-keyed branch로 구현에 핸드오프 ("One ticket, plan through build"). `codex/skills/`와 `codex/plugins/dev-workflow/skills/` 두 사본 모두 갱신.
- `/ult-start-task`에 기존 Task/Issue가 지목된 경우의 분기 백포트: 새 Task/Issue/Story를 만들지 않고 해당 이슈 기준 브랜치(`ult-wt-add.sh`)에서 바로 구현하며, 이슈 코멘트의 확정 스펙을 Plan으로 사용.

## v0.7.0 (2026-07-16)

- `ultivis-flow`를 상시 기반으로 유지하면서 자연어 질의를 13개 독립 오버레이 스킬로 자동 라우팅하는 기본 라우터 추가.
- 경로가 명확하면 자동 선택하고, 결과를 바꾸는 복수 경로에서는 추천안을 먼저 둔 2~3개 선택지로 사용자 결정을 받도록 정리.
- Matt Pocock의 `tdd`, `diagnosing-bugs`, `research`, `domain-modeling`, `codebase-design`, `improve-codebase-architecture`, `wayfinder`, `resolving-merge-conflicts`와 productivity 스킬을 고정 커밋 기준으로 도입.
- `wayfinder`를 Notion Story → Notion Task + GitHub Issue 구조와 `Parent Task` dependency에 맞게 조정.
- `code-review`의 Spec Review/Standards Review를 `commit-and-verify`의 intent-validator/code-simplifier에 흡수.
- Claude/Codex 설치 스크립트와 Codex plugin이 전체 스킬 세트를 설치하도록 확장.

## v0.6.7 (2026-07-13)

- Codex skill에만 있던 Weekly Review 규칙(직전 Week 기본 대상, `마케팅` 템플릿 3섹션, 제목 규칙, 명시적 발행 요청 시에만 publish)을 `/ult-weekly-report` 명령과 Codex plugin 명령, `weekly-report-format.md`에 백포트.
- `ult-weekly-collect.sh`에서 Story/Project 캐시 파일이 없을 때 `jq` glob 확장 실패로 매핑이 깨지던 문제 수정.
- Codex 설치/문서를 현재 plugin/skill 구조에 맞춰 정리하고, 기본 사용법을 `/ult:...` slash command 대신 `ultivis-flow` skill과 자연어 요청 중심으로 수정.
- Codex plugin 설치 위치를 `~/.codex/plugins/ult`로 정리하고 marketplace entry가 해당 plugin을 가리키도록 수정.

## v0.6.6 (2026-05-04)

- `/review-cycle` 기본 실행이 Ralph Loop를 자동으로 시작하고, 내부 반복 라운드는 `/review-cycle ... --once`로 수행하도록 명령 프롬프트와 문서를 수정.
- Ralph Loop 완료 감지에 맞춰 review-cycle 완료 신호를 `<promise>REVIEW COMPLETE</promise>` 형식으로 정리.

## v0.6.5 (2026-04-30)
- `/review-cycle`을 한 라운드 처리 명령으로 정리하고, 자동 반복은 Ralph Loop가 `REVIEW COMPLETE` 완료 신호를 기준으로 담당하도록 문서와 설치본 프롬프트를 통일.
- Story/Task 선택 시 완료/미완료/취소된 과거 Story를 재사용하지 않도록 필터와 검증을 강화하고, 오래된 branch base나 과거 worktree 기반 Story 추론을 제거.
- PR 생성 target을 `origin/dev` 또는 repository default branch로 고정하고, local handoff/branch config/과거 PR에서 작업 브랜치를 target으로 추론하지 않도록 명시.
- `ult-my-tasks.sh`와 `ult-wt-add.sh`가 이슈 번호 포함 브랜치나 기존 worktree 경로를 잘못 재사용하지 않도록 방어 로직 추가.

## v0.6.4 (2026-04-29)
- Story는 Notion 조율 단위로 유지하고 GitHub Issue/PR은 Task 단위에만 만들도록 Story 생성, Task 추가, Story runner, PR/review 문서를 정리.
- workflow 스크립트와 Notion cache를 전역 설치 경로(`~/.codex`/`~/.claude`) 기준으로 해석하도록 강화해 작업 repo-local `scripts/` 탐색을 피하도록 수정.
- 브랜치/worktree 생성 전에 항상 `git fetch origin --prune`로 원격 refs를 최신화하고, 새 브랜치를 최신 원격 base 기준으로 만들도록 `ult-wt-add.sh`와 workflow 문서를 강화.
- Notion Story/Task 생성 시 template block 복사 대신 Notion template API를 사용하고, markdown body를 `설명` block 뒤에 삽입하도록 수정.
- Task 실행 중 사용자 승인 없이 후속 Task/Issue/branch/worktree를 생성하지 않고 carryover로 기록하도록 Story runner prompt와 workflow 문서를 강화.
- Story 기반 agent/worktree flow, cross-repo Story, `Parent Task` dependency 규칙을 workflow 문서와 Codex skill/plugin reference에 반영.
- Plan 작성/발행 전에 blocking question을 먼저 묻고, 사용자가 스스로 판단할 수 있도록 decision tradeoff를 제시하는 규칙을 추가.
- Story 생성 시 GitHub Story Issue와 Story branch/worktree를 만들지 않고, Task별 Issue/branch/worktree와 Task worktree handoff만 생성하도록 수정.
- `ult-story-run.sh` / `/ult-story-run`을 추가해 Story의 Ready/Blocked Task를 분석하고 subagent 실행 프롬프트를 생성하도록 지원.
- Story 생성 시 Task worktree별 `tmp/story-handoff.json`을 함께 만들고, `ult-story-run.sh`이 로컬 handoff를 먼저 사용한 뒤 Notion은 fallback으로 조회하도록 개선.
- `ult-task-create.sh`가 기존 Story를 GitHub Task Issue URL, current branch, local handoff에서 더 안정적으로 찾고 최신 원격 base를 기본 base로 사용하도록 개선.
- `ult-cache-refresh.sh`를 추가하고 `setup.sh`, `setup-codex.sh`, `setup.ps1` 설치 시 사용자별 `~/.claude/notion-cache` / `~/.codex/notion-cache`를 자동 준비하도록 개선.
- `verify-workflow.sh`가 Claude Code 설치본과 Codex 설치본을 구분해 검증하도록 수정.
- branch ancestry를 `gh-merge-base`, Notion Story comment, Task worktree handoff에 기록하고 review-cycle은 Task PR 기준으로 수행하도록 문서화.
- Notion Story/Task 생성 시 template 적용 실패를 감지하고, markdown body를 heading/list/todo Notion block으로 변환하도록 개선.
- `ult-task-create.sh`가 `--parent-task` 옵션으로 선행 Task relation을 설정할 수 있도록 확장.
- Codex skill display name/path renamed from `dev-workflow` to `ultivis-flow`.
- `setup-codex.sh --update` now removes the legacy `~/.codex/skills/dev-workflow` directory before installing `~/.codex/skills/ultivis-flow`.
- `ult-task-create.sh` now supports `--project` as an explicit recovery path when a Notion Repository has no Project relation.
- Ultivis task branch creation now prefers `origin/dev` when available instead of blindly following the remote default branch.

## v0.6.2 (2026-04-20)
- Codex command discovery 실험 정리:
  - `setup-codex.sh`가 Codex용 로컬 plugin marketplace와 workflow plugin 설치를 함께 처리하도록 확장
  - Codex용 workflow plugin 번들을 `codex/plugins/dev-workflow`에 추가
  - README에 Codex command/plugin 제약과 현재 설치 구조를 반영

## v0.6.1 (2026-04-20)
- Codex rules 안전성 정리:
  - `codex/rules/dev-workflow.rules`를 유효한 최소 Starlark 파일로 정리해 startup parse error 방지
  - Codex 워크플로우의 실제 책임이 `dev-workflow` skill에 있음을 README와 설치 안내에 명시
  - `setup-codex.sh` 출력 문구를 skill 중심 흐름에 맞게 조정

## v0.6.0 (2026-04-20)
- Codex 지원 추가:
  - `setup-codex.sh` 신설 — `~/.codex/rules`, `~/.codex/skills`, `~/.codex/dev-tools` 설치
  - `codex/rules/dev-workflow.rules` 추가 — 개발 플로우를 Codex 규칙으로 적용
  - `codex/skills/dev-workflow` 추가 — commit/validate/PR/review/Ultivis 흐름을 Codex skill로 제공
- Ultivis 명령 프리픽스 및 문서 정리:
  - `isaac-*` 명령/스크립트를 `ult-*`로 정리
  - Plan 승인 후 흐름을 `AI 제안 + 사용자 확인 + 실행` 방식으로 재구성
  - README와 workflow 문서의 진입점/온보딩 문구 정리
- 워크플로우 명령 슬림화 및 검증 보강:
  - `commit-and-verify`, `create-pr`, `review-cycle`, `visual-qa`, `ult-story-create` 문서 토큰 최적화
  - validation contract/reference 및 `verify-workflow.sh` 기반 검증 추가

## v0.5.0 (2026-04-17)
- **Notion MCP 연동** — setup.sh/ps1에 Internal Integration Token 등록 단계 추가 (user scope)
- **Isaac 스킬 6개 추가**:
  - `/isaac-my-tasks` — 본인 Task 조회 + worktree 자동 생성
  - `/isaac-story-create` — Plan → Story + Task N + Issue N + worktree N 일괄
  - `/isaac-task-create` — 기존 Story에 Task 추가
  - `/isaac-task-note` — Task에 메모 코멘트
  - `/isaac-task-status` — 비정형 상태 변경 (취소/재개)
  - `/isaac-weekly-report` — 주간 작업 정리 + 발행
- **공통 헬퍼**:
  - `scripts/notion-api.sh` — 토큰/캐시(members/projects/repos/schemas/templates)/lookup
  - `scripts/isaac-wt-add.sh` — repo abbr 기반 worktree 생성
- **기존 스킬 확장**:
  - `/issue` — Notion Task/Story/Project 컨텍스트 추가
  - `/commit-and-verify` — 검증 결과를 Task 코멘트로 자동 동기화
- **dev-tools 리팩터**:
  - `MAIN_PROJECT` 제거, `WORKTREE_ROOT`로 통합 (다중 프로젝트 지원)
  - repo 이니셜 축약 기반 폴더명 (`pm` / `ub` / `url` / `ccs` 등)
  - `dw` 2-tier hook 조회 (`.isaac/dw.sh` → `~/.claude/dev-tools/hooks/<repo>.sh` → 레거시)
  - `isaac-init` 명령어 신설 (status/setup/check/dw-hook)
- **Plan 승인 hook**: worktree 감지 + Plan 성격별 스킬 분류 추천

## v0.4.0 (2026-04-02)
- Docker 멀티유저 격리 지원 — 사용자명 해시 기반 포트 자동 할당 및 COMPOSE_PROJECT_NAME 자동 설정
- dev-commands.sh에서 하드코딩된 포트 제거, 사용자별 자동 계산으로 대체
- dw 명령어에 사용자별 --env-file 지원 추가
- setup.sh .env 생성 시 Docker 멀티유저 격리 안내 포함

## v0.3.0 (2026-02-06)
- visual-qa 커맨드 추가 — Chrome MCP 브라우저 자동화로 React 프론트엔드 UI/UX 검증
- visual-qa-analyzer 에이전트 추가 — 수집 데이터 기반 디자인 품질 평가 및 이슈 판정
- commit-and-verify에 visual-qa 선택적 3단계 통합 — 프론트엔드 변경 감지 시 사용자에게 제안
- validation-status.schema.json에 visual-qa 필드 추가

## v0.2.1 (2025-01-25)
- commit-and-verify에서 Plan 파일 선택 기능 추가 - 최근 5개 Plan 중 사용자가 직접 선택
- 동시 세션 환경에서 정확한 Plan 선택 지원

## v0.2.0 (2025-01-25)
- test-validator 추가 - 테스트 커버리지 및 테스트 통과 여부 검증
- test-validator를 검증 플로우(commit-and-verify)에 통합

## v0.1.2 (2025-01-25)
- Plan 복사 hook 수정 - `~/.claude/plans/`에서 최신 Plan 파일 복사 방식으로 변경
- ExitPlanMode 도구에 plan 파라미터가 없는 문제 해결

## v0.1.1 (2025-01-18)
- 버전 정책 도입 및 문서화
- setup.sh에 버전 비교 및 업데이트 내역 출력 기능 추가
- VERSION 파일 추가

## v0.1.0 (2025-01-18)
- Plan 복사 hook 개선 - tool_input.plan에서 직접 추출 방식으로 변경
- .gitignore 추가

## v0.0.x (2025-01-08 ~ 2025-01-15)
- subagent 결과 취합 방식 개선 - 메인에서 validation-status.json 생성
- templates/ 디렉토리 분리, 업데이트 검증 문서화
- 업데이트 시 원격 저장소 자동 pull 기능 추가
- security-validator commit-and-verify 호출 금지 강화
- Plan 승인 시 자동 복사 hook 추가
- --update 옵션 추가
- 커밋 메시지 컨벤션 문서화
- validation-status 스키마 및 브랜치별 검증 추가
- 서브에이전트 제한사항 명시
- PowerShell 한글 인코딩 수정
- Windows PowerShell 설치 스크립트 추가
- 최초 릴리스
