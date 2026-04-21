#!/bin/bash
# 현재 브랜치의 GitHub Issue + Notion Task/Story/Project 컨텍스트 조회

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/notion-api.sh"

BRANCH=$(git branch --show-current)
ISSUE_NUM=$(issue_num_from_branch "$BRANCH") || {
    echo "브랜치 이름에서 이슈 번호를 찾을 수 없습니다: $BRANCH" >&2
    exit 1
}

issue_json=$(gh issue view "$ISSUE_NUM" --json title,body,state,labels,comments,assignees,createdAt,author,url)

echo "$issue_json" | jq -r --arg branch "$BRANCH" --arg num "$ISSUE_NUM" '
    "### Issue #\($num): \(.title)",
    "",
    "- **상태**: \(.state)",
    "- **브랜치**: \($branch)",
    "- **URL**: \(.url)",
    "- **작성자**: \(.author.login // "")",
    "- **라벨**: \([.labels[]?.name] | join(", "))",
    "- **담당자**: \([.assignees[]?.login] | join(", "))",
    "",
    "#### 본문",
    (.body // ""),
    ""
'

issue_url=$(echo "$issue_json" | jq -r '.url')

task=""
if [ -n "$issue_url" ]; then
    task=$(find_task_by_issue_url "$issue_url" 2>/dev/null || true)
fi
if [ -z "$task" ]; then
    task=$(find_task_by_issue "$ISSUE_NUM" 2>/dev/null || true)
fi

if [ -n "$task" ]; then
    story_id=$(echo "$task" | jq -r '.properties["📜 Story"].relation[0].id // empty')
    project_id=$(echo "$task" | jq -r '.properties["🛡️ Project"].relation[0].id // empty')
    repo_id=$(echo "$task" | jq -r '.properties["🥨 Repository"].relation[0].id // empty')

    story=""
    project=""
    repo=""
    [ -n "$story_id" ] && story=$(notion_get_page "$story_id" 2>/dev/null || true)
    [ -n "$project_id" ] && project=$(notion_get_page "$project_id" 2>/dev/null || true)
    [ -n "$repo_id" ] && repo=$(notion_get_page "$repo_id" 2>/dev/null || true)

    echo "---"
    echo ""
    echo "### 📋 Notion Task"
    echo ""
    echo "$task" | jq -r '
        "- **이름**: \(.properties.Name.title[0].plain_text // "(제목 없음)")",
        "- **상태**: \(.properties.Status.status.name // "")",
        "- **Topic**: \(.properties.Topic.select.name // "")",
        "- **Planned Date**: \(
            if .properties["Planned Date"].date.start then
                .properties["Planned Date"].date.start + (if .properties["Planned Date"].date.end then " ~ " + .properties["Planned Date"].date.end else "" end)
            else
                ""
            end
        )",
        "- **Working Time**: \(.properties["Working Time"].number // "")",
        "- **First Commit**: \(.properties["First Commit"].date.start // "")",
        "- **Last Commit**: \(.properties["Last Commit"].date.start // "")"
    '
    if [ -n "$repo" ]; then
        echo "$repo" | jq -r '"- **Repository**: \(.properties.Name.title[0].plain_text // "")"'
    fi

    if [ -n "$story" ]; then
        echo ""
        echo "$story" | jq -r '
            "#### 📜 Story: \(.properties.Title.title[0].plain_text // .properties.Name.title[0].plain_text // "(제목 없음)")",
            "- **Tag**: \(.properties.Tag.select.name // "")",
            "- **Priority**: \(.properties.Priority.select.name // "")",
            "- **Status**: \(.properties.Status.status.name // "")",
            "- **Work Progress**: \(.properties["Work Progress"].number // "")"
        '
    fi

    if [ -n "$project" ]; then
        echo ""
        echo "$project" | jq -r '
            "#### 🛡️ Project: \(.properties.Title.title[0].plain_text // .properties.Name.title[0].plain_text // "(제목 없음)")",
            "- **Manager**: \([.properties.Manager.people[]?.name] | join(", "))",
            "- **Duration**: \(
                if .properties["Project Duration"].date.start then
                    .properties["Project Duration"].date.start + (if .properties["Project Duration"].date.end then " ~ " + .properties["Project Duration"].date.end else "" end)
                else
                    ""
                end
            )",
            "- **Status**: \(.properties.Status.status.name // "")",
            "- **Work Progress**: \(.properties["Work Progress"].number // "")"
        '
    fi
else
    echo "---"
    echo ""
    echo "Notion Task를 찾지 못했습니다. Task의 Issue URL이 비어 있으면 다음으로 연결하세요:"
    echo "  $SCRIPT_DIR/ult-task-link-issue.sh #$ISSUE_NUM --task <notion_task_url>"
fi

comments=$(echo "$issue_json" | jq '.comments | length')
if [ "$comments" -gt 0 ]; then
    echo ""
    echo "---"
    echo ""
    echo "#### 코멘트 (GitHub)"
    echo "$issue_json" | jq -r '.comments[] | "- **\(.author.login)** (\(.createdAt)): \(.body | gsub("\n"; " "))"'
fi
