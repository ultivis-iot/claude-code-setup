#!/bin/bash
# Plan 발행 실행기 — JSON 입력 받아 Notion Story + Tasks + Task Issues/branches 일괄 생성
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

github_slug_for_repo_path() {
    local repo_path="$1"
    local url
    url=$(git -C "$repo_path" remote get-url origin 2>/dev/null || true)
    [ -n "$url" ] || return 1
    printf '%s\n' "$url" \
        | sed -E 's#^git@github.com:##; s#^https://github.com/##; s#^http://github.com/##; s#\.git$##'
}

repo_path_for_slug() {
    local slug="$1"
    local repo_name="${slug##*/}"
    local current_root candidate current_slug worktree_root
    worktree_root="${WORKTREE_ROOT:-$HOME/Git}"

    current_root=$(git rev-parse --show-toplevel 2>/dev/null || true)
    if [ -n "$current_root" ]; then
        current_slug=$(github_slug_for_repo_path "$current_root" 2>/dev/null || true)
        if [ "$current_slug" = "$slug" ]; then
            printf '%s\n' "$current_root"
            return 0
        fi
    fi

    for candidate in "$worktree_root/$repo_name" "$HOME/Git/$repo_name"; do
        git -C "$candidate" rev-parse --show-toplevel >/dev/null 2>&1 || continue
        current_slug=$(github_slug_for_repo_path "$candidate" 2>/dev/null || true)
        if [ "$current_slug" = "$slug" ]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done

    return 1
}

