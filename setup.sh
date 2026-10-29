#!/bin/bash

# Claude Code 개발 플로우 설치 스크립트
# 사용법: ./setup.sh [--update|-u]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"

# 색상 정의
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 옵션 파싱
UPDATE_MODE=false
if [ "$1" = "--update" ] || [ "$1" = "-u" ]; then
    UPDATE_MODE=true
fi

# 버전 파일 경로
VERSION_FILE="$SCRIPT_DIR/VERSION"
INSTALLED_VERSION_FILE="$CLAUDE_DIR/.installed-version"

# 현재 버전 읽기
CURRENT_VERSION="unknown"
if [ -f "$VERSION_FILE" ]; then
    CURRENT_VERSION=$(cat "$VERSION_FILE" | tr -d '[:space:]')
fi

# 설치된 버전 읽기
INSTALLED_VERSION="none"
if [ -f "$INSTALLED_VERSION_FILE" ]; then
    INSTALLED_VERSION=$(cat "$INSTALLED_VERSION_FILE" | tr -d '[:space:]')
fi

if [ "$UPDATE_MODE" = true ]; then
    echo "==================================="
    echo "Claude Code 개발 플로우 업데이트"
    echo "==================================="
    echo ""

    # Git 저장소인지 확인하고 업데이트 수행
    if [ -d "$SCRIPT_DIR/.git" ]; then
        echo "0. 원격 저장소 업데이트 확인..."
        cd "$SCRIPT_DIR"

        # remote가 설정되어 있는지 확인
        if git remote -v | grep -q "origin"; then
            # fetch로 원격 변경사항 확인
            git fetch origin 2>/dev/null

            LOCAL=$(git rev-parse HEAD 2>/dev/null)
            REMOTE=$(git rev-parse @{u} 2>/dev/null || echo "")

            if [ -n "$REMOTE" ] && [ "$LOCAL" != "$REMOTE" ]; then
                echo -e "${YELLOW}   원격 저장소에 업데이트가 있습니다. pull 수행 중...${NC}"
                if git pull origin "$(git branch --show-current)" 2>/dev/null; then
                    echo -e "${GREEN}   ✓ 최신 버전으로 업데이트 완료${NC}"
                else
                    echo -e "${YELLOW}   ⚠ git pull 실패. 로컬 파일로 진행합니다.${NC}"
                fi
            else
                echo -e "${GREEN}   ✓ 이미 최신 버전입니다${NC}"
            fi
        else
            echo -e "${YELLOW}   원격 저장소가 설정되지 않음. 로컬 파일로 진행합니다.${NC}"
        fi
    else
        echo -e "${YELLOW}   Git 저장소가 아님. 로컬 파일로 진행합니다.${NC}"
    fi
else
    echo "==================================="
    echo "Claude Code 개발 플로우 설치"
    echo "==================================="
fi
echo ""

echo "0-1. Graft CLI 확인..."
if command -v node > /dev/null 2>&1; then
    node "$SCRIPT_DIR/scripts/graft.mjs" ensure || true
else
    echo "[graft] Node.js가 없어 Graft 설치를 건너뜁니다. Node.js 20 이상을 설치하세요."
fi
echo ""

# 디렉토리 생성
echo "1. 디렉토리 생성..."
mkdir -p "$CLAUDE_DIR/commands"
mkdir -p "$CLAUDE_DIR/agents"
mkdir -p "$CLAUDE_DIR/skills"

# CLAUDE.md 설치 (기존 파일에 추가, 업데이트 시 직접 고친 내용과 3-way 병합)
echo "2. CLAUDE.md 설치..."
if command -v node > /dev/null 2>&1; then
    CLAUDE_MD_ARGS=("$CLAUDE_DIR/CLAUDE.md" "$SCRIPT_DIR/templates/global-claude.md" --state "$CLAUDE_DIR/.claude-code-setup" --repo "$SCRIPT_DIR")
    [ "$UPDATE_MODE" = true ] && CLAUDE_MD_ARGS+=(--update)
    node "$SCRIPT_DIR/scripts/install-claude-md.mjs" "${CLAUDE_MD_ARGS[@]}"
