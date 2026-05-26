#!/bin/bash
# 주간 리뷰 마크다운을 Weekly Review DB에 발행
# Usage:
#   ult-weekly-publish.sh "<YYYY-MM-DD>" [template-name-or-id] [--project <name-or-id-or-url>] < markdown.md
#   ult-weekly-publish.sh "<title>" "<YYYY-MM-DD>" [template-name-or-id] [--project <name-or-id-or-url>] < markdown.md
#   echo "<markdown>" | ult-weekly-publish.sh 2026-05-26 --project "Ultivis CRM"

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/notion-api.sh"

POSITIONAL=()
PROJECT_REF=""
TEMPLATE_REF=""
while [ $# -gt 0 ]; do
    case "$1" in
        --project|-p)
            PROJECT_REF="$2"
            shift 2
            ;;
        --template|-t)
            TEMPLATE_REF="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [\"<title>\"] \"<YYYY-MM-DD>\" [template-name-or-id] [--project <name-or-id-or-url>] < markdown"
            exit 0
            ;;
        *)
            POSITIONAL+=("$1")
            shift
            ;;
    esac
done

TITLE="${POSITIONAL[0]:-}"
DATE="${POSITIONAL[1]:-}"
TEMPLATE_REF="${TEMPLATE_REF:-${POSITIONAL[2]:-마케팅}}"

if [ -z "$DATE" ] && echo "$TITLE" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'; then
    DATE="$TITLE"
    TITLE=""
fi

if [ -z "$DATE" ]; then
    echo "Usage: $0 [\"<title>\"] \"<YYYY-MM-DD>\" [template-name-or-id] [--project <name-or-id-or-url>] < markdown" >&2
    exit 1
fi

MARKDOWN=$(cat)
[ -z "$MARKDOWN" ] && { echo "ERROR: 표준입력으로 마크다운 필요" >&2; exit 1; }

WEEK_ID=$(current_week_id "$DATE")
[ -z "$WEEK_ID" ] && { echo "ERROR: Week not found for date: $DATE" >&2; exit 1; }
WEEK_PAGE=$(notion_get_page "$WEEK_ID")
WEEK_FROM=$(echo "$WEEK_PAGE" | jq -r '.properties.DateFrom.date.start // empty')

TEMPLATE_ID=$(weekly_review_template_id "$TEMPLATE_REF")
[ -z "$TEMPLATE_ID" ] && { echo "ERROR: Weekly Review template id is empty: $TEMPLATE_REF" >&2; exit 1; }

TEMPLATE_PAGE=$(notion_get_page "$TEMPLATE_ID")
TEMPLATE_ERROR=$(echo "$TEMPLATE_PAGE" | jq -r '.object == "error"')
if [ "$TEMPLATE_ERROR" = "true" ]; then
    echo "ERROR: Weekly Review template 조회 실패: $TEMPLATE_REF ($TEMPLATE_ID)" >&2
    echo "$TEMPLATE_PAGE" >&2
    exit 1
fi

resolve_project_ref() {
    local ref="$1" id
    [ -n "$ref" ] || return 1
    if id=$(normalize_notion_page_id "$ref" 2>/dev/null); then
        printf '%s\n' "$id"
        return 0
    fi
    project_id_by_name "$ref"
}

if [ -n "$PROJECT_REF" ]; then
    PROJECT_ID=$(resolve_project_ref "$PROJECT_REF" | head -1)
    [ -n "$PROJECT_ID" ] || {
        echo "ERROR: Project를 찾을 수 없습니다: $PROJECT_REF" >&2
        echo "Project name, Notion page id, 또는 URL을 확인하세요." >&2
        exit 1
    }
    PROJECT_RELATIONS=$(jq -nc --arg id "$PROJECT_ID" '[{id: $id}]')
else
    PROJECT_RELATIONS=$(echo "$TEMPLATE_PAGE" | jq -c '.properties["🛡️ Project"].relation // []')
fi

project_short_name() {
    case "$1" in
        "Ultivis CRM") echo "CRM" ;;
        "표준협회 AI 진단 모델") echo "Diag" ;;
        "Ultivis Vision") echo "Vision" ;;
        "Ultivis IoT") echo "IoT" ;;
        "Ultivis LLM") echo "LLM" ;;
        Agent) echo "Agent" ;;
        *)
            local slug
            slug=$(printf '%s\n' "$1" \
                | tr '[:upper:]' '[:lower:]' \
                | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g')
            if [ -n "$slug" ]; then
                printf '%s\n' "$slug"
            else
                printf 'Weekly\n'
            fi
            ;;
    esac
}

