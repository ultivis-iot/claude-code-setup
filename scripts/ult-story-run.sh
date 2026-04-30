#!/bin/bash
# Story 실행 오케스트레이션 준비
# Usage:
#   ult-story-run.sh [task-issue|handoff-json|notion-story-url] [--publish] [--json]

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
  ult-story-run.sh [task-issue|handoff-json|notion-story-url] [--publish] [--json]

역할:
  로컬 Story handoff를 먼저 읽어 Task dependency를 평가하고,
  Ready Task별 subagent 프롬프트와 실행 요약을 생성합니다.
  handoff가 없을 때만 Notion Story/Task 조회로 fallback합니다.

옵션:
  --publish   생성한 실행 요약을 Notion Story에 코멘트로 남김
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

pr_state_json() {
    local pr_url="$1"
    [ -n "$pr_url" ] || return 1
    gh pr view "$pr_url" --json state,mergedAt,url --jq . 2>/dev/null
}

issue_state() {
    local issue_url="$1"
    local repo num
    repo=$(repo_slug_from_issue_url "$issue_url")
    num=$(issue_num_from_url "$issue_url")
    [ -n "$repo" ] && [ -n "$num" ] || return 1
    gh issue view "$num" --repo "$repo" --json state --jq '.state' 2>/dev/null
}

find_pr_for_branch_json() {
    local repo="$1"
    local branch="$2"
    [ -n "$repo" ] && [ -n "$branch" ] || return 1
    gh pr list --repo "$repo" --head "$branch" --state all --json url,state,mergedAt \
        --jq 'sort_by(.mergedAt // "") | reverse | .[0] // empty' 2>/dev/null
}

extract_handoff_json_from_text() {
    awk '
        /<!-- ult-story-handoff-json/ {
            inside = 1
            sub(/^.*<!-- ult-story-handoff-json[[:space:]]*/, "")
            if ($0 ~ /-->/) {
                sub(/[[:space:]]*-->.*$/, "")
                print
                inside = 0
            } else if (length($0) > 0) {
                print
            }
            next
        }
        inside && /-->/ {
            sub(/[[:space:]]*-->.*$/, "")
            if (length($0) > 0) print
            inside = 0
            next
        }
        inside { print }
    '
}

valid_handoff_json() {
    jq -e '(.story | type == "object") and (.tasks | type == "array")' >/dev/null 2>&1
}

load_local_handoff() {
    local candidate

    if [ -n "$STORY_REF" ] && [ -f "$STORY_REF" ] && valid_handoff_json < "$STORY_REF"; then
        jq -c --arg source "local:$STORY_REF" '. + {_source: $source}' "$STORY_REF"
        return 0
    fi

    [ -z "$STORY_REF" ] || return 1

    for candidate in "tmp/story-handoff.json" "$(pwd)/tmp/story-handoff.json"; do
        if [ -f "$candidate" ] && valid_handoff_json < "$candidate"; then
            jq -c --arg source "local:$candidate" '. + {_source: $source}' "$candidate"
            return 0
        fi
    done

    return 1
}

current_github_repo() {
    gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null
}

github_issue_ref_from_arg() {
    local ref="$1"
    local repo num current

    if [ -n "$ref" ] && printf '%s\n' "$ref" | grep -Eq '^https://github.com/.+/issues/[0-9]+$'; then
        repo=$(repo_slug_from_issue_url "$ref")
        num=$(issue_num_from_url "$ref")
        printf '%s\t%s\n' "$repo" "$num"
        return 0
    fi

    if [ -n "$ref" ] && printf '%s\n' "${ref#\#}" | grep -Eq '^[0-9]+$'; then
        repo=$(current_github_repo)
        [ -n "$repo" ] || return 1
        printf '%s\t%s\n' "$repo" "${ref#\#}"
        return 0
    fi

    [ -z "$ref" ] || return 1

    current=$(issue_num_from_branch 2>/dev/null || true)
    if [ -n "$current" ]; then
        repo=$(current_github_repo)
        [ -n "$repo" ] || return 1
        printf '%s\t%s\n' "$repo" "$current"
        return 0
    fi

    return 1
}