else
    # Node.js 없이도 첫 설치·추가는 한다. 병합이 필요한 업데이트만 건너뛴다.
    MARKER="# === Claude Code 개발 플로우 설정 ==="
    if [ ! -f "$CLAUDE_DIR/CLAUDE.md" ]; then
        { echo "$MARKER"; cat "$SCRIPT_DIR/templates/global-claude.md"; } > "$CLAUDE_DIR/CLAUDE.md"
        echo -e "${GREEN}   ✓ CLAUDE.md 생성 완료${NC}"
    elif ! grep -qF "$MARKER" "$CLAUDE_DIR/CLAUDE.md"; then
        { echo ""; echo "$MARKER"; cat "$SCRIPT_DIR/templates/global-claude.md"; } >> "$CLAUDE_DIR/CLAUDE.md"
        echo -e "${GREEN}   ✓ CLAUDE.md에 설정 추가 완료${NC}"
    else
        echo -e "${YELLOW}   ⚠ Node.js가 없어 CLAUDE.md 병합 업데이트를 건너뜀 (파일은 그대로)${NC}"
    fi
fi

# Commands 설치
echo "3. Commands 설치..."
for file in "$SCRIPT_DIR/commands"/*.md; do
    if [ -f "$file" ]; then
        filename=$(basename "$file")
        cp "$file" "$CLAUDE_DIR/commands/$filename"
        echo -e "${GREEN}   ✓ $filename${NC}"
    fi
done

# Scripts 설치
mkdir -p "$CLAUDE_DIR/docs/references" "$CLAUDE_DIR/templates"
cp "$SCRIPT_DIR"/docs/references/*.md "$CLAUDE_DIR/docs/references/"
cp "$SCRIPT_DIR/templates/cli-sync.json" "$SCRIPT_DIR/templates/REVIEW.md" "$CLAUDE_DIR/templates/"
if [ -d "$SCRIPT_DIR/scripts" ]; then
    mkdir -p "$CLAUDE_DIR/scripts"
    for file in "$SCRIPT_DIR/scripts"/*.sh "$SCRIPT_DIR/scripts"/*.mjs; do
        if [ -f "$file" ]; then
            filename=$(basename "$file")
            # test-*.mjs 는 저장소 전용 테스트라 설치하지 않는다
            case "$filename" in test-*) continue ;; esac
            cp "$file" "$CLAUDE_DIR/scripts/$filename"
            chmod +x "$CLAUDE_DIR/scripts/$filename"
            echo -e "${GREEN}   ✓ $filename${NC}"
        fi
    done
    # Node 스크립트가 쓰는 공용 모듈 (scripts/lib/*.mjs)
    if [ -d "$SCRIPT_DIR/scripts/lib" ]; then
        mkdir -p "$CLAUDE_DIR/scripts/lib"
        for file in "$SCRIPT_DIR/scripts/lib"/*.mjs; do
            if [ -f "$file" ]; then
                filename=$(basename "$file")
                cp "$file" "$CLAUDE_DIR/scripts/lib/$filename"
                echo -e "${GREEN}   ✓ lib/$filename${NC}"
            fi
        done
    fi
fi

# 구버전 파일 정리
# 이 목록에는 과거에 이 저장소가 설치했다가 rename/제거된 파일만 넣는다.
# (~/.claude에 사용자가 직접 만든 로컬 전용 파일은 건드리지 않는다)
echo "3-1. 구버전 파일 정리..."
STALE_FILES=(
    "commands/isaac-my-tasks.md"
    "commands/isaac-story-create.md"
    "commands/isaac-task-create.md"
    "commands/isaac-task-note.md"
    "commands/isaac-task-status.md"
    "commands/isaac-weekly-report.md"
    "scripts/isaac-my-tasks.sh"
    "scripts/isaac-story-create-exec.sh"
    "scripts/isaac-task-note.sh"
    "scripts/isaac-task-status.sh"
    "scripts/isaac-weekly-collect.sh"
    "scripts/isaac-weekly-publish.sh"
    "scripts/isaac-wt-add.sh"
    "scripts/issue.sh"
    "scripts/notion-api.sh"
    "scripts/ult-my-tasks.sh"
    "scripts/ult-task-note.sh"
    "scripts/ult-task-status.sh"
    "scripts/ult-task-link-issue.sh"
    "scripts/ult-sync-task.sh"
    "scripts/ult-weekly-collect.sh"
    "scripts/ult-weekly-publish.sh"
    "scripts/ult-story-create-exec.sh"
    "scripts/ult-task-create.sh"
    "scripts/ult-story-run.sh"
    "scripts/ult-cache-refresh.sh"
    "scripts/graft-refresh.sh"
    "scripts/ensure-graft-cli.sh"
    "scripts/ult-wt-add.sh"
    "scripts/review-cycle-ralph-loop.sh"
    "scripts/check-validation-status.sh"
    "scripts/workflow-env.sh"
    "hooks/copy-plan-on-accept.sh"
    "plugins/security-guidance/hooks/security_reminder_hook.py"
)
STALE_REMOVED=0
for rel_path in "${STALE_FILES[@]}"; do
    stale_target="$CLAUDE_DIR/$rel_path"
    if [ -f "$stale_target" ]; then
        rm "$stale_target"
        echo -e "${GREEN}   ✓ 제거: $rel_path${NC}"
        STALE_REMOVED=$((STALE_REMOVED + 1))
    fi
done
if [ "$STALE_REMOVED" -eq 0 ]; then
    echo -e "${GREEN}   ✓ 정리할 구버전 파일 없음${NC}"
fi

# Agents 설치
echo "4. Agents 설치..."
for file in "$SCRIPT_DIR/agents"/*.md; do
    if [ -f "$file" ]; then
        filename=$(basename "$file")
        cp "$file" "$CLAUDE_DIR/agents/$filename"
        echo -e "${GREEN}   ✓ $filename${NC}"
    fi
done

# Skills 설치
echo "4-1. Skills 설치..."
for skill_dir in "$SCRIPT_DIR/codex/skills"/*/; do
    if [ -d "$skill_dir" ] && [ -f "$skill_dir/SKILL.md" ]; then
        skill_name=$(basename "$skill_dir")
        rm -rf "$CLAUDE_DIR/skills/$skill_name"
        cp -R "$skill_dir" "$CLAUDE_DIR/skills/$skill_name"
        echo -e "${GREEN}   ✓ $skill_name${NC}"
    fi
