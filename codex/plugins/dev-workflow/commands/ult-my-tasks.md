---
allowed-tools: Bash(git:*), Bash(gh:*), Bash(node:*), Read, AskUserQuestion
description: 나에게 할당된 Notion Task 목록을 조회하고, 선택한 Task의 브랜치를 체크아웃하거나 생성
argument-hint: [--week | --all]
---

# 내 Task 목록

현재 사용자에게 할당된 Notion Task를 조회하고, 선택 시 브랜치(worktree)를 자동 체크아웃/생성합니다.

## 실행

1. 목록만 먼저 조회한다. (stdin 이 터미널이 아니면 목록을 출력하고 끝난다)

```bash
node ~/.codex/scripts/ult-notion.mjs my-tasks $ARGUMENTS
```

2. 출력된 목록을 사용자에게 보여주고 AskUserQuestion 으로 번호를 고르게 한다(항목이 많으면 마감 임박 순 상위 4개를 선택지로 주고 나머지는 번호 입력).
3. 선택이 정해지면 **같은 옵션으로** 다시 실행한다. 목록 순서가 같아야 번호가 같은 Task 를 가리킨다.

```bash
node ~/.codex/scripts/ult-notion.mjs my-tasks $ARGUMENTS --select <번호>
```

스크립트가 처리하는 것:
- GitHub 사용자(`gh api user`) → Member DB(24h 캐시)로 Notion user ID 매핑
- Task DB 쿼리 (기본: 시작 전/진행 중), Story / Repository 이름 병렬 조회
- 상태별 그룹핑 출력 + 마감 표시(D-n / 오늘 마감 / 지남 / 마감 미정)
- `--select` 시:
  - Issue URL이 없으면 Task 본문으로 GitHub Issue를 만들고 Task의 `Issue URL`에 반영
  - 이슈 번호로 시작하는 기존 브랜치가 있으면 그것을 사용, 없으면 `<issue_num>-<topic>-<slug>` 브랜치 생성
  - worktree 생성(또는 기존 worktree 경로 반환) 후 이동 방법 안내

## 옵션

| 플래그 | 동작 |
|---|---|
| (기본) | 시작 전 + 진행 중 |
| `--week` | 이번 Week 관계에 속한 본인 Task (완료 포함) |
| `--all` | 모든 상태 |
| `--select <n>` | 목록의 n번 Task 로 브랜치/worktree 진행 (비대화형) |

## 주의

- Notion 토큰은 `NOTION_TOKEN` 환경변수, `~/.codex/dev-tools/.env`, 또는 `~/.claude.json` 의 `notion-api` MCP 등록값에서 자동 인식한다. 없으면 오류 메시지의 안내를 사용자에게 그대로 전한다.
- 본인 GitHub 로그인이 Member DB 의 `Github` 칸에 없으면 PM 에게 추가를 요청하라고 안내한다.
- worktree 는 Task 의 Repository 저장소에 만든다. 그 저장소가 현재 저장소가 아니고 로컬 체크아웃(`WORKTREE_ROOT` 또는 `~/Git` 아래 저장소 이름 디렉터리, origin 이 그 GitHub 저장소)도 없으면 현재 저장소에 만들지 않고 실패한다. 오류 메시지의 clone 안내를 사용자에게 그대로 전한다. Repository 의 URL 이 GitHub 저장소가 아니어도 실패한다. Repository 관계가 없는 Task 만 현재 저장소를 쓴다.
- 첫 실행 시 Member DB 캐싱(~1s), 이후 24h 동안 `~/.codex/notion-cache` 재사용.
