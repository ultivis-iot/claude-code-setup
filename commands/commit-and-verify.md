---
allowed-tools: Bash(git:*), Task, Read, Grep, Glob, Write
description: 커밋 후 검증 단계를 자동으로 실행
argument-hint: [directory] [commit-message]
---

## 중요 제한 사항

**Subagent 제한**:
- 검증 subagent(intent-validator, doc-validator, security-validator, code-simplifier)는 **검증만 수행**
- Subagent는 `/create-pr`, `/commit-and-verify` 등 다른 skill/command를 **절대 호출하지 않음**
- PR 생성은 사용자가 직접 `/create-pr`을 호출해야 함
- 이 명령은 **검증까지만** 수행하고 종료됨

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

4. **결과 종합 보고** (필수)
   - **반드시** 검증 상태 파일 생성: `<directory>/tmp/validation-status.json`
   - 이 파일이 없으면 검증이 완료되지 않은 것으로 간주됨
   - PASS/WARN/FAIL 결과 요약 출력

## validation-status.json 형식 (필수)

검증 완료 후 **반드시** 다음 형식으로 파일을 생성해야 합니다:

```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "commit": "abc1234",
  "results": {
    "intent-validator": "PASS",
    "doc-validator": "PASS",
    "security-validator": "WARN",
    "code-simplifier": "PASS"
  },
  "overall": "PASS",
  "warnings": ["보안: 위험 패턴 감지"],
  "errors": []
}
```

**필드 설명**:
- `timestamp`: ISO 8601 형식의 검증 완료 시간
- `commit`: 검증된 커밋 해시 (short)
- `results`: 각 validator의 개별 결과
- `overall`: 전체 결과 (FAIL이 하나라도 있으면 FAIL)
- `warnings`: 경고 메시지 배열
- `errors`: 에러 메시지 배열

**overall 판정 기준**:
- `PASS`: 모든 검증 통과
- `WARN`: FAIL 없이 WARN 존재
- `FAIL`: 하나라도 FAIL

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
