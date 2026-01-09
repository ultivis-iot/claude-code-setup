---
allowed-tools: Bash(git:*), Task, Read, Grep, Glob
description: 커밋 후 검증 단계를 자동으로 실행
argument-hint: [directory] [commit-message]
---

## 인자 파싱

입력된 인자: `$ARGUMENTS`

**인자 형식**:
- `/commit-and-verify` → 현재 디렉토리
- `/commit-and-verify project-maker` → project-maker 디렉토리
- `/commit-and-verify project-maker fix: 버그 수정` → project-maker 디렉토리 + 커밋 메시지

**파싱 규칙**:
1. 첫 번째 인자가 존재하고 디렉토리라면 → 작업 디렉토리로 사용
2. 첫 번째 인자가 디렉토리가 아니면 → 현재 디렉토리 사용, 전체를 커밋 메시지로
3. 나머지 인자는 커밋 메시지로 사용

## 현재 상태 확인

먼저 작업 디렉토리를 결정합니다:
- 인자에서 디렉토리 추출 (없으면 현재 디렉토리 `.`)
- 해당 디렉토리의 Git 상태 확인

**확인할 항목**:
- Git 상태: `git -C <directory> status`
- 변경 내용: `git -C <directory> diff --staged`
- 최근 커밋: `git -C <directory> log --oneline -5`

## Plan 문서 참조

작업 디렉토리의 Plan 문서를 확인합니다:
- 경로: `<directory>/tmp/current-plan.md`
- Plan 문서가 없으면 경고 후 계속 진행 여부 확인

## 수행 작업

1. **커밋 생성**
   - 작업 디렉토리에서 커밋: `git -C <directory> commit -m "..."`
   - 커밋 메시지는 변경 내용을 반영하여 작성
   - 인자로 메시지가 제공된 경우 해당 메시지 사용

2. **검증 1단계 (의도 검증)** 수행
   - intent-validator subagent 호출
   - Plan 문서 경로: `<directory>/tmp/current-plan.md`
   - Plan 문서의 의도대로 구현되었는지 확인

3. **검증 2단계 (품질 검증)** 병렬 수행
   - 검증 1단계 통과 시 실행
   - 다음 세 가지 검증을 **동시에 병렬로** 실행:
     - doc-validator subagent: 문서 검증
     - security-validator subagent: 보안 검증
     - code-simplifier subagent: 코드 단순화 검증
   - 반드시 세 Task 도구를 **한 번의 응답에서 동시에 호출**
   - 각 subagent에 작업 디렉토리 정보 전달

4. **결과 종합 보고**
   - 검증 상태 파일 업데이트: `<directory>/tmp/validation-status.json`
   - PASS/WARN/FAIL 결과 요약

## 검증 실패 시

- 구체적인 미충족 사항 안내
- 수정이 필요한 파일/위치 지정
- 빌드 단계로 돌아가 수정하도록 안내

## 사용 예시

```bash
# 현재 디렉토리에서 실행
/commit-and-verify

# 특정 디렉토리 지정
/commit-and-verify project-maker

# 디렉토리 + 커밋 메시지
/commit-and-verify project-maker fix: 로그인 버그 수정

# 현재 디렉토리 + 커밋 메시지 (디렉토리가 아닌 경우)
/commit-and-verify feat: 새로운 기능 추가
```