load_github_handoff() {
    local ref_pair repo num payload row body handoff issue_url
    ref_pair=$(github_issue_ref_from_arg "$STORY_REF") || return 1
    repo=$(printf '%s\n' "$ref_pair" | awk -F '\t' '{print $1}')
    num=$(printf '%s\n' "$ref_pair" | awk -F '\t' '{print $2}')
    [ -n "$repo" ] && [ -n "$num" ] || return 1

    payload=$(gh issue view "$num" --repo "$repo" --json url,body,comments 2>/dev/null) || return 1
    issue_url=$(printf '%s\n' "$payload" | jq -r '.url // ""')
    while IFS= read -r row; do
        body=$(printf '%s' "$row" | base64 -d | jq -r '.body // ""')
        handoff=$(printf '%s\n' "$body" | extract_handoff_json_from_text)
        if [ -n "$handoff" ] && printf '%s\n' "$handoff" | valid_handoff_json; then
            printf '%s\n' "$handoff" | jq -c --arg source "github:$issue_url" '. + {_source: $source}'
            return 0
        fi
    done < <(printf '%s\n' "$payload" | jq -r '([{body: .body}] + (.comments // [] | map({body: .body}))) | reverse | .[] | @base64')

    return 1
}

load_handoff() {
    load_local_handoff && return 0
    load_github_handoff && return 0
    return 1
}

task_pr_json() {
    local repo="$1"
    local pr_url="$2"
    local branch="$3"
    local pr=""
    if [ -n "$pr_url" ]; then
        pr=$(pr_state_json "$pr_url" || true)
    fi
    if [ -z "$pr" ] && [ -n "$repo" ] && [ -n "$branch" ]; then
        pr=$(find_pr_for_branch_json "$repo" "$branch" || true)
    fi
    printf '%s\n' "$pr"
}

parent_ready_from_handoff() {
    local handoff="$1"
    local parent_urls_json="$2"
    local ready=1
    local summary=""
    local parent_url parent_state parent_repo parent_num parent_task parent_pr parent_ok

    while IFS= read -r parent_url; do
        [ -n "$parent_url" ] || continue
        parent_repo=$(repo_slug_from_issue_url "$parent_url")
        parent_num=$(issue_num_from_url "$parent_url")
        parent_state=$(issue_state "$parent_url" || true)
        parent_task=$(printf '%s\n' "$handoff" | jq -c --arg u "$parent_url" '.tasks[]? | select(.issue_url == $u)' | head -1)
        parent_pr=""
        if [ -n "$parent_task" ]; then
            parent_pr=$(task_pr_json \
                "$(printf '%s\n' "$parent_task" | jq -r '.repo // empty')" \
                "$(printf '%s\n' "$parent_task" | jq -r '.pr_url // empty')" \
                "$(printf '%s\n' "$parent_task" | jq -r '.branch // empty')" || true)
        fi

        parent_ok=0
        [ "$parent_state" = "CLOSED" ] && parent_ok=1
        if [ "$parent_ok" -eq 0 ] && [ -n "$parent_pr" ]; then
            printf '%s\n' "$parent_pr" | jq -e '(.state == "MERGED") or ((.mergedAt // "") != "")' >/dev/null 2>&1 && parent_ok=1
        fi
        [ "$parent_ok" -eq 1 ] || ready=0
        summary+="${parent_repo}#${parent_num}(${parent_state:-unknown}); "
    done < <(printf '%s\n' "$parent_urls_json" | jq -r '.[]?')

    [ -n "$summary" ] || summary="-"
    printf '%s\t%s\n' "$ready" "$summary"
}

