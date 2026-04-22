# Story 실행 준비

Story handoff를 읽고, dependency 기준으로 Ready/Blocked를 판정한 뒤 서브에이전트에 넘길 실행 프롬프트를 생성합니다.

## 실행

```bash
~/.codex/scripts/ult-story-run.sh [story-issue|story-issue-url|handoff-json|notion-story-url]
```

## 동작

- 로컬 `tmp/story-handoff.json`을 먼저 찾는다.
- 없으면 GitHub Story Issue의 handoff comment를 읽는다.
- 그래도 없을 때만 Notion Story/Task를 fallback으로 조회한다.
- `Parent Task` dependency를 평가한다.
- Ready Task와 Blocked Task를 구분한다.
- Task별 branch/base/worktree 상태를 정리한다.
- Ready Task별 subagent prompt를 생성한다.
- 결과를 `tmp/story-run/<story>/summary.md`와 `prompts/` 아래에 저장한다.

## 옵션

| 옵션 | 동작 |
|---|---|
| `--publish` | 실행 요약을 GitHub Story Issue에 코멘트로 남김 |
| `--json` | markdown 대신 JSON summary 출력 |

## 에이전트 실행 규칙

이 명령은 subagent를 직접 실행하지 않습니다. 메인 에이전트는 출력된 Ready Task prompt를 보고, 사용자가 subagent/병렬 실행을 허용한 경우에만 각 Task subagent를 시작합니다.

subagent는 반드시 지정된 Task worktree만 수정하고, Task PR은 Story branch를 target으로 만들어야 합니다.
