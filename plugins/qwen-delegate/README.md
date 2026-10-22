# qwen-delegate

범위를 정한 코드 리뷰·탐색을 사내 vLLM 의 Qwen(`ultivis/ultivis-vl`)에 Pi 하네스로 맡겨 **Claude 로 가는 토큰을 줄이는** Claude Code 플러그인입니다. 파일을 읽고 추적하는 일은 Qwen 이, 지적 확인은 Sonnet 서브에이전트가 하고, 메인 대화는 브리프와 결과 전달만 합니다.

## 포함

- 스킬 `qwen-delegate` — 사용자가 부르는 입구. 메인 대화는 파일을 열지 않고 대화에 있는 정보로 브리프(대상·시나리오·effort)만 써서 서브에이전트에 넘기고, 돌아온 요약을 다시 추적하지 않고 전한다
- 에이전트 `qwen-worker`(Sonnet) — Qwen 실행, 지적마다 그 file:line 만 열어 확인함·틀림·미확인으로 나눈 짧은 요약 반환
- 실행기 `skills/qwen-delegate/scripts/delegate.mjs` — Node.js 22 이상, 의존성 없음. `start`/`wait`(셸 도구의 10분 상한에 걸리지 않게 떼어 띄우고 기다림), `run`, `check`, `setup`

서브에이전트를 스킬의 `context: fork` 로 띄우지 않는 이유: fork 는 대화를 보지 못해, 적중률을 가르는 범위·시나리오를 브리프에 담을 수 없습니다.

사용 예: `/qwen-delegate 인증 토큰 갱신 경로를 재시도·만료 상황에서 리뷰해줘`

## 설치

조직 관리자가 claude.ai Organization library 에 이 폴더를 플러그인으로 올리면, 각자 Claude Code 의 `/plugin` 화면에서 `qwen-delegate` 를 골라 설치합니다. 아래 설정이 없는 사람에게는 동작하지 않으므로 자동 설치가 아닌 선택 설치로 둡니다.

## 각자 해야 하는 설정

Linux/macOS, 사내망 또는 VPN, Node.js 22.19 이상이 필요합니다. 나머지는 `setup` 이 합니다.

1. 셸 프로필(`~/.bashrc`·`~/.zshrc`)에 사내 엔드포인트와 키를 넣고 Claude Code 를 다시 시작합니다. 사내 OpenCode 배포(`setup-opencode.sh`)와 같은 값입니다.
   ```bash
   export ULTIVIS_ENDPOINT=http://<사내 vLLM 주소>:8000/v1
   export ULTIVIS_API_KEY=<발급받은 키>
   ```
2. Claude Code 에서 `/qwen-delegate 설정해줘` 라고 하면 Claude 가 `delegate.mjs setup` 을 실행합니다. 직접 돌릴 때는 `node <플러그인 경로>/skills/qwen-delegate/scripts/delegate.mjs setup`.
   - Node 버전 확인
   - Pi(`@earendil-works/pi-coding-agent`)를 검증한 고정 버전 1.4.0 으로 설치(`npm install -g --ignore-scripts`). 이미 같은 버전이면 건너뜁니다. 다른 버전은 `--pi-version` 으로 지정
   - `~/.pi/agent/models.json` 을 백업한 뒤 사내 모델만 병합(다른 provider 유지, 키는 파일에 쓰지 않고 `${ULTIVIS_API_KEY}` 참조, 응답 한도 65536)
   - 엔드포인트 연결 점검 — `ready: true` 가 나오면 끝

전역 npm 설치 권한이 없다고 나오면 `npm config set prefix ~/.local` 후 `~/.local/bin` 을 PATH 에 넣고 다시 실행합니다. 응답 한도 65536 은 `xhigh` 에 필요합니다 — 32768 이면 생각 도중 잘립니다.

## 무엇을 맡기나 — Claude 토큰 실측

같은 리뷰 3건(함수 1개, 파일 3개 호출 경로, 동시성·재시도)을 세 방식으로 돌려 Claude 로 간 토큰을 쟀습니다(`claude -p` 의 사용량, Qwen 토큰 제외). 모두 실제 버그를 찾았습니다.

| 방식 | Claude 토큰 (3건 평균) | 그중 Opus | 비용 환산 |
|---|---|---|---|
| Claude 가 직접 | 81.7만 | 81.7만 | $0.94 |
| **이 플러그인 (메인 브리프 + Sonnet 확인)** | **26.6만 (−67%)** | **8.9만 (−89%)** | $0.64 (−32%) |
| 서브에이전트 없이 메인이 Qwen 을 직접 부르고 확인 | 35.3만 (−57%) | 35.3만 | $0.63 |

헤드리스 세션 기준이라 메인 컨텍스트가 작습니다(약 3.7만). 실제 대화는 메인 컨텍스트가 훨씬 커서 메인의 턴 수가 적은 이 구조(메인 2턴)가 더 유리해집니다 — 직접 하면 11~17턴, 서브에이전트 없이는 7~10턴이 매번 그 컨텍스트를 다시 읽습니다.

- **리뷰·탐색만 맡깁니다.** 1 파일 구현을 맡기면 81만 → 99만으로 오히려 늘었습니다(Qwen diff 의 버그를 Opus 가 찾아 고치는 비용).
- effort: 결함을 찾는 리뷰는 `xhigh`, 탐색은 `medium`. `low`(instant)는 받지 않습니다.
- 직접 하는 편이 나은 일: 도구 몇 번이면 끝나는 일(서브에이전트 기동비가 더 큼), 열린 리뷰·설계 결정·보안의 최종 판정, DB·통합 환경이 필요한 확인.
- 대신 느립니다: 직접 2~3분, 위임 8~16분. 위임은 백그라운드로 돕니다.

## 운영 서버와 같은 자원을 씁니다

이 vLLM 은 사내 서비스도 함께 씁니다. 위임 1건이 5~15분 동안 서버 자리 하나를 점유하므로, 한 사람이 동시에 여러 건을 띄우지 않습니다. 실행 기록은 `~/.local/state/qwen-delegate/runs/` 에 남고, 결과 JSON 의 `output_tokens`·`peak_input_tokens` 로 사용량을 볼 수 있습니다.

## 하네스

Pi 만 지원합니다. Pi 는 리뷰 모드의 읽기 전용 도구 제한을 실행 인자(`--tools`)로 겁니다. OpenCode 에서 같은 제한을 걸려면 `opencode.json` 에 전용 에이전트 프로필이 있어야 하는데, 사내 배포 `setup-opencode.sh` 는 그 파일을 통째로 다시 쓰므로 프로필이 유지되지 않습니다.
