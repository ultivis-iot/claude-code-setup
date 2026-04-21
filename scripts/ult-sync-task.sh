#!/bin/bash
# 현재 Task 동기화 단일 진입점
# Usage:
#   ult-sync-task.sh
#   ult-sync-task.sh cancel|reopen|todo|in-progress|done
#   ult-sync-task.sh "<note>"

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ $# -eq 0 ]; then
    exec "$SCRIPT_DIR/issue.sh"
fi

case "$1" in
    cancel|reopen|todo|in-progress|done)
        exec "$SCRIPT_DIR/ult-task-status.sh" "$1"
        ;;
    *)
        exec "$SCRIPT_DIR/ult-task-note.sh" "$*"
        ;;
esac