if [ -z "$TITLE" ]; then
    FIRST_PROJECT_ID=$(echo "$PROJECT_RELATIONS" | jq -r '.[0].id // empty')
    PROJECT_NAME=""
    if [ -n "$FIRST_PROJECT_ID" ]; then
        PROJECT_NAME=$(notion_get_page "$FIRST_PROJECT_ID" \
            | jq -r '.properties.Title.title[0].plain_text // .properties.Name.title[0].plain_text // empty')
    fi
    PROJECT_SHORT=$(project_short_name "${PROJECT_NAME:-Weekly}")
    WEEK_START="${WEEK_FROM%%T*}"
    [ -n "$WEEK_START" ] || WEEK_START="$DATE"
    YY="${WEEK_START:2:2}"
    MM="${WEEK_START:5:2}"
    DD="${WEEK_START:8:2}"
    WEEK_OF_MONTH=$(( (10#$DD - 1) / 7 + 1 ))
    TITLE=$(printf '%s-%s-%s-%02d' "$PROJECT_SHORT" "$YY" "$MM" "$WEEK_OF_MONTH")
fi

# Markdown -> blocks (간단 변환: 줄별 paragraph)
# 코드블록/헤더 등 고급 변환은 skip; 주간 리뷰 본문 append 용도에는 충분하다.
BLOCKS=$(echo "$MARKDOWN" | jq -R -s '
    split("\n")
    | map(select(length > 0))
    | map({
        object: "block",
        type: "paragraph",
        paragraph: {rich_text: [{type: "text", text: {content: .}}]}
    })
')

section_lines() {
    local target="$1"
    printf '%s\n' "$MARKDOWN" | awk -v target="$target" '
        function trim(s) {
            sub(/^[[:space:]]+/, "", s)
            sub(/[[:space:]]+$/, "", s)
            return s
        }
        {
            line = trim($0)
            plain = line
            sub(/^#+[[:space:]]*/, "", plain)
            if (plain == "새로 추가된 기능") { section = "features"; next }
            if (plain == "기타 업데이트 내용") { section = "updates"; next }
            if (plain == "Task 보기") { section = ""; next }
            if (line ~ /^#+[[:space:]]*/) { section = ""; next }
            if (section == target && line != "") {
                sub(/^[-*][[:space:]]+/, "", line)
                print line
            }
        }
    '
}

lines_to_bullets() {
    jq -R -s '
        split("\n")
        | map(select(length > 0))
        | map({
            object: "block",
            type: "bulleted_list_item",
            bulleted_list_item: {rich_text: [{type: "text", text: {content: .}}]}
        })
    '
}

append_after_heading() {
    local page_id="$1" heading="$2" blocks="$3" heading_id position
    [ "$(echo "$blocks" | jq 'length')" -gt 0 ] || return 0
    heading_id=$(notion_find_child_block_by_text "$page_id" "$heading" || true)
    if [ -z "$heading_id" ]; then
        notion_append_blocks "$page_id" "$blocks"
        return
    fi
    position=$(jq -nc --arg id "$heading_id" '{type: "after_block", after_block: {id: $id}}')
    notion_append_blocks "$page_id" "$blocks" "$position"
}

archive_empty_template_bullets() {
    local page_id="$1"
    notion_api GET "/blocks/${page_id}/children?page_size=100" \
        | jq -r '
            .results[]
            | select(.type == "bulleted_list_item")
            | select((.bulleted_list_item.rich_text // []) | length == 0)
            | .id
        ' \
        | while read -r block_id; do
            [ -n "$block_id" ] || continue
            notion_api PATCH "/blocks/${block_id}" '{"archived": true}' >/dev/null
        done
}

FEATURE_BLOCKS=$(section_lines features | lines_to_bullets)
UPDATE_BLOCKS=$(section_lines updates | lines_to_bullets)

if echo "$PROJECT_RELATIONS" | jq -e 'length > 0' >/dev/null; then
    PROPS=$(jq -nc \
        --arg t "$TITLE" \
        --arg w "$WEEK_ID" \
        --argjson projects "$PROJECT_RELATIONS" \
        '{
            Title: {title: [{type: "text", text: {content: $t}}]},
            "❤️‍🔥 Week": {relation: [{id: $w}]},
            "🛡️ Project": {relation: $projects}
        }')
else
    PROPS=$(jq -nc \
        --arg t "$TITLE" \
        --arg w "$WEEK_ID" \
        '{
            Title: {title: [{type: "text", text: {content: $t}}]},
            "❤️‍🔥 Week": {relation: [{id: $w}]}
        }')
fi

RESP=$(notion_create_page_from_template "$WEEKLY_REVIEW_DB" "$PROPS" "$TEMPLATE_ID")
PAGE_ID=$(echo "$RESP" | jq -r '.id // empty')
URL=$(echo "$RESP" | jq -r '.url // empty')

if [ -z "$PAGE_ID" ] || [ "$URL" = "null" ] || [ -z "$URL" ]; then
    echo "ERROR: Weekly Review 발행 실패" >&2
    echo "$RESP" >&2
    exit 1
fi

notion_wait_for_template_applied "$PAGE_ID" || exit 1
if [ "$(echo "$FEATURE_BLOCKS" | jq 'length')" -gt 0 ] || [ "$(echo "$UPDATE_BLOCKS" | jq 'length')" -gt 0 ]; then
    archive_empty_template_bullets "$PAGE_ID"
    append_after_heading "$PAGE_ID" "새로 추가된 기능" "$FEATURE_BLOCKS"
    append_after_heading "$PAGE_ID" "기타 업데이트 내용" "$UPDATE_BLOCKS"
else
    notion_append_blocks "$PAGE_ID" "$BLOCKS"
fi

echo "✓ 발행됨: $URL"
