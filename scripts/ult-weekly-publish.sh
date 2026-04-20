#!/bin/bash
# 주간 보고서 마크다운을 일일 업무 보고 DB에 발행
# Usage:
#   ult-weekly-publish.sh "<title>" "<YYYY-MM-DD>" < markdown.md
#   echo "<markdown>" | ult-weekly-publish.sh "<title>" "<YYYY-MM-DD>"

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/notion-api.sh"

TITLE="$1"
DATE="$2"

if [ -z "$TITLE" ] || [ -z "$DATE" ]; then
    echo "Usage: $0 \"<title>\" \"<YYYY-MM-DD>\" < markdown" >&2
    exit 1
fi

MARKDOWN=$(cat)
[ -z "$MARKDOWN" ] && { echo "ERROR: 표준입력으로 마크다운 필요" >&2; exit 1; }

# 본인 Notion ID
gh_user=$(gh api user --jq .login 2>/dev/null) || gh_user=""
PERSON_ID=""
[ -n "$gh_user" ] && PERSON_ID=$(member_notion_id "$gh_user" || echo "")

# Markdown → blocks (간단 변환: 줄별 paragraph)
# 코드블록/헤더 등 고급 변환은 skip — 단순 paragraph로 충분
BLOCKS=$(echo "$MARKDOWN" | jq -R -s '
    split("\n")
    | map(select(length > 0))
    | map({
        object: "block",
        type: "paragraph",
        paragraph: {rich_text: [{type: "text", text: {content: .}}]}
    })
')

# Properties
if [ -n "$PERSON_ID" ]; then
    PROPS=$(jq -nc --arg t "$TITLE" --arg d "$DATE" --arg p "$PERSON_ID" \
        '{
            Name: {title: [{type: "text", text: {content: $t}}]},
            Date: {date: {start: $d}},
            Person: {people: [{id: $p}]}
        }')
else
    PROPS=$(jq -nc --arg t "$TITLE" --arg d "$DATE" \
        '{
            Name: {title: [{type: "text", text: {content: $t}}]},
            Date: {date: {start: $d}}
        }')
fi

# 일일 업무 보고 DB에 페이지 생성
RESP=$(notion_create_page "$DAILY_REPORT_DB" "$PROPS" "$BLOCKS")
URL=$(echo "$RESP" | jq -r .url)

if [ "$URL" = "null" ] || [ -z "$URL" ]; then
    echo "ERROR: 발행 실패" >&2
    echo "$RESP" >&2
    exit 1
fi

echo "✓ 발행됨: $URL"
