#!/bin/bash
# 기존 Notion Task에 GitHub Issue URL 연결
# Usage:
#   ult-task-link-issue.sh [issue_num|issue_url] [--task <notion_page_id_or_url>]
#   ult-task-link-issue.sh [issue_num|issue_url] --name "<task title>"
#   ult-task-link-issue.sh [issue_num|issue_url] --auto

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/notion-api.sh"

usage() {
    cat >&2 <<'EOF'
사용법:
  ult-task-link-issue.sh [issue_num|issue_url] [--task <notion_page_id_or_url>]
  ult-task-link-issue.sh [issue_num|issue_url] --name "<task title>"
  ult-task-link-issue.sh [issue_num|issue_url] --auto

옵션:
  --task, -t   연결할 Notion Task page id 또는 URL
  --name, -n   Issue title 대신 사용할 Task title 검색어
  --auto       대화형 선택 없이 title이 유일하게 매칭될 때만 연결
  --yes, -y    기존 Issue URL 덮어쓰기 확인 생략
EOF
}

ISSUE_NUM=""
GITHUB_REPO=""
TASK_REF=""
NAME_QUERY=""
AUTO=0
YES=0

while [ $# -gt 0 ]; do
    case "$1" in
        --task|-t)
            TASK_REF="$2"
            shift 2
            ;;
        --name|-n)
            NAME_QUERY="$2"
            shift 2
            ;;
        --auto)
            AUTO=1
            shift
            ;;
        --yes|-y)
            YES=1
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        http://*github.com/*/issues/*|https://*github.com/*/issues/*)
            GITHUB_REPO=$(printf '%s\n' "$1" | sed -E 's#^https?://github.com/([^/]+/[^/]+)/issues/[0-9]+.*#\1#')
            ISSUE_NUM=$(printf '%s\n' "$1" | sed -E 's#^https?://github.com/[^/]+/[^/]+/issues/([0-9]+).*#\1#')
            shift
            ;;
        \#*[0-9]*|[0-9]*)
            ISSUE_NUM="${1#\#}"
            shift
            ;;
        *)
            echo "알 수 없는 인자: $1" >&2
            usage
            exit 1
            ;;
    esac
done

if [ -z "$ISSUE_NUM" ]; then
    ISSUE_NUM=$(issue_num_from_branch) || {
        echo "Issue 번호를 인자로 주거나 issue 번호가 포함된 브랜치에서 실행하세요." >&2
        exit 1
    }
fi

if ! [[ "$ISSUE_NUM" =~ ^[0-9]+$ ]]; then
    echo "Issue 번호 형식이 올바르지 않습니다: $ISSUE_NUM" >&2
    exit 1
fi

gh_args=()
[ -n "$GITHUB_REPO" ] && gh_args+=(--repo "$GITHUB_REPO")

issue_json=$(gh issue view "$ISSUE_NUM" "${gh_args[@]}" --json title,url,state 2>/dev/null) || {
    echo "GitHub Issue #$ISSUE_NUM 조회 실패" >&2
    exit 1
}
issue_title=$(echo "$issue_json" | jq -r '.title')
issue_url=$(echo "$issue_json" | jq -r '.url')
[ -z "$NAME_QUERY" ] && NAME_QUERY="$issue_title"

normalize_notion_page_id() {
    local ref="$1"
    local uuid compact
    uuid=$(printf '%s\n' "$ref" | grep -oE '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' | tail -1 || true)
    if [ -n "$uuid" ]; then
        printf '%s\n' "$uuid"
        return 0
    fi
    compact=$(printf '%s\n' "$ref" | grep -oE '[0-9a-fA-F]{32}' | tail -1 || true)
    if [ -n "$compact" ]; then
        printf '%s-%s-%s-%s-%s\n' \
            "${compact:0:8}" "${compact:8:4}" "${compact:12:4}" "${compact:16:4}" "${compact:20:12}"
        return 0
    fi
    return 1
}

