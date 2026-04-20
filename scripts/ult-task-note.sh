#!/bin/bash
# 현재 브랜치 Task에 코멘트 추가
# Usage: ult-task-note.sh "<메모 내용>"

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/notion-api.sh"

content="$*"
if [ -z "$content" ]; then
    echo "사용법: /ult-task-note \"<메모 내용>\"" >&2
    exit 1
fi

issue_num=$(issue_num_from_branch) || { echo "브랜치에서 Issue 번호를 찾을 수 없음" >&2; exit 1; }

task=$(find_task_by_issue "$issue_num")
if [ -z "$task" ]; then
    echo "Task #$issue_num 을(를) Notion에서 찾을 수 없음 (Issue URL 미등록 상태일 수 있음)" >&2
    exit 1
fi

task_id=$(echo "$task" | jq -r .id)
task_name=$(echo "$task" | jq -r '.properties.Name.title[0].plain_text // "(제목 없음)"')

gh_user=$(gh api user --jq .login 2>/dev/null || echo "unknown")
author=$(member_name "$gh_user" || echo "$gh_user")

body="[${author}] ${content}"
resp=$(notion_add_comment "$task_id" "$body")

if echo "$resp" | jq -e .id >/dev/null 2>&1; then
    echo "✓ Task #${issue_num} (${task_name}) 에 코멘트 추가됨"
    echo "  ${body}"
else
    echo "ERROR: 코멘트 추가 실패" >&2
    echo "$resp" >&2
    exit 1
fi
