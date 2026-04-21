#!/bin/bash
# Plan 발행 실행기 — JSON 입력 받아 Story+Tasks+Issues+브랜치 일괄 생성
# Usage:
#   ult-story-create-exec.sh <spec.json>
#   echo '<json>' | ult-story-create-exec.sh -
#
# spec.json 형식:
# {
#   "story": {
#     "title": "...",
#     "tag": "Feature|Bug|Update|Refactor",
#     "priority": "High|Medium|Low",
#     "project_id": "uuid",
#     "assignee_notion_id": "uuid",
#     "body_markdown": "..."
#   },
#   "github_repo": "owner/name",
#   "tasks": [
#     {
#       "name": "...",
#       "topic": "Feature|Fix|Update|Refactor|Style|Other",
#       "description": "...",
#       "planned_start": "YYYY-MM-DD",
#       "planned_end": "YYYY-MM-DD",
#       "repository_id": "uuid",
#       "week_id": "uuid"
#     }
#   ]
# }

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/workflow-env.sh"
. "$SCRIPT_DIR/notion-api.sh"

STORY_DB="338b9757-d10f-462f-92c9-4777cb747c78"

# 입력 로드
if [ "$1" = "-" ]; then
    SPEC=$(cat)
elif [ -n "$1" ] && [ -f "$1" ]; then
    SPEC=$(cat "$1")
else
    echo "Usage: $0 <spec.json> | -" >&2
    exit 1
fi

# 검증
echo "$SPEC" | jq -e '.story.title and .github_repo and (.tasks | length > 0)' >/dev/null \
    || { echo "ERROR: spec 형식 오류 (story.title, github_repo, tasks 필수)" >&2; exit 1; }

GITHUB_REPO=$(echo "$SPEC" | jq -r '.github_repo')

# Markdown → Notion blocks (간단 변환: 줄 단위 paragraph)
md_to_blocks() {
    local md="$1"
    echo "$md" | jq -R -s '
        split("\n")
        | map(select(length > 0))
        | map({
            object: "block",
            type: "paragraph",
            paragraph: {rich_text: [{type: "text", text: {content: .}}]}
        })
    '
}

# topic → 브랜치명 구성 요소
topic_prefix() {
    case "$1" in
        Feature) echo "feature" ;;
        Fix)     echo "fix" ;;
        Update)  echo "update" ;;
        Refactor) echo "refactor" ;;
        Style)   echo "style" ;;
        *)       echo "chore" ;;
    esac
}

# slug 생성
make_slug() {
    local s="$1"
    s=$(echo "$s" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9 ]//g' | tr ' ' '-' | sed 's/--*/-/g' | sed 's/^-\|-$//g')
    [ -z "$s" ] && s="task"
    echo "${s:0:50}"
}

# ---- 1단계: Story 생성 ----
echo "▸ Story 생성 중..."
STORY_TITLE=$(echo "$SPEC" | jq -r '.story.title')
STORY_TAG=$(echo "$SPEC" | jq -r '.story.tag')
STORY_PRIORITY=$(echo "$SPEC" | jq -r '.story.priority')
STORY_PROJECT=$(echo "$SPEC" | jq -r '.story.project_id')
STORY_ASSIGNEE=$(echo "$SPEC" | jq -r '.story.assignee_notion_id')
STORY_BODY=$(echo "$SPEC" | jq -r '.story.body_markdown // ""')

story_props=$(jq -nc \
    --arg title "$STORY_TITLE" \
    --arg tag "$STORY_TAG" \
    --arg pri "$STORY_PRIORITY" \
    --arg pid "$STORY_PROJECT" \
    --arg uid "$STORY_ASSIGNEE" \
    '{
        Title: {title: [{type: "text", text: {content: $title}}]},
        Tag: {select: {name: $tag}},
        Priority: {select: {name: $pri}},
        "🛡️ Project ": {relation: [{id: $pid}]},
        Assignee: {people: [{id: $uid}]}
    }')

# 템플릿 + Plan 본문 조합
TEMPLATE_BLOCKS=$(story_template_blocks "$STORY_TAG")
PLAN_BLOCKS=$(md_to_blocks "$STORY_BODY")
story_blocks=$(jq -nc --argjson t "$TEMPLATE_BLOCKS" --argjson p "$PLAN_BLOCKS" '$t + $p')

story_resp=$(notion_create_page "$STORY_DB" "$story_props" "$story_blocks")
STORY_ID=$(echo "$story_resp" | jq -r .id)
STORY_URL=$(echo "$story_resp" | jq -r .url)
[ "$STORY_ID" = "null" ] && { echo "ERROR: Story 생성 실패"; echo "$story_resp" >&2; exit 1; }
echo "  ✓ $STORY_TITLE"
echo "    $STORY_URL"

# ---- 2단계: Task별 Github Issue + Notion Task 생성 (병렬) ----
echo ""
echo "▸ Task 생성 중..."

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

TASK_COUNT=$(echo "$SPEC" | jq '.tasks | length')

