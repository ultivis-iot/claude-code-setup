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

# 디렉토리 생성
echo "1. 디렉토리 생성..."
mkdir -p "$CLAUDE_DIR/commands"
mkdir -p "$CLAUDE_DIR/agents"

# CLAUDE.md 설치 (기존 파일에 추가)
echo "2. CLAUDE.md 설치..."
MARKER="# === Claude Code 개발 플로우 설정 ==="
if [ -f "$CLAUDE_DIR/CLAUDE.md" ]; then
    # 이미 설치된 내용이 있는지 확인
    if grep -q "$MARKER" "$CLAUDE_DIR/CLAUDE.md" 2>/dev/null; then
        if [ "$UPDATE_MODE" = true ]; then
            # 업데이트 모드: 기존 설정 섹션 교체
            echo -e "${YELLOW}   기존 설정 섹션 업데이트${NC}"
            # MARKER 이전 내용만 유지
            sed -i "/$MARKER/,\$d" "$CLAUDE_DIR/CLAUDE.md"
            # 새 내용 추가
            echo "$MARKER" >> "$CLAUDE_DIR/CLAUDE.md"
            cat "$SCRIPT_DIR/templates/global-claude.md" >> "$CLAUDE_DIR/CLAUDE.md"
            echo -e "${GREEN}   ✓ CLAUDE.md 업데이트 완료${NC}"
        else
            echo -e "${YELLOW}   이미 설치된 설정 발견. 건너뜀 (업데이트: --update)${NC}"
        fi
    else
        echo -e "${YELLOW}   기존 CLAUDE.md에 설정 추가${NC}"
        echo "" >> "$CLAUDE_DIR/CLAUDE.md"
        echo "$MARKER" >> "$CLAUDE_DIR/CLAUDE.md"
        cat "$SCRIPT_DIR/templates/global-claude.md" >> "$CLAUDE_DIR/CLAUDE.md"
        echo -e "${GREEN}   ✓ CLAUDE.md에 설정 추가 완료${NC}"
    fi
else
    echo "$MARKER" > "$CLAUDE_DIR/CLAUDE.md"
    cat "$SCRIPT_DIR/templates/global-claude.md" >> "$CLAUDE_DIR/CLAUDE.md"
    echo -e "${GREEN}   ✓ CLAUDE.md 생성 완료${NC}"
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
if [ -d "$SCRIPT_DIR/scripts" ]; then
    mkdir -p "$CLAUDE_DIR/scripts"
    for file in "$SCRIPT_DIR/scripts"/*.sh; do
        if [ -f "$file" ]; then
            filename=$(basename "$file")
            cp "$file" "$CLAUDE_DIR/scripts/$filename"
            chmod +x "$CLAUDE_DIR/scripts/$filename"
            echo -e "${GREEN}   ✓ $filename${NC}"
        fi
    done
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

# Plugins 설치
echo "6. Plugins 설치..."
if [ -d "$SCRIPT_DIR/plugins" ]; then
    mkdir -p "$CLAUDE_DIR/plugins"
    for plugin_dir in "$SCRIPT_DIR/plugins"/*/; do
        if [ -d "$plugin_dir" ]; then
            plugin_name=$(basename "$plugin_dir")
            cp -r "$plugin_dir" "$CLAUDE_DIR/plugins/"
            # Python 스크립트에 실행 권한 부여
            find "$CLAUDE_DIR/plugins/$plugin_name" -name "*.py" -exec chmod +x {} \;
            echo -e "${GREEN}   ✓ $plugin_name${NC}"
        fi
    done
fi

