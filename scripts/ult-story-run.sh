#!/bin/bash
# Story 실행 오케스트레이션 준비
# Usage:
#   ult-story-run.sh [story-issue|story-issue-url|notion-story-url] [--publish] [--json]

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/workflow-env.sh"
. "$SCRIPT_DIR/notion-api.sh"

PUBLISH=0
JSON_OUTPUT=0
STORY_REF=""

usage() {
    cat >&2 <<'EOF'
사용법:
  ult-story-run.sh [story-issue|story-issue-url|notion-story-url] [--publish] [--json]

역할:
  Story에 연결된 Task들을 읽어 Parent Task dependency를 평가하고,
  Ready Task별 subagent 프롬프트와 실행 요약을 생성합니다.

옵션:
  --publish   생성한 실행 요약을 Notion Story와 GitHub Story Issue에 코멘트로 남김
  --json      사람이 읽는 요약 대신 JSON summary 출력
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --publish) PUBLISH=1; shift ;;
        --json) JSON_OUTPUT=1; shift ;;
        --help|-h) usage; exit 0 ;;
        -*)
            echo "알 수 없는 옵션: $1" >&2
            usage
            exit 1
            ;;
        *)
            if [ -z "$STORY_REF" ]; then
                STORY_REF="$1"
            else
                echo "알 수 없는 인자: $1" >&2
                usage
                exit 1
            fi
            shift
            ;;
    esac
done

title_of_page() {
    jq -r '.properties.Title.title[0].plain_text // .properties.Name.title[0].plain_text // "(제목 없음)"'
}

repo_slug_from_issue_url() {
    printf '%s\n' "$1" | sed -E 's#^https://github.com/##; s#/issues/[0-9]+$##'
}

issue_num_from_url() {
    printf '%s\n' "$1" | grep -oE '[0-9]+$' || true
}

worktree_for_branch() {
    local branch="$1"
    [ -n "$branch" ] || return 1
    git worktree list --porcelain 2>/dev/null \
        | awk -v target="refs/heads/$branch" '
            $1 == "worktree" { wt = $2 }
            $1 == "branch" && $2 == target { print wt; exit }
        '
}

branch_for_issue() {
    local issue_num="$1"
    [ -n "$issue_num" ] || return 1
    local current
    current=$(git branch --show-current 2>/dev/null || true)
    if printf '%s\n' "$current" | grep -Eq "^${issue_num}($|[-_/])"; then
        printf '%s\n' "$current"
        return 0
    fi
    git branch --format='%(refname:short)' 2>/dev/null \
        | grep -E "^${issue_num}($|[-_/])" \
        | head -1
}

branch_base() {
    local branch="$1"
    local base=""
    [ -n "$branch" ] && base=$(git config "branch.$branch.gh-merge-base" 2>/dev/null || true)
    if [ -z "$base" ] && git show-ref --verify --quiet refs/remotes/origin/dev 2>/dev/null; then
        base="dev"
    fi
    echo "${base:-main}"
}

pr_is_merged() {
    local pr_url="$1"
    [ -n "$pr_url" ] || return 1
    gh pr view "$pr_url" --json state,mergedAt --jq 'select(.state == "MERGED" or (.mergedAt // "") != "") | .state' >/dev/null 2>&1
}

resolve_issue_url() {
    local ref="$1"
    if printf '%s\n' "$ref" | grep -Eq '^https://github.com/.+/issues/[0-9]+$'; then
        printf '%s\n' "$ref"
        return 0
    fi
    local num="${ref#\#}"
    if printf '%s\n' "$num" | grep -Eq '^[0-9]+$'; then
        gh issue view "$num" --json url --jq .url 2>/dev/null
        return 0
    fi
    return 1
}

load_story_from_issue_url() {
    local issue_url="$1"
    local story task story_id
    story=$(find_story_by_issue_url "$issue_url" 2>/dev/null || true)
    if [ -n "$story" ]; then
        printf '%s\n' "$story"
        return 0
    fi

    task=$(find_task_by_issue_url "$issue_url" 2>/dev/null || true)
    story_id=$(printf '%s\n' "$task" | jq -r '.properties["📜 Story"].relation[0].id // empty' 2>/dev/null || true)
    if [ -n "$story_id" ]; then
        notion_get_page "$story_id"
        return 0
    fi

    return 1
}

resolve_story() {
    local ref="$1"
    local page_id issue_url issue_num

    if [ -n "$ref" ] && page_id=$(normalize_notion_page_id "$ref" 2>/dev/null); then
        notion_get_page "$page_id"
        return 0
    fi

    if [ -n "$ref" ] && issue_url=$(resolve_issue_url "$ref" 2>/dev/null); then
        load_story_from_issue_url "$issue_url" && return 0
    fi

    issue_num=$(issue_num_from_branch 2>/dev/null || true)
    if [ -n "$issue_num" ]; then
        issue_url=$(gh issue view "$issue_num" --json url --jq .url 2>/dev/null || true)
        [ -n "$issue_url" ] && load_story_from_issue_url "$issue_url" && return 0
    fi

    return 1
}