done

# Schemas 설치
echo "5. Schemas 설치..."
if [ -d "$SCRIPT_DIR/schemas" ]; then
    mkdir -p "$CLAUDE_DIR/schemas"
    for file in "$SCRIPT_DIR/schemas"/*.json; do
        if [ -f "$file" ]; then
            filename=$(basename "$file")
            cp "$file" "$CLAUDE_DIR/schemas/$filename"
            echo -e "${GREEN}   ✓ $filename${NC}"
        fi
    done
fi

# Kiro 구현 agent 설정 (kiro-cli 가 있을 때만, kiro-implementer subagent 가 쓴다)
echo "5-1. Kiro agent 설정..."
if command -v kiro-cli > /dev/null 2>&1; then
    mkdir -p "$HOME/.kiro/agents"
    KIRO_AGENT="$HOME/.kiro/agents/claude-implementer.json"
    # 직접 고쳤거나 Kiro 가 바꾼 기존 설정은 덮어쓰기 전에 백업한다
    if [ -f "$KIRO_AGENT" ] && ! cmp -s "$SCRIPT_DIR/templates/kiro/claude-implementer.json" "$KIRO_AGENT"; then
        KIRO_BACKUP="$KIRO_AGENT.backup-$(date +%Y%m%d%H%M%S)"
        cp -p "$KIRO_AGENT" "$KIRO_BACKUP"
        echo -e "${YELLOW}   기존 Kiro agent 설정 백업: $KIRO_BACKUP${NC}"
    fi
    cp "$SCRIPT_DIR/templates/kiro/claude-implementer.json" "$KIRO_AGENT"
    echo -e "${GREEN}   ✓ ~/.kiro/agents/claude-implementer.json${NC}"
else
    echo -e "${YELLOW}   kiro-cli 없음. 건너뜀 (kiro-implementer 는 쓸 수 없음)${NC}"
fi

# Plugins 설치
echo "6. Plugins 설치..."
if [ -d "$SCRIPT_DIR/plugins" ]; then
    mkdir -p "$CLAUDE_DIR/plugins"
    for plugin_dir in "$SCRIPT_DIR/plugins"/*/; do
        if [ -d "$plugin_dir" ]; then
            plugin_name=$(basename "$plugin_dir")
            cp -r "$plugin_dir" "$CLAUDE_DIR/plugins/"
            # Node 스크립트에 실행 권한 부여
            find "$CLAUDE_DIR/plugins/$plugin_name" -name "*.mjs" -exec chmod +x {} \;
            echo -e "${GREEN}   ✓ $plugin_name${NC}"
        fi
    done
