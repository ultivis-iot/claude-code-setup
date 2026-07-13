---
allowed-tools: Bash(git:*), Bash(gh:*), Read
description: 검증 결과를 확인한 뒤 push와 PR 생성을 수행
argument-hint: [directory] [-b target-branch]
---

# Create PR

본문만으로 기본 실행은 가능하고, 아래 문서는 validation 기준이 헷갈릴 때만 연다:

- `docs/references/create-pr-contract.md`
  - PR 생성 전 validation-status 해석 기준을 다시 볼 때

## 입력 파싱

입력: `$ARGUMENTS`

- `-b <branch>`가 있으면 타겟 브랜치로 사용
- 첫 인자가 디렉토리면 작업 디렉토리로 사용
- 아니면 현재 디렉토리를 사용

## 수행 절차

1. `<directory>/tmp/validation-status.json`을 읽는다
2. 아래 조건을 만족하는지 확인한다
   - `overall == PASS || WARN`
   - `results.intent-validator == PASS`
   - 어떤 validator도 `FAIL`이 아님
3. 현재 브랜치와 리모트를 확인한다
   - `-b`가 없으면 `origin/dev`가 있을 때 `dev`, 없으면 repository default branch를 사용한다
   - Story 기반 작업이어도 Task PR은 `dev` 또는 repository default branch를 target으로 한다
   - local handoff, branch config, 과거 PR, 오래된 작업 branch에서 target branch를 추론하지 않는다
   - target이 현재 branch이거나 `dev`/repository default branch가 아닌 작업 branch로 보이면 중단하고 사용자 확인을 받는다
4. `git push -u origin <branch>`를 수행한다
5. `gh pr create`로 PR을 생성한다
   - `-b`가 있으면 `-B <target-branch>` 적용
6. 생성된 PR URL을 Notion에 동기화한다
   - 현재 Task의 `PR URL`

## PR 본문

최소 섹션:

- `Summary`
- `Changes`
- `Test Plan`
- `Validation`

## 실패 규칙

- validation 미통과 시 즉시 중단
- `/ult:commit-and-verify` 재실행 안내
- push 또는 `gh pr create` 실패 시 원인만 요약해 안내하고 중단

reference를 안 열어도 되는 경우:

- validation이 이미 통과했고 push + PR 생성만 하면 되는 일반 케이스
