# Story 생성 (Plan 발행)

본문만으로 기본 발행은 가능하고, 아래 문서는 spec이나 모델이 헷갈릴 때만 연다:

- `docs/references/task-publishing-model.md`
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
2. 현재 사용자, Repository, Project 후보, 현재 Week를 조회한다
3. Plan을 읽고 아래를 결정한다
   - Story title
   - Story tag
   - Story priority
   - Task N개 분해
4. 사용자에게 Project와 최종 발행 미리보기를 확인받는다
5. 아래 JSON spec을 생성한다
   - `github_repo`
   - `story`
   - `tasks`
   - 실행 전 최소 확정값은 Project, Story title, priority, Task 목록이다
6. `--dry-run`이 아니면 확정된 spec을 `scripts/ult-story-create-exec.sh`에 전달한다
7. Story URL, 생성된 Task/Issue 목록, worktree 결과를 요약해 출력한다

## 출력 규칙

- `Task 1개 = Issue 1개`
- 각 Task는 topic, description, planned date를 가진다
- 필요하면 각 Issue 기준으로 브랜치/worktree를 만든다
- Story/Task page는 configured Notion template을 사용한다
- description/body markdown은 heading/list/todo Notion block으로 변환되어야 한다
- Task dependency가 있으면 `Parent Task` relation을 사용한다
- Story GitHub Issue를 만들고 Story `Issue URL`에 기록한다
- Story branch/worktree를 먼저 만들고 Task branch는 Story branch를 base로 만든다
- `tmp/story-handoff.md`와 `tmp/story-handoff.json`을 만들고 초기 handoff를 Notion Story와 GitHub Story Issue에 동일하게 남긴다
- 생성 이후 handoff 변경사항은 GitHub Story Issue에 반영한다

## Agent Worktree 규칙

여러 Task가 있는 Story는 Story 기반 agent worktree flow를 우선 적용한다.

- 메인 에이전트는 Story context와 Story worktree를 담당한다.
- 서브에이전트는 각 Task worktree를 담당한다.
- Task branch는 Story branch에서 생성하는 것이 원칙이다.
- Task PR은 Story branch를 target으로 한다.
- Story PR만 최종적으로 `dev`를 target으로 한다.
- cross-repo Story에서는 Task의 Repository relation이 repo ownership의 기준이다.
- cross-repo issue 식별은 bare `#123` 대신 `repo#issue` 또는 Issue URL을 사용한다.

## 사용자 확인 항목

- Project 선택
- Story title
- Story priority
- Task 분해 결과

Project 확인은 필수다. Story는 Project 산하 작업 단위이므로, repository에 연결된 Project 후보 밖의 Story를 재사용하거나 비슷한 이름의 전역 Story를 임의로 고르지 않는다.

## 옵션

- 기본: `tmp/current-plan.md`
- `<path>`: 지정한 Plan 파일 사용
- `--dry-run`: spec과 미리보기만 확인하고 실행하지 않음

## 관련 명령

- 기존 Story에 Task 1개 추가: `/ult-task-create`
- 현재 Task 메모 추가: `/ult-task-note`

reference를 안 열어도 되는 경우:

- 새 Story가 필요하고 Task를 몇 개로 나눌지만 결정하면 되는 일반 케이스
