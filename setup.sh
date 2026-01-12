#!/bin/bash

# Claude Code 개발 플로우 설치 스크립트
# 사용법: ./setup.sh [--update|-u]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"

# 옵션 파싱
UPDATE_MODE=false
if [ "$1" = "--update" ] || [ "$1" = "-u" ]; then
    UPDATE_MODE=true
fi

if [ "$UPDATE_MODE" = true ]; then
    echo "==================================="
    echo "Claude Code 개발 플로우 업데이트"
    echo "==================================="
else
    echo "==================================="
    echo "Claude Code 개발 플로우 설치"
    echo "==================================="
fi
echo ""

# 색상 정의
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

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
            cat "$SCRIPT_DIR/CLAUDE.md" >> "$CLAUDE_DIR/CLAUDE.md"
            echo -e "${GREEN}   ✓ CLAUDE.md 업데이트 완료${NC}"
        else
            echo -e "${YELLOW}   이미 설치된 설정 발견. 건너뜀 (업데이트: --update)${NC}"
        fi
    else
        echo -e "${YELLOW}   기존 CLAUDE.md에 설정 추가${NC}"
        echo "" >> "$CLAUDE_DIR/CLAUDE.md"
        echo "$MARKER" >> "$CLAUDE_DIR/CLAUDE.md"
        cat "$SCRIPT_DIR/CLAUDE.md" >> "$CLAUDE_DIR/CLAUDE.md"
        echo -e "${GREEN}   ✓ CLAUDE.md에 설정 추가 완료${NC}"
    fi
else
    echo "$MARKER" > "$CLAUDE_DIR/CLAUDE.md"
    cat "$SCRIPT_DIR/CLAUDE.md" >> "$CLAUDE_DIR/CLAUDE.md"
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

echo ""
echo "==================================="
echo -e "${GREEN}설치 완료!${NC}"
echo "==================================="
echo ""
echo "설치된 파일:"
echo "  ~/.claude/CLAUDE.md (기존 파일에 추가됨)"
echo "  ~/.claude/commands/commit-and-verify.md"
echo "  ~/.claude/commands/create-pr.md"
echo "  ~/.claude/agents/intent-validator.md"
echo "  ~/.claude/agents/doc-validator.md"
echo "  ~/.claude/agents/security-validator.md"
echo "  ~/.claude/agents/code-simplifier.md"
echo "  ~/.claude/schemas/validation-status.schema.json"
echo "  ~/.claude/plugins/security-guidance/ (보안 검사 Plugin)"
echo "  ~/.claude/hooks/copy-plan-on-accept.sh (Plan Accept Hook)"
echo "  ~/.claude/settings.json (hooks 설정 포함)"
echo ""
echo "사용 방법:"
echo "  1. Plan 모드 진입: Shift+Tab 두 번"
echo "  2. 구현 후 커밋+검증: /commit-and-verify"
echo "  3. PR 생성: /create-pr"
echo ""
echo "프로젝트별 필요 사항:"
echo "  mkdir -p tmp  # 프로젝트 루트에 tmp 디렉토리 생성"
