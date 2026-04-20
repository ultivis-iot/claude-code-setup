# Claude Code / Codex 표준 개발 플로우 설정

표준화된 개발 플로우를 위한 Claude Code / Codex 설정 패키지입니다.

## 개요

이 설정은 다음과 같은 개발 플로우를 자동화합니다:

``` 
Plan → 빌드 → Commit → 검증 1단계 → 검증 2단계 (병렬) → Push & PR
                           ↓
                      (실패 시 빌드로 복귀)
```

Plan을 작업 단위로 발행할 때는 다음 관계를 기준으로 움직입니다:

- `Story`는 여러 `Task`를 묶는 상위 단위
- `Task 1개 = GitHub Issue 1개`
- 필요하면 각 Issue 기준으로 브랜치/worktree를 생성

즉 큰 Plan은 `ult-story-create`로 `Story + Task N개 + Issue N개`로 발행하고, 기존 Story에 작업 하나를 붙일 때는 `ult-task-create`로 `Task 1개 + Issue 1개`를 만듭니다.

## 처음 시작

처음 쓰는 사용자는 보통 아래 순서로 시작하면 됩니다.

1. Plan 작성 후 승인
2. Plan 승인 후 AI 제안을 확인하고 진행
3. 필요하면 `wa`, `cc`, `dw`, `ult-init`로 로컬 작업 환경 진입/전환
4. 구현 후 `/commit-and-verify`
5. 검증 통과 시 `/create-pr`, 이후 필요하면 `/review-cycle`

## 주요 기능

| 기능 | 설명 |
|-----|------|
| **Plan 모드 가이드** | 사용자 의도를 명확하게 문서화 |
| **Plan 자동 저장** | Plan 승인 시 `tmp/current-plan.md`로 자동 복사 |
| **자동 검증** | 커밋 후 의도 검증 + 품질 검증 자동 실행 |
| **작업 중심 진입점** | `ult-start-task`, `ult-finish-task`, `ult-sync-task` 명령으로 세부 명령 추상화 |
| **CLI 동기화 검증** | 서버 API 변경 시 CLI 커맨드 동기화 + Help 품질 자동 검증 |
| **보안 검사** | 실시간 보안 취약점 경고 + 커밋 후 보안 리뷰 |
| **Visual QA** | 프론트엔드 변경 시 브라우저 자동화 UI 검증 |
| **PR 생성** | 검증 통과 확인 후 자동 PR 생성 |

## 설치

### Codex (Linux / macOS)

```bash
git clone https://github.com/ultivis-iot/claude-code-setup.git
cd claude-code-setup
./setup-codex.sh
```

Codex에서는 `skill + plugin commands + minimal rules` 형태로 같은 워크플로우를 적용합니다. 현재 Codex 명령 진입점은 짧은 `/ult:...` 네임스페이스를 사용합니다.

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

### Codex (Linux / macOS)

```bash
cd claude-code-setup
git pull
./setup-codex.sh --update
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
│   ├── ult-start-task.md       # 작업 시작 단일 진입점
│   ├── ult-finish-task.md      # 작업 마무리 단일 진입점
│   ├── ult-sync-task.md        # Task 동기화 단일 진입점
│   ├── review-cycle.md         # PR AI 리뷰 반영 사이클
│   └── visual-qa.md            # 프론트엔드 Visual QA 검증
├── agents/
│   ├── intent-validator.md     # 검증 1단계: 의도 검증
│   ├── doc-validator.md        # 검증 2단계: 문서 검증
│   ├── security-validator.md   # 검증 2단계: 보안 검증
│   ├── code-simplifier.md      # 검증 2단계: 코드 단순화
│   ├── test-validator.md       # 검증 2단계: 테스트 검증
│   ├── cli-validator.md        # 검증 2단계: CLI 동기화 + Help 품질
│   └── visual-qa-analyzer.md   # Visual QA 결과 분석
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

Codex 설치 시:

```text
~/.codex/
├── rules/
│   └── dev-workflow.rules      # 안전한 최소 rules 파일 (Starlark 파싱용)
├── skills/
│   └── dev-workflow/
│       ├── SKILL.md
│       └── references/
│           ├── core-workflow.md
│           ├── commit-and-verify.md
│           ├── create-pr.md
│           ├── review-cycle.md
│           └── ult-notion.md
└── dev-tools/
    ├── dev-commands.sh
    ├── .env.example
    └── .env

~/plugins/
└── ult/
    ├── .codex-plugin/
    │   └── plugin.json
    ├── commands/
    │   ├── commit-and-verify.md
    │   ├── create-pr.md
    │   ├── review-cycle.md
    │   └── ...
    └── skills/
        └── dev-workflow/

