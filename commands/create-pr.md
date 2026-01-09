---
allowed-tools: Bash(git:*), Bash(gh:*), Read
description: 검증 통과 확인 후 Push 및 PR 생성
argument-hint: [directory] [-b target-branch]
---

## 인자 파싱

입력된 인자: `$ARGUMENTS`

**인자 형식**:
- `/create-pr` → 현재 디렉토리, 기본 브랜치로 PR
- `/create-pr project-maker` → project-maker 디렉토리
- `/create-pr -b dev` → 현재 디렉토리, dev 브랜치로 PR
- `/create-pr project-maker -b dev` → project-maker 디렉토리, dev 브랜치로 PR

**파싱 규칙**:
1. `-b <branch>` 옵션이 있으면 해당 브랜치를 타겟으로 사용
2. 첫 번째 인자가 존재하고 디렉토리라면 → 작업 디렉토리로 사용
3. 인자가 없거나 디렉토리가 아니면 → 현재 디렉토리 사용
4. 타겟 브랜치 미지정 시 → 저장소 기본 브랜치 사용

## 1. 검증 상태 확인

작업 디렉토리의 검증 상태 파일을 확인합니다:
- 경로: `<directory>/tmp/validation-status.json`

**검증 통과 조건**:
- `ready_for_pr`이 `true`여야 함
- `intent_validation.status`가 `PASS`여야 함
- `quality_validation`의 모든 항목이 `PASS` 또는 `WARN`이어야 함

**검증 미통과 시**:
- PR 생성을 중단하고 미통과 항목을 안내
- `/commit-and-verify <directory>` 명령으로 검증 단계를 다시 수행하도록 안내

## 2. 현재 상태 (검증 통과 시에만 진행)

작업 디렉토리에서 확인:
- 브랜치: `git -C <directory> branch --show-current`
- 커밋 로그: `git -C <directory> log origin/main..HEAD --oneline`
- 리모트: `git -C <directory> remote -v`

## 3. 수행 작업

1. 검증 상태 확인 → 미통과 시 중단
2. 작업 디렉토리로 이동 후 Push: `git -C <directory> push -u origin <branch>`
3. PR 생성: `gh pr create` (작업 디렉토리에서 실행)
   - `-b` 옵션이 지정된 경우: `gh pr create -B <target-branch>`

## 4. PR 형식

gh pr create 명령 사용:

```bash
# 타겟 브랜치 지정 시
cd <directory> && gh pr create -B <target-branch> --title "..." --body "..."

# 타겟 브랜치 미지정 시 (기본 브랜치 사용)
cd <directory> && gh pr create --title "..." --body "..."
```

**PR 본문 형식**:

```bash
cd <directory> && gh pr create -B <target-branch> --title "<커밋 메시지 기반 제목>" --body "$(cat <<'EOF'
## Summary
- 변경 사항 요약

## Changes
- 주요 변경 파일 목록

## Test Plan
- 테스트 방법

## Validation
- Intent: [PASS/FAIL]
- Documentation: [PASS/WARN/FAIL]
- Security: [PASS/WARN/FAIL]
- Code Quality: [PASS/WARN/FAIL]
EOF
)"
```

## 5. 완료 후

- PR URL 출력
- 검증 상태 파일 초기화 (선택적)

## 사용 예시

```bash
# 현재 디렉토리, 기본 브랜치로 PR
/create-pr

# 특정 디렉토리 지정
/create-pr project-maker

# 타겟 브랜치 지정 (dev 브랜치로 PR)
/create-pr -b dev

# 디렉토리 + 타겟 브랜치
/create-pr project-maker -b dev
```
