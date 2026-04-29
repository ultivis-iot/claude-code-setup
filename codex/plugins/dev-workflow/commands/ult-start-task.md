---
allowed-tools: Bash(git:*), Bash(gh:*), Read, Grep, Glob, Write
description: 작업 시작 진입점. 상황에 맞게 Task 조회, Story 발행, Task 추가 중 하나를 선택해 진행
argument-hint: [story-or-task-context]
---

# 작업 시작

사용자가 "무엇부터 시작하지?" 관점에서 진입할 때 사용하는 작업 중심 명령.
기본 UX는 명령 이름을 나열하는 것이 아니라, 현재 컨텍스트를 보고 적절한 흐름을 제안하고 확인을 받은 뒤 이어서 수행하는 것이다.

## 기본 원칙

- 세부 명령 이름을 몰라도 이 명령으로 시작할 수 있어야 한다.
- 현재 컨텍스트를 보고 아래 세 흐름 중 하나를 선택한다.
- 사용자가 직접 다음 명령을 타이핑하게 밀지 말고, 추천 흐름 1개를 먼저 제시한 뒤 확인을 받는다.
- 요구사항이 애매하면 바로 발행하지 말고, 사용자가 스스로 판단할 수 있는 질문을 1~3개 먼저 묻는다.
- 질문에는 왜 그 결정이 필요한지와 선택지별 tradeoff를 짧게 붙인다.

## 선택 규칙

1. 인자가 없고 현재 작업을 고르려는 상황이면:
   - `${WORKFLOW_SCRIPTS_DIR:-${CODEX_HOME:-$HOME/.codex}/scripts}/ult-my-tasks.sh`를 사용해 본인 Task 목록을 보여주고 선택을 진행한다.

2. 승인된 Plan이 있고, 새 Story + Task 여러 개 + Issue/브랜치 발행이 필요한 작업이면:
   - `/ult-story-create`의 절차를 따른다.

3. 기존 Story에 Task 하나만 추가하는 상황이면:
   - `/ult-task-create`의 절차를 따른다.

4. 기존 Story의 Ready Task를 실행하거나 병렬 서브에이전트 작업을 준비하는 상황이면:
   - `/ult-story-run`의 절차를 따른다.

5. 현재 Task에 메모나 보완만 남기면 되는 상황이면:
   - `/ult-task-note`의 절차를 따른다.

## 출력

- 어떤 흐름을 추천하는지 먼저 짧게 설명한다.
- 추천 이유를 1줄로 덧붙인다.
- 사용자의 확인을 받은 뒤 실제 흐름을 수행한다.
- 생성되거나 선택된 Task, Issue, worktree 경로를 마지막에 요약한다.
