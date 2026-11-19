# 전역 Claude Code 설정

## 기본 원칙
- 코드 변경 전 반드시 기존 패턴 확인
- 브랜치 생성, 체크아웃, worktree 생성 전에는 먼저 `git fetch origin --prune`로 원격 refs를 최신화하고, 새 브랜치는 최신 원격 base에서 시작
- PR 머지는 `merge-readiness.md`(최종 HEAD 변경 브리프와 변경 범위에 따른 이해 확인 질문)를 거친 뒤 사용자의 명시적 요청으로만 한다
- 자기 worktree 밖에서 git 쓰기 금지. 특히 메인 체크아웃에서 `git checkout -- `, `reset --hard`, `stash`, `clean` 금지 — 다른 세션의 미커밋 작업이 있을 수 있다. 다른 브랜치 내용은 `git show <ref>:<path>`나 별도 worktree로 본다. 리뷰·조사는 항상 읽기 전용이다.
- 사용자가 승인하기 전에는 Notion Task, GitHub Issue, branch, worktree를 새로 만들지 않는다. 범위 밖 후속 작업은 carryover로 기록한다.

## 응답
- 간결하게 쓴다. 결론부터, 근거는 필요한 만큼만. 이미 말한 것을 다시 요약하지 않고, 진행 상황 표·중간 보고는 사용자가 물었을 때만 쓴다. 작업 보고는 바뀐 것과 사용자 판단이 필요한 것만 적는다.
- 파일 위치는 **항상 절대경로**로 알려준다(읽은·수정한·만든 파일, 코드 참조 `/abs/path/file.ts:42` 모두). worktree에서 작업했으면 그 worktree 경로를, 병합 뒤 메인 체크아웃에도 반영됐으면 두 경로를 함께 쓴다. 파일이 여러 개면 목록으로 모두 적는다.
- 아티팩트(claude.ai Artifact, 캔버스·문서 등)는 사용자가 명시적으로 요청할 때만 만든다. 기본은 로컬 파일(png, HTML, Markdown 등)이고 절대경로만 알려준다.

## 기본 라우터
`ultivis-flow`를 모든 개발 작업의 상시 기반으로 사용한다. 이 흐름이 Plan, GitHub/Notion Story·Task, branch/worktree, commit-and-verify, PR과 review-cycle을 소유하고, 다른 스킬은 이 게이트를 대체하지 않는 일시적 오버레이다. 사용자가 `/tdd`처럼 스킬을 명시하면 그 선택을 우선한다. 오버레이 선택 규칙과 매핑은 `ultivis-flow`의 `references/overlay-routing.md`를 따른다.

## 서브에이전트
`Agent`로 서브에이전트를 띄울 때 `model`을 항상 명시한다. 설계 판단·보안 표면·상태 머신·원인 불명 결함은 `opus`, 정해진 구현·리뷰 반영·테스트 보강은 `sonnet`, 기계적 작업은 `haiku`, 애매하면 `sonnet`. 상세 기준은 `ultivis-flow`의 `references/subagent-models.md`.

## Plan 모드 가이드
Plan에는 반드시 `의도` 섹션(사용자가 원하는 것, 기대 결과물)을 넣고, 사용자가 자기 의도가 정확히 문서화됐는지 확인하게 한다. Plan을 쓰기 전 질문, UI 변경의 목업 전·후 비교, `tmp/current-plan.md` 저장, 승인 뒤 다음 흐름 제안은 `ultivis-flow`의 `references/core-workflow.md`를 읽고 따른다.
