#!/bin/bash
# 주간 작업 데이터 수집 → JSON 출력
# Usage:
#   ult-weekly-collect.sh                  # 본인, 이번 주
#   ult-weekly-collect.sh --week DATE      # 특정 날짜 포함 주
#   ult-weekly-collect.sh --team           # 팀 전체

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/notion-api.sh"

WEEK_DATE=""
TEAM_MODE=false
while [ $# -gt 0 ]; do
    case "$1" in
        --week) WEEK_DATE="$2"; shift 2 ;;
        --team) TEAM_MODE=true; shift ;;
        *) shift ;;
    esac
done

# 1. Week 페이지
TARGET_DATE="${WEEK_DATE:-$(date +%Y-%m-%d)}"
WEEK_ID=$(current_week_id "$TARGET_DATE")
[ -z "$WEEK_ID" ] && { echo '{"error": "Week not found"}'; exit 1; }
WEEK_PAGE=$(notion_get_page "$WEEK_ID")
WEEK_FROM=$(echo "$WEEK_PAGE" | jq -r '.properties.DateFrom.date.start')
WEEK_TO=$(echo "$WEEK_PAGE" | jq -r '.properties.DateTo.formula.date.start // empty')

# 2. Notion user
gh_user=$(gh api user --jq .login 2>/dev/null) || gh_user=""
NOTION_ID=""
USER_NAME=""
if [ "$TEAM_MODE" = false ] && [ -n "$gh_user" ]; then
    NOTION_ID=$(member_notion_id "$gh_user" || echo "")
    USER_NAME=$(member_name "$gh_user" || echo "$gh_user")
fi

# 3. Task 조회 (Week relation 필터)
if [ "$TEAM_MODE" = true ]; then
    filter=$(jq -nc --arg w "$WEEK_ID" '{property: "❤️‍🔥 Week", relation: {contains: $w}}')
else
    [ -z "$NOTION_ID" ] && { echo '{"error": "Notion user not mapped"}'; exit 1; }
    filter=$(jq -nc --arg w "$WEEK_ID" --arg u "$NOTION_ID" '{
        and: [
            {property: "❤️‍🔥 Week", relation: {contains: $w}},
            {property: "Assignee", people: {contains: $u}}
        ]
    }')
fi

TASKS_RESP=$(notion_query_ds "$TASK_DB" "$filter")
TASK_COUNT=$(echo "$TASKS_RESP" | jq '.results | length')

# 4. 연관 Story/Project ID 수집 후 병렬 fetch
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

story_ids=$(echo "$TASKS_RESP" | jq -r '.results[].properties["📜 Story"].relation[]?.id' | sort -u)
project_ids=$(echo "$TASKS_RESP" | jq -r '.results[].properties["🛡️ Project"].relation[]?.id' | sort -u)

fetch_to() {
    notion_get_page "$1" | jq -c "{id: .id, title: (.properties.Title.title[0].plain_text // .properties.Name.title[0].plain_text // \"\")}" > "$TMPDIR/$2-$1"
}
export -f fetch_to notion_get_page notion_api _notion_token
export TMPDIR

for id in $story_ids; do fetch_to "$id" story & done
for id in $project_ids; do fetch_to "$id" project & done
wait

# id → name 매핑 빌드
STORY_MAP=$(cat "$TMPDIR"/story-* 2>/dev/null | jq -s 'map({(.id): .title}) | add // {}')
PROJECT_MAP=$(cat "$TMPDIR"/project-* 2>/dev/null | jq -s 'map({(.id): .title}) | add // {}')

# 5. Task 정리 (필요 필드만 추출)
TASKS_JSON=$(echo "$TASKS_RESP" | jq -c \
    --argjson stories "$STORY_MAP" \
    --argjson projects "$PROJECT_MAP" \
    '[.results[] | {
        id: .id,
        name: .properties.Name.title[0].plain_text,
        topic: .properties.Topic.select.name,
        status: .properties.Status.status.name,
        issue_num: .properties["Issue Number"].formula.string,
        issue_url: .properties["Issue URL"].url,
        pr_url: .properties["PR URL"].url,
        planned_start: .properties["Planned Date"].date.start,
        planned_end: .properties["Planned Date"].date.end,
        working_time: .properties["Working Time"].formula.number,
        planned_time: .properties["Planned Time"].formula.number,
        on_time_rate: .properties["On Time Rate"].formula.number,
        first_commit: .properties["First Commit"].formula.date.start,
        last_commit: .properties["Last Commit"].formula.date.start,
        story_id: .properties["📜 Story"].relation[0].id,
        story_name: ($stories[.properties["📜 Story"].relation[0].id] // ""),
        project_id: .properties["🛡️ Project"].relation[0].id,
        project_name: ($projects[.properties["🛡️ Project"].relation[0].id] // ""),
        commit_count: (.properties["🔎 Commit"].relation | length),
        assignees: [.properties.Assignee.people[]?.name]
    }]')

# 6. 집계 통계
STATS=$(echo "$TASKS_JSON" | jq -c '{
    total: length,
    by_status: (group_by(.status) | map({key: .[0].status, value: length}) | from_entries),
    total_commits: (map(.commit_count) | add // 0),
    total_working: (map(.working_time // 0) | add),
    total_planned: (map(.planned_time // 0) | add),
    overdue: [.[] | select(.status != "완료" and .status != "미완료" and .status != "취소" and (.planned_end // .planned_start) and (.planned_end // .planned_start) < (now | strftime("%Y-%m-%d"))) | .name],
    on_time_low: [.[] | select((.on_time_rate // 100) < 80 and (.on_time_rate // 0) > 0) | {name, on_time_rate}]
}')

# 7. 최종 출력
jq -nc \
    --arg from "$WEEK_FROM" \
    --arg to "$WEEK_TO" \
    --arg user "$USER_NAME" \
    --argjson team "$TEAM_MODE" \
    --argjson tasks "$TASKS_JSON" \
    --argjson stats "$STATS" \
    '{
        week: {date_from: $from, date_to: $to},
        user: $user,
        team_mode: $team,
        stats: $stats,
        tasks: $tasks
    }'
