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
#     "body_markdown": "...",
#     "branch": "optional-story-branch"
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
#       "week_id": "uuid",
#       "parent_task_ids": ["uuid"]
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
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

# topic → 브랜치명 구성 요소
topic_prefix() {
    case "$1" in
        Feature) echo "feature" ;;
        Bug)     echo "fix" ;;
        Fix)     echo "fix" ;;
        Update)  echo "update" ;;
        Refactor) echo "refactor" ;;
        Style)   echo "style" ;;
        *)       echo "chore" ;;
    esac
}

resolve_story_base_branch() {
    if git show-ref --verify --quiet "refs/remotes/origin/dev" 2>/dev/null; then
        echo "dev"
        return 0
    fi
    local base
    base=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
    echo "${base:-main}"
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
STORY_BRANCH_OVERRIDE=$(echo "$SPEC" | jq -r '.story.branch // empty')

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
if ! echo "$TEMPLATE_BLOCKS" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1; then
    echo "ERROR: Story template blocks are empty for tag: $STORY_TAG" >&2
    echo "빈 Story page 생성을 중단합니다. story_template_id 매핑과 Notion template 접근 권한을 확인하세요." >&2
    exit 1
fi
PLAN_BLOCKS=$(md_to_blocks "$STORY_BODY")
story_blocks=$(jq -nc --argjson t "$TEMPLATE_BLOCKS" --argjson p "$PLAN_BLOCKS" '$t + $p')

story_resp=$(notion_create_page "$STORY_DB" "$story_props" "$story_blocks")
STORY_ID=$(echo "$story_resp" | jq -r .id)
STORY_URL=$(echo "$story_resp" | jq -r .url)
[ "$STORY_ID" = "null" ] && { echo "ERROR: Story 생성 실패"; echo "$story_resp" >&2; exit 1; }
echo "  ✓ $STORY_TITLE"
echo "    $STORY_URL"

echo "▸ Story GitHub Issue 생성 중..."
STORY_ISSUE_BODY="$WORKDIR/story-issue.md"
{
    echo "Notion Story: $STORY_URL"
    echo ""
    echo "$STORY_BODY"
} > "$STORY_ISSUE_BODY"
STORY_ISSUE_URL=$(gh issue create --repo "$GITHUB_REPO" --title "$STORY_TITLE" --body-file "$STORY_ISSUE_BODY") || {
    echo "ERROR: Story GitHub Issue 생성 실패" >&2
    exit 1
}
STORY_ISSUE_NUM=$(echo "$STORY_ISSUE_URL" | grep -oE '[0-9]+$')
story_issue_props=$(jq -nc --arg u "$STORY_ISSUE_URL" '{"Issue URL": {url: $u}}')
notion_patch_page "$STORY_ID" "$story_issue_props" >/dev/null || {
    echo "ERROR: Story Issue URL 업데이트 실패" >&2
    exit 1
}
echo "  ✓ #$STORY_ISSUE_NUM $STORY_ISSUE_URL"

echo "▸ Story Worktree 생성 중..."
if [ -n "$STORY_BRANCH_OVERRIDE" ]; then
    STORY_BRANCH="$STORY_BRANCH_OVERRIDE"
else
    STORY_BRANCH="${STORY_ISSUE_NUM}-$(topic_prefix "$STORY_TAG")-$(make_slug "$STORY_TITLE")"
fi
STORY_BASE_BRANCH=$(resolve_story_base_branch)
STORY_WT_PATH=$("$SCRIPT_DIR/ult-wt-add.sh" "$STORY_BRANCH" --base "$STORY_BASE_BRANCH" --quiet) || {
    echo "ERROR: Story worktree 생성 실패" >&2
    exit 1
}
echo "  ✓ $STORY_BRANCH → $STORY_WT_PATH"

# ---- 2단계: Task별 Github Issue + Notion Task 생성 (병렬) ----
echo ""
echo "▸ Task 생성 중..."

TASK_COUNT=$(echo "$SPEC" | jq '.tasks | length')

# 한 Task 처리 (Issue → Task) — 백그라운드 실행
process_task() {
    local idx="$1"
    local out="$WORKDIR/task-$idx.json"

    local task name topic desc pstart pend repo_id week_id parent_task_ids task_repo
    task=$(echo "$SPEC" | jq -c ".tasks[$idx]")
    name=$(echo "$task" | jq -r .name)
    topic=$(echo "$task" | jq -r .topic)
    desc=$(echo "$task" | jq -r '.description // ""')
    pstart=$(echo "$task" | jq -r '.planned_start // empty')
    pend=$(echo "$task" | jq -r '.planned_end // empty')
    repo_id=$(echo "$task" | jq -r '.repository_id // empty')
    week_id=$(echo "$task" | jq -r '.week_id // empty')
    parent_task_ids=$(echo "$task" | jq -c '[.parent_task_ids[]? | select(. != null and . != "")]')
    task_repo="$GITHUB_REPO"

    # Github Issue 생성
    local issue_url issue_num issue_body
    issue_body="$WORKDIR/task-$idx-issue.md"
    {
        echo "$desc"
        echo ""
        echo "---"
        echo "Parent Story: $STORY_ISSUE_URL"
        echo "Notion Story: $STORY_URL"
        echo "Story Branch: $STORY_BRANCH"
        echo "Task Base Branch: $STORY_BRANCH"
    } > "$issue_body"
    issue_url=$(gh issue create --repo "$task_repo" --title "$name" --body-file "$issue_body" 2>/dev/null) || {
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
        --argjson parents "$parent_task_ids" \
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
        + (if ($parents | length) > 0 then {"Parent Task": {relation: ($parents | map({id: .}))}} else {} end)
        + (if $ps != "" then {"Planned Date": {date: ({start: $ps} + (if $pe != "" then {end: $pe} else {} end))}} else {} end)
        ')

    # Task 본문: 템플릿 + 설명
    local task_template_b desc_blocks task_blocks
    task_template_b=$(task_template_blocks)
    if ! echo "$task_template_b" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1; then
        echo '{"error": "Task template blocks are empty"}' > "$out"
        return
    fi
    desc_blocks=$(md_to_blocks "$desc")
    task_blocks=$(jq -nc --argjson t "$task_template_b" --argjson d "$desc_blocks" '$t + $d')

    local resp
    resp=$(notion_create_page "$TASK_DB" "$props" "$task_blocks")
    local task_id
    task_id=$(echo "$resp" | jq -r .id)
    if ! echo "$resp" | jq -e .id >/dev/null 2>&1; then
        jq -nc --arg error "Notion Task 생성 실패" --arg response "$resp" \
            '{error: $error, response: $response}' > "$out"
        return
    fi

    jq -nc --argjson idx "$idx" \
           --arg id "$task_id" --arg url "$issue_url" --arg num "$issue_num" \
           --arg name "$name" --arg topic "$topic" --arg repo "$task_repo" \
           --arg rid "$repo_id" --argjson parents "$parent_task_ids" \
        '{idx: $idx, task_id: $id, issue_url: $url, issue_num: $num, name: $name, topic: $topic, repo: $repo, repository_id: $rid, parent_task_ids: $parents, pr_url: ""}' > "$out"
}

# 병렬 실행
export -f process_task notion_create_page notion_api _notion_token md_to_blocks task_template_blocks template_blocks_cached _cache_fresh
export SPEC STORY_ID STORY_URL STORY_ISSUE_URL STORY_BRANCH STORY_PROJECT STORY_ASSIGNEE GITHUB_REPO TASK_DB WORKDIR CACHE_DIR TASK_TEMPLATE_ID

for i in $(seq 0 $((TASK_COUNT - 1))); do
    process_task "$i" &
done
wait

# 결과 수집
RESULTS=$(jq -s 'sort_by(.idx)' "$WORKDIR"/task-*.json)

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
mkdir -p "$STORY_WT_PATH/tmp"
HANDOFF_PATH="$STORY_WT_PATH/tmp/story-handoff.md"
HANDOFF_JSON_PATH="$STORY_WT_PATH/tmp/story-handoff.json"
HANDOFF_COMMENT_PATH="$WORKDIR/story-handoff-comment.md"
HANDOFF_JSON=$(jq -nc \
    --arg title "$STORY_TITLE" \
    --arg notion_url "$STORY_URL" \
    --arg issue_url "$STORY_ISSUE_URL" \
    --arg repo "$GITHUB_REPO" \
    --arg branch "$STORY_BRANCH" \
    --arg base "$STORY_BASE_BRANCH" \
    --arg worktree "$STORY_WT_PATH" \
    '{
        version: 1,
        updated_at: now | todate,
        story: {
            title: $title,
            notion_url: $notion_url,
            github_issue_url: $issue_url,
            github_repo: $repo,
            pr_url: "",
            branch: $branch,
            base_branch: $base,
            worktree: $worktree
        },
        tasks: []
    }')

parent_issue_urls_json() {
    local parent_ids_json="$1"
    local urls='[]'
    local parent_id parent_url parent_page

    while IFS= read -r parent_id; do
        [ -n "$parent_id" ] || continue
        parent_url=$(printf '%s\n' "$RESULTS" | jq -r --arg pid "$parent_id" '.[] | select(.task_id == $pid) | .issue_url' | head -1)
        if [ -z "$parent_url" ]; then
            parent_page=$(notion_get_page "$parent_id" 2>/dev/null || true)
            parent_url=$(printf '%s\n' "$parent_page" | jq -r '.properties["Issue URL"].url // empty' 2>/dev/null || true)
        fi
        if [ -n "$parent_url" ]; then
            urls=$(printf '%s\n' "$urls" | jq -c --arg u "$parent_url" '. + [$u]')
        fi
    done < <(printf '%s\n' "$parent_ids_json" | jq -r '.[]?')

    printf '%s\n' "$urls"
}

notion_add_long_comment() {
    local page_id="$1"
    local content="$2"
    local max=1800
    local offset=0
    local len=${#content}
    local part=1
    local chunk

    while [ "$offset" -lt "$len" ]; do
        chunk="${content:$offset:$max}"
        notion_add_comment "$page_id" "[Story handoff ${part}]
$chunk" >/dev/null || return 1
        offset=$((offset + max))
        part=$((part + 1))
    done
}

{
    echo "# Story Handoff"
    echo ""
    echo "Story: $STORY_TITLE"
    echo "Notion Story: $STORY_URL"
    echo "GitHub Story Issue: $STORY_ISSUE_URL"
    echo "Story Branch: $STORY_BRANCH"
    echo "Story Base Branch: $STORY_BASE_BRANCH"
    echo "Story Worktree: $STORY_WT_PATH"
    echo ""
    echo "Execution source: local/GitHub handoff. After initial publication, update the GitHub Story Issue; use Notion only for inspection/fallback."
    echo "Machine-readable handoff: $HANDOFF_JSON_PATH"
    echo ""
    echo "## Task Map"
    echo ""
    echo "| Task | Repo | Issue | Branch | Base Branch | Worktree | Parents | Status |"
    echo "| --- | --- | --- | --- | --- | --- | --- | --- |"
} > "$HANDOFF_PATH"

while IFS= read -r task; do
    name=$(echo "$task" | jq -r .name)
    topic=$(echo "$task" | jq -r .topic)
    issue_num=$(echo "$task" | jq -r .issue_num)
    issue_url=$(echo "$task" | jq -r .issue_url)
    task_id=$(echo "$task" | jq -r .task_id)
    task_repo=$(echo "$task" | jq -r '.repo // empty')
    parent_task_ids=$(echo "$task" | jq -c '.parent_task_ids // []')
    parent_issue_urls=$(parent_issue_urls_json "$parent_task_ids")
    parent_summary=$(printf '%s\n' "$parent_issue_urls" | jq -r 'if length == 0 then "-" else join(", ") end')
    prefix=$(topic_prefix "$topic")
    slug=$(make_slug "$name")
    branch="${issue_num}-${prefix}-${slug}"

    wt_path=$("$WORKFLOW_SCRIPTS_DIR/ult-wt-add.sh" "$branch" --base "$STORY_BRANCH" --quiet 2>/dev/null) || {
        echo "  ⚠ #$issue_num worktree 생성 실패"
        echo "| $name | $task_repo | $issue_url | $branch | $STORY_BRANCH | (failed) | $parent_summary | Worktree Failed |" >> "$HANDOFF_PATH"
        HANDOFF_JSON=$(printf '%s\n' "$HANDOFF_JSON" | jq -c \
            --arg name "$name" \
            --arg topic "$topic" \
            --arg repo "$task_repo" \
            --arg id "$task_id" \
            --arg issue "$issue_url" \
            --arg num "$issue_num" \
            --arg branch "$branch" \
            --arg base "$STORY_BRANCH" \
            --argjson parent_ids "$parent_task_ids" \
            --argjson parent_urls "$parent_issue_urls" \
            '.tasks += [{
                name: $name,
                topic: $topic,
                repo: $repo,
                notion_task_id: $id,
                issue_url: $issue,
                issue_num: $num,
                pr_url: "",
                branch: $branch,
                base_branch: $base,
                worktree: "",
                parent_task_ids: $parent_ids,
                parent_issue_urls: $parent_urls,
                status: "Worktree Failed"
            }]')
        continue
    }
    notion_add_comment "$task_id" "Branch: $branch
Base Branch: $STORY_BRANCH
Worktree: $wt_path
Parent Story: $STORY_ISSUE_URL" >/dev/null || true
    if [ -z "$FIRST_WT_PATH" ]; then
        FIRST_WT_PATH="$wt_path"
        FIRST_ISSUE="$issue_num"
    fi
    echo "| $name | $task_repo | $issue_url | $branch | $STORY_BRANCH | $wt_path | $parent_summary | Ready |" >> "$HANDOFF_PATH"
    HANDOFF_JSON=$(printf '%s\n' "$HANDOFF_JSON" | jq -c \
        --arg name "$name" \
        --arg topic "$topic" \
        --arg repo "$task_repo" \
        --arg id "$task_id" \
        --arg issue "$issue_url" \
        --arg num "$issue_num" \
        --arg branch "$branch" \
        --arg base "$STORY_BRANCH" \
        --arg wt "$wt_path" \
        --argjson parent_ids "$parent_task_ids" \
        --argjson parent_urls "$parent_issue_urls" \
        '.tasks += [{
            name: $name,
            topic: $topic,
            repo: $repo,
            notion_task_id: $id,
            issue_url: $issue,
            issue_num: $num,
            pr_url: "",
            branch: $branch,
            base_branch: $base,
            worktree: $wt,
            parent_task_ids: $parent_ids,
            parent_issue_urls: $parent_urls,
            status: "Ready"
        }]')
    echo "  ✓ #$issue_num → $wt_path"
done < <(echo "$RESULTS" | jq -c '.[]')

printf '%s\n' "$HANDOFF_JSON" | jq . > "$HANDOFF_JSON_PATH"
{
    cat "$HANDOFF_PATH"
    echo ""
    echo "<!-- ult-story-handoff-json"
    cat "$HANDOFF_JSON_PATH"
    echo "-->"
} > "$HANDOFF_COMMENT_PATH"

notion_add_long_comment "$STORY_ID" "$(cat "$HANDOFF_COMMENT_PATH")" >/dev/null || true
gh issue comment "$STORY_ISSUE_NUM" --repo "$GITHUB_REPO" --body-file "$HANDOFF_COMMENT_PATH" >/dev/null || true

# ---- 4단계: 완료 안내 ----
echo ""
echo "✅ 발행 완료"
echo "  Story: $STORY_URL"
echo "  Story Issue: $STORY_ISSUE_URL"
echo "  Story Branch: $STORY_BRANCH"
echo "  Story Worktree: $STORY_WT_PATH"
echo "  Task ${TASK_COUNT}개, Issue ${TASK_COUNT}개, Worktree ${TASK_COUNT}개"
echo "  Handoff: $HANDOFF_PATH"
echo "  Handoff JSON: $HANDOFF_JSON_PATH"
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