run_handoff_story() {
    local handoff="$1"
    local source story_title story_url story_issue_url story_pr_url story_repo story_issue_num story_id
    local story_branch story_base story_worktree output_root run_key output_dir summary_md summary_json ready_json

    source=$(printf '%s\n' "$handoff" | jq -r '._source // "handoff"')
    story_title=$(printf '%s\n' "$handoff" | jq -r '.story.title // "(제목 없음)"')
    story_url=$(printf '%s\n' "$handoff" | jq -r '.story.notion_url // ""')
    story_id=$(printf '%s\n' "$handoff" | jq -r '.story.notion_id // empty')
    if [ -z "$story_id" ] && [ -n "$story_url" ]; then
        story_id=$(normalize_notion_page_id "$story_url" 2>/dev/null || true)
    fi
    story_issue_url=$(printf '%s\n' "$handoff" | jq -r '.story.github_issue_url // ""')
    story_pr_url=$(printf '%s\n' "$handoff" | jq -r '.story.pr_url // ""')
    story_repo=$(printf '%s\n' "$handoff" | jq -r '.story.github_repo // empty')
    [ -n "$story_repo" ] || story_repo=$(repo_slug_from_issue_url "$story_issue_url")
    story_issue_num=$(issue_num_from_url "$story_issue_url")
    story_branch=$(printf '%s\n' "$handoff" | jq -r '.story.branch // ""')
    story_base=$(printf '%s\n' "$handoff" | jq -r '.story.base_branch // ""')
    story_worktree=$(printf '%s\n' "$handoff" | jq -r '.story.worktree // ""')
    [ -n "$story_branch" ] || story_branch=$(branch_for_issue "$story_issue_num" 2>/dev/null || true)
    [ -n "$story_base" ] || story_base=$(branch_base "$story_branch")
    [ -n "$story_worktree" ] || story_worktree=$(worktree_for_branch "$story_branch" 2>/dev/null || true)

    output_root="${story_worktree:-$(pwd)}/tmp/story-run"
    run_key="${story_issue_num:-story}"
    output_dir="$output_root/$run_key"
    mkdir -p "$output_dir/prompts"

    summary_md="$output_dir/summary.md"
    summary_json="$output_dir/summary.json"
    ready_json="$output_dir/ready-tasks.json"

    {
        echo "# Story Run Summary"
        echo ""
        echo "- Source: $source"
        echo "- Story: $story_title"
        echo "- Notion Story: $story_url"
        echo "- Story Base: ${story_base:-"(unknown)"}"
        echo ""
        echo "## Tasks"
        echo ""
        echo "| State | Task | Repo | Issue | Branch | Base | Worktree | Parents |"
        echo "| --- | --- | --- | --- | --- | --- | --- | --- |"
    } > "$summary_md"

    local ready_items='[]'
    local all_items='[]'
    local task_count i task task_id task_name status topic issue_url pr_url repo_slug issue_num task_branch task_base task_worktree
    local parent_urls parent_ids parent_result parent_ready parent_summary pr_json pr_state merged_at state issue_current_state prompt_path prompt_ref
    task_count=$(printf '%s\n' "$handoff" | jq '.tasks | length')
    for i in $(seq 0 $((task_count - 1))); do
        task=$(printf '%s\n' "$handoff" | jq -c ".tasks[$i]")
        task_id=$(printf '%s\n' "$task" | jq -r '.notion_task_id // .task_id // ""')
        task_name=$(printf '%s\n' "$task" | jq -r '.name // "(제목 없음)"')
        status=$(printf '%s\n' "$task" | jq -r '.status // ""')
        topic=$(printf '%s\n' "$task" | jq -r '.topic // "Other"')
        issue_url=$(printf '%s\n' "$task" | jq -r '.issue_url // ""')
        pr_url=$(printf '%s\n' "$task" | jq -r '.pr_url // ""')
        repo_slug=$(printf '%s\n' "$task" | jq -r '.repo // empty')
        [ -n "$repo_slug" ] || repo_slug=$(repo_slug_from_issue_url "$issue_url")
        [ -n "$repo_slug" ] || repo_slug="$story_repo"
        issue_num=$(issue_num_from_url "$issue_url")
        task_branch=$(printf '%s\n' "$task" | jq -r '.branch // ""')
        [ -n "$task_branch" ] || task_branch=$(branch_for_issue "$issue_num" 2>/dev/null || true)
        task_base=$(printf '%s\n' "$task" | jq -r '.base_branch // ""')
        [ -n "$task_base" ] || task_base=$(branch_base "$task_branch")
        task_worktree=$(printf '%s\n' "$task" | jq -r '.worktree // ""')
        [ -n "$task_worktree" ] || task_worktree=$(worktree_for_branch "$task_branch" 2>/dev/null || true)

        parent_urls=$(printf '%s\n' "$task" | jq -c '.parent_issue_urls // []')
        parent_ids=$(printf '%s\n' "$task" | jq -c '.parent_task_ids // []')
        if [ "$(printf '%s\n' "$parent_urls" | jq 'length')" -eq 0 ] && [ "$(printf '%s\n' "$parent_ids" | jq 'length')" -gt 0 ]; then
            parent_ready=0
            parent_summary="Parent Task IDs present; GitHub issue URLs missing"
        else
            parent_result=$(parent_ready_from_handoff "$handoff" "$parent_urls")
            parent_ready=$(printf '%s\n' "$parent_result" | awk -F '\t' '{print $1}')
            parent_summary=$(printf '%s\n' "$parent_result" | awk -F '\t' '{print $2}')
        fi

        pr_json=$(task_pr_json "$repo_slug" "$pr_url" "$task_branch" || true)
        pr_state=""
        merged_at=""
        if [ -n "$pr_json" ]; then
            pr_url=$(printf '%s\n' "$pr_json" | jq -r '.url // empty')
            pr_state=$(printf '%s\n' "$pr_json" | jq -r '.state // empty')
            merged_at=$(printf '%s\n' "$pr_json" | jq -r '.mergedAt // empty')
        fi
        issue_current_state=$(issue_state "$issue_url" || true)

        state="Ready"
        if [ "$pr_state" = "MERGED" ] || [ -n "$merged_at" ] || [ "$issue_current_state" = "CLOSED" ]; then
            state="Done"
        elif [ "$pr_state" = "OPEN" ]; then
            state="Review"
        elif [ "$pr_state" = "CLOSED" ]; then
            state="Stopped"
        elif [ "$parent_ready" -ne 1 ]; then
            state="Blocked"
        elif [ "$status" = "Done" ] || [ "$status" = "완료" ] || [ "$status" = "개발 완료" ]; then
            state="Done"
        fi

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
- Do not create additional Notion Tasks, GitHub Issues, branches, or worktrees unless the user explicitly approves that new Task creation.
- If you find out-of-scope follow-up work, record it as carryover in the Story handoff/Notion Story instead of creating a subtask.
- Verify locally using the repository's existing commands.
- Commit and push the Task branch.
- Create the Task PR targeting the base branch: ${task_base:-"(base branch required)"}.
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
        --arg source "$source" \
        --arg story "$story_title" \
        --arg story_url "$story_url" \
        --arg story_base "$story_base" \
        --arg output_dir "$output_dir" \
        --argjson tasks "$all_items" \
        --argjson ready "$ready_items" \
        '{source:$source, story:$story, story_url:$story_url, story_base:$story_base, output_dir:$output_dir, tasks:$tasks, ready_tasks:$ready}' \
        > "$summary_json"

    printf '%s\n' "$ready_items" > "$ready_json"

    if [ "$PUBLISH" -eq 1 ] && [ -n "$story_id" ]; then
        notion_add_comment "$story_id" "$(cat "$summary_md")" >/dev/null || true
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

if handoff=$(load_handoff 2>/dev/null); then
    run_handoff_story "$handoff"
    exit 0
fi

story=$(resolve_story "$STORY_REF") || {
    echo "Story를 찾을 수 없습니다. Story Notion URL, Task Issue, 또는 Task worktree에서 실행하세요." >&2
    exit 1
}

story_id=$(printf '%s\n' "$story" | jq -r .id)
story_title=$(printf '%s\n' "$story" | title_of_page)
story_url=$(printf '%s\n' "$story" | jq -r '.url // ""')
story_base=$(branch_base "")
story_repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)

