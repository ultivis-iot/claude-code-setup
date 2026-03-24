---
allowed-tools: Bash(git:*), Task, Read, Grep, Glob, Write
description: 커밋 후 검증 단계를 자동으로 실행
argument-hint: [directory] [commit-message]
---

## 중요 제한 사항

**Subagent 제한**:
- 검증 subagent(intent-validator, doc-validator, security-validator, code-simplifier, test-validator, cli-validator)는 **검증만 수행**
- Subagent는 `/create-pr`, `/commit-and-verify` 등 다른 skill/command를 **절대 호출하지 않음**
- **Subagent는 파일을 작성하지 않음** - 결과를 JSON 텍스트로 반환만 함
- **메인(이 커맨드)에서 결과를 취합**하여 `tmp/validation-status.json` 파일 생성
- PR 생성은 사용자가 직접 `/create-pr`을 호출해야 함
- 이 명령은 **검증까지만** 수행하고 종료됨

**Visual QA 통합**:
- 프론트엔드 파일 변경이 감지되면 3단계에서 `/visual-qa` 수행 여부를 사용자에게 제안
- `/visual-qa`는 브라우저 MCP가 필요하므로 이 커맨드에서 직접 실행하지 않음 — 사용자가 별도 실행
- `validation-status.json`에 `visual-qa` 결과를 기록 (`SKIP` 또는 `PENDING`)

**CLI 동기화 검증**:
- 프로젝트 루트에 `.cli-sync.json`이 있고 `enabled: true`이면, 2단계에서 cli-validator를 병렬 실행
- `.cli-sync.json`이 없으면 첫 커밋 시 CLI 유무를 질문하여 파일 생성
- `enabled: false`이면 CLI 디렉토리가 새로 추가되었는지 자동 탐지

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

## CLI 동기화 설정 확인

1. **`.cli-sync.json` 존재 확인**
   ```bash
   test -f <directory>/.cli-sync.json && echo "EXISTS" || echo "NOT_FOUND"
   ```

2. **파일이 없는 경우 또는 `enabled: false`인 경우** — CLI 자동 탐지:
   - 프로젝트에 CLI가 있는지 자동으로 확인:
     ```bash
     # Go CLI (go.mod + cmd/ 디렉토리)
     find <directory> -maxdepth 3 -name "go.mod" -exec dirname {} \; 2>/dev/null | xargs -I{} test -d "{}/cmd" && echo "go"
     # Python CLI (cli/ + __main__.py 또는 setup.py entry_points)
     find <directory> -maxdepth 3 -name "__main__.py" -path "*/cli/*" 2>/dev/null
     # TypeScript CLI (package.json의 bin 필드)
     find <directory> -maxdepth 3 -name "package.json" -exec grep -l '"bin"' {} \; 2>/dev/null
     # Rust CLI (Cargo.toml의 [[bin]])
     find <directory> -maxdepth 3 -name "Cargo.toml" -exec grep -l '\[\[bin\]\]' {} \; 2>/dev/null
     ```
   - **감지됨** → 서버 API 경로도 자동 탐지:
     ```bash
     # GraphQL typeDefs
     find <directory> -maxdepth 5 -type d -name "typeDefs" -path "*/graphql/*" 2>/dev/null
     # REST OpenAPI
     find <directory> -maxdepth 3 -name "openapi.yaml" -o -name "openapi.json" 2>/dev/null
     # gRPC proto
     find <directory> -maxdepth 3 -name "*.proto" 2>/dev/null
     ```
   - 탐지 결과를 사용자에게 **확인만** 받음:
     ```
     CLI가 감지되었습니다:
       - CLI 경로: packages/cli (Go, cobra)
       - 서버 API: packages/server/src/graphql/typeDefs (GraphQL)

     이 설정으로 .cli-sync.json을 생성할까요?
       ○ 예
       ○ 아니오
     ```
   - **"예"** → 탐지된 경로로 `.cli-sync.json` 생성, staged에 추가
   - **"아니오"** → `{"enabled": false}` 로 생성 (또는 기존 유지)
   - **감지 안 됨** → `{"enabled": false}` 로 생성, CLI_ENABLED=false 설정, 스킵