patch_issue_url() {
    local task="$1"
    local task_id task_name current_url props resp
    task_id=$(echo "$task" | jq -r .id)
    task_name=$(echo "$task" | jq -r '.properties.Name.title[0].plain_text // "(제목 없음)"')
    current_url=$(echo "$task" | jq -r '.properties["Issue URL"].url // ""')

    if [ "$current_url" = "$issue_url" ]; then
        echo "✓ 이미 연결됨: #${ISSUE_NUM} ${task_name}"
        echo "  ${issue_url}"
        return 0
    fi

    if [ -n "$current_url" ] && [ "$YES" -ne 1 ] && [ "$AUTO" -ne 1 ]; then
        echo "Task에 이미 다른 Issue URL이 있습니다."
        echo "  Task: ${task_name}"
        echo "  현재: ${current_url}"
        echo "  변경: ${issue_url}"
        read -r -p "덮어쓸까요? [y/N]: " overwrite
        case "$overwrite" in
            y|Y|yes|YES) ;;
            *) echo "취소됨"; exit 0 ;;
        esac
    elif [ -n "$current_url" ] && [ "$current_url" != "$issue_url" ] && [ "$YES" -ne 1 ] && [ "$AUTO" -eq 1 ]; then
        echo "자동 모드에서는 기존 Issue URL을 덮어쓰지 않습니다: ${task_name}" >&2
        exit 1
    fi

    props=$(jq -nc --arg u "$issue_url" '{"Issue URL": {url: $u}}')
    resp=$(notion_patch_page "$task_id" "$props")
    if ! echo "$resp" | jq -e .id >/dev/null 2>&1; then
        echo "ERROR: Task Issue URL 업데이트 실패" >&2
        echo "$resp" >&2
        exit 1
    fi

    echo "✓ Task와 GitHub Issue 연결됨"
    echo "  Task: #${ISSUE_NUM} ${task_name}"
    echo "  Issue: ${issue_url}"
}

if [ -n "$TASK_REF" ]; then
    task_id=$(normalize_notion_page_id "$TASK_REF") || {
        echo "Notion page id/URL을 해석할 수 없습니다: $TASK_REF" >&2
        exit 1
    }
    task=$(notion_get_page "$task_id")
    if ! echo "$task" | jq -e .id >/dev/null 2>&1; then
        echo "Notion Task 조회 실패: $TASK_REF" >&2
        echo "$task" >&2
        exit 1
    fi
    patch_issue_url "$task"
    exit 0
fi

task=$(find_task_by_issue "$ISSUE_NUM")
if [ -n "$task" ]; then
    patch_issue_url "$task"
    exit 0
fi

task=$(find_task_by_issue_url "$issue_url")
if [ -n "$task" ]; then
    patch_issue_url "$task"
    exit 0
fi

candidates=$(find_unlinked_tasks_by_title "$NAME_QUERY")
count=$(echo "$candidates" | jq 'length')

if [ "$count" -eq 0 ]; then
    echo "Issue URL이 비어 있고 title이 매칭되는 Task를 찾지 못했습니다." >&2
    echo "  Issue: #${ISSUE_NUM} ${issue_title}" >&2
    echo "  검색어: ${NAME_QUERY}" >&2
    echo "Notion Task URL을 알고 있으면 --task <url>로 다시 실행하세요." >&2
    exit 1
fi

if [ "$count" -eq 1 ]; then
    patch_issue_url "$(echo "$candidates" | jq -c '.[0]')"
    exit 0
fi

if [ "$AUTO" -eq 1 ] || [ ! -t 0 ]; then
    echo "매칭 Task가 여러 개라 자동 연결을 중단합니다." >&2
    echo "$candidates" | jq -r '.[] | "  - \(.id) \(.properties.Name.title[0].plain_text // "(제목 없음)") [\(.properties.Status.status.name // "")]"' >&2
    echo "하나를 골라 --task <page_id>로 다시 실행하세요." >&2
    exit 1
fi

echo "Issue #${ISSUE_NUM}: ${issue_title}"
echo "연결할 Notion Task를 선택하세요."
echo "$candidates" | jq -r 'to_entries[] | "  [\(.key + 1)] \(.value.properties.Name.title[0].plain_text // "(제목 없음)") [\(.value.properties.Status.status.name // "")]"'
read -r -p "선택 [1-${count}/q]: " pick
[ "$pick" = "q" ] || [ -z "$pick" ] && exit 0
[ "$pick" -ge 1 ] 2>/dev/null && [ "$pick" -le "$count" ] || { echo "잘못된 선택"; exit 1; }

patch_issue_url "$(echo "$candidates" | jq -c ".[$((pick - 1))]")"
