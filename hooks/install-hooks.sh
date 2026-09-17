#!/bin/bash
# Install validation gates and the post-merge Graft refresh in the current repository.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git rev-parse --show-toplevel)"
HOOKS="$(git rev-parse --path-format=absolute --git-path hooks)"
REPLACE=false
case "${1:-}" in
    --replace) REPLACE=true ;;
    "") ;;
    *) echo "Usage: $0 [--replace]" >&2; exit 1 ;;
esac
command -v node >/dev/null || { echo "ERROR: Node.js is required." >&2; exit 1; }

# Inspect every target before modifying any hook. Keep user hooks unless explicit.
for name in pre-commit pre-push post-merge; do
    target="$HOOKS/$name"
    if [ -f "$target" ] && ! grep -qE 'Claude Code 개발 플로우|Ultivis workflow|Ultivis validation|Ultivis Graft graph refresh' "$target"; then
        if [ "$REPLACE" != true ]; then
            echo "ERROR: existing custom hook: $target. Integrate it manually or use --replace (backup preserved)." >&2
            exit 1
        fi
    fi
done

mkdir -p "$HOOKS/workflow/scripts" "$HOOKS/workflow/schemas"
cp "$SCRIPT_DIR/../scripts/validation-gate.mjs" "$HOOKS/workflow/scripts/"
cp "$SCRIPT_DIR/../scripts/graft-refresh.sh" "$HOOKS/workflow/scripts/"
chmod +x "$HOOKS/workflow/scripts/graft-refresh.sh"
cp "$SCRIPT_DIR/../schemas/validation-status.schema.json" "$HOOKS/workflow/schemas/"
for name in pre-commit pre-push post-merge; do
    target="$HOOKS/$name"
    if [ -f "$target" ]; then
        backup=$(mktemp "$target.backup.XXXXXX")
        cp -p "$target" "$backup"
        echo "기존 hook 백업: $backup"
    fi
    cp "$SCRIPT_DIR/$name" "$target"
    chmod +x "$target"
done
mkdir -p "$ROOT/tmp"
echo "설치 완료: commit → validation → push, merge/pull → Graft 갱신. Graft가 없으면 설치를 권고하고 Git 작업은 계속합니다."
echo "tmp/는 프로젝트 .gitignore 또는 개인 exclude에서 제외하세요."