fi

# Hooks 설치
echo "7. Hooks 설치..."
if [ -d "$SCRIPT_DIR/hooks" ]; then
    mkdir -p "$CLAUDE_DIR/hooks"
    # Claude Code hook(.mjs). git hook(pre-commit 등)과 install-hooks.sh 는 저장소별로 hooks/install-hooks.sh 가 설치한다
    for file in "$SCRIPT_DIR/hooks"/*.mjs; do
        if [ -f "$file" ]; then
            filename=$(basename "$file")
            cp "$file" "$CLAUDE_DIR/hooks/$filename"
            chmod +x "$CLAUDE_DIR/hooks/$filename"
            echo -e "${GREEN}   ✓ $filename${NC}"
        fi
    done
fi

# settings.json에 hooks 설정 추가 (예전 .sh hook 경로는 Node hook 으로 옮긴다)
echo "8. settings.json 업데이트..."
SETTINGS_FILE="$CLAUDE_DIR/settings.json"
if command -v node &> /dev/null; then
    SETTINGS_RESULT=$(node "$SCRIPT_DIR/scripts/install-settings.mjs" "$SETTINGS_FILE" "node ~/.claude/hooks/copy-plan-on-accept.mjs" 2>&1) || SETTINGS_RESULT="error"
    case "$SETTINGS_RESULT" in
        created)           echo -e "${GREEN}   ✓ settings.json 생성 완료${NC}" ;;
        added)             echo -e "${GREEN}   ✓ settings.json에 hooks 추가${NC}" ;;
        migrated:*)        echo -e "${GREEN}   ✓ settings.json의 예전 copy-plan-on-accept.sh hook ${SETTINGS_RESULT#migrated:}개를 Node hook 으로 변경${NC}" ;;
        unchanged)         echo -e "${YELLOW}   hooks 설정이 이미 존재함. 건너뜀${NC}" ;;
        *)                 echo -e "${YELLOW}   ⚠ settings.json을 갱신하지 못했습니다. hook 을 수동으로 설정하세요:${NC}"
                           echo "     PostToolUse(ExitPlanMode) → node ~/.claude/hooks/copy-plan-on-accept.mjs" ;;
    esac
else
    echo -e "${YELLOW}   Node.js가 없어 settings.json 갱신을 건너뜁니다. (Node.js 20 이상 설치 후 다시 실행)${NC}"
fi

# Dev-tools 설치
echo "9. Dev-tools 설치..."
DEV_TOOLS_DEST="$CLAUDE_DIR/dev-tools"
mkdir -p "$DEV_TOOLS_DEST"

# dev-commands.sh 복사 (항상 최신으로 갱신)
cp "$SCRIPT_DIR/dev-tools/dev-commands.sh" "$DEV_TOOLS_DEST/dev-commands.sh"
echo -e "${GREEN}   ✓ dev-commands.sh${NC}"

# .env.example 복사
cp "$SCRIPT_DIR/dev-tools/.env.example" "$DEV_TOOLS_DEST/.env.example"
echo -e "${GREEN}   ✓ .env.example${NC}"

# .env 생성 (없을 때만)
if [ ! -f "$DEV_TOOLS_DEST/.env" ]; then
    if [ "$UPDATE_MODE" = false ]; then
        echo ""
        echo -e "${YELLOW}   dev-tools 환경 설정이 필요합니다.${NC}"
        DEFAULT_ROOT="$HOME/Git"
        read -p "   WORKTREE_ROOT 경로 (worktree 루트, 기본: $DEFAULT_ROOT): " WORKTREE_ROOT_PATH
        WORKTREE_ROOT_PATH="${WORKTREE_ROOT_PATH:-$DEFAULT_ROOT}"

        cat > "$DEV_TOOLS_DEST/.env" << ENV_EOF
# Ultivis dev-tools 환경 설정
WORKTREE_ROOT="$WORKTREE_ROOT_PATH"

# Notion API 직접 호출 스크립트용 토큰 (Claude MCP 설정이 없을 때 사용)
# export NOTION_TOKEN="ntn_..."

# Docker 멀티유저 격리 (자동 설정)
# dev-commands.sh가 사용자명 기반으로 포트/COMPOSE_PROJECT_NAME을 자동 계산합니다.
# 오버라이드 필요 시 아래 주석 해제:
# export COMPOSE_PROJECT_NAME="pm-$(whoami)"
# export PM_PORT_OFFSET=0
ENV_EOF
        echo -e "${GREEN}   ✓ .env 생성 완료 (WORKTREE_ROOT=$WORKTREE_ROOT_PATH, 포트 자동 할당)${NC}"
    else
        echo -e "${YELLOW}   .env 파일 없음. ~/.claude/dev-tools/.env.example 참고하여 수동 생성 필요${NC}"
    fi
else
    echo -e "${GREEN}   ✓ .env 유지 (기존 설정 보존)${NC}"
fi

# ~/.bashrc에 source 라인 추가
BASHRC="$HOME/.bashrc"
SOURCE_LINE="source \"\$HOME/.claude/dev-tools/dev-commands.sh\""
if [ -f "$BASHRC" ]; then
    if ! grep -qF 'dev-tools/dev-commands.sh' "$BASHRC" 2>/dev/null; then
        echo "" >> "$BASHRC"
        echo "# AX 개발 환경 명령어" >> "$BASHRC"
        echo "$SOURCE_LINE" >> "$BASHRC"
        echo -e "${GREEN}   ✓ ~/.bashrc에 source 추가${NC}"
    else
        echo -e "${GREEN}   ✓ ~/.bashrc에 이미 설정됨${NC}"
    fi
else
    echo "$SOURCE_LINE" > "$BASHRC"
    echo -e "${GREEN}   ✓ ~/.bashrc 생성 및 source 추가${NC}"
fi

# Notion MCP 설정
echo "10. Notion MCP 설정..."
if ! command -v claude &> /dev/null; then
    echo -e "${YELLOW}   claude CLI를 찾을 수 없어 Notion MCP 등록을 건너뜁니다.${NC}"
elif claude mcp list 2>/dev/null | grep -q "^notion-api:"; then
    echo -e "${GREEN}   ✓ notion-api MCP가 이미 등록됨${NC}"
elif [ "$UPDATE_MODE" = false ]; then
    echo ""
    echo "   Notion 워크스페이스 연결을 위해 Internal Integration 토큰이 필요합니다."
    echo "   발급 방법:"
    echo "     1. https://www.notion.so/profile/integrations 접속"
    echo "     2. + New integration → 회사 워크스페이스 선택, Type: Internal"
    echo "     3. 생성 후 Internal Integration Secret 복사 (ntn_... 또는 secret_...)"
    echo "     4. 접근할 페이지에서 ··· → Connections로 integration 공유"
    echo ""
    read -r -s -p "   NOTION_TOKEN (건너뛰려면 Enter): " NOTION_TOKEN_INPUT
    echo ""
    if [ -n "$NOTION_TOKEN_INPUT" ]; then
        if claude mcp add -s user -e "NOTION_TOKEN=$NOTION_TOKEN_INPUT" notion-api -- npx -y @notionhq/notion-mcp-server > /dev/null 2>&1; then
            echo -e "${GREEN}   ✓ notion-api MCP 등록 완료 (user scope)${NC}"
            echo -e "${YELLOW}   ⚠ Claude Code 재시작 후 mcp__notion-api__* 도구 사용 가능${NC}"
        else
            echo -e "${YELLOW}   ⚠ notion-api MCP 등록 실패. 수동 등록 필요${NC}"
        fi
        unset NOTION_TOKEN_INPUT
    else
        echo -e "${YELLOW}   건너뜀. 나중에 등록하려면:${NC}"
        echo "     claude mcp add -s user -e NOTION_TOKEN=<token> notion-api -- npx -y @notionhq/notion-mcp-server"
    fi
else
    echo -e "${YELLOW}   notion-api 미등록 (업데이트 모드에서는 자동 등록 안 함)${NC}"
fi

echo "11. Notion cache 준비..."
CACHE_REFRESH_OUTPUT=$(node "$CLAUDE_DIR/scripts/ult-notion.mjs" cache-refresh --quiet 2>&1 || true)
if printf '%s\n' "$CACHE_REFRESH_OUTPUT" | grep -q '^DONE:'; then
    echo -e "${GREEN}   ✓ ~/.claude/notion-cache 준비 완료${NC}"
elif printf '%s\n' "$CACHE_REFRESH_OUTPUT" | grep -q '^SKIP:'; then
    echo -e "${YELLOW}   건너뜀. Notion token 설정 후 첫 Notion 명령 실행 시 cache가 생성됩니다.${NC}"
else
    echo -e "${YELLOW}   ⚠ Notion cache 준비 실패. 첫 Notion 명령 실행 시 다시 시도됩니다.${NC}"
fi

# 설치된 버전 기록
echo "$CURRENT_VERSION" > "$INSTALLED_VERSION_FILE"

echo ""
echo "==================================="
echo -e "${GREEN}설치 완료!${NC} (v$CURRENT_VERSION)"
echo "==================================="

# 업데이트 모드에서 버전 변경 내역 출력
if [ "$UPDATE_MODE" = true ] && [ "$INSTALLED_VERSION" != "$CURRENT_VERSION" ]; then
    echo ""
    echo -e "${YELLOW}업데이트 내역 ($INSTALLED_VERSION → $CURRENT_VERSION):${NC}"
    echo "-----------------------------------"
    if [ -f "$SCRIPT_DIR/CHANGELOG.md" ]; then
        # CHANGELOG에서 현재 버전 섹션 출력
        sed -n "/^## v$CURRENT_VERSION/,/^## v/p" "$SCRIPT_DIR/CHANGELOG.md" | head -n -1
    fi
    echo "-----------------------------------"
fi

echo ""
echo "설치된 파일:"
echo "  ~/.claude/CLAUDE.md (기존 파일에 추가됨)"
echo "  ~/.claude/commands/commit-and-verify.md"
echo "  ~/.claude/commands/create-pr.md"
echo "  ~/.claude/commands/review-cycle.md"
echo "  ~/.claude/agents/intent-validator.md"
echo "  ~/.claude/agents/doc-validator.md"
echo "  ~/.claude/agents/security-validator.md"
echo "  ~/.claude/agents/code-simplifier.md"
echo "  ~/.claude/skills/*/SKILL.md"
echo "  ~/.claude/agents/cli-validator.md (CLI 동기화 검증 Agent)"
echo "  ~/.claude/schemas/validation-status.schema.json"
echo "  ~/.claude/plugins/security-guidance/ (보안 검사 Plugin)"
echo "  ~/.claude/hooks/copy-plan-on-accept.mjs (Plan Accept Hook)"
echo "  ~/.claude/settings.json (hooks 설정 포함)"
echo "  ~/.claude/scripts/*.sh, *.mjs, lib/*.mjs (workflow 실행 스크립트)"
echo "  ~/.claude/dev-tools/dev-commands.sh (개발 환경 셸 명령어)"
echo "  ~/.claude/dev-tools/.env (사용자별 경로 설정)"
echo "  ~/.claude/notion-cache/ (Notion token 사용 가능 시 자동 준비)"
echo "  notion-api MCP (Notion 토큰 입력 시 user scope 등록)"
echo ""
echo "사용 방법:"
echo "  1. Plan 모드 진입: Shift+Tab 두 번"
echo "  2. 구현 후 커밋+검증: /commit-and-verify"
echo "  3. PR 생성: /create-pr"
echo "  4. PR 리뷰 자동 반영: /review-cycle [PR번호]  (Ralph Loop 자동 시작)"
echo "     내부 단일 라운드: /review-cycle [PR번호] --once"
echo ""
echo "프로젝트별 필요 사항:"
echo "  mkdir -p tmp  # 프로젝트 루트에 tmp 디렉토리 생성"
echo "  (선택) .cli-sync.json  # CLI가 있는 프로젝트는 첫 커밋 시 자동 생성됨"
