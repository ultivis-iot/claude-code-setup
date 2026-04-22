#!/bin/bash
# 워크플로우 자가 검증

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKFLOW_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MODE="installed-unknown"
if [ -f "$WORKFLOW_ROOT/setup.sh" ] && [ -d "$WORKFLOW_ROOT/codex" ]; then
    MODE="repo"
elif [ "$(basename "$WORKFLOW_ROOT")" = ".codex" ]; then
    MODE="installed-codex"
elif [ "$(basename "$WORKFLOW_ROOT")" = ".claude" ]; then
    MODE="installed-claude"
fi

check_file() {
    local path="$1"
    [ -f "$path" ] || { echo "ERROR: missing file: $path" >&2; exit 1; }
}

check_script() {
    local path="$1"
    check_file "$path"
    bash -n "$path"
}

if [ "$MODE" = "repo" ]; then
    check_script "$WORKFLOW_ROOT/setup.sh"
    check_script "$WORKFLOW_ROOT/setup-codex.sh"
    check_file "$WORKFLOW_ROOT/setup.ps1"
    check_file "$WORKFLOW_ROOT/codex/skills/ultivis-flow/SKILL.md"
    check_file "$WORKFLOW_ROOT/codex/plugins/dev-workflow/skills/ultivis-flow/SKILL.md"
elif [ "$MODE" = "installed-codex" ]; then
    check_file "$WORKFLOW_ROOT/skills/ultivis-flow/SKILL.md"
    check_file "$HOME/plugins/ult/.codex-plugin/plugin.json"
    check_file "$HOME/plugins/ult/skills/ultivis-flow/SKILL.md"
elif [ "$MODE" = "installed-claude" ]; then
    check_file "$WORKFLOW_ROOT/CLAUDE.md"
    check_file "$WORKFLOW_ROOT/commands/commit-and-verify.md"
    check_file "$WORKFLOW_ROOT/commands/ult-story-run.md"
    check_file "$WORKFLOW_ROOT/agents/intent-validator.md"
    check_file "$WORKFLOW_ROOT/schemas/validation-status.schema.json"
else
    echo "ERROR: unknown workflow install mode: $WORKFLOW_ROOT" >&2
    exit 1
fi

check_script "$WORKFLOW_ROOT/scripts/issue.sh"
check_script "$WORKFLOW_ROOT/scripts/notion-api.sh"
check_script "$WORKFLOW_ROOT/scripts/ult-my-tasks.sh"
check_script "$WORKFLOW_ROOT/scripts/ult-story-create-exec.sh"
check_script "$WORKFLOW_ROOT/scripts/ult-story-run.sh"
check_script "$WORKFLOW_ROOT/scripts/ult-sync-task.sh"
check_script "$WORKFLOW_ROOT/scripts/ult-task-create.sh"
check_script "$WORKFLOW_ROOT/scripts/ult-task-link-issue.sh"
check_script "$WORKFLOW_ROOT/scripts/ult-task-note.sh"
check_script "$WORKFLOW_ROOT/scripts/ult-task-status.sh"
check_script "$WORKFLOW_ROOT/scripts/ult-wt-add.sh"
check_script "$WORKFLOW_ROOT/scripts/check-validation-status.sh"
check_script "$WORKFLOW_ROOT/scripts/ult-cache-refresh.sh"

if [ "$MODE" = "repo" ]; then
    "$WORKFLOW_ROOT/scripts/check-validation-status.sh" "$WORKFLOW_ROOT/fixtures/validation-status.sample.json"
else
    echo "OK: installed workflow files are present and shell-parse clean"
fi

echo "OK: workflow verification passed"
