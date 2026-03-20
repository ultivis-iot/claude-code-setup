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
| **Plan 자동 저장** | Plan 승인 시 `tmp/current-plan.md`로 자동 복사 |
| **자동 검증** | 커밋 후 의도 검증 + 품질 검증 자동 실행 |
| **보안 검사** | 실시간 보안 취약점 경고 + 커밋 후 보안 리뷰 |
| **PR 생성** | 검증 통과 확인 후 자동 PR 생성 |

## 설치

### Linux / macOS

```bash
git clone https://github.com/ultivis-iot/claude-code-setup.git
cd claude-code-setup
./setup.sh
```

### Windows (PowerShell)

```powershell
git clone https://github.com/ultivis-iot/claude-code-setup.git
cd claude-code-setup
.\setup.ps1
```

> **참고**: Windows에서 스크립트 실행이 차단되면 다음 명령을 먼저 실행하세요:
> ```powershell
> Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
> ```

## 업데이트

설정이 변경되면 `git pull` 후 업데이트 명령을 실행합니다.

### Linux / macOS

```bash
cd claude-code-setup
git pull
./setup.sh --update
```

### Windows (PowerShell)

```powershell
cd claude-code-setup
git pull
.\setup.ps1 -Update
```

> **참고**: 업데이트 시 `~/.claude/CLAUDE.md`의 `# === Claude Code 개발 플로우 설정 ===` 이후 내용만 교체됩니다. 사용자 설정은 해당 마커 이전에 작성하세요.

## 설치되는 파일

```
~/.claude/
├── CLAUDE.md                   # Plan 모드 가이드
├── settings.json               # hooks 설정 포함
├── commands/
│   ├── commit-and-verify.md    # 커밋 + 검증 자동 실행
│   ├── create-pr.md            # 검증 통과 후 PR 생성
│   └── review-cycle.md         # PR AI 리뷰 반영 사이클
├── agents/
│   ├── intent-validator.md     # 검증 1단계: 의도 검증
│   ├── doc-validator.md        # 검증 2단계: 문서 검증
│   ├── security-validator.md   # 검증 2단계: 보안 검증
│   └── code-simplifier.md      # 검증 2단계: 코드 단순화
├── schemas/
│   └── validation-status.schema.json  # 검증 결과 표준 스키마
├── hooks/
│   └── copy-plan-on-accept.sh  # Plan 승인 시 자동 복사
├── plugins/
│   └── security-guidance/      # 실시간 보안 검사 Plugin
└── dev-tools/
    ├── dev-commands.sh         # 개발 환경 셸 명령어
    ├── .env.example            # 환경 설정 템플릿
    └── .env                    # 사용자별 경로 설정 (자동 생성)
```

## 사용 방법

### 1. Plan 모드 진입

`Shift+Tab` 두 번 또는 CLI에서 `claude --permission-mode plan`

Plan 작성 시 반드시 **의도(Intent)** 섹션을 포함하여 사용자 의도를 명문화합니다.

**Plan 승인 시 자동 동작**:
- 사용자가 Plan을 승인하면 `tmp/current-plan.md`로 자동 복사됩니다
- 이 Plan은 검증 단계에서 의도 검증의 기준이 됩니다

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

### 5. PR 리뷰 반영

```bash
# 1회 실행 — 최신 AI 리뷰 확인 후 반영/코멘트
/review-cycle 23

# 자동 반복 — 새 리뷰가 올 때마다 자동 반영 (Ralph Loop 연동)
/ralph-loop /review-cycle 23 --completion-promise "REVIEW COMPLETE" --max-iterations 15
```

AI 코드 리뷰어의 지적을 자동으로 분석하고:
- **실제 버그/보안 문제** → 코드 수정 + 커밋 + push
- **설계 개선** → PR 범위 초과 시 GitHub 이슈 생성
- **오탐/반복 지적** → PR 코멘트로 사유 설명
- **신규 지적 없음** → 사이클 종료

## 프로젝트별 설정

### 기본 설정

각 프로젝트에서 tmp 디렉토리를 생성해야 합니다:

```bash
mkdir -p tmp
```

