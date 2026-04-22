#!/bin/bash
# Notion workflow cache warm-up/refresh.
#
# Usage:
#   ult-cache-refresh.sh [--quiet] [--strict]
#
# Default behavior is installer-friendly: missing tokens or partial Notion
# failures are reported but do not fail the caller. Use --strict when a caller
# wants cache refresh failures to be fatal.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/workflow-env.sh"
. "$SCRIPT_DIR/notion-api.sh"

QUIET=0
STRICT=0

usage() {
    cat >&2 <<'EOF'
사용법:
  ult-cache-refresh.sh [--quiet] [--strict]

역할:
  사용자별 Notion workflow cache를 준비합니다.
  기본 위치는 ~/.claude/notion-cache 또는 ~/.codex/notion-cache 입니다.

옵션:
  --quiet   성공/스킵 메시지 최소화
  --strict  토큰 없음 또는 refresh 실패를 exit 1로 처리
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --quiet) QUIET=1; shift ;;
        --strict) STRICT=1; shift ;;
        --help|-h) usage; exit 0 ;;
        *)
            echo "알 수 없는 옵션: $1" >&2
            usage
            exit 1
            ;;
    esac
done

log() {
    [ "$QUIET" -eq 1 ] || echo "$@"
}

warn() {
    echo "$@" >&2
}

status() {
    echo "$@"
}

skip_or_fail() {
    local message="$1"
    if [ "$STRICT" -eq 1 ]; then
        warn "ERROR: $message"
        exit 1
    fi
    status "SKIP: $message"
    exit 0
}

if ! _notion_token >/dev/null 2>&1; then
    skip_or_fail "Notion token not found. Set NOTION_TOKEN or configure notion-api MCP."
fi

mkdir -p "$CACHE_DIR/schemas" "$CACHE_DIR/templates"

failed=0
refresh_step() {
    local label="$1"
    shift
    if "$@" >/dev/null 2>&1; then
        log "OK: $label"
    else
        failed=1
        warn "WARN: failed to refresh $label"
    fi
}

refresh_step "members" member_cache_refresh
refresh_step "projects" project_cache_refresh
refresh_step "repositories" repo_cache_refresh
refresh_step "task schema" schema_refresh task "$TASK_DB"
refresh_step "story schema" schema_refresh story "$STORY_DB"
refresh_step "project schema" schema_refresh project "$PROJECT_DB"
refresh_step "task template" template_blocks_cached "$TASK_TEMPLATE_ID"

for tag in Feature Update Refactor Bug; do
    template_id=$(story_template_id "$tag")
    [ -n "$template_id" ] || continue
    refresh_step "story template: $tag" template_blocks_cached "$template_id"
done

if [ "$failed" -ne 0 ]; then
    if [ "$STRICT" -eq 1 ]; then
        exit 1
    fi
    status "DONE: Notion cache refresh completed with warnings at $CACHE_DIR"
    exit 0
fi

status "DONE: Notion cache ready at $CACHE_DIR"