# Hooks 설치
echo "7. Hooks 설치..."
if [ -d "$SCRIPT_DIR/hooks" ]; then
    mkdir -p "$CLAUDE_DIR/hooks"
    for file in "$SCRIPT_DIR/hooks"/*.sh; do
        if [ -f "$file" ]; then
            filename=$(basename "$file")
            # install-hooks.sh는 git hook용이므로 제외
            if [ "$filename" != "install-hooks.sh" ]; then
                cp "$file" "$CLAUDE_DIR/hooks/$filename"
                chmod +x "$CLAUDE_DIR/hooks/$filename"
                echo -e "${GREEN}   ✓ $filename${NC}"
            fi
        fi
    done
fi

# settings.json에 hooks 설정 추가
echo "8. settings.json 업데이트..."
SETTINGS_FILE="$CLAUDE_DIR/settings.json"
if [ -f "$SETTINGS_FILE" ]; then
    # hooks 설정이 있는지 확인
    if grep -q '"hooks"' "$SETTINGS_FILE" 2>/dev/null; then
        echo -e "${YELLOW}   hooks 설정이 이미 존재함. 건너뜀${NC}"
    else
        # jq가 있으면 사용, 없으면 수동 처리
        if command -v jq &> /dev/null; then
            jq '. + {"hooks": {"PostToolUse": [{"matcher": "ExitPlanMode", "hooks": [{"type": "command", "command": "~/.claude/hooks/copy-plan-on-accept.sh", "timeout": 10}]}]}}' "$SETTINGS_FILE" > "${SETTINGS_FILE}.tmp" && mv "${SETTINGS_FILE}.tmp" "$SETTINGS_FILE"
            echo -e "${GREEN}   ✓ settings.json에 hooks 추가 (jq 사용)${NC}"
        else
            # jq 없이 수동 처리 - 전체 파일 재작성
            cat > "$SETTINGS_FILE" << 'SETTINGS_EOF'
{
  "enabledPlugins": {
    "security-guidance@claude-plugins-official": true
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "ExitPlanMode",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/copy-plan-on-accept.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
SETTINGS_EOF
            echo -e "${GREEN}   ✓ settings.json 재생성 완료${NC}"
        fi
    fi
else
    # settings.json이 없으면 새로 생성
    cat > "$SETTINGS_FILE" << 'SETTINGS_EOF'
{
  "enabledPlugins": {
    "security-guidance@claude-plugins-official": true
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "ExitPlanMode",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/copy-plan-on-accept.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
SETTINGS_EOF
    echo -e "${GREEN}   ✓ settings.json 생성 완료${NC}"
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
        read -p "   MAIN_PROJECT 경로 (메인 프로젝트, 예: /data/user/ax/project-maker): " MAIN_PROJECT_PATH
        read -p "   AX_DIR 경로 (작업 루트, 예: /data/user/ax): " AX_DIR_PATH

        if [ -n "$MAIN_PROJECT_PATH" ] && [ -n "$AX_DIR_PATH" ]; then
            cat > "$DEV_TOOLS_DEST/.env" << ENV_EOF
# AX 개발 환경 설정
# 이 파일을 .env로 복사 후 경로를 수정하세요

# 메인 프로젝트 경로 (git worktree의 기준)
MAIN_PROJECT="$MAIN_PROJECT_PATH"

# 작업 루트 디렉토리 (worktree들이 생성되는 상위 디렉토리)
AX_DIR="$AX_DIR_PATH"
ENV_EOF
            echo -e "${GREEN}   ✓ .env 생성 완료${NC}"
        else
            echo -e "${YELLOW}   ⚠ 경로가 입력되지 않았습니다. .env.example을 참고하여 수동으로 .env를 생성하세요.${NC}"
        fi
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
echo "  ~/.claude/schemas/validation-status.schema.json"
echo "  ~/.claude/plugins/security-guidance/ (보안 검사 Plugin)"
echo "  ~/.claude/hooks/copy-plan-on-accept.sh (Plan Accept Hook)"
echo "  ~/.claude/settings.json (hooks 설정 포함)"
echo "  ~/.claude/scripts/issue.sh (이슈 조회 스크립트)"
echo "  ~/.claude/dev-tools/dev-commands.sh (개발 환경 셸 명령어)"
echo "  ~/.claude/dev-tools/.env (사용자별 경로 설정)"
echo ""
echo "사용 방법:"
echo "  1. Plan 모드 진입: Shift+Tab 두 번"
echo "  2. 구현 후 커밋+검증: /commit-and-verify"
echo "  3. PR 생성: /create-pr"
echo "  4. PR 리뷰 반영: /review-cycle [PR번호]"
echo "     자동 반복: /ralph-loop /review-cycle [PR번호] --completion-promise \"REVIEW COMPLETE\""
echo ""
echo "프로젝트별 필요 사항:"
echo "  mkdir -p tmp  # 프로젝트 루트에 tmp 디렉토리 생성"
