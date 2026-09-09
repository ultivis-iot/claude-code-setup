# 커밋과 검증 계약

이 문서가 Claude/Codex 공통 실행 절차의 원본이다. 실행 전에 읽는다.
`WF`는 설치 루트(Claude: `~/.claude`, Codex: `${CODEX_HOME:-$HOME/.codex}`) 또는 이 설정 저장소의 절대 경로다.
검증 실행에는 Node.js가 필요하다. `<repo>`는 대상 저장소, 명령의 작업 디렉터리도 그 저장소로 맞춘다.

## 실행

1. 사용자 요청 범위, git status, staged diff를 확인한다. 요청 범위의 변경만 커밋한다. 메시지가 없으면 diff에 맞는 conventional commit 메시지를 작성한다. 변경이 이미 커밋됐으면 바로 검증한다.
2. 현재 대화에서 승인된 Plan/Issue/Task를 기준으로 삼는다. `tmp/current-plan.md`가 있으면 현재 요청과 일치하는지 먼저 확인한다. 다른 세션의 최신 Plan을 자동 선택하지 않는다. 이슈/요청만으로 기준이 충분하면 Plan 파일 없이 진행하고 사용한 기준을 의도 검증 증거에 남긴다.
3. `git fetch origin --prune` 후 PR target을 결정한다. 명시된 target을 우선하고, 없으면 `origin/dev`, 없으면 원격 default branch를 사용한다. 검증의 base ref는 `origin/<target>`이다. `tmp/`는 gitignore 또는 개인 exclude에서 제외한다.
4. 검증 시작 **전에** 다음 스냅샷을 만든다. 작업 트리가 dirty면 먼저 변경을 정리한다.

```bash
node "$WF/scripts/validation-gate.mjs" snapshot --repo <repo> --base origin/<target> --out tmp/validation-snapshot.json
```

5. Spec Review를 먼저 실행한다. 승인된 의도·범위·성공 조건과 diff/테스트 증거를 비교한다. `PASS`일 때만 문서·보안·Standards Review·테스트 검증을 실행한다. 각 리뷰 입력에는 저장소 절대 경로, 스냅샷의 base/head SHA, 그 사이 diff와 변경 목록, 승인된 성공 조건을 전달한다. 기준 브랜치를 각 리뷰가 추측하지 않는다. 각 리뷰 기준은 `$WF/agents/<validator>.md`를 읽는다. Codex에서는 이 파일을 리뷰 지침으로 읽으며 Claude의 agent 등록이나 model 필드를 가정하지 않는다. 병렬 실행은 현재 세션의 위임 권한이 있을 때만 사용한다.
6. `.cli-sync.json`의 `enabled: true`이면 CLI 검증도 필수다. Visual QA는 사용자 요청/기존 승인에 따라 수행하고, 미실행이면 `SKIP` 또는 `PENDING`과 사유를 기록한다.
7. 메인 에이전트가 리뷰 응답을 아래 입력 형식으로 `tmp/validator-results.json`에 저장한다. 각 상태에는 구체적인 명령·종료 코드·로그 경로 또는 검토한 파일/라인 근거를 연결한다. 테스트 환경 부족·시간 초과는 성공으로 바꾸지 않는다. Spec 실패 후 실행하지 않은 검증은 `SKIP`과 사유를 남긴다.
8. 실행기로 결과를 집계하고 현재 상태를 확인한다.

```bash
node "$WF/scripts/validation-gate.mjs" record --repo <repo> --snapshot tmp/validation-snapshot.json --results tmp/validator-results.json --out tmp/validation-status.json
node "$WF/scripts/validation-gate.mjs" ready tmp/validation-status.json --repo <repo> --base origin/<target>
```

## 리뷰 응답 입력

```json
{
  "intent-validator": {"status": "PASS", "evidence": ["승인된 issue URL, 성공 조건과 diff/test 결과의 대응"]},
  "doc-validator": {"status": "PASS", "evidence": ["검토한 문서 경로와 변경 근거"]},
  "security-validator": {"status": "PASS", "evidence": ["검토 범위와 보안 검사 결과"]},
  "code-simplifier": {"status": "PASS", "evidence": ["저장소 표준과 변경 코드 검토 결과"]},
  "test-validator": {"status": "PASS", "evidence": ["실제 테스트 명령, 종료 코드, 로그 경로"]}
}
```

위 문구는 입력 구조 설명이다. 실행 시 실제 근거로 채운다.
일반 상태는 `PASS|WARN|FAIL|SKIP`, Visual QA에는 `PENDING`도 허용한다.
결과 파일은 실행기가 생성한다. 모델이 최종 `overall`, SHA 또는 스냅샷을 수동 작성하지 않는다.

## 게이트 의미

- `check`: v2 스키마, 결과 집계 일치, 근거 존재를 검사한다. PR 준비 완료를 뜻하지 않는다.
- `ready`: 의도 PASS, 필수 리뷰 PASS/WARN, FAIL 없음, 동일 repository/branch/HEAD/base/Plan/CLI 설정, clean worktree를 추가 검사한다.
- `record`: 시작 스냅샷과 종료 상태가 일치할 때만 결과를 저장한다.
- 결과가 FAIL이거나 필수 리뷰가 SKIP이면 PR을 만들지 않는다. 메인 에이전트가 수정하고 커밋한 뒤 새 스냅샷으로 다시 검증한다.
- 기존 v1 결과는 재사용하지 않고 검증을 다시 실행한다.
- 근거 문자열과 해시는 실행의 추적성과 변경 감지를 제공한다. 사용자 승인이나 모델 리뷰의 정확성을 독립적으로 증명하지는 않는다.

## 실행 주체

검증자는 리뷰 결과를 반환한다. 코드 수정·커밋·PR·외부 코멘트는 수행하지 않는다.
보안 검사 도구 호출은 허용하지만 lifecycle command를 재귀 호출하지 않는다.
Standards Review가 제안한 리팩터링은 메인 에이전트가 수행한다. 검증 자체가 수정 단계는 아니다.
PR 생성은 별도의 create-pr 계약을 따른다. 커밋 후 검증이므로 Git의 게시 차단 지점은 pre-push다.
