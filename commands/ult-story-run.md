---
allowed-tools: Bash(git:*), Bash(gh:*), Bash(node:*), Read, Write
description: Story handoff를 읽어 dependency 기준으로 Ready/Blocked를 판정하고 서브에이전트에 넘길 실행 프롬프트를 생성
argument-hint: [task-issue|handoff-json|notion-story-url] [--publish]
---

# Story 실행 준비

Story handoff를 읽고, dependency 기준으로 Ready/Blocked를 판정한 뒤 서브에이전트에 넘길 실행 프롬프트를 생성합니다.

## 실행

```bash
node ~/.claude/scripts/ult-notion.mjs story-run [task-issue|handoff-json|notion-story-url] [--publish] [--json]
```

Codex에서는:

```bash
node ~/.codex/scripts/ult-notion.mjs story-run [task-issue|handoff-json|notion-story-url]
```

인자: `$ARGUMENTS`

## 동작

- 로컬 `tmp/story-handoff.json`을 먼저 찾는다 (인자가 파일이면 그 파일).
- 없으면 인자/현재 브랜치의 GitHub Issue 코멘트에 올라간 handoff 를 찾는다.
- 그래도 없을 때만 Notion Story와 연결된 Task 목록을 조회한다 (`story-run-fetch` 와 같은 소스).
- `Parent Task` dependency를 평가한다.
- Ready Task와 Blocked Task를 구분한다.
- Task별 branch/base/worktree 상태를 정리한다.
- Ready Task별 실행 prompt를 생성한다 (추천 모델, Story 공통 맥락 포함, PR 생성 후 종료).
- 결과를 `tmp/story-run/<story>/summary.md`와 `prompts/` 아래에 저장한다.

판정과 프롬프트 생성은 `ult-flow.mjs story-eval` 이 하고, Notion fallback 입력 JSON 은 `ult-notion.mjs story-run-fetch [ref]` 로 따로 뽑아볼 수 있다.

## 옵션

| 옵션 | 동작 |
|---|---|
| `--publish` | 실행 요약을 Notion Story 페이지 본문에 기록 |
| `--json` | markdown 대신 JSON summary 출력 |

## 에이전트 실행 규칙

이 명령은 Task를 직접 실행하지 않습니다. 메인 에이전트는 실행 요약을 보여준 뒤 아래 순서로 진행합니다.

1. Ready Task가 있으면 실행을 시작하기 **전에** 실행 방식을 사용자에게 묻습니다 (AskUserQuestion, 선택지 2개).
   - **서브에이전트 병렬 (Recommended)**: 메인 세션이 Task마다 서브에이전트를 띄웁니다. 자동으로 진행되고 토큰이 가장 적게 듭니다.
   - **herdr thread**: Task마다 herdr pane에서 claude 세션을 엽니다. 사람이 각 Task를 지켜보고 중간에 지시할 수 있지만, 세션마다 기본 비용이 들고 herdr 서버가 떠 있어야 합니다.
2. 서브에이전트를 고르면 Task마다 `Agent`의 `model`을 실행 요약의 Model 값으로 지정해 띄웁니다 (fork 금지, 생성된 prompt 파일 내용만 전달).
3. herdr를 고르면 다음 명령을 실행합니다. 실패한 Task는 결과 JSON의 `error`를 사용자에게 보여주고, 다른 방식으로 자동 전환하지 않습니다.
   ```bash
   node ~/.claude/scripts/ult-flow.mjs story-herdr --summary <output_dir>/summary.json [--tasks <issue#,...>]
   ```
4. Task 실행자는 Task PR을 만든 뒤 끝냅니다. Task PR이 생기면 메인 에이전트가 PR마다 **새 sonnet 서브에이전트**를 띄워 review-cycle을 실행합니다.
5. Story 안의 Task가 모두 완료되면(실행 요약의 `all_done`) Story status를 `완료`로 바꿉니다.

Task 실행자는 반드시 지정된 Task worktree만 수정하고, Task PR은 `dev` 또는 repository default branch를 target으로 만들어야 합니다.

## 실행 요약 필드

- `Model`: handoff Task의 `model`(`opus`/`sonnet`/`haiku`). 없으면 `sonnet`.
- `story.context`(handoff, 선택): 모든 Task prompt에 넣는 Story 공통 맥락. 주요 파일 경로나 규칙 요약을 적습니다.
- `all_done`: Task가 모두 Done이면 `true`.
