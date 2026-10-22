---
name: qwen-delegate
description: Hand a bounded code review, repository exploration, or scoped implementation to the internal Qwen model through Pi, via the qwen-worker subagent. Use only when the user asks to hand work to Qwen, Pi, or the internal model.
---

# Qwen 위임

사내 Qwen 에게 작업을 맡긴다. 이 대화에서는 **브리프만 쓰고**, Qwen 실행·검증은 `qwen-delegate:qwen-worker` 서브에이전트(Sonnet)가 한다. Qwen 보고서와 검증용 파일 읽기가 이 대화의 컨텍스트에 쌓이지 않게 하려는 구조다 — 이 대화에서 `delegate.mjs` 를 직접 돌리지 않는다.

## 1. 맡길지 정한다

맡기지 않고 직접 하는 일:
- 설계 결정이 열려 있는 일, 여러 파일에 걸친 구조 변경
- DB·통합 환경·비밀값이 있어야 확인되는 일
- 범위가 "모듈 전체 검토"처럼 열려 있어 시나리오를 적을 수 없는 일 — 사용자와 범위를 먼저 좁힌다

## 2. 브리프를 쓴다

서브에이전트와 Qwen 은 이 대화를 보지 못한다. 대화에서 알게 된 것을 브리프에 담는다:
- 절대 경로 작업 디렉토리, 모드(`review` 또는 `implement`)
- 대상 파일·함수와 그 값이 어디에 쓰이는지
- 검토할 시나리오("어떤 상황에서 무엇이 틀릴 수 있나") 또는 구현 명세와 제약 — 실측에서 이 한 줄이 적중률을 갈랐다
- 구현이면 수용 기준, 돌릴 시험 명령, 격리된 worktree 경로(없으면 먼저 만든다. 같은 체크아웃에 쓰는 작업자를 둘 두지 않는다)
- 보고 언어
- 난이도 판단: 결함을 찾는 리뷰·파일 간 추적·동시성·보안이면 `xhigh`, 구현과 탐색은 `medium`(구현 xhigh 는 4배 넘게 걸리고 명세 밖까지 짓는다). 사용자가 지정했으면 그것을 적는다

## 3. 넘긴다

Agent 도구로 `subagent_type: "qwen-delegate:qwen-worker"` 에 브리프를 넘긴다. 위임은 5~45분 걸리므로 백그라운드로 두고 다른 일을 계속한다.

## 4. 받는다

서브에이전트는 확인된 지적과 틀리거나 미확인인 지적을 나눠 돌려준다. 사용자에게는 확인된 것을 중심으로 전하고, 구현은 worktree 의 diff 를 받아들이기 전에 직접 훑는다. 서브에이전트가 `output_limit` 이나 설정 경고를 돌려주면 사용자에게 `node ${CLAUDE_SKILL_DIR}/scripts/delegate.mjs setup` 과 README 의 설정 절을 안내한다.
