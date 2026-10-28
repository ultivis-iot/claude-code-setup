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
    node "$WORKFLOW_ROOT/scripts/sync-workflow.mjs" --check
    node "$WORKFLOW_ROOT/scripts/test-install-claude-md.mjs"
    check_script "$WORKFLOW_ROOT/hooks/pre-commit"
    check_script "$WORKFLOW_ROOT/hooks/pre-push"
    check_script "$WORKFLOW_ROOT/hooks/post-merge"
    check_script "$WORKFLOW_ROOT/hooks/install-hooks.sh"
    check_file "$WORKFLOW_ROOT/hooks/copy-plan-on-accept.mjs"
    node --check "$WORKFLOW_ROOT/hooks/copy-plan-on-accept.mjs"
    check_file "$WORKFLOW_ROOT/plugins/security-guidance/hooks/security-reminder.mjs"
    node --check "$WORKFLOW_ROOT/plugins/security-guidance/hooks/security-reminder.mjs"
    for command_file in "$WORKFLOW_ROOT"/commands/*.md; do
        command_name="$(basename "$command_file")"
        plugin_command="$WORKFLOW_ROOT/codex/plugins/dev-workflow/commands/$command_name"
        check_file "$plugin_command"
    done

    while IFS= read -r skill_dir; do
        skill_name="$(basename "$skill_dir")"
        check_file "$skill_dir/SKILL.md"
        check_file "$skill_dir/agents/openai.yaml"
        check_file "$WORKFLOW_ROOT/codex/plugins/dev-workflow/skills/$skill_name/SKILL.md"
    done < <(find "$WORKFLOW_ROOT/codex/skills" -mindepth 1 -maxdepth 1 -type d | sort)

    while IFS= read -r skill_file; do
        rel="${skill_file#"$WORKFLOW_ROOT/codex/skills/"}"
        plugin_file="$WORKFLOW_ROOT/codex/plugins/dev-workflow/skills/$rel"
        check_file "$plugin_file"
        cmp -s "$skill_file" "$plugin_file" || {
            echo "ERROR: plugin skill copy differs: $rel" >&2
            exit 1
        }
    done < <(find "$WORKFLOW_ROOT/codex/skills" -type f | sort)
elif [ "$MODE" = "installed-codex" ]; then
    check_file "$WORKFLOW_ROOT/skills/ultivis-flow/SKILL.md"
    check_file "$WORKFLOW_ROOT/skills/tdd/SKILL.md"
    check_file "$WORKFLOW_ROOT/skills/wayfinder/SKILL.md"
    check_file "$WORKFLOW_ROOT/plugins/ult/.codex-plugin/plugin.json"
    check_file "$WORKFLOW_ROOT/plugins/ult/skills/ultivis-flow/SKILL.md"
elif [ "$MODE" = "installed-claude" ]; then
    check_file "$WORKFLOW_ROOT/CLAUDE.md"
    check_file "$WORKFLOW_ROOT/commands/commit-and-verify.md"
    check_file "$WORKFLOW_ROOT/commands/ult-story-run.md"
    check_file "$WORKFLOW_ROOT/agents/intent-validator.md"
    check_file "$WORKFLOW_ROOT/schemas/validation-status.schema.json"
    check_file "$WORKFLOW_ROOT/skills/ultivis-flow/SKILL.md"
    check_file "$WORKFLOW_ROOT/skills/tdd/SKILL.md"
else
    echo "ERROR: unknown workflow install mode: $WORKFLOW_ROOT" >&2
    exit 1
fi

check_file "$WORKFLOW_ROOT/scripts/validation-gate.mjs"
for node_script in ult-notion.mjs ult-flow.mjs graft.mjs lib/notion.mjs review-cycle-ralph-loop.mjs review-findings.mjs review-metrics.mjs install-settings.mjs; do
    check_file "$WORKFLOW_ROOT/scripts/$node_script"
    node --check "$WORKFLOW_ROOT/scripts/$node_script"
done
check_file "$WORKFLOW_ROOT/schemas/validation-status.schema.json"
check_file "$WORKFLOW_ROOT/docs/references/validation-contract.md"
check_file "$WORKFLOW_ROOT/docs/references/create-pr-contract.md"
check_file "$WORKFLOW_ROOT/templates/cli-sync.json"
check_file "$WORKFLOW_ROOT/templates/REVIEW.md"

if [ "$MODE" = "repo" ]; then
    node "$WORKFLOW_ROOT/scripts/validation-gate.mjs" check "$WORKFLOW_ROOT/fixtures/validation-status.sample.json"
    node "$WORKFLOW_ROOT/scripts/test-validation-gate.mjs"
    node "$WORKFLOW_ROOT/scripts/test-install-settings.mjs"
    node "$WORKFLOW_ROOT/scripts/test-review-findings.mjs"
    node "$WORKFLOW_ROOT/scripts/test-review-metrics.mjs"
    node "$WORKFLOW_ROOT/scripts/test-ult-notion.mjs" | tail -n 3
else
    echo "OK: installed workflow files are present and shell-parse clean"
fi

echo "OK: workflow verification passed"