**자동 생성되는 파일**:
- `tmp/current-plan.md` - Plan 승인 시 자동 복사 (PostToolUse hook)
- `tmp/validation-status.json` - 검증 결과 기록
- `tmp/last-review-id.txt` - 리뷰 사이클 상태 (`.gitignore` 권장)

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

## 개발 환경 셸 명령어

`setup.sh` 실행 시 Git Worktree + tmux + Claude Code를 조합한 셸 명령어가 함께 설치됩니다.

### 환경 변수 (.env)

설치 시 `MAIN_PROJECT`와 `AX_DIR` 경로를 입력하면 `~/.claude/dev-tools/.env`가 자동 생성됩니다.

```bash
MAIN_PROJECT="/your/path/to/project-maker"  # 메인 프로젝트 경로 (git worktree 기준)
AX_DIR="/your/path/to/ax"                   # 작업 루트 디렉토리
```

### Worktree 명령어

| 명령어 | 설명 |
|--------|------|
| `wt` | Worktree 목록 보기 (PR/merged 상태 표시) |
| `wa` | Worktree 추가 (원격 브랜치 선택 또는 새 브랜치) |
| `wr` | Worktree 삭제 (대화형, merged 우선 표시) |
| `gw` | `git worktree list` 단축 |

### Claude Code 세션 명령어

| 명령어 | 설명 |
|--------|------|
| `cc [target]` | Claude Code tmux 세션 시작/접속 |
| `cc 552` | pm-552 디렉토리로 세션 시작 (숫자만 입력) |
| `cc main` | 메인 프로젝트 세션 (또는 `cc m`) |
| `ccs` | 모든 worktree의 세션 상태 보기 |
| `cca` | 모든 worktree에 대해 세션 일괄 생성 |
| `cc0` / `ccm` | 메인 프로젝트 세션 단축 |

### Docker Worktree 전환

> **참고**: `dw` 명령어는 project-maker 프로젝트 구조에 맞춰져 있습니다.
> 아래 환경이 갖춰진 경우에만 동작합니다:
> - `docker/docker-compose.dev.yml` (Docker Compose 설정)
> - `scripts/init-dev.sh` (개발 환경 초기화 스크립트)
> - `apps/api/alembic/` (Alembic 마이그레이션)
> - `pnpm` + Vite dev server (프론트엔드)
>
> 해당 구조가 없는 프로젝트에서는 `dw`를 사용하지 않아도 됩니다. 나머지 명령어(`wt`, `wa`, `cc` 등)는 프로젝트 구조와 무관하게 사용 가능합니다.

| 명령어 | 설명 |
|--------|------|
| `dw` | 현재 Docker worktree 상태 표시 |
| `dw 583` | pm-583 워크트리로 Docker+Vite 전환 |
| `dw main` | 기본 project-maker로 복원 (또는 `dw m`) |

`dw` 실행 시 Alembic downgrade → Docker 재시작 → Alembic upgrade → Vite dev server 재시작이 자동으로 수행됩니다.

### tmux 단축 명령어

| 명령어 | 설명 |
|--------|------|
| `tl` | tmux 세션 목록 |
| `tk <name>` | 특정 세션 종료 |
| `tka` | 모든 세션 종료 |
| `td` | 현재 세션에서 detach |

### Git 테스트 명령어

| 명령어 | 설명 |
|--------|------|
| `gtest <branch>` | 메인 프로젝트에서 non-commit 테스트 머지 |
| `greset` | 테스트 머지 초기화 |

### 워크플로우 예시

```bash
# 1. 새 이슈 작업 시작
wa              # worktree 추가 (브랜치 선택)
cc 558          # 해당 worktree에서 Claude Code 시작

# 2. 기존 작업 이어하기
ccs             # 세션 상태 확인
cc 552          # 원하는 세션으로 접속

# 3. Docker 워크트리 전환
dw 583          # Docker + Vite를 pm-583으로 전환
dw main         # 작업 끝나면 메인으로 복원
```

## 변경 이력

[CHANGELOG.md](./CHANGELOG.md) 참조

## 기여

문제 보고나 개선 제안은 이슈를 생성해주세요.

## 라이선스

MIT License
