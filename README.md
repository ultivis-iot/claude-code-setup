# Claude Code 표준 개발 플로우 설정

표준화된 개발 플로우를 위한 Claude Code 전역 설정 패키지입니다.

## 개요

이 설정은 다음과 같은 개발 플로우를 자동화합니다:

```
Plan → 빌드 → Commit → 검증 1단계 → 검증 2단계 (병렬) → Push & PR
                           ↓
                      (실패 시 빌드로 복귀)
```

## 주요 기능

| 기능 | 설명 |
|-----|------|
| **Plan 모드 가이드** | 사용자 의도를 명확하게 문서화 |
| **자동 검증** | 커밋 후 의도 검증 + 품질 검증 자동 실행 |
| **보안 검사** | 실시간 보안 취약점 경고 + 커밋 후 보안 리뷰 |
| **PR 생성** | 검증 통과 확인 후 자동 PR 생성 |

## 설치

```bash
git clone <repository-url>
cd claude-code-setup
./setup.sh
```

## 설치되는 파일

```
~/.claude/
├── CLAUDE.md                   # Plan 모드 가이드
├── commands/
│   ├── commit-and-verify.md    # 커밋 + 검증 자동 실행
│   └── create-pr.md            # 검증 통과 후 PR 생성
├── agents/
│   ├── intent-validator.md     # 검증 1단계: 의도 검증
│   ├── doc-validator.md        # 검증 2단계: 문서 검증
│   ├── security-validator.md   # 검증 2단계: 보안 검증
│   └── code-simplifier.md      # 검증 2단계: 코드 단순화
└── plugins/
    └── security-guidance/      # 실시간 보안 검사 Hook
```

## 사용 방법

### 1. Plan 모드 진입

`Shift+Tab` 두 번 또는 CLI에서 `claude --permission-mode plan`

Plan 작성 시 반드시 **의도(Intent)** 섹션을 포함하여 사용자 의도를 명문화합니다.

### 2. 구현 (빌드)

Plan에 따라 코드를 구현합니다.

### 3. 커밋 + 검증

```bash
# 현재 디렉토리
/commit-and-verify feat: 새로운 기능 추가

# 특정 디렉토리 지정 (멀티 프로젝트 환경)
/commit-and-verify project-maker fix: 버그 수정
```

이 명령은 다음을 자동으로 수행합니다:
- 커밋 생성
- 검증 1단계: Plan 의도대로 구현되었는지 확인
- 검증 2단계: 문서/보안/코드 품질 병렬 검증

### 4. PR 생성

```bash
# 현재 디렉토리
/create-pr

# 특정 디렉토리 지정
/create-pr project-maker
```

모든 검증 통과 시 Push 및 PR을 생성합니다.

## 프로젝트별 설정

### 기본 설정

각 프로젝트에서 tmp 디렉토리를 생성해야 합니다:

```bash
mkdir -p tmp
```

Plan 문서는 `tmp/current-plan.md`에 저장되고, 검증 상태는 `tmp/validation-status.json`에 기록됩니다.

### Git Hook 설치 (선택)

검증 없이 커밋하는 것을 방지하려면 pre-commit hook을 설치하세요:

```bash
# 프로젝트 루트에서 실행
/path/to/claude-code-setup/hooks/install-hooks.sh
```

또는 수동으로:

```bash
cp /path/to/claude-code-setup/hooks/pre-commit .git/hooks/
chmod +x .git/hooks/pre-commit
```

**Hook 동작**:
- 커밋 시 `tmp/validation-status.json` 확인
- 검증 미통과 시 커밋 차단
- `git commit --no-verify`로 우회 가능

## 보안 검증

이 설정은 **이중 보안 검증**을 제공합니다:

| 검증 | 시점 | 방식 |
|-----|------|------|
| security-guidance | 파일 편집 **전** | PreToolUse Hook |
| security-validator | 커밋 **후** | Subagent 검증 |

### 감지 항목

- GitHub Actions 명령 주입
- `child_process.exec()`, `eval()`, `new Function()`
- XSS (`dangerouslySetInnerHTML`, `innerHTML`)
- Python `pickle` 역직렬화
- `os.system` 시스템 명령
- SQL Injection 패턴

## 검증 결과 형식

| 상태 | 의미 |
|-----|------|
| **PASS** | 검증 통과 |
| **WARN** | 경고 (진행 가능) |
| **FAIL** | 실패 (수정 필요) |

## 기여

문제 보고나 개선 제안은 이슈를 생성해주세요.

## 라이선스

MIT License
