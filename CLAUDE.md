# Claude Code Setup 프로젝트

Claude Code 개발 플로우 설정 도구 저장소입니다.

## 프로젝트 구조

```
├── templates/          # 설치될 템플릿 파일
│   └── global-claude.md  # ~/.claude/CLAUDE.md에 추가될 전역 설정
├── agents/             # 서브에이전트 정의
├── commands/           # 슬래시 커맨드 (skills)
├── hooks/              # Git/이벤트 훅
├── schemas/            # JSON 스키마 정의
├── plugins/            # MCP 플러그인
├── setup.sh            # Linux/Mac 설치 스크립트
└── setup.ps1           # Windows 설치 스크립트
```

## 개발 규칙

### Agent 작성
- `agents/*.md` 파일로 정의
- 금지 사항을 명확히 명시 (특히 다른 skill 호출 제한)
- model 필드: `haiku`, `sonnet`, `opus`, `inherit` 중 선택

### 업데이트 내역 작성
- `CHANGELOG.md` 에 업데이트 진행 내역을 간단히 기록

### Command 작성
- `commands/*.md` 파일로 정의
- frontmatter에 name, description 필수

### 테스트
- 설치: `./setup.sh`
- 업데이트: `./setup.sh --update`

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
