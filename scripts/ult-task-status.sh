#!/bin/bash
# Task 상태 변경
# Usage:
#   ult-task-status.sh                           # 현재 브랜치 Task 대화형
#   ult-task-status.sh <issue_num> <action>      # 비대화형
#     action: cancel | reopen | in-progress | todo

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/notion-api.sh"

# 상태 매핑
action_to_status() {
    case "$1" in
        cancel)      echo "미완료" ;;
        reopen|todo) echo "시작 전" ;;
        in-progress) echo "진행 중" ;;
        done)        echo "완료" ;;
        *)           return 1 ;;
    esac
}

# 인자 파싱
ISSUE_NUM=""
ACTION=""
if [ -n "$1" ]; then
    if [[ "$1" =~ ^#?[0-9]+$ ]]; then
        ISSUE_NUM="${1#\#}"
        ACTION="$2"
    else
        ACTION="$1"
    fi
fi

# Issue 번호: 인자 없으면 브랜치에서
if [ -z "$ISSUE_NUM" ]; then
    ISSUE_NUM=$(issue_num_from_branch) || { echo "브랜치에서 Issue 번호를 찾을 수 없음" >&2; exit 1; }
fi

issue_url=$(gh issue view "$ISSUE_NUM" --json url --jq .url 2>/dev/null || echo "")

task=""
if [ -n "$issue_url" ]; then
    task=$(find_task_by_issue_url "$issue_url" 2>/dev/null || true)
fi
if [ -z "$task" ]; then
    task=$(find_task_by_issue "$ISSUE_NUM" 2>/dev/null || true)
fi
if [ -z "$task" ]; then
    echo "Task #$ISSUE_NUM 을(를) Notion에서 찾을 수 없음. Issue URL 자동 연결을 시도합니다." >&2
    if "$SCRIPT_DIR/ult-task-link-issue.sh" "$ISSUE_NUM" --auto >/dev/null; then
        [ -n "$issue_url" ] && task=$(find_task_by_issue_url "$issue_url")
        [ -z "$task" ] && task=$(find_task_by_issue "$ISSUE_NUM")
    fi
fi

if [ -z "$task" ]; then
    echo "Task #$ISSUE_NUM 을(를) Notion에서 찾을 수 없음" >&2
    echo "수동 연결: $SCRIPT_DIR/ult-task-link-issue.sh #$ISSUE_NUM --task <notion_task_url>" >&2
    exit 1
fi

task_id=$(echo "$task" | jq -r .id)
task_name=$(echo "$task" | jq -r '.properties.Name.title[0].plain_text // "(제목 없음)"')
current_status=$(echo "$task" | jq -r '.properties.Status.status.name // ""')

echo "Task #${ISSUE_NUM}: ${task_name}"
echo "현재 상태: ${current_status}"

# 대화형 action 선택
if [ -z "$ACTION" ]; then
    echo ""
    echo "전이 옵션:"
    echo "  [1] cancel      → 미완료"
    echo "  [2] reopen      → 시작 전"
    echo "  [3] in-progress → 진행 중"
    echo "  [4] done        → 완료"
    echo "  [c] 취소"
    read -r -p "선택 [1-4/c]: " choice
    case "$choice" in
        1) ACTION="cancel" ;;
        2) ACTION="reopen" ;;
        3) ACTION="in-progress" ;;
        4) ACTION="done" ;;
        *) echo "취소됨"; exit 0 ;;
    esac
fi

new_status=$(action_to_status "$ACTION") || { echo "알 수 없는 action: $ACTION" >&2; exit 1; }

# 사유 입력 (대화형일 때만)
reason=""
if [ -t 0 ]; then
    read -r -p "사유 (Enter로 생략): " reason
fi

# 상태 업데이트
props=$(jq -nc --arg s "$new_status" '{Status: {status: {name: $s}}}')
resp=$(notion_patch_page "$task_id" "$props")
if ! echo "$resp" | jq -e .id >/dev/null 2>&1; then
    echo "ERROR: 상태 업데이트 실패" >&2
    echo "$resp" >&2
    exit 1
fi

# 변경 이력 코멘트
gh_user=$(gh api user --jq .login 2>/dev/null || echo "unknown")
author=$(member_name "$gh_user" || echo "$gh_user")
comment="[${author}] 상태 변경: ${current_status} → ${new_status}"
[ -n "$reason" ] && comment+=$'\n'"사유: $reason"

notion_add_comment "$task_id" "$comment" >/dev/null

echo "✓ Task #${ISSUE_NUM} 상태: ${current_status} → ${new_status}"
if [ -n "$reason" ]; then
    echo "  사유: $reason"
fi
