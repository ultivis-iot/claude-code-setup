# Claude Code Setup 프로젝트

Claude Code와 Codex 개발 플로우 설정 도구 저장소입니다.

## 프로젝트 구조

```
├── templates/          # 설치될 템플릿 파일
│   └── global-claude.md  # ~/.claude/CLAUDE.md에 추가될 전역 설정
├── agents/             # 서브에이전트 정의
├── commands/           # 슬래시 커맨드 (skills)
├── hooks/              # Git/이벤트 훅
├── schemas/            # JSON 스키마 정의
├── plugins/            # MCP 플러그인
├── codex/              # Codex rules/skills
├── setup.sh            # Linux/Mac 설치 스크립트
├── setup-codex.sh      # Codex 설치 스크립트
└── setup.ps1           # Windows 설치 스크립트
```

## 개발 규칙

### Agent 작성
- `agents/*.md` 파일로 정의
- 금지 사항을 명확히 명시 (특히 다른 skill 호출 제한)
- model 필드: `haiku`, `sonnet`, `opus`, `inherit` 중 선택

### 업데이트 내역 작성
- `CHANGELOG.md` 에 업데이트 진행 내역을 간단히 기록

### 버전 정책 (Semantic Versioning)

버전 형식: `vMAJOR.MINOR.PATCH` (VERSION 파일에 저장)

| 변경 유형 | 버전 증가 | 예시 |
|----------|----------|------|
| **MAJOR** | 호환성 깨지는 변경 | settings.json 구조 변경, 필수 의존성 추가 |
| **MINOR** | 새 기능 추가 (하위 호환) | 새 agent/command/hook 추가 |
| **PATCH** | 버그 수정, 개선, 문서 수정 | hook 수정, 오타 수정, 기능 개선 |

**릴리스 시 필수 작업:**
1. VERSION 파일 버전 증가
2. CHANGELOG.md의 `## Unreleased` 항목을 해당 버전 절로 확정
3. 커밋 후 태그 생성

커밋마다 버전을 올리지 않는다. 커밋은 CHANGELOG의 `## Unreleased`에 쌓고, 푸시해서 내보낼 때 한 번만 번호를 정한다. 릴리스 단위와 버전이 1:1이어야 태그가 의미를 갖는다.

**예시:**
```bash
# 커밋할 때 — 버전은 건드리지 않고 CHANGELOG 의 ## Unreleased 에만 적는다
git add . && git commit -m "fix: 변경 내용"

# 내보낼 때 — 쌓인 커밋을 한 버전으로 확정한다
# 1. VERSION 수정: 0.1.0 → 0.1.1
# 2. CHANGELOG.md 의 ## Unreleased 를 ## v0.1.1 (날짜) 로 확정
git add . && git commit -m "chore: v0.1.1"
git tag -a v0.1.1 -m "v0.1.1: 변경 요약"
git push origin master --tags
```

**업데이트 시 버전 확인:**
`./setup.sh --update` 실행 시 버전 비교 후 변경 내역 출력

### Command 작성
- `commands/*.md` 파일로 정의
- frontmatter에 name, description 필수

### 테스트
- 설치: `./setup.sh`
- Codex 설치: `./setup-codex.sh`
- 업데이트: `./setup.sh --update`
- 워크플로우 검증: `./scripts/verify-workflow.sh`

### 업데이트 검증
`./setup.sh --update` 실행 후 아래 항목 확인:

```bash
# 1. CLAUDE.md 전역 설정 확인
cat ~/.claude/CLAUDE.md | grep "Plan 모드 가이드"

# 2. Agents 파일 동기화 확인
diff -q agents/ ~/.claude/agents/

# 3. Commands 파일 동기화 확인
diff -q commands/ ~/.claude/commands/

# 4. Hooks 파일 동기화 확인
diff -q hooks/ ~/.claude/hooks/
```

모든 diff에서 차이가 없으면 업데이트 성공.
