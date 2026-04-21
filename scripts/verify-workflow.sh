#!/bin/bash
# 워크플로우 자가 검증

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

bash -n "$REPO_ROOT/setup.sh"
bash -n "$REPO_ROOT/setup-codex.sh"
test -f "$REPO_ROOT/codex/skills/ultivis-flow/SKILL.md"
test -f "$REPO_ROOT/codex/plugins/dev-workflow/skills/ultivis-flow/SKILL.md"
bash -n "$REPO_ROOT/scripts/issue.sh"
bash -n "$REPO_ROOT/scripts/notion-api.sh"
bash -n "$REPO_ROOT/scripts/ult-my-tasks.sh"
bash -n "$REPO_ROOT/scripts/ult-story-create-exec.sh"
bash -n "$REPO_ROOT/scripts/ult-sync-task.sh"
bash -n "$REPO_ROOT/scripts/ult-task-create.sh"
bash -n "$REPO_ROOT/scripts/ult-task-link-issue.sh"
bash -n "$REPO_ROOT/scripts/ult-task-note.sh"
bash -n "$REPO_ROOT/scripts/ult-task-status.sh"
bash -n "$REPO_ROOT/scripts/ult-wt-add.sh"
bash -n "$REPO_ROOT/scripts/check-validation-status.sh"

"$REPO_ROOT/scripts/check-validation-status.sh" "$REPO_ROOT/fixtures/validation-status.sample.json"

echo "OK: workflow verification passed"