3. **파일이 있고 `enabled: true`인 경우** — CLI_ENABLED=true로 설정, 설정값 보관

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
   - 다음 검증을 **동시에 병렬로** 실행:
     - doc-validator subagent: 문서 검증
     - security-validator subagent: 보안 검증
     - code-simplifier subagent: 코드 단순화 검증
     - test-validator subagent: 테스트 검증
     - **cli-validator subagent: CLI 동기화 + help 품질 검증** (CLI_ENABLED=true일 때만)
   - CLI_ENABLED=false이면 cli-validator를 호출하지 않고 결과를 `"SKIP"`으로 기록
   - cli-validator에 전달할 프롬프트:
     ```
     작업 디렉토리: <directory 절대경로>
     기준 브랜치: <base_branch>
     CLI 설정:
     - cliPath: <.cli-sync.json의 cliPath>
     - serverApiPath: <.cli-sync.json의 serverApiPath>
     - cliLanguage: <.cli-sync.json의 cliLanguage>
     - apiType: <.cli-sync.json의 apiType>
     - helpQualityRules: <.cli-sync.json의 helpQualityRules 배열>
     ```
   - 반드시 모든 Task 도구를 **한 번의 응답에서 동시에 호출**
   - 각 subagent에 작업 디렉토리 정보 전달
   - **각 subagent가 반환한 JSON 결과를 수집** (파일 작성은 subagent가 하지 않음)

4. **검증 3단계 (선택적 — Visual QA)**
   - **검증 2단계 PASS/WARN 시에만 실행** (FAIL이면 건너뜀)
   - 변경 파일 중 프론트엔드 파일(`.jsx`, `.tsx`, `.js`, `.ts`, `.css`, `.scss`) 존재 여부 확인:
     ```bash
     git -C <directory> diff <base_branch>...HEAD --name-only | grep -E '\.(jsx|tsx|js|ts|css|scss)$' | grep -v 'node_modules\|\.config\.\|\.test\.\|\.spec\.'
     ```
   - **프론트엔드 변경이 있는 경우**: AskUserQuestion으로 선택 제시:
     - "Visual QA를 수행하시겠습니까? (프론트엔드 변경 감지)"
     - 선택지: "예 — 이 검증 후 `/visual-qa` 실행", "아니오 — 건너뛰기"
   - **"예" 선택 시**: `visual-qa` 결과를 `"PENDING"`으로 기록, 결과 안내에서 `/visual-qa` 실행 안내 표시
   - **"아니오" 선택 시 또는 프론트엔드 변경 없음**: `visual-qa` 결과를 `"SKIP"`으로 기록

5. **결과 취합 및 파일 생성** (필수 - 메인에서만 수행)
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
| `results.cli-validator` | "PASS" \| "WARN" \| "FAIL" \| "SKIP" | X | CLI 동기화 검증 결과 (선택적 — .cli-sync.json 활성화 시) |
| `results.visual-qa` | "PASS" \| "WARN" \| "FAIL" \| "SKIP" \| "PENDING" | X | Visual QA 결과 (선택적) |
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
- `visual-qa`와 `cli-validator`는 선택적이므로 `SKIP` 상태일 때 overall에 영향 없음
- `cli-validator`가 활성화된 경우(SKIP이 아닌 경우)에는 overall 판정에 포함

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
    "test-validator": "SKIP",
    "cli-validator": "SKIP",
    "visual-qa": "SKIP"
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

### 3단계 (Visual QA) PENDING
- 검증 완료 후 안내:
  ```
  프론트엔드 변경이 감지되어 Visual QA가 대기 중입니다.
  `/visual-qa` 명령으로 UI 검증을 수행하세요.
  ```
- `/visual-qa` 실행 후 리포트(`tmp/visual-qa-report.md`)에서 결과 확인

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
