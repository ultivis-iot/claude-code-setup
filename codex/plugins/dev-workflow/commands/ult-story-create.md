---
allowed-tools: Bash(git:*), Bash(gh:*), Bash(${HOME}/.codex/scripts/ult-story-create-exec.sh:*), Read, Grep, Glob, Write, AskUserQuestion
description: 승인된 Plan을 Story 1개 + Task N개 + Issue N개로 발행. 사용자가 명시적으로 승인했을 때만 실행하는 발행 명령
argument-hint: [--dry-run]
---

# Story 생성 (Plan 발행)

발행 입력 spec을 만들기 전에 아래 계약을 읽는다:

- `~/.codex/docs/references/request-to-plan.md`
  - 의도·범위·성공 사례와 Task 결과·의존성·검증의 연결을 확인한다. 미확정 요청은 조사·합의로 돌아가고 승인된 계획은 임의로 재기획하지 않는다.

- `~/.codex/docs/references/task-publishing-model.md`
  - Story/Task/Issue 관계를 다시 확인할 때
  - exec 스크립트에 넘길 JSON spec을 확인할 때

새 Story가 필요할 때 Plan을 `Story + Task N개 + Issue N개`로 발행한다.

## 전제

- 현재 위치는 메인 프로젝트여야 한다
- 이미 worktree 안이면 메인으로 돌아간 뒤 실행한다
- 작은 작업이라도 새 Story가 필요하면 이 명령을 사용한다

## 책임 분리

- LLM: Plan 분석, Story/Task 구조화, Project 선택, spec 확정
- 스크립트: `scripts/ult-story-create-exec.sh`가 Story/Task/Issue/브랜치 생성 실행

## 수행 절차

1. `tmp/current-plan.md`를 우선 읽고, 없으면 인자 경로를 사용한다
   - 둘 다 없으면 중단한다
2. Plan에 아래 항목이 불명확하면 발행 전에 사용자에게 먼저 질문한다
   - 목표/성공 기준
   - 포함/제외 범위
   - 대상 repo/Project/Story
   - 선행 Task/dependency
   - 검증/리뷰 기준
3. 질문은 사용자가 스스로 판단할 수 있도록 선택 기준과 tradeoff를 짧게 제시하고, 한 번에 1~3개만 묻는다
4. 사용자의 답변은 Plan의 결정사항으로 반영하고, 위험하지 않은 미확정 사항만 가정으로 남긴다
5. 현재 사용자, Repository, Project 후보, 현재 Week를 조회한다
6. Plan을 읽고 아래를 결정한다
   - Story title
   - Story tag
   - Story priority
   - Task N개 분해
   - 공통 request-to-plan 기준으로 성공 사례와 Task 결과·검증을 연결하고 Story `body_markdown`과 Task `description`에 근거·결정을 보존한다.
   - 실험에 의존하는 후속 작업은 초안으로 남긴다. 새 Task 간 의존성 ID가 없으면 선행 작업부터 발행하고 후속 Task는 실제 ID로 기존 추가 흐름에서 발행한다.
7. 사용자에게 Project와 최종 발행 미리보기를 확인받는다
8. 아래 JSON spec을 생성한다
   - `github_repo`
   - `story`
   - `tasks`
   - 실행 전 최소 확정값은 Project, Story title, priority, Task 목록이다
9. `--dry-run`이 아니면 확정된 spec을 `scripts/ult-story-create-exec.sh`에 전달한다
10. Story URL, 생성된 Task/Issue 목록, worktree 결과를 요약해 출력한다

## 출력 규칙

- `Task 1개 = Issue 1개`
- 각 Task는 topic, description, planned date를 가진다
- 필요하면 각 Issue 기준으로 브랜치/worktree를 만든다
- Story/Task page는 configured Notion template을 사용한다
- description/body markdown은 heading/list/todo Notion block으로 변환되어야 한다
- Task dependency가 있으면 `Parent Task` relation을 사용한다
- Story GitHub Issue/PR은 만들지 않는다
- Task branch/worktree는 Task Issue 기준으로 만들고 최신 원격 base를 사용한다
- `tmp/story-handoff.md`와 `tmp/story-handoff.json`을 각 Task worktree에 만들고 초기 handoff를 Notion Story comment에도 남긴다
- 생성 이후 handoff 변경사항은 Task worktree handoff와 Notion Story comment에 반영한다

## Agent Worktree 규칙

여러 Task가 있는 Story는 Story 기반 agent worktree flow를 우선 적용한다.

- 메인 에이전트는 Notion Story context와 handoff를 담당한다.
- 서브에이전트는 각 Task worktree를 담당한다.
- Task branch는 최신 원격 base에서 생성하는 것이 원칙이다.
- Task PR은 `dev` 또는 repository default branch를 target으로 한다.
- Story PR은 만들지 않는다.
- cross-repo Story에서는 Task의 Repository relation이 repo ownership의 기준이다.
- cross-repo issue 식별은 bare `#123` 대신 `repo#issue` 또는 Issue URL을 사용한다.

## 사용자 확인 항목

- Plan 질문 답변이 결정사항으로 반영됐는지
- Project 선택
- Story title
- Story priority
- Task 분해 결과

Project 확인은 필수다. Story는 Project 산하 작업 단위이므로, repository에 연결된 Project 후보 밖의 Story를 재사용하거나 비슷한 이름의 전역 Story를 임의로 고르지 않는다.
Story/Task/Issue 생성은 Plan 승인과 발행 미리보기 확인 이후에만 수행한다.

## 옵션

- 기본: `tmp/current-plan.md`
- `<path>`: 지정한 Plan 파일 사용
- `--dry-run`: spec과 미리보기만 확인하고 실행하지 않음

## 관련 명령

- 기존 Story에 Task 1개 추가: `/ult-task-create`
- 현재 Task 메모 추가: `/ult-task-note`

실행할 때 사용하는 스크립트와 같은 설치본의 계약을 읽는다. 설정 저장소에서 직접 실행하면 저장소의 대응 문서를 사용한다.
