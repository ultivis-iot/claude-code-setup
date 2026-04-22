#!/bin/bash

# Codex 개발 플로우 설치 스크립트
# 사용법: ./setup-codex.sh [--update|-u]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODEX_DIR="${CODEX_HOME:-$HOME/.codex}"
SKILL_NAME="ultivis-flow"
LEGACY_SKILL_NAME="dev-workflow"
RULE_NAME="dev-workflow.rules"
PLUGIN_SOURCE_DIR="dev-workflow"
PLUGIN_NAME="ult"
LEGACY_PLUGIN_NAME="dev-workflow"
PLUGIN_ROOT="$HOME/plugins"
PLUGIN_DEST="$PLUGIN_ROOT/$PLUGIN_NAME"
MARKETPLACE_PATH="$HOME/.agents/plugins/marketplace.json"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

UPDATE_MODE=false
if [ "$1" = "--update" ] || [ "$1" = "-u" ]; then
    UPDATE_MODE=true
fi

echo "==================================="
if [ "$UPDATE_MODE" = true ]; then
    echo "Codex 개발 플로우 업데이트"
else
    echo "Codex 개발 플로우 설치"
fi
echo "==================================="
echo ""

echo "1. 디렉토리 생성..."
mkdir -p "$CODEX_DIR/rules"
mkdir -p "$CODEX_DIR/skills"

echo "2. Minimal rules 설치..."
cp "$SCRIPT_DIR/codex/rules/$RULE_NAME" "$CODEX_DIR/rules/$RULE_NAME"
echo -e "${GREEN}   ✓ ~/.codex/rules/$RULE_NAME${NC}"
echo -e "${YELLOW}     실제 워크플로우 동작은 skill이 담당하고, rules는 안전한 최소 파일입니다.${NC}"

echo "3. Skill 설치..."
rm -rf "$CODEX_DIR/skills/$LEGACY_SKILL_NAME"
rm -rf "$CODEX_DIR/skills/$SKILL_NAME"
cp -R "$SCRIPT_DIR/codex/skills/$SKILL_NAME" "$CODEX_DIR/skills/$SKILL_NAME"
echo -e "${GREEN}   ✓ ~/.codex/skills/$SKILL_NAME${NC}"

echo "4. Plugin 설치..."
mkdir -p "$PLUGIN_ROOT"
rm -rf "$PLUGIN_ROOT/$LEGACY_PLUGIN_NAME"
rm -rf "$PLUGIN_DEST"
cp -R "$SCRIPT_DIR/codex/plugins/$PLUGIN_SOURCE_DIR" "$PLUGIN_DEST"
mkdir -p "$(dirname "$MARKETPLACE_PATH")"
python3 - "$MARKETPLACE_PATH" "$PLUGIN_NAME" "$LEGACY_PLUGIN_NAME" <<'PY'
import json
import sys
from pathlib import Path

marketplace_path = Path(sys.argv[1]).expanduser()
plugin_name = sys.argv[2]
legacy_plugin_name = sys.argv[3]
entry = {
    "name": plugin_name,
    "source": {
        "source": "local",
        "path": f"./plugins/{plugin_name}",
    },
    "policy": {
        "installation": "INSTALLED_BY_DEFAULT",
        "authentication": "ON_INSTALL",
    },
    "category": "Coding",
}

if marketplace_path.exists():
    with marketplace_path.open() as handle:
        payload = json.load(handle)
else:
    payload = {
        "name": "local",
        "interface": {"displayName": "Local Plugins"},
        "plugins": [],
    }

plugins = payload.setdefault("plugins", [])
plugins = [
    item for item in plugins
    if not (isinstance(item, dict) and item.get("name") == legacy_plugin_name)
]
for index, existing in enumerate(plugins):
    if isinstance(existing, dict) and existing.get("name") == plugin_name:
        plugins[index] = entry
        break
else:
    plugins.append(entry)
payload["plugins"] = plugins

marketplace_path.parent.mkdir(parents=True, exist_ok=True)
with marketplace_path.open("w") as handle:
    json.dump(payload, handle, indent=2)
    handle.write("\n")
PY
echo -e "${GREEN}   ✓ ~/plugins/$PLUGIN_NAME${NC}"
echo -e "${GREEN}   ✓ ~/.agents/plugins/marketplace.json${NC}"
echo -e "${YELLOW}     Codex에서 /ult:commit-and-verify 같은 짧은 namespaced slash command를 기본 노출합니다.${NC}"