filter=$(jq -nc --arg sid "$story_id" '{property: "📜 Story", relation: {contains: $sid}}')
sorts='[{"property":"Created","direction":"ascending"}]'
tasks_resp=$(notion_query_ds "$TASK_DB" "$filter" "$sorts")
task_count=$(printf '%s\n' "$tasks_resp" | jq '.results | length')

output_root="$(pwd)/tmp/story-run"
run_key="$story_id"
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
    echo "- Story Base: $story_base"
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
- Do not create additional Notion Tasks, GitHub Issues, branches, or worktrees unless the user explicitly approves that new Task creation.
- If you find out-of-scope follow-up work, record it as carryover in the Story handoff/Notion Story instead of creating a subtask.
- Verify locally using the repository's existing commands.
- Commit and push the Task branch.
- Create the Task PR targeting the base branch: ${task_base:-"(base branch required)"}.
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
    --arg story_base "$story_base" \
    --arg output_dir "$output_dir" \
    --argjson tasks "$all_items" \
    --argjson ready "$ready_items" \
    '{story_id:$story_id, story:$story, story_url:$story_url, story_base:$story_base, output_dir:$output_dir, tasks:$tasks, ready_tasks:$ready}' \
    > "$summary_json"

printf '%s\n' "$ready_items" > "$ready_json"

if [ "$PUBLISH" -eq 1 ]; then
    notion_add_comment "$story_id" "$(cat "$summary_md")" >/dev/null || true
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
