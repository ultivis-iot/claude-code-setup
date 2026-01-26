---
allowed-tools: Bash(git:*), Task, Read, Grep, Glob, Write
description: 커밋 후 검증 단계를 자동으로 실행
argument-hint: [directory] [commit-message]
---

## 중요 제한 사항

**Subagent 제한**:
- 검증 subagent(intent-validator, doc-validator, security-validator, code-simplifier, test-validator)는 **검증만 수행**
- Subagent는 `/create-pr`, `/commit-and-verify` 등 다른 skill/command를 **절대 호출하지 않음**
- **Subagent는 파일을 작성하지 않음** - 결과를 JSON 텍스트로 반환만 함
- **메인(이 커맨드)에서 결과를 취합**하여 `tmp/validation-status.json` 파일 생성
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
- 현재 브랜치: `git -C <directory> branch --show-current`
- 기준 브랜치 확인: main, master, dev 중 존재하는 브랜치
- Git 상태: `git -C <directory> status`
- 브랜치 전체 커밋: `git -C <directory> log <base_branch>..HEAD --oneline`
- 브랜치 전체 변경: `git -C <directory> diff <base_branch>...HEAD`
- staged 변경 내용: `git -C <directory> diff --staged`

## Plan 문서 선택

`~/.claude/plans/`에서 Plan 파일을 찾아 사용자가 선택할 수 있도록 합니다:

1. **최근 Plan 파일 검색** (최근 5개)
   ```bash
   ls -t ~/.claude/plans/*.md 2>/dev/null | head -5
   ```

2. **Plan 파일 목록 표시**
   - 각 파일의 제목(`#`으로 시작하는 첫 줄)과 의도 섹션 요약 출력
   - 파일명과 수정 시간 표시

3. **사용자 선택**
   - 여러 개면: AskUserQuestion으로 선택 요청
   - 1개면: 해당 파일 사용 확인
   - 0개면: Plan 없이 진행할지 확인

4. **선택된 Plan 복사**
   ```bash
   mkdir -p <directory>/tmp
   cp <선택된_plan_파일> <directory>/tmp/current-plan.md
   ```

## 커밋 메시지 컨벤션

### 형식
```
type: subject

body
```

### type 목록
| type | 설명 |
|------|------|
| `feat` | 새로운 기능 추가 |
| `fix` | 버그 수정 |
| `docs` | 문서 작성/수정 |
| `style` | 코드 스타일 변경 (기능 무관) |
| `refactor` | 리팩토링 (기능 변화 없음) |
| `test` | 테스트 코드 추가/변경 |
| `chore` | 설정, 빌드, 의존성 등 기타 작업 |
| `ci` | CI/CD 설정 변경 |
| `perf` | 성능 개선 작업 |

### 규칙
- **subject**: 50자 이내, 명령형 문장, 마침표 없음
- **body**: 한 줄 띄운 후 상세 설명 (무엇을, 왜 변경했는지 목록으로)
- 기능 하나당 커밋 하나

### 예시
```
feat: 회원가입 유효성 검사 추가

- 비밀번호 최소 길이, 이메일 형식 등 유효성 체크 추가
- 실패 케이스에 대한 에러 메시지 검증 포함
```

## 수행 작업

1. **커밋 생성**
   - 작업 디렉토리에서 커밋: `git -C <directory> commit -m "..."`
   - **반드시 위 커밋 메시지 컨벤션을 따름**
   - 인자로 메시지가 제공된 경우 해당 메시지 사용 (컨벤션 형식 확인)

2. **검증 1단계 (의도 검증)** 수행
   - intent-validator subagent 호출
   - Plan 문서 경로: `<directory>/tmp/current-plan.md`
   - Plan 문서의 의도대로 구현되었는지 확인
   - **subagent가 반환한 JSON 결과에서 status 확인**
   - **⚠️ FAIL 시 즉시 중지**: 2단계로 진행하지 않고, 실패 내용을 사용자에게 안내

