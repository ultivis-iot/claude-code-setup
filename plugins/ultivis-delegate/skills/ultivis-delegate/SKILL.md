---
name: ultivis-delegate
description: Save Claude tokens by handing a bounded code review, bug hunt, or codebase exploration to the internal Ultivis model via the ultivis-worker subagent. Use proactively, even when the user does not mention delegation, whenever doing the request yourself would mean reading several files or making more than about ten tool calls (e.g. "review this module for retry bugs", "where is X used and how does it flow"). Do not use for implementation, quick lookups, open-ended design questions, or checks that need a database or running services. Also use when the user asks to set up the internal model.
---

# 사내 모델 위임

목적은 **Claude 로 가는 토큰을 줄이는 것**이다. 파일을 읽고 추적하는 일은 사내 모델(Ultivis vLLM, Pi 하네스)이 하고, 지적 확인은 `ultivis-delegate:ultivis-worker` 서브에이전트(Sonnet)가 한다. 이 대화(메인)가 쓰는 토큰은 브리프와 결과 전달뿐이어야 한다.

사용자가 위임을 말하지 않아도, 아래 1절의 "맡기는 일" 에 해당하면 스스로 위임한다. 사용자가 "직접 해줘" 라고 하면 위임하지 않는다.

## 메인이 하지 않는 일

메인이 아래를 하면 위임해서 아낀 토큰을 다시 쓴다(실측: 메인이 브리프를 쓰려고 코드를 읽고 지적을 다시 추적해 Opus 몫이 25만 토큰이 됐다).

- **파일을 열거나 검색하지 않는다.** 브리프는 이 대화에 이미 있는 정보와 사용자 요청으로만 쓴다. 대상 경로를 모르면 사용자가 말한 이름 그대로 적는다 — 위치는 서브에이전트가 찾는다.
- **돌아온 지적을 다시 추적하지 않는다.** 서브에이전트가 확인함·틀림·미확인으로 나눠 온다. 그대로 전한다. 사용자가 특정 지적을 더 보자고 할 때만 그 자리를 연다.
- 위임 작업으로 `delegate.mjs` 를 직접 돌리지 않는다(설정 확인·설정만 예외 — 0절).

## 0. 설정

**스스로 위임하기 전에, 이 대화에서 처음 한 번** 설정을 확인한다(파일만 보는 가벼운 점검):

```bash
node ${CLAUDE_SKILL_DIR}/scripts/delegate.mjs check
```

`"ready": false` 면 위임하지 않고 직접 한다. 사용자에게 한 줄로 알린다: "사내 모델 위임이 설정되지 않아 직접 처리합니다 — `/ultivis-delegate 설정해줘` 로 설정할 수 있습니다." 같은 대화에서 다시 확인하지 않는다.

사용자가 설정·설치를 요청하면(예: `/ultivis-delegate 설정해줘`) 이 대화에서 실행한다:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/delegate.mjs setup
```

Node 22.19 이상을 확인하고, Pi 를 검증한 고정 버전으로 설치하고, `~/.pi/agent/models.json` 에 사내 모델을 병합한 뒤 연결을 점검한다. `ULTIVIS_ENDPOINT`·`ULTIVIS_API_KEY` 가 없다고 나오면 셸 프로필에 넣고 Claude Code 를 다시 시작하라고 안내한다(사내 OpenCode 배포와 같은 값). 출력의 `problems` 를 그대로 전한다.

## 1. 맡길지 정한다

맡기는 일 — 직접 하면 여러 파일을 읽고 도구를 10번 넘게 부를 일:

| 종류 | 상한 | 실측 (Claude 로 간 토큰, 직접 → 위임) |
|---|---|---|
| 리뷰·버그 찾기 | 대상과 시나리오를 정해 줄 수 있으면 함수 1개부터 5~6 파일과 관련 SQL 추적까지 | 81만 → 30만, 98만 → 24만, 66만 → 26만 (Opus 는 각 9만) |
| 탐색 | "X 가 어디서 쓰이나", 호출 흐름·모듈 구조 요약 | — |

직접 하는 일:
- **구현.** 실측 81만 → 99만으로 오히려 늘었다 — 사내 모델의 diff 를 검토하고 고치는 비용이 직접 짜는 비용보다 컸다.
- 도구 몇 번이면 끝나는 일 — 서브에이전트 기동비(새 토큰 약 4.5만)가 더 크다.
- 검증이 다시 하는 것과 같은 일 — "모듈 전체 검토"처럼 열린 리뷰(먼저 사용자와 범위를 좁힌다), 설계 결정, 보안의 최종 판정.
- DB·통합 환경·비밀값·실행 중인 서비스가 있어야 확인되는 일.

시간은 기준이 아니다(위임은 5~15분, 직접은 2~3분). 사용자가 빠른 답을 원하면 "직접 해줘" 로 고른다.

스스로 위임할 때는 시작하며 한 줄로 알린다: "읽을 파일이 많아 사내 모델에 맡겼습니다(5~15분). 직접 하길 원하시면 말씀해 주세요."

## 2. 브리프를 쓴다

서브에이전트와 사내 모델은 이 대화를 보지 못한다. 대화에 있는 것만으로 짧게:
- 절대 경로 작업 디렉토리
- 대상(파일·함수·기능 이름 — 아는 만큼)과 그 값이 어디에 쓰이는지(대화에 있으면)
- 검토할 시나리오: "어떤 상황에서 무엇이 틀릴 수 있나" — 실측에서 이 한 줄이 적중률을 갈랐다
- 보고 언어
- effort: 결함을 찾는 리뷰는 `xhigh`, 탐색은 `medium`. 사용자가 지정했으면 그것

## 3. 넘기고 전한다

Agent 도구로 `subagent_type: "ultivis-delegate:ultivis-worker"` 에 브리프를 넘긴다. 백그라운드로 두고 다른 일을 계속한다. 돌아온 요약을 사용자에게 그대로 전한다. 서브에이전트가 설정 문제(`output_limit`, `warnings`, 실행 실패)를 알리면 그 작업은 직접 하지 말고 결과를 전하며 `/ultivis-delegate 설정해줘` 를 안내한다.