story=$(resolve_story "$STORY_REF") || {
    echo "Story를 찾을 수 없습니다. Story Notion URL, Story GitHub Issue, 또는 Story/Task branch에서 실행하세요." >&2
    exit 1
}

story_id=$(printf '%s\n' "$story" | jq -r .id)
story_title=$(printf '%s\n' "$story" | title_of_page)
story_url=$(printf '%s\n' "$story" | jq -r '.url // ""')
story_issue_url=$(printf '%s\n' "$story" | jq -r '.properties["Issue URL"].url // ""')
story_pr_url=$(printf '%s\n' "$story" | jq -r '.properties["PR URL"].url // ""')
story_issue_num=$(issue_num_from_url "$story_issue_url")
story_repo=$(repo_slug_from_issue_url "$story_issue_url")
story_branch=$(branch_for_issue "$story_issue_num" 2>/dev/null || true)
story_base=$(branch_base "$story_branch")
story_worktree=$(worktree_for_branch "$story_branch" 2>/dev/null || true)

filter=$(jq -nc --arg sid "$story_id" '{property: "📜 Story", relation: {contains: $sid}}')
sorts='[{"property":"Created","direction":"ascending"}]'
tasks_resp=$(notion_query_ds "$TASK_DB" "$filter" "$sorts")
task_count=$(printf '%s\n' "$tasks_resp" | jq '.results | length')

output_root="${story_worktree:-$(pwd)}/tmp/story-run"
run_key="${story_issue_num:-$story_id}"
output_dir="$output_root/$run_key"
mkdir -p "$output_dir/prompts"

summary_md="$output_dir/summary.md"
summary_json="$output_dir/summary.json"
ready_json="$output_dir/ready-tasks.json"

{
    echo "# Story Run Summary"
    echo ""
    echo "- Story: $story_title"
    echo "- Notion Story: $story_url"
    echo "- GitHub Story Issue: $story_issue_url"
    echo "- Story PR: $story_pr_url"
    echo "- Story Branch: ${story_branch:-"(not found)"}"
    echo "- Story Base: $story_base"
    echo "- Story Worktree: ${story_worktree:-"(not found)"}"
    echo ""
    echo "## Tasks"
    echo ""
    echo "| State | Task | Repo | Issue | Branch | Base | Worktree | Parents |"
    echo "| --- | --- | --- | --- | --- | --- | --- | --- |"
} > "$summary_md"

ready_items='[]'
all_items='[]'

for i in $(seq 0 $((task_count - 1))); do
    task=$(printf '%s\n' "$tasks_resp" | jq -c ".results[$i]")
    task_id=$(printf '%s\n' "$task" | jq -r .id)
    task_name=$(printf '%s\n' "$task" | title_of_page)
    status=$(printf '%s\n' "$task" | jq -r '.properties.Status.status.name // ""')
    topic=$(printf '%s\n' "$task" | jq -r '.properties.Topic.select.name // "Other"')
    issue_url=$(printf '%s\n' "$task" | jq -r '.properties["Issue URL"].url // ""')
    pr_url=$(printf '%s\n' "$task" | jq -r '.properties["PR URL"].url // ""')
    repo_id=$(printf '%s\n' "$task" | jq -r '.properties["🥨 Repository"].relation[0].id // ""')
    parent_ids=$(printf '%s\n' "$task" | jq -r '.properties["Parent Task"].relation[]?.id')

    repo_slug=""
    [ -n "$repo_id" ] && repo_slug=$(repository_github_slug_by_id "$repo_id" 2>/dev/null || true)
    [ -z "$repo_slug" ] && repo_slug="$story_repo"

    issue_num=$(issue_num_from_url "$issue_url")
    task_branch=$(branch_for_issue "$issue_num" 2>/dev/null || true)
    if [ -z "$task_branch" ] && [ -n "$issue_num" ]; then
        task_branch="${issue_num}-$(topic_branch_component "$topic")-$(make_slug "$task_name")"
    fi
    task_base=$(branch_base "$task_branch")
    task_worktree=$(worktree_for_branch "$task_branch" 2>/dev/null || true)

    parent_ready=1
    parent_summary=""
    while IFS= read -r parent_id; do
        [ -n "$parent_id" ] || continue
        parent=$(notion_get_page "$parent_id")
        parent_name=$(printf '%s\n' "$parent" | title_of_page)
        parent_status=$(printf '%s\n' "$parent" | jq -r '.properties.Status.status.name // ""')
        parent_pr_url=$(printf '%s\n' "$parent" | jq -r '.properties["PR URL"].url // ""')
        parent_ok=0
        case "$parent_status" in
            "완료"|"개발 완료") parent_ok=1 ;;
        esac
        if [ "$parent_ok" -eq 0 ] && pr_is_merged "$parent_pr_url"; then
            parent_ok=1
        fi
        [ "$parent_ok" -eq 1 ] || parent_ready=0
        parent_summary+="${parent_name}(${parent_status:-unknown}); "
    done <<< "$parent_ids"
    [ -n "$parent_summary" ] || parent_summary="-"

    state="Ready"
    case "$status" in
        "완료"|"개발 완료") state="Done" ;;
        "AI검토중") state="Review" ;;
        "미완료") state="Stopped" ;;
        *)
            [ "$parent_ready" -eq 1 ] || state="Blocked"
            ;;
    esac

    item=$(jq -nc \
        --arg state "$state" \
        --arg id "$task_id" \
        --arg name "$task_name" \
        --arg status "$status" \
        --arg repo "$repo_slug" \
        --arg issue "$issue_url" \
        --arg pr "$pr_url" \
        --arg branch "$task_branch" \
        --arg base "$task_base" \
        --arg worktree "$task_worktree" \
        --arg parents "$parent_summary" \
        '{state:$state, task_id:$id, name:$name, status:$status, repo:$repo, issue_url:$issue, pr_url:$pr, branch:$branch, base_branch:$base, worktree:$worktree, parents:$parents}')
    all_items=$(printf '%s\n' "$all_items" | jq -c --argjson item "$item" '. + [$item]')
    if [ "$state" = "Ready" ]; then
        ready_items=$(printf '%s\n' "$ready_items" | jq -c --argjson item "$item" '. + [$item]')
        prompt_path="$output_dir/prompts/task-${issue_num:-$task_id}.md"
        cat > "$prompt_path" <<EOF
