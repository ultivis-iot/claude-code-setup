# qwen-delegate

범위를 정한 코드 리뷰·탐색·구현을 사내 vLLM 의 Qwen(`ultivis/ultivis-vl`)에 Pi 하네스로 맡기는 Claude Code 플러그인입니다. Qwen 이 파일을 읽고 추적하는 토큰을 쓰고, Claude 는 작업 정의·난이도 선택·결과 검증만 합니다.

## 포함

- 스킬 `qwen-delegate` — 사용자가 부르는 입구. 지금 대화의 맥락으로 브리프(대상·시나리오·수용 기준·난이도)만 쓰고 서브에이전트에 넘긴다
- 에이전트 `qwen-worker`(Sonnet) — 난이도별 effort(`medium`/`xhigh`) 선택, Qwen 실행, 지적의 file:line·diff·시험 확인, 짧은 요약 반환
- 실행기 `skills/qwen-delegate/scripts/delegate.mjs` — Node.js 22 이상, 의존성 없음(`run`·`check`·`setup`)

Qwen 보고서(수천~1만 자)와 검증용 파일 읽기는 서브에이전트 컨텍스트에만 쌓이고, 메인 대화에는 요약만 돌아옵니다. 서브에이전트를 스킬의 `context: fork` 로 띄우지 않는 이유: fork 는 대화를 보지 못해, 적중률을 가르는 범위·시나리오를 브리프에 담을 수 없습니다.

사용 예: `/qwen-delegate 인증 토큰 갱신 경로를 재시도·만료 상황에서 리뷰해줘`

## 설치

조직 관리자가 claude.ai Organization library 에 이 폴더를 플러그인으로 올리면, 각자 Claude Code 의 `/plugin` 화면에서 `qwen-delegate` 를 골라 설치합니다. 아래 설정이 없는 사람에게는 동작하지 않으므로 자동 설치가 아닌 선택 설치로 둡니다.

## 각자 해야 하는 설정 (플러그인이 대신하지 않음)

Linux/macOS 전용입니다. 사내망 또는 VPN 이 필요합니다.

```bash
# 1) Pi 설치 (Node.js 22.19 이상)
npm install -g --ignore-scripts @earendil-works/pi-coding-agent

# 2) 사내 엔드포인트와 키 — OpenCode 배포(setup-opencode.sh)와 같은 변수
export ULTIVIS_ENDPOINT=http://<사내 vLLM 주소>:8000/v1
export ULTIVIS_API_KEY=<발급받은 키>     # 셸 프로필에 넣어 둡니다

# 3) ~/.pi/agent/models.json 에 사내 모델 병합 (기존 파일은 백업, 다른 provider 는 유지)
PLUGIN=<플러그인 설치 경로>              # /plugin 화면 또는 ~/.claude/plugins 아래
node "$PLUGIN/skills/qwen-delegate/scripts/delegate.mjs" setup

# 4) 점검 — ready: true 가 나오면 끝
node "$PLUGIN/skills/qwen-delegate/scripts/delegate.mjs" check --ping
```

`setup` 은 키를 파일에 쓰지 않고 `${ULTIVIS_API_KEY}` 참조만 남깁니다. 응답 한도(`maxTokens`)는 65536 으로 둡니다 — 32768 이면 `xhigh` 구현에서 생각 도중 잘립니다.

## effort 고르기

`low`(instant)는 받지 않습니다. 기준과 실측은 [qwen-worker.md](agents/qwen-worker.md) 의 난이도 표에 있습니다. 요약하면 결함을 찾는 리뷰와 파일을 건너는 추적은 `xhigh`, 구현과 탐색은 `medium` 입니다. 같은 1 파일 구현을 비교하면 `medium` 9분·+92줄, `xhigh` 41분·+486줄로 둘 다 숨은 회귀 시험을 통과했습니다.

## 운영 서버와 같은 자원을 씁니다

이 vLLM 은 사내 서비스도 함께 씁니다. 위임 1건이 5~45분 동안 서버 자리 하나를 점유하므로, 한 사람이 동시에 여러 건을 띄우지 않습니다. 실행 기록은 `~/.local/state/qwen-delegate/runs/` 에 남고, 결과 JSON 의 `output_tokens`·`peak_input_tokens` 로 사용량을 볼 수 있습니다.

## 하네스

Pi 만 지원합니다. Pi 는 리뷰 모드의 읽기 전용 도구 제한을 실행 인자(`--tools`)로 겁니다. OpenCode 에서 같은 제한을 걸려면 `opencode.json` 에 전용 에이전트 프로필이 있어야 하는데, 사내 배포 `setup-opencode.sh` 는 그 파일을 통째로 다시 쓰므로 프로필이 유지되지 않습니다.