~/.agents/plugins/
└── marketplace.json
```

## 사용 방법

### Codex

`setup-codex.sh` 실행 후 새 Codex 세션에서 다음처럼 요청하면 됩니다:

- `/ult:commit-and-verify feat: 새로운 기능 추가`
- `/ult:create-pr`
- `/ult:review-cycle 23`
- `/ult:ult-my-tasks`
- "이 작업 plan 먼저 잡고 intent 명시해줘"
- "commit and verify 해줘"
- "validation 통과했으면 PR 만들어줘"
- "PR 23 review cycle 돌려줘"

Codex에서는 로컬 문서/예제 기준으로 루트 slash command 등록 경로를 확인하지 못해, `~/plugins/ult`와 `~/.agents/plugins/marketplace.json`를 통해 `/ult:...` 형식의 짧은 slash command를 등록합니다. `dev-workflow` skill은 같은 워크플로우를 자연어 요청에도 적용하고, `~/.codex/rules/dev-workflow.rules`는 Codex 시작 시 파싱 오류를 막기 위한 최소 안전 파일로 유지합니다.

### 1. Plan 모드 진입

`Shift+Tab` 두 번 또는 CLI에서 `claude --permission-mode plan`

Plan 작성 시 반드시 **의도(Intent)** 섹션을 포함하여 사용자 의도를 명문화합니다.

**Plan 승인 시 자동 동작**:
- 사용자가 Plan을 승인하면 `tmp/current-plan.md`로 자동 복사됩니다
- 이 Plan은 검증 단계에서 의도 검증의 기준이 됩니다

### 2. Plan 승인 후 확인

Plan 승인 후에는 AI가 Plan 성격을 먼저 분류하고, 가장 적절한 다음 흐름 1개를 제안합니다.

- 새 Story가 적절하면 `ult-story-create` 흐름을 제안하고, 확인되면 이어서 진행
- 기존 Story에 Task 1개를 붙이는 게 맞으면 `ult-task-create` 흐름을 제안하고, 확인되면 이어서 진행
- 현재 Task 메모면 `ult-task-note` 흐름을 제안하고, 확인되면 이어서 진행
- 발행 없이 바로 구현할 작은 로컬 작업이면 그대로 Build 시작을 제안

즉 사용자가 항상 명령어를 직접 고르는 구조가 아니라, AI가 먼저 추천하고 사용자는 발행 방식만 확인하는 구조를 기본으로 둡니다.

작업 크기와 발행 단위는 항상 같지 않습니다. 작은 작업이어도 새 Story로 관리할 수 있고, 큰 작업이어도 기존 Story에 Task로 붙일 수 있습니다.

### 3. 구현 (빌드)

Plan에 따라 코드를 구현합니다.

### 작업 시작 명령

직접 세부 명령을 고를 수도 있고, 아래 진입점으로 시작할 수도 있습니다.

- `/ult-my-tasks` - 내 Task 조회 후 선택, 필요 시 브랜치/worktree 연결
- `/ult-story-create` - Plan을 새 Story와 Task들로 발행
- `/ult-task-create` - 기존 Story에 Task 1개와 Issue 1개 추가
- `/ult-task-note` - 현재 Task에 메모 추가
- `/ult-task-status` - 현재 Task 상태 수동 변경
- `/ult-weekly-report` - 주간 작업 집계 및 보고서 발행

### 셸 워크플로우 명령

로컬 작업 환경 전환도 이 저장소의 중요한 축입니다.

- `wt` - 현재 프로젝트 worktree 목록 확인
- `wa` - 새 worktree 생성 또는 기존 브랜치 기준 worktree 추가
- `cc` - 선택한 worktree에서 Claude Code 세션 시작/접속
- `dw` - 프로젝트별 개발 환경 전환 스크립트 실행
- `ult-init` - dev-tools 상태 확인, 설정, `dw-hook` 생성

보통 작업 흐름은 `ult-*` 명령으로 Task를 정한 뒤 `wa`/`cc`/`dw`로 로컬 환경을 맞추고 구현으로 들어갑니다.

### 4. 커밋 + 검증

```bash
# 현재 디렉토리
/commit-and-verify feat: 새로운 기능 추가

# 특정 디렉토리 지정 (멀티 프로젝트 환경)
/commit-and-verify project-maker fix: 버그 수정
```

이 명령은 다음을 자동으로 수행합니다:
- 커밋 생성
- 검증 1단계: Plan 의도대로 구현되었는지 확인
- 검증 2단계: 문서/보안/코드 품질/테스트/CLI 동기화 병렬 검증
- 검증 3단계: 프론트엔드 변경 시 Visual QA 제안 (선택적)

### 작업 중심 명령

세부 명령을 직접 기억하지 않아도 아래 진입점으로 시작할 수 있습니다.

- `/ult-start-task` - 내 Task 조회, Story 발행, Task 추가 중 상황에 맞는 흐름 선택
- `/ult-finish-task` - 검증 상태를 확인하고 필요 시 `/commit-and-verify` 후 `/create-pr`까지 연결
- `/ult-sync-task` - 현재 Task 메모 추가, 상태 변경, Issue/Task 컨텍스트 확인을 단일 진입점으로 처리

### 5. PR 생성

```bash
# 현재 디렉토리
/create-pr

# 특정 디렉토리 지정
/create-pr project-maker
```

모든 검증 통과 시 Push 및 PR을 생성합니다.

### 6. PR 리뷰 반영

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
- `tmp/last-review-id-{PR}.txt` - 리뷰 사이클 상태 (`.gitignore` 권장)
- `.cli-sync.json` - CLI 동기화 검증 설정 (첫 커밋 시 자동 탐지/생성)

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

## 저장소 검증

이 저장소 자체 변경 후에는 아래 검증 스크립트로 기본 계약을 확인할 수 있습니다.

```bash
./scripts/verify-workflow.sh
```

포함 항목:
- 주요 셸 스크립트 문법 검사
- `fixtures/validation-status.sample.json` 계약 검사

### 환경 변수 (.env)

설치 시 `WORKTREE_ROOT` 기준의 `~/.claude/dev-tools/.env`가 자동 생성됩니다.

```bash
WORKTREE_ROOT="/your/path/to/worktrees"
```

하위 호환으로 `AX_DIR`도 읽지만, 현재 기준 설정 키는 `WORKTREE_ROOT`입니다.

### Worktree 명령어

| 명령어 | 설명 |
|--------|------|
| `wt` | Worktree 목록 보기 (PR/merged 상태 표시) |
| `wa` | Worktree 추가 (원격 브랜치 선택 또는 새 브랜치) |
| `wr` | Worktree 삭제 (복수 선택: `1,3,5` / `1-3` / `a`=merged 전체) |
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
