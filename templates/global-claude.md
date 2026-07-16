# 전역 Claude Code 설정

## 기본 원칙
- 코드 변경 전 반드시 기존 패턴 확인
- 브랜치 생성, 체크아웃, worktree 생성 전에는 먼저 `git fetch origin --prune`로 원격 refs를 최신화하고, 새 브랜치는 최신 원격 base에서 시작

## 기본 라우터

`ultivis-flow`를 모든 개발 작업의 상시 기반으로 사용한다. 이 흐름이 Plan, GitHub/Notion Story·Task, branch/worktree, commit-and-verify, PR과 review-cycle을 소유한다. 설치된 다른 스킬은 특정 작업 방식을 제공하는 일시적 오버레이이며 이 게이트를 대체하지 않는다.

사용자의 자연어 질의와 저장소 상태를 보고 다음처럼 라우팅한다.

1. 사용자가 `/tdd`, `/research`처럼 스킬을 명시하면 그 선택을 우선한다.
2. 하나의 스킬이 명확하면 자동 선택하고 한 문장으로 알린 뒤 진행한다.
3. 둘 이상의 접근이 결과를 실질적으로 바꾸면 질문 하나에 선택지 2~3개를 제시한다. 추천안을 먼저 두고 각 선택지의 tradeoff를 짧게 설명한다.
4. primary overlay는 한 번에 하나만 사용하고, 완료 기준에 도달한 뒤에만 후속 스킬로 전환한다.
5. 적합한 오버레이가 없으면 `ultivis-flow`만으로 진행한다.

기본 매핑:

- 중요한 모호성/의사결정: `grilling`
- test-first 구현: `tdd`
- 원인 불명의 버그/회귀/성능 저하: `diagnosing-bugs`
- 외부 문서/API/표준 확인: `research`
- 도메인 용어와 불변식: `domain-modeling`
- module/interface/seam 설계: `codebase-design`
- 코드베이스 구조 개선 후보 탐색: `improve-codebase-architecture`
- 여러 세션이 필요한 foggy work: `wayfinder`
- merge/rebase conflict: `resolving-merge-conflicts`
- 세션 인수인계: `handoff`
- 전용 학습 workspace: `teach`
- skill 작성/수정: `writing-great-skills`

`grill-me`는 사용자가 명시적으로 `grilling`을 시작하는 단축 진입점이다.

## Plan 모드 가이드
Plan 모드 사용 시 반드시 의도 섹션이 포함되어 **사용자의 의도를 명확하게 명문화**해야 합니다.

### Plan 작성 전 질문
Plan이 크거나 애매하면 바로 Story/Task를 만들지 말고, 먼저 사용자가 스스로 판단할 수 있도록 질문한다.

- 질문은 blocking point 위주로 1~3개씩 묻는다.
- 단순히 답을 요구하지 말고 선택 기준과 tradeoff를 짧게 제시한다.
- 최소 확인 항목:
  - 목표와 성공 기준
  - 포함/제외 범위
  - 대상 repo, Project, Story
  - 데이터/API/UI 영향 범위
  - 선행 Task/dependency
  - 검증/리뷰 기준
- 사용자의 답변은 Plan의 `결정사항`에 남긴다.
- 답이 없지만 진행 가능한 내용은 `가정`에 적고, 위험한 가정이면 진행하지 않는다.
- Story/Task/Issue 생성은 Plan 승인 이후에만 한다.

### Task 생성 제한
작업 수행 중 새 Notion Task, GitHub Issue, 하위 Task를 임의로 만들지 않는다.

- `ult-task-create`는 사용자가 명시적으로 “Task를 추가/생성하라”고 승인한 경우에만 실행한다.
- 현재 Task 범위를 벗어난 후속 작업은 새 Task를 만들지 말고 Story handoff와 Notion Story comment에 carryover로 기록한다.
- 리뷰나 구현 중 발견한 추가 범위도 동일하다. 사용자가 승인하기 전까지 Task/Issue/branch/worktree를 새로 만들지 않는다.

### Plan 저장 시점
1. Plan 모드 진입 시 프로젝트 루트에 tmp 디렉토리가 없으면 생성
2. **사용자 승인 완료 후, Build 시작 전에** `tmp/current-plan.md`로 복사
3. Build 중에는 Plan을 수정하지 않음 (원본 의도 보존)

### Plan 승인 후 분류 + 확인
Plan 승인 직후 (hook이 `tmp/current-plan.md`를 저장한 직후), Build 시작 전에 Plan 성격을 분류하고 다음 단계 1개를 제안한다.

| Plan 성격 | 기본 제안 |
|---|---|
| 새 Story로 관리할 작업 | `ult-story-create` 흐름 제안 — Story 1개 + Task N개 + Issue N개 + 필요 시 브랜치/worktree |
| 기존 Story의 추가 작업 | `ult-task-create` 흐름 제안 — Task 1개 + Issue 1개 + 필요 시 브랜치/worktree |
| 현재 Task의 보완/메모 | `ult-task-note` 흐름 제안 |
| 발행 없이 바로 구현할 작업 | 바로 Build 시작 제안 |

이때 사용자가 명령어를 직접 고르게 밀어내지 말고, 아래 순서로 진행한다.

1. 추천 흐름 1개를 먼저 제시
2. 이유를 1줄로 설명
3. 대안은 최대 2개만 짧게 제시
4. **사용자 확인을 받은 뒤** 그 흐름을 직접 이어서 수행

권장 응답 형식:

```text
Plan 승인 완료.

추천 다음 단계: 새 Story 발행
이유: 독립된 작업 단위가 여러 개라 Story 아래 Task로 나누는 편이 적절합니다.

확인되면 제가 이어서 진행하겠습니다.
대안:
- 기존 Story에 Task 1개 추가
- 발행 없이 바로 구현
```

사용자가 다른 흐름을 고르면 그 선택을 따른다. 명시적 거부 시 그대로 Build 시작.
### 의도 (Intent)
- 사용자가 원하는 것이 무엇인지 명확히 기술
- 기대 결과물 정의
- **사용자는 자신의 의도가 정확하게 문서화되었는지 반드시 확인해야 함**
