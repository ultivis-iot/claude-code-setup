#!/bin/bash

set -euo pipefail

for arg in "$@"; do
    if [ "$arg" = "--once" ]; then
        exit 0
    fi
done

MAX_ITERATIONS="${REVIEW_CYCLE_MAX_ITERATIONS:-15}"

if ! [[ "$MAX_ITERATIONS" =~ ^[0-9]+$ ]]; then
    echo "ERROR: REVIEW_CYCLE_MAX_ITERATIONS must be a non-negative integer." >&2
    exit 1
fi

RALPH_SETUP=""

if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -x "$CLAUDE_PLUGIN_ROOT/scripts/setup-ralph-loop.sh" ]; then
    RALPH_SETUP="$CLAUDE_PLUGIN_ROOT/scripts/setup-ralph-loop.sh"
fi

if [ -z "$RALPH_SETUP" ]; then
    for candidate in \
        "$HOME/.claude/plugins/marketplaces/claude-plugins-official/plugins/ralph-loop/scripts/setup-ralph-loop.sh" \
        "$HOME/.claude/plugins/ralph-loop/scripts/setup-ralph-loop.sh" \
        "$HOME/plugins/ralph-loop/scripts/setup-ralph-loop.sh"
    do
        if [ -x "$candidate" ]; then
            RALPH_SETUP="$candidate"
            break
        fi
    done
fi

if [ -z "$RALPH_SETUP" ]; then
    cat >&2 <<'EOF'
ERROR: Ralph Loop setup script was not found.

Install or enable the ralph-loop plugin, then run /review-cycle again.
EOF
    exit 1
fi

"$RALPH_SETUP" \
    /review-cycle "$@" --once \
    --completion-promise "REVIEW COMPLETE" \
    --max-iterations "$MAX_ITERATIONS"