3. **검증 2단계 (품질 검증)** 병렬 수행
   - **검증 1단계 PASS 시에만 실행**
   - 다음 네 가지 검증을 **동시에 병렬로** 실행:
     - doc-validator subagent: 문서 검증
     - security-validator subagent: 보안 검증
     - code-simplifier subagent: 코드 단순화 검증
     - test-validator subagent: 테스트 검증
   - 반드시 네 Task 도구를 **한 번의 응답에서 동시에 호출**
   - 각 subagent에 작업 디렉토리 정보 전달
   - **각 subagent가 반환한 JSON 결과를 수집** (파일 작성은 subagent가 하지 않음)

4. **결과 취합 및 파일 생성** (필수 - 메인에서만 수행)
   - 각 subagent가 반환한 결과(JSON 텍스트)를 파싱
   - 결과를 취합하여 `<directory>/tmp/validation-status.json` 파일 **직접 생성**
   - **Subagent는 이 파일을 작성하지 않음 - 반드시 메인에서 Write 도구로 생성**
   - 이 파일이 없으면 검증이 완료되지 않은 것으로 간주됨
   - PASS/WARN/FAIL 결과 요약 출력

## validation-status.json 형식 (필수)

검증 완료 후 **반드시** 표준 스키마에 따라 파일을 생성해야 합니다.

**스키마 참조**: `schemas/validation-status.schema.json`

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `timestamp` | string (ISO 8601) | O | 검증 완료 시간 |
| `branch` | string | O | 현재 브랜치명 |
| `base_branch` | string | O | 기준 브랜치명 (main, master, dev 등) |
| `commits` | array | O | 브랜치의 커밋 목록 |
| `commits[].hash` | string | O | 커밋 해시 (7-40자) |
| `commits[].message` | string | O | 커밋 메시지 |
| `results` | object | O | 각 validator별 결과 |
| `results.intent-validator` | "PASS" \| "WARN" \| "FAIL" | O | 의도 검증 결과 |
| `results.doc-validator` | "PASS" \| "WARN" \| "FAIL" \| "SKIP" | O | 문서 검증 결과 |
| `results.security-validator` | "PASS" \| "WARN" \| "FAIL" \| "SKIP" | O | 보안 검증 결과 |
| `results.code-simplifier` | "PASS" \| "WARN" \| "FAIL" \| "SKIP" | O | 코드 품질 검증 결과 |
| `results.test-validator` | "PASS" \| "WARN" \| "FAIL" \| "SKIP" | O | 테스트 검증 결과 |
| `overall` | "PASS" \| "WARN" \| "FAIL" | O | 전체 검증 결과 |
| `warnings` | string[] | O | 경고 메시지 배열 |
| `errors` | string[] | O | 에러 메시지 배열 |

**커밋 목록 수집 방법**:
```bash
# base_branch 이후의 모든 커밋 조회
git log <base_branch>..HEAD --oneline
```

**overall 판정 기준**:
- `PASS`: 모든 검증 통과
- `WARN`: FAIL 없이 WARN 존재
- `FAIL`: 하나라도 FAIL

**1단계 FAIL 시 파일 생성**:
- 1단계에서 FAIL이면 2단계는 실행하지 않음
- 이 경우에도 `validation-status.json` 파일은 생성
- 2단계 validator 결과는 `"SKIP"`으로 표시

```json
{
  "results": {
    "intent-validator": "FAIL",
    "doc-validator": "SKIP",
    "security-validator": "SKIP",
    "code-simplifier": "SKIP",
    "test-validator": "SKIP"
  },
  "overall": "FAIL"
}
```

## 검증 실패 시

### 1단계 (의도 검증) FAIL
- **2단계로 진행하지 않고 즉시 중지**
- intent-validator가 반환한 미충족 의도 항목 안내
- 수정이 필요한 파일/위치 지정
- 빌드 단계로 돌아가 재구현 안내

### 2단계 (품질 검증) FAIL
- 구체적인 미충족 사항 안내 (어느 validator에서 실패했는지 명시)
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
