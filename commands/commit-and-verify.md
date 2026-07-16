---
allowed-tools: Bash(git:*), Task, Read, Grep, Glob, Write
description: 커밋 후 의도/품질 검증을 수행하고 validation-status.json을 생성
argument-hint: [directory] [commit-message]
---

# Commit And Verify

본문만으로 기본 실행은 가능하고, 아래 문서는 막힐 때만 연다:

- `docs/references/validation-contract.md`
  - `validation-status.json` 필드/상태값이 헷갈릴 때
- `templates/cli-sync.json`
  - CLI sync 자동 탐지 결과를 해석하거나 파일을 생성할 때

## 중요 제한

- 검증 subagent는 검증만 수행한다
- subagent는 다른 command를 호출하지 않는다
- subagent는 파일을 쓰지 않고 JSON 텍스트만 반환한다
- 메인 명령만 `<directory>/tmp/validation-status.json`을 생성한다
- 이 명령은 검증까지만 수행한다. PR 생성은 `/create-pr`로 분리한다

## 입력 파싱

입력: `$ARGUMENTS`

- 첫 인자가 디렉토리면 작업 디렉토리로 사용
- 아니면 현재 디렉토리를 사용하고 전체 인자를 커밋 메시지로 사용

## 수행 절차

1. 작업 디렉토리, 현재 브랜치, 기준 브랜치, git 상태를 확인한다
2. 필요하면 Plan 파일을 선택해 `<directory>/tmp/current-plan.md`로 복사한다
3. 커밋 메시지가 있으면 conventional commit 형식인지 확인하고 커밋한다
   - 메시지가 없으면 사용자에게 커밋 메시지를 확인받거나, staged 변경이 없으면 중단한다
4. intent-validator를 **Spec Review**로 먼저 실행한다
   - 승인된 Plan/Issue/Task 대비 누락, 잘못된 동작, 범위 확장, 검증 증거를 확인한다
5. intent 결과가 `PASS`일 때만 아래 validator를 병렬 실행한다
   - doc-validator
   - security-validator
   - code-simplifier (**Standards Review**: 저장소 규칙 우선 + 코드 스멜 기준)
   - test-validator
   - cli-validator (`.cli-sync.json`이 활성화된 경우만)
6. 프론트엔드 변경이 있으면 Visual QA 수행 여부를 사용자에게 묻고 `visual-qa`를 `PENDING` 또는 `SKIP`으로 기록한다
7. 결과를 취합해 `validation-status.json`을 생성한다
8. 현재 브랜치의 Issue에 연결된 Notion Task가 있으면 검증 요약 코멘트를 남긴다

## Plan 선택

- 최근 Plan 5개를 확인한다
- 하나면 확인 후 사용
- 여러 개면 사용자에게 선택받는다
- 없으면 Plan 없이 진행할지 확인한다

Plan 없이 진행할 수는 있지만, intent 검증 품질은 떨어질 수 있음을 사용자에게 알려준다.

## CLI sync

- `.cli-sync.json`이 있고 `enabled: true`면 cli-validator 실행
- 파일이 없거나 `enabled: false`면 CLI 존재 여부를 탐지해 생성 여부만 사용자에게 확인
- 감지 규칙과 예시는 `templates/cli-sync.json`을 따른다

## 실패 규칙

- intent-validator가 `FAIL`이면 즉시 중단하고 나머지는 `SKIP`
- 품질 validator 중 하나라도 `FAIL`이면 결과를 파일에 기록하고 수정 지점을 안내한다
- Visual QA는 선택적이며 `PENDING` 또는 `SKIP` 가능
- Spec Review와 Standards Review가 모두 통과해야 리뷰가 완료된 것으로 본다

## 출력

- validator별 상태 요약
- `overall` 상태
- 생성된 `tmp/validation-status.json` 경로
- FAIL 또는 WARN이 있으면 수정이 필요한 validator 이름

reference를 안 열어도 되는 경우:

- 일반적인 commit + validate 흐름
- CLI sync를 쓰지 않는 프로젝트
- `validation-status.json` 세부 필드명을 직접 다룰 필요가 없는 경우
