# 기존 Story에 Task 추가

기존 Story에 Task 1개, GitHub Issue 1개, Issue URL 연결, 브랜치/worktree 생성을 한 번에 처리합니다.

이 명령은 새 Task/Issue/branch/worktree를 만드는 발행 명령입니다. 사용자가 명시적으로 Task 추가를 승인한 경우에만 실행하고, 현재 Task 수행 중 발견한 후속 작업은 임의로 생성하지 말고 Story handoff와 Notion Story comment에 carryover로 기록합니다.

## 실행

```bash
~/.claude/scripts/ult-task-create.sh [story-title-or-url] [--name <task>] [--topic <topic>] [--description <body>]
```

스크립트가 처리하는 것:
- 현재 GitHub 계정, repository, repository에 연결된 Project, Week 조회
- Story 선택 또는 Notion URL/id, GitHub Task Issue, local handoff로 Story 조회
- Story는 현재 repository의 Project에 연결된 후보만 허용
- Task 내용으로 GitHub Issue 생성
- Notion Task 생성과 동시에 `Issue URL` 반영
- Task template을 사용하고 description markdown을 Notion block으로 변환
- `--parent-task`가 있으면 `Parent Task` dependency 반영
- 최신 원격 base에서 `<issue_num>-<topic>-<slug>` 브랜치/worktree 생성
- local handoff가 있으면 새 Task를 append하고 Notion Story comment에 handoff update를 남김

## Story 선택 원칙

Story는 전역 분류가 아니라 Project 산하 작업 단위입니다.

- Story 선택 전에 현재 repository의 Notion Project를 먼저 확인합니다.
- 후보 Story는 해당 Project에 연결된 것만 유효합니다.
- 완료/미완료/취소 등 과거 종료 상태 Story는 후보에서 제외하고, 명시 URL/id로 지정해도 상태를 먼저 되돌리기 전에는 새 Task를 붙이지 않습니다.
- title 검색 결과가 여러 개면 최신 active Story인지, 현재 handoff/current issue와 연결되는지 확인하기 전에는 자동 선택하지 않습니다.
- 후보가 애매하면 Story를 고르거나 만들기 전에 사용자 확인을 받습니다.
- Project가 불명확하면 아무 Story나 고르지 말고 중단합니다.

## 사용 예

```
/ult-task-create "다크모드 설정 추가" --name "설정 화면 토글 추가" --topic Feature
/ult-task-create --story https://www.notion.so/... --name "토큰 갱신 오류 수정" --topic Fix --description "..."
/ult-task-create --story https://www.notion.so/... --name "후속 검증" --parent-task https://www.notion.so/...
/ult-task-create --name "문구 정리" --here
```

## 옵션

| 인자 | 동작 |
|---|---|
| `<story title or url>` | 해당 Story에 추가. Notion URL/id, GitHub Issue URL, `repo#issue`, title 지원 |
| `--project` | Repository의 Project relation이 비어 있을 때 쓰는 임시 우회. Project name/page id/URL. 지정해도 선택된 Story의 Project 검증은 그대로 수행 |
| `--name` | Task 이름 |
| `--topic` | `Feature`, `Fix`, `Update`, `Refactor`, `Style`, `Other` |
| `--description` | GitHub Issue body 및 Task 본문 |
| `--planned-start`, `--planned-end` | Planned Date |
| `--parent-task` | 선행 Task Notion page id/URL. 반복 가능 |
| `--base` | 브랜치 생성 기준 브랜치. 기본은 `origin/dev` 또는 repository default branch |
| `--here` | Issue/Task만 만들고 현재 브랜치 유지 |
| `--no-checkout` | worktree 없이 로컬 브랜치만 생성 |

## Story Flow 주의

Story 기반 작업에서는 `Parent Task`를 선행관계로 사용한다. Task branch는 최신 원격 base에서 만들고, Task PR은 `dev` 또는 repository default branch를 target으로 한다. Story GitHub Issue/PR은 만들지 않는다. 같은 Story가 여러 repository를 건드리더라도 Task의 Repository relation이 repo ownership의 기준이다.

Story를 명시하지 않으면 현재 worktree의 `tmp/story-handoff.json`, 현재 GitHub Issue 순서로 Story를 추론한다. 오래된 branch base나 과거 worktree만으로 Story를 추론하지 않는다. 추론이 애매하면 active Story 후보를 보여주고 사용자 선택으로 fallback한다.
