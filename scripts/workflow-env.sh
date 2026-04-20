#!/bin/bash
# 공통 워크플로우 환경 해석기
# 설치 위치(~/.claude, ~/.codex 등)와 무관하게 동일한 상대 구조를 사용한다.

if [ -n "${WORKFLOW_ENV_LOADED:-}" ]; then
    return 0 2>/dev/null || exit 0
fi
WORKFLOW_ENV_LOADED=1

WORKFLOW_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKFLOW_HOME_DEFAULT="$(cd "$WORKFLOW_SCRIPT_DIR/.." && pwd)"

export WORKFLOW_HOME="${WORKFLOW_HOME:-${APP_HOME:-$WORKFLOW_HOME_DEFAULT}}"
export WORKFLOW_SCRIPTS_DIR="${WORKFLOW_SCRIPTS_DIR:-$WORKFLOW_HOME/scripts}"
export WORKFLOW_DEV_TOOLS_DIR="${WORKFLOW_DEV_TOOLS_DIR:-$WORKFLOW_HOME/dev-tools}"
export WORKFLOW_HOOKS_DIR="${WORKFLOW_HOOKS_DIR:-$WORKFLOW_HOME/hooks}"
export WORKFLOW_PLANS_DIR="${WORKFLOW_PLANS_DIR:-$WORKFLOW_HOME/plans}"
export WORKFLOW_CACHE_DIR="${WORKFLOW_CACHE_DIR:-$WORKFLOW_HOME/notion-cache}"
export WORKFLOW_CONFIG_JSON="${WORKFLOW_CONFIG_JSON:-$HOME/.claude.json}"

# 하위 호환 alias
export APP_HOME="$WORKFLOW_HOME"

workflow_scripts_path() {
    printf '%s\n' "$WORKFLOW_SCRIPTS_DIR"
}

workflow_dev_tools_path() {
    printf '%s\n' "$WORKFLOW_DEV_TOOLS_DIR"
}

workflow_hooks_path() {
    printf '%s\n' "$WORKFLOW_HOOKS_DIR"
}

workflow_plans_path() {
    printf '%s\n' "$WORKFLOW_PLANS_DIR"
}

workflow_cache_path() {
    printf '%s\n' "$WORKFLOW_CACHE_DIR"
}