resolve_task_base_branch() {
    local repo_path="$1"
    local base

    if git -C "$repo_path" remote get-url origin >/dev/null 2>&1; then
        git -C "$repo_path" fetch origin --prune >&2 || true
    fi

    if git -C "$repo_path" show-ref --verify --quiet "refs/remotes/origin/dev" 2>/dev/null; then
        echo "dev"
        return 0
    fi

    base=$(git -C "$repo_path" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
    echo "${base:-main}"
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

# 템플릿 적용 후 Plan 본문 삽입
STORY_TEMPLATE_ID=$(story_template_id "$STORY_TAG")
if [ -z "$STORY_TEMPLATE_ID" ]; then
    echo "ERROR: Story template id is empty for tag: $STORY_TAG" >&2
    echo "빈 Story page 생성을 중단합니다. story_template_id 매핑을 확인하세요." >&2
    exit 1
fi
PLAN_BLOCKS=$(md_to_blocks "$STORY_BODY")

story_resp=$(notion_create_page_from_template "$STORY_DB" "$story_props" "$STORY_TEMPLATE_ID")
STORY_ID=$(echo "$story_resp" | jq -r .id)
STORY_URL=$(echo "$story_resp" | jq -r .url)
[ "$STORY_ID" = "null" ] && { echo "ERROR: Story 생성 실패"; echo "$story_resp" >&2; exit 1; }
notion_wait_for_template_applied "$STORY_ID" || exit 1
notion_insert_blocks_after_text "$STORY_ID" "$PLAN_BLOCKS" "설명" || {
    echo "ERROR: Story Plan 본문 삽입 실패" >&2
    exit 1
}
echo "  ✓ $STORY_TITLE"
echo "    $STORY_URL"

STORY_BASE_BRANCH=$(resolve_story_base_branch)
if [ -n "$STORY_BRANCH_OVERRIDE" ]; then
    echo "  ℹ story.branch override는 더 이상 Story용 GitHub branch를 만들지 않으므로 무시합니다: $STORY_BRANCH_OVERRIDE"
fi

# ---- 2단계: Task별 Github Issue + Notion Task 생성 (병렬) ----
echo ""
echo "▸ Task 생성 중..."

TASK_COUNT=$(echo "$SPEC" | jq '.tasks | length')
SPEC=$(echo "$SPEC" | jq -c --arg repo "$GITHUB_REPO" '.tasks |= map(. + {github_repo: (.github_repo // $repo)})')
for i in $(seq 0 $((TASK_COUNT - 1))); do
    repo_id=$(echo "$SPEC" | jq -r ".tasks[$i].repository_id // empty")
    if [ -n "$repo_id" ]; then
        repo_slug=$(repository_github_slug_by_id "$repo_id" 2>/dev/null || true)
        if [ -n "$repo_slug" ]; then
            SPEC=$(echo "$SPEC" | jq -c --argjson idx "$i" --arg repo "$repo_slug" '.tasks[$idx].github_repo = $repo')
        fi
    fi
done

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
    task_repo=$(echo "$task" | jq -r '.github_repo // empty')
    [ -n "$task_repo" ] || task_repo="$GITHUB_REPO"

    # Github Issue 생성
    local issue_url issue_num issue_body
    issue_body="$WORKDIR/task-$idx-issue.md"
    {
        echo "$desc"
        echo ""
        echo "---"
        echo "Notion Story: $STORY_URL"
        echo "Task Base Branch: $STORY_BASE_BRANCH"
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

    # Task 본문: 템플릿 적용 후 설명 삽입
    local desc_blocks
    if [ -z "$TASK_TEMPLATE_ID" ]; then
        echo '{"error": "Task template id is empty"}' > "$out"
        return
    fi
    desc_blocks=$(md_to_blocks "$desc")

    local resp
    resp=$(notion_create_page_from_template "$TASK_DB" "$props" "$TASK_TEMPLATE_ID")
    local task_id
    task_id=$(echo "$resp" | jq -r .id)
    if ! echo "$resp" | jq -e .id >/dev/null 2>&1; then
        jq -nc --arg error "Notion Task 생성 실패" --arg response "$resp" \
            '{error: $error, response: $response}' > "$out"
        return
    fi
    if ! notion_wait_for_template_applied "$task_id"; then
        jq -nc --arg error "Notion Task template 적용 실패" --arg response "$resp" \
            '{error: $error, response: $response}' > "$out"
        return
    fi
    if ! notion_insert_blocks_after_text "$task_id" "$desc_blocks" "설명"; then
        jq -nc --arg error "Notion Task description 삽입 실패" --arg response "$resp" \
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
export -f process_task notion_create_page notion_create_page_from_template notion_append_blocks notion_find_child_block_by_text notion_insert_blocks_after_text notion_wait_for_template_applied notion_api _notion_token md_to_blocks task_template_blocks template_blocks_cached _cache_fresh
export SPEC STORY_ID STORY_URL STORY_BASE_BRANCH STORY_PROJECT STORY_ASSIGNEE GITHUB_REPO TASK_DB WORKDIR CACHE_DIR TASK_TEMPLATE_ID

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
HANDOFF_PATH="$WORKDIR/story-handoff.md"
HANDOFF_JSON_PATH="$WORKDIR/story-handoff.json"
HANDOFF_COMMENT_PATH="$WORKDIR/story-handoff-comment.md"
HANDOFF_JSON=$(jq -nc \
    --arg title "$STORY_TITLE" \
    --arg notion_id "$STORY_ID" \
    --arg notion_url "$STORY_URL" \
    --arg repo "$GITHUB_REPO" \
    --arg base "$STORY_BASE_BRANCH" \
    '{
        version: 1,
        updated_at: now | todate,
        story: {
            title: $title,
            notion_id: $notion_id,
            notion_url: $notion_url,
            github_repo: $repo,
            base_branch: $base
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
    echo "Story Base Branch: $STORY_BASE_BRANCH"
    echo ""
    echo "Execution source: Notion Story comment and local handoff files in Task worktrees."
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

    repo_path=$(repo_path_for_slug "$task_repo" 2>/dev/null || true)
    if [ -z "$repo_path" ]; then
        echo "  ⚠ #$issue_num repository local checkout 없음: $task_repo"
        echo "| $name | $task_repo | $issue_url | $branch | $STORY_BASE_BRANCH | (repo not found) | $parent_summary | Worktree Failed |" >> "$HANDOFF_PATH"
        HANDOFF_JSON=$(printf '%s\n' "$HANDOFF_JSON" | jq -c \
            --arg name "$name" \
            --arg topic "$topic" \
            --arg repo "$task_repo" \
            --arg id "$task_id" \
            --arg issue "$issue_url" \
            --arg num "$issue_num" \
            --arg branch "$branch" \
            --arg base "$STORY_BASE_BRANCH" \
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
    fi

    task_base=$(resolve_task_base_branch "$repo_path")

    wt_path=$("$WORKFLOW_SCRIPTS_DIR/ult-wt-add.sh" "$branch" --repo "$repo_path" --base "$task_base" --quiet 2>/dev/null) || {
        echo "  ⚠ #$issue_num worktree 생성 실패"
        echo "| $name | $task_repo | $issue_url | $branch | $task_base | (failed) | $parent_summary | Worktree Failed |" >> "$HANDOFF_PATH"
        HANDOFF_JSON=$(printf '%s\n' "$HANDOFF_JSON" | jq -c \
            --arg name "$name" \
            --arg topic "$topic" \
            --arg repo "$task_repo" \
            --arg id "$task_id" \
            --arg issue "$issue_url" \
            --arg num "$issue_num" \
            --arg branch "$branch" \
            --arg base "$task_base" \
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
Base Branch: $task_base
Worktree: $wt_path
Notion Story: $STORY_URL" >/dev/null || true
    if [ -z "$FIRST_WT_PATH" ]; then
        FIRST_WT_PATH="$wt_path"
        FIRST_ISSUE="$issue_num"
    fi
    echo "| $name | $task_repo | $issue_url | $branch | $task_base | $wt_path | $parent_summary | Ready |" >> "$HANDOFF_PATH"
    HANDOFF_JSON=$(printf '%s\n' "$HANDOFF_JSON" | jq -c \
        --arg name "$name" \
        --arg topic "$topic" \
        --arg repo "$task_repo" \
        --arg id "$task_id" \
        --arg issue "$issue_url" \
        --arg num "$issue_num" \
        --arg branch "$branch" \
        --arg base "$task_base" \
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
while IFS= read -r task_wt_path; do
    [ -n "$task_wt_path" ] || continue
    mkdir -p "$task_wt_path/tmp"
    cp "$HANDOFF_PATH" "$task_wt_path/tmp/story-handoff.md"
    cp "$HANDOFF_JSON_PATH" "$task_wt_path/tmp/story-handoff.json"
done < <(printf '%s\n' "$HANDOFF_JSON" | jq -r '.tasks[]?.worktree | select(. != "")')

# ---- 4단계: 완료 안내 ----
echo ""
echo "✅ 발행 완료"
echo "  Story: $STORY_URL"
echo "  Task ${TASK_COUNT}개, Issue ${TASK_COUNT}개, Worktree ${TASK_COUNT}개"
echo "  Handoff: 각 Task worktree의 tmp/story-handoff.md"
echo "  Handoff JSON: 각 Task worktree의 tmp/story-handoff.json"
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