echo "5. Scripts 설치..."
SCRIPTS_DEST="$CODEX_DIR/scripts"
mkdir -p "$SCRIPTS_DEST"
for file in "$SCRIPT_DIR/scripts"/*.sh; do
    if [ -f "$file" ]; then
        filename=$(basename "$file")
        cp "$file" "$SCRIPTS_DEST/$filename"
        chmod +x "$SCRIPTS_DEST/$filename"
        echo -e "${GREEN}   ✓ ~/.codex/scripts/$filename${NC}"
    fi
done

echo "6. Dev-tools 설치..."
DEV_TOOLS_DEST="$CODEX_DIR/dev-tools"
mkdir -p "$DEV_TOOLS_DEST"

cp "$SCRIPT_DIR/dev-tools/dev-commands.sh" "$DEV_TOOLS_DEST/dev-commands.sh"
cp "$SCRIPT_DIR/dev-tools/.env.example" "$DEV_TOOLS_DEST/.env.example"
echo -e "${GREEN}   ✓ ~/.codex/dev-tools/dev-commands.sh${NC}"
echo -e "${GREEN}   ✓ ~/.codex/dev-tools/.env.example${NC}"

if [ ! -f "$DEV_TOOLS_DEST/.env" ]; then
    if [ "$UPDATE_MODE" = false ]; then
        echo ""
        echo -e "${YELLOW}   dev-tools 환경 설정이 필요합니다.${NC}"
        DEFAULT_ROOT="$HOME/Git"
        read -p "   WORKTREE_ROOT 경로 (worktree 루트, 기본: $DEFAULT_ROOT): " WORKTREE_ROOT_PATH
        WORKTREE_ROOT_PATH="${WORKTREE_ROOT_PATH:-$DEFAULT_ROOT}"

        cat > "$DEV_TOOLS_DEST/.env" << ENV_EOF
# Codex dev-tools 환경 설정
WORKTREE_ROOT="$WORKTREE_ROOT_PATH"

# Notion API 직접 호출 스크립트용 토큰 (Codex 단독 설치 시 필요)
# export NOTION_TOKEN="ntn_..."

# Docker 멀티유저 격리 (자동 설정)
# dev-commands.sh가 사용자명 기반으로 포트/COMPOSE_PROJECT_NAME을 자동 계산합니다.
# 오버라이드 필요 시 아래 주석 해제:
# export COMPOSE_PROJECT_NAME="pm-$(whoami)"
# export PM_PORT_OFFSET=0
ENV_EOF
        echo -e "${GREEN}   ✓ ~/.codex/dev-tools/.env 생성 완료${NC}"
    else
        echo -e "${YELLOW}   .env 파일 없음. ~/.codex/dev-tools/.env.example 참고하여 수동 생성 필요${NC}"
    fi
else
    echo -e "${GREEN}   ✓ ~/.codex/dev-tools/.env 유지${NC}"
fi

BASHRC="$HOME/.bashrc"
SOURCE_LINE="source \"\$HOME/.codex/dev-tools/dev-commands.sh\""
if [ -f "$BASHRC" ]; then
    if ! grep -qF '.codex/dev-tools/dev-commands.sh' "$BASHRC" 2>/dev/null; then
        echo "" >> "$BASHRC"
        echo "# Codex 개발 환경 명령어" >> "$BASHRC"
        echo "$SOURCE_LINE" >> "$BASHRC"
        echo -e "${GREEN}   ✓ ~/.bashrc에 Codex dev-tools source 추가${NC}"
    else
        echo -e "${GREEN}   ✓ ~/.bashrc에 이미 Codex dev-tools 설정됨${NC}"
    fi
else
    echo "$SOURCE_LINE" > "$BASHRC"
    echo -e "${GREEN}   ✓ ~/.bashrc 생성 및 Codex dev-tools source 추가${NC}"
fi

echo "7. Notion cache 준비..."
CACHE_REFRESH_OUTPUT=$("$SCRIPTS_DEST/ult-cache-refresh.sh" --quiet 2>&1 || true)
if printf '%s\n' "$CACHE_REFRESH_OUTPUT" | grep -q '^DONE:'; then
    echo -e "${GREEN}   ✓ ~/.codex/notion-cache 준비 완료${NC}"
elif printf '%s\n' "$CACHE_REFRESH_OUTPUT" | grep -q '^SKIP:'; then
    echo -e "${YELLOW}   건너뜀. Notion token 설정 후 첫 Notion 명령 실행 시 cache가 생성됩니다.${NC}"
else
    echo -e "${YELLOW}   ⚠ Notion cache 준비 실패. 첫 Notion 명령 실행 시 다시 시도됩니다.${NC}"
fi

echo ""
echo "==================================="
echo -e "${GREEN}설치 완료!${NC}"
echo "==================================="
echo ""
echo "설치된 파일:"
echo "  ~/.codex/rules/$RULE_NAME"
echo "  ~/.codex/skills/$SKILL_NAME/SKILL.md"
echo "  ~/.codex/skills/$SKILL_NAME/references/*.md"
echo "  ~/plugins/$PLUGIN_NAME/.codex-plugin/plugin.json"
echo "  ~/plugins/$PLUGIN_NAME/commands/*.md"
echo "  ~/.agents/plugins/marketplace.json"
echo "  ~/.codex/scripts/*.sh"
echo "  ~/.codex/dev-tools/dev-commands.sh"
echo "  ~/.codex/dev-tools/.env"
echo "  ~/.codex/notion-cache/ (Notion token 사용 가능 시 자동 준비)"
echo ""
echo "사용 방법:"
echo "  1. 새 Codex 세션 시작"
echo "  2. Plan 작성 시 Intent를 명확히 문서화"
echo "  3. /ult:commit-and-verify, /ult:create-pr 같은 slash command 사용"
echo "  4. 자연어 요청과 ~/.codex/skills/$SKILL_NAME 기반 workflow도 함께 사용 가능"