You are a Task owner subagent. You are not alone in the codebase; do not revert changes made by others, and work only in your assigned worktree.

Story:
- Title: $story_title
- Notion Story: $story_url
- GitHub Story Issue: $story_issue_url
- Story branch: ${story_branch:-"(not found)"}

Task:
- Name: $task_name
- Repository: $repo_slug
- GitHub Issue: $issue_url
- Notion Task ID: $task_id
- Branch: $task_branch
- Base branch: $task_base
- Worktree: ${task_worktree:-"(not found; create from base branch if needed)"}
- Parent Task status: $parent_summary

Rules:
- Use only the assigned Task worktree.
- Preserve Story context and Task scope.
- Do not edit another Task owner's worktree.
- Verify locally using the repository's existing commands.
- Commit and push the Task branch.
- Create the Task PR targeting the Story branch: ${story_branch:-"(story branch required)"}.
- Run or request review-cycle for the Task PR until AI review and CI are clear.
- Update the Story handoff with results, PR URL, tests, and carryover.

Deliverable:
- Implementation summary
- Files changed
- Verification commands and results
- Task PR URL
- Any Story-wide carryover
EOF
    fi

    prompt_ref=""
    [ "$state" = "Ready" ] && prompt_ref="prompt: $output_dir/prompts/task-${issue_num:-$task_id}.md"
    printf '| %s | %s | %s | %s | %s | %s | %s | %s |\n' \
        "$state" \
        "$task_name" \
        "$repo_slug" \
        "${issue_url:-"-"}" \
        "${task_branch:-"-"}" \
        "${task_base:-"-"}" \
        "${task_worktree:-"$prompt_ref"}" \
        "$parent_summary" >> "$summary_md"
done

jq -nc \
    --arg story_id "$story_id" \
    --arg story "$story_title" \
    --arg story_url "$story_url" \
    --arg story_issue_url "$story_issue_url" \
    --arg story_pr_url "$story_pr_url" \
    --arg story_branch "$story_branch" \
    --arg story_base "$story_base" \
    --arg story_worktree "$story_worktree" \
    --arg output_dir "$output_dir" \
    --argjson tasks "$all_items" \
    --argjson ready "$ready_items" \
    '{story_id:$story_id, story:$story, story_url:$story_url, story_issue_url:$story_issue_url, story_pr_url:$story_pr_url, story_branch:$story_branch, story_base:$story_base, story_worktree:$story_worktree, output_dir:$output_dir, tasks:$tasks, ready_tasks:$ready}' \
    > "$summary_json"

printf '%s\n' "$ready_items" > "$ready_json"

if [ "$PUBLISH" -eq 1 ]; then
    notion_add_comment "$story_id" "$(cat "$summary_md")" >/dev/null || true
    if [ -n "$story_issue_num" ] && [ -n "$story_repo" ]; then
        gh issue comment "$story_issue_num" --repo "$story_repo" --body-file "$summary_md" >/dev/null || true
    fi
fi

if [ "$JSON_OUTPUT" -eq 1 ]; then
    cat "$summary_json"
else
    cat "$summary_md"
    echo ""
    echo "Generated:"
    echo "- Summary: $summary_md"
    echo "- JSON: $summary_json"
    echo "- Ready task prompts: $output_dir/prompts"
fi
