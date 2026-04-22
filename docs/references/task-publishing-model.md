# Task Publishing Model

`/ult-story-create`나 `/ult-task-create`에서 Story/Task/Issue 관계가 헷갈릴 때만 보는 문서.

핵심 관계:

- `Story`는 여러 `Task`를 묶는 조율 단위
- `Task`는 실제 실행 단위
- `Task 1개 = GitHub Issue 1개`
- `Task`는 정확히 하나의 Notion `Repository` relation을 가진다
- 필요하면 각 Task 기준으로 브랜치/worktree를 만든다

## Story-Based Agent Worktree Flow

여러 Task로 나뉘는 Story 작업은 Story owner와 Task owner를 분리한다. 핵심 운영 규칙은 아래다.

- Story는 orchestration unit이다. Task는 execution unit이다.
- 메인 에이전트는 Notion Story, GitHub Story Issue, Story branch, Story worktree, dependency map, handoff, integration, final review를 담당한다.
- 각 서브에이전트는 정확히 하나의 Notion Task, GitHub Issue, Task branch, Task worktree, implementation, verification, Task PR을 담당한다.
- Task branch는 Story branch에서 만들고, Task PR은 Story branch를 target으로 한다. 최종 Story PR만 `dev`를 target으로 한다.
- `Parent Task`는 hierarchy가 아니라 prerequisite/dependency다. dependency가 충족된 Task만 병렬 실행한다.
- Task `Repository` relation이 repo ownership의 source of truth다. cross-repo reference는 bare issue number가 아니라 `repo#issue` 또는 Issue URL을 쓴다.
- `tmp/story-handoff.md`와 `tmp/story-handoff.json`을 유지한다. 초기 handoff는 Notion Story와 GitHub Story Issue에 동일하게 남기고, 이후 변경은 GitHub Story Issue에 반영한다.
- review-cycle은 두 번 돈다. Task PR마다 Story branch merge 전에 한 번, Story PR에서 `dev` merge 전에 한 번 돈다.
- Story/Task Notion page는 configured template을 사용하고, appended markdown은 raw markdown이 아니라 Notion block으로 렌더링한다.
- 실행 전에는 `/ult-story-run`으로 Ready/Blocked Task를 확인하고 Ready Task별 subagent prompt를 생성한다. 이때 runner는 로컬/GitHub handoff를 먼저 읽고 Notion은 fallback으로만 쓴다.

Branch flow:

```text
dev
└── Story branch
    ├── Task branch -> PR to Story branch
    ├── Task branch -> PR to Story branch
    └── Task branch -> PR to Story branch

Story branch -> PR to dev
```

추가 규칙:

- Story 생성 시 Story GitHub Issue를 만들고 Notion Story `Issue URL`에 기록한다.
- Story PR URL은 Notion Story `PR URL`에 기록한다.
- branch ancestry는 git `branch.<name>.gh-merge-base`, 초기 Notion comment, GitHub Story Issue handoff에 기록한다.
- 브랜치 이름에 `story/`, `task/` prefix는 필수 아니다. Story/Task 여부는 Notion relation, GitHub issue 관계, PR target branch로 판단한다.

## Story Handoff

Story 기반 작업은 `tmp/story-handoff.md`와 `tmp/story-handoff.json`을 유지한다.

- Story title, Notion Story URL, GitHub Story Issue URL
- Story branch, base branch, worktree
- Task issue, branch, base branch, worktree, status
- cross-repo dependency 또는 리뷰에서 나온 carryover

초기 handoff는 Notion Story comment와 GitHub Story Issue comment에 동일하게 남긴다. 이후 실행 중 변경사항, PR URL, 리뷰 carryover, 상태 갱신은 GitHub Story Issue에만 반영한다. Notion은 생성 결과를 확인하거나 fallback으로 조회할 때만 사용한다.

## Parent Task Dependency

현재 Notion 구조에서는 `Parent Task`를 선행관계로 사용한다.

- `Parent Task`는 ownership hierarchy가 아니라 prerequisite/dependency다.
- `Parent Task`가 없는 Task는 바로 시작 가능하다.
- `Parent Task`가 있는 Task는 모든 parent가 완료되거나 Story branch에 merge될 때까지 `Blocked`다.
- 병렬 실행은 dependency가 없는 Task 또는 dependency가 이미 충족된 Task에만 허용한다.
- 같은 파일을 수정할 가능성이 있는 Task는 병렬화하지 않는다.

## Cross-Repo Story

하나의 Story가 여러 repository를 건드릴 수 있다.

- Story 자체에 direct Repository relation을 둘 필요는 없다.
- repository ownership의 source of truth는 Task의 `Repository` relation이다.
- Story가 건드리는 repository 목록은 연결된 Task들의 `Repository`로 판단한다.
- 보기 편한 rollup이 필요하면 Story에 `Related Repositories = rollup(Task -> Repository)`를 추가한다.
- cross-repo dependency도 `Parent Task` relation으로 표현한다.
- GitHub issue 번호는 repository별 namespace이므로 cross-repo 문서에서는 bare `#123`를 쓰지 않는다.
- cross-repo 식별은 `repo#issue` 또는 Issue URL을 사용한다.

## Notion Template and Markdown Rule

Story/Task page는 빈 page로 만들지 않는다.

- Story는 Tag에 맞는 configured template blocks를 사용한다.
- Task는 configured Task template blocks를 사용한다.
- template blocks가 비어 있거나 로드에 실패하면 page 생성을 중단한다.
- template 뒤에 붙이는 markdown body는 Notion blocks로 변환한다.
- raw markdown syntax가 최종 Notion page에 그대로 남지 않아야 한다.

## Review Cycle

Story 기반 작업은 Task PR과 Story PR 모두에서 review-cycle을 돌린다.

- Task PR은 Story branch를 target으로 만들고, AI 리뷰/CI가 통과할 때까지 반복한다.
- Task PR이 통과하면 Story branch로 merge한다.
- 모든 Task PR이 merge된 뒤 Story PR을 `dev`로 만들고 다시 review-cycle을 반복한다.
- Task PR 리뷰에서 Story 전체 설계나 다른 Task 범위의 이슈가 나오면, 해당 Task에서 확장하지 말고 Story handoff와 GitHub Story Issue에 carryover로 기록한다.

명령 선택 기준:

- 새 Story가 필요하면 `/ult-story-create`
- 기존 Story의 Ready Task를 실행 준비하면 `/ult-story-run`
- 기존 Story에 Task 1개를 추가하면 `/ult-task-create`
- 현재 Task에 메모만 남기면 `/ult-task-note`

`/ult-story-create` 최소 출력 spec:

```json
{
  "github_repo": "owner/name",
  "story": {
    "title": "...",
    "tag": "Feature|Update|Refactor|Bug",
    "priority": "High|Medium|Low",
    "project_id": "uuid",
    "assignee_notion_id": "uuid",
    "body_markdown": "...",
    "branch": "optional-story-branch"
  },
  "tasks": [
    {
      "name": "...",
      "topic": "Feature|Fix|Update|Refactor|Style|Other",
      "description": "...",
      "planned_start": "YYYY-MM-DD",
      "planned_end": "YYYY-MM-DD",
      "repository_id": "uuid",
      "week_id": "uuid",
      "parent_task_ids": ["uuid"]
    }
  ]
}
```

`/ult-story-create`의 LLM 책임:

- Plan을 읽고 Story 1개와 Task N개로 분해
- Story tag/priority와 Task topic을 추론
- Project 후보를 사용자에게 제시하고 선택받음
- 위 JSON spec만 확정하면 실행은 `scripts/ult-story-create-exec.sh`에 위임