# 한 Task 처리 (Issue → Task) — 백그라운드 실행
process_task() {
    local idx="$1"
    local out="$WORKDIR/task-$idx.json"

    local task name topic desc pstart pend repo_id week_id
    task=$(echo "$SPEC" | jq -c ".tasks[$idx]")
    name=$(echo "$task" | jq -r .name)
    topic=$(echo "$task" | jq -r .topic)
    desc=$(echo "$task" | jq -r '.description // ""')
    pstart=$(echo "$task" | jq -r '.planned_start // empty')
    pend=$(echo "$task" | jq -r '.planned_end // empty')
    repo_id=$(echo "$task" | jq -r '.repository_id // empty')
    week_id=$(echo "$task" | jq -r '.week_id // empty')

    # Github Issue 생성
    local issue_url issue_num
    issue_url=$(gh issue create --repo "$GITHUB_REPO" --title "$name" --body "$desc" 2>/dev/null) || {
        echo '{"error": "gh issue create 실패"}' > "$out"; return
    }
    issue_num=$(echo "$issue_url" | grep -oE '[0-9]+$')

    # Notion Task 생성
    local props_args=(
        Name "title" "$name"
        Topic "select" "$topic"
        "📜 Story" "relation" "$STORY_ID"
        "🛡️ Project" "relation" "$STORY_PROJECT"
        Assignee "people" "$STORY_ASSIGNEE"
        "Issue URL" "url" "$issue_url"
    )

    # properties JSON 빌드
    local props
    props=$(jq -nc \
        --arg name "$name" \
        --arg topic "$topic" \
        --arg sid "$STORY_ID" \
        --arg pid "$STORY_PROJECT" \
        --arg uid "$STORY_ASSIGNEE" \
        --arg iurl "$issue_url" \
        --arg rid "$repo_id" \
        --arg wid "$week_id" \
        --arg ps "$pstart" \
        --arg pe "$pend" \
        '{
            Name: {title: [{type: "text", text: {content: $name}}]},
            Topic: {select: {name: $topic}},
            "📜 Story": {relation: [{id: $sid}]},
            "🛡️ Project": {relation: [{id: $pid}]},
            Assignee: {people: [{id: $uid}]},
            "Issue URL": {url: $iurl}
        }
        + (if $rid != "" then {"🥨 Repository": {relation: [{id: $rid}]}} else {} end)
        + (if $wid != "" then {"❤️‍🔥 Week": {relation: [{id: $wid}]}} else {} end)
        + (if $ps != "" then {"Planned Date": {date: ({start: $ps} + (if $pe != "" then {end: $pe} else {} end))}} else {} end)
        ')

    # Task 본문: 템플릿 + 설명
    local task_template_b desc_blocks task_blocks
    task_template_b=$(task_template_blocks)
    desc_blocks=$(md_to_blocks "$desc")
    task_blocks=$(jq -nc --argjson t "$task_template_b" --argjson d "$desc_blocks" '$t + $d')

    local resp
    resp=$(notion_create_page "$TASK_DB" "$props" "$task_blocks")
    local task_id
    task_id=$(echo "$resp" | jq -r .id)

    jq -nc --arg id "$task_id" --arg url "$issue_url" --arg num "$issue_num" \
           --arg name "$name" --arg topic "$topic" \
        '{task_id: $id, issue_url: $url, issue_num: $num, name: $name, topic: $topic}' > "$out"
}

# 병렬 실행
export -f process_task notion_create_page notion_api _notion_token md_to_blocks task_template_blocks template_blocks_cached _cache_fresh
export SPEC STORY_ID STORY_PROJECT STORY_ASSIGNEE GITHUB_REPO TASK_DB WORKDIR CACHE_DIR TASK_TEMPLATE_ID

for i in $(seq 0 $((TASK_COUNT - 1))); do
    process_task "$i" &
done
wait

# 결과 수집
RESULTS=$(jq -s '.' "$WORKDIR"/task-*.json)

# 에러 체크
errs=$(echo "$RESULTS" | jq '[.[] | select(.error)] | length')
if [ "$errs" -gt 0 ]; then
    echo "ERROR: 일부 Task 생성 실패" >&2
    echo "$RESULTS" >&2
    exit 1
fi

echo "$RESULTS" | jq -r '.[] | "  ✓ #\(.issue_num) [\(.topic)] \(.name)\n    \(.issue_url)"'

# ---- 3단계: Worktree 생성 (각 Task별, ult-wt-add.sh 위임) ----
echo ""
echo "▸ Worktree 생성 중..."

FIRST_WT_PATH=""
FIRST_ISSUE=""
while IFS= read -r task; do
    name=$(echo "$task" | jq -r .name)
    topic=$(echo "$task" | jq -r .topic)
    issue_num=$(echo "$task" | jq -r .issue_num)
    prefix=$(topic_prefix "$topic")
    slug=$(make_slug "$name")
    branch="${issue_num}-${prefix}-${slug}"

    wt_path=$("$WORKFLOW_SCRIPTS_DIR/ult-wt-add.sh" "$branch" --quiet 2>/dev/null) || {
        echo "  ⚠ #$issue_num worktree 생성 실패"
        continue
    }
    if [ -z "$FIRST_WT_PATH" ]; then
        FIRST_WT_PATH="$wt_path"
        FIRST_ISSUE="$issue_num"
    fi
    echo "  ✓ #$issue_num → $wt_path"
done < <(echo "$RESULTS" | jq -c '.[]')

# ---- 4단계: 완료 안내 ----
echo ""
echo "✅ 발행 완료"
echo "  Story: $STORY_URL"
echo "  Task ${TASK_COUNT}개, Issue ${TASK_COUNT}개, Worktree ${TASK_COUNT}개"
echo ""
echo "  첫 Task로 이동:"
if [ -n "$FIRST_WT_PATH" ]; then
    FIRST_WT_NAME=$(basename "$FIRST_WT_PATH")
    echo "    cc $FIRST_WT_NAME    # tmux 세션 + Claude Code"
    echo "    cd $FIRST_WT_PATH"
fi

# Plan 파일 archive (있으면)
if [ -f "tmp/current-plan.md" ]; then
    mkdir -p tmp/archived-plans
    archive="tmp/archived-plans/$(date +%Y%m%d-%H%M)-$(make_slug "$STORY_TITLE").md"
    mv tmp/current-plan.md "$archive"
    echo "  Plan archive: $archive"
fi
