#!/bin/bash
# 기존 Notion Story에 Task 1개 + GitHub Issue 1개 추가
# Usage:
#   ult-task-create.sh [story-title-or-url] [--name <task>] [--topic <topic>] [--description <body>]
#   ult-task-create.sh --story <story-title-or-url> --project <project-name-or-id> --name <task>
#   ult-task-create.sh --story <story-title-or-url> --name <task> [--here | --no-checkout]

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/workflow-env.sh"
. "$SCRIPT_DIR/notion-api.sh"

usage() {
    cat >&2 <<'EOF'
사용법:
  ult-task-create.sh [story-title-or-url] [--name <task>] [--topic <topic>] [--description <body>]
  ult-task-create.sh --story <story-title-or-url> --project <project-name-or-id> --name <task>
  ult-task-create.sh --story <story-title-or-url> --name <task> [--planned-start YYYY-MM-DD] [--planned-end YYYY-MM-DD]

옵션:
  --story, -s        Story title, Notion page URL/id, GitHub Task Issue URL, repo#issue
  --project, -p      Repository의 Project relation이 비어 있을 때 사용할 Project name/page id/URL
  --name, -n         Task 이름
  --topic, -t        Feature|Fix|Update|Refactor|Style|Other (기본 Feature)
  --description, -d  GitHub Issue body 및 Task 본문
  --planned-start    Planned Date 시작일
  --planned-end      Planned Date 종료일
  --parent-task      선행 Task Notion page id/URL (반복 가능)
  --base             브랜치 생성 기준 브랜치 (기본: origin/dev가 있으면 dev, 없으면 origin HEAD)
  --here             Issue/Task만 만들고 브랜치/worktree 생성 안 함
  --no-checkout      worktree 없이 로컬 브랜치만 생성
EOF
}

STORY_REF=""
PROJECT_REF=""
TASK_NAME=""
TOPIC="Feature"
DESCRIPTION=""
PLANNED_START=""
PLANNED_END=""
BASE_BRANCH=""
PARENT_TASK_IDS=()
HERE=0
NO_CHECKOUT=0

while [ $# -gt 0 ]; do
    case "$1" in
        --story|-s) STORY_REF="$2"; shift 2 ;;
        --project|-p) PROJECT_REF="$2"; shift 2 ;;
        --name|-n) TASK_NAME="$2"; shift 2 ;;
        --topic|-t) TOPIC="$2"; shift 2 ;;
        --description|-d) DESCRIPTION="$2"; shift 2 ;;
        --planned-start) PLANNED_START="$2"; shift 2 ;;
        --planned-end) PLANNED_END="$2"; shift 2 ;;
        --parent-task)
            parent_id=$(normalize_notion_page_id "$2") || {
                echo "Parent Task page id/URL을 해석할 수 없습니다: $2" >&2
                exit 1
            }
            PARENT_TASK_IDS+=("$parent_id")
            shift 2
            ;;
        --base) BASE_BRANCH="$2"; shift 2 ;;
        --here) HERE=1; shift ;;
        --no-checkout) NO_CHECKOUT=1; shift ;;
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

case "$TOPIC" in
    Feature|Fix|Update|Refactor|Style|Other) ;;
    feature) TOPIC="Feature" ;;
    fix) TOPIC="Fix" ;;
    update) TOPIC="Update" ;;
    refactor) TOPIC="Refactor" ;;
    style) TOPIC="Style" ;;
    other|chore) TOPIC="Other" ;;
    *) echo "알 수 없는 topic: $TOPIC" >&2; exit 1 ;;
esac

gh_user=$(gh api user --jq .login 2>/dev/null) || { echo "gh CLI 인증 필요" >&2; exit 1; }
ASSIGNEE_ID=$(member_notion_id "$gh_user")
[ -n "$ASSIGNEE_ID" ] || { echo "Member DB에 Github 계정($gh_user)이 등록되지 않았습니다." >&2; exit 1; }

repo_json=$(gh repo view --json name,nameWithOwner 2>/dev/null) || { echo "현재 git remote에서 GitHub repo를 확인할 수 없습니다." >&2; exit 1; }
GITHUB_REPO=$(echo "$repo_json" | jq -r .nameWithOwner)
REPO_NAME=$(echo "$repo_json" | jq -r .name)
REPO_ID=$(repository_id_by_github_slug "$GITHUB_REPO" 2>/dev/null || true)
[ -n "$REPO_ID" ] || REPO_ID=$(repository_id_by_name "$GITHUB_REPO" 2>/dev/null || true)
[ -n "$REPO_ID" ] || REPO_ID=$(repository_id_by_name "$REPO_NAME" 2>/dev/null || true)

REPO_PROJECT_IDS_JSON="[]"
if [ -n "$REPO_ID" ]; then
    repo_project_ids=$(repository_project_ids "$REPO_ID" 2>/dev/null || true)
    if [ -n "$repo_project_ids" ]; then
        REPO_PROJECT_IDS_JSON=$(printf '%s\n' "$repo_project_ids" \
            | jq -R -s -c 'split("\n") | map(select(length > 0))')
    fi
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
    PROJECT_OVERRIDE_ID=$(resolve_project_ref "$PROJECT_REF" | head -1)
    [ -n "$PROJECT_OVERRIDE_ID" ] || {
        echo "Project를 찾을 수 없습니다: $PROJECT_REF" >&2
        echo "Project name, Notion page id, 또는 URL을 확인하세요." >&2
        exit 1
    }
    if [ "$(echo "$REPO_PROJECT_IDS_JSON" | jq 'length')" -gt 0 ] \
        && ! echo "$REPO_PROJECT_IDS_JSON" | jq -e --arg pid "$PROJECT_OVERRIDE_ID" 'index($pid)' >/dev/null; then
        echo "지정한 Project가 현재 repository의 Project relation에 포함되지 않습니다." >&2
        echo "  Repository: $GITHUB_REPO" >&2
        echo "  Project: $PROJECT_REF ($PROJECT_OVERRIDE_ID)" >&2
        echo "  Repository Project(s): $(echo "$REPO_PROJECT_IDS_JSON" | jq -r 'join(", ")')" >&2
        exit 1
    fi
    REPO_PROJECT_IDS_JSON=$(jq -nc --arg pid "$PROJECT_OVERRIDE_ID" '[$pid]')
elif [ "$(echo "$REPO_PROJECT_IDS_JSON" | jq 'length')" -eq 0 ]; then
    echo "Repository에서 Project relation을 찾을 수 없습니다: $GITHUB_REPO" >&2
    echo "Notion Repository DB에서 repo와 Project 연결을 수정하거나, 이번 실행에 한해 --project <Project name|id|url>을 지정하세요." >&2
    exit 1
fi

story_title() {
    echo "$1" | jq -r '.properties.Title.title[0].plain_text // .properties.Name.title[0].plain_text // "(제목 없음)"'
}

story_project_id() {
    echo "$1" | jq -r '.properties["🛡️ Project "].relation[0].id // .properties["🛡️ Project"].relation[0].id // empty'
}

CONTEXT_HANDOFF_PATH=""

story_issue_url() {
    echo "$1" | jq -r '.properties["Issue URL"].url // empty'
}

repo_slug_from_issue_url() {
    printf '%s\n' "$1" | sed -E 's#^https://github.com/##; s#/issues/[0-9]+$##'
}

issue_num_from_url() {
    printf '%s\n' "$1" | grep -oE '[0-9]+$' || true
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

load_story_from_handoff_json() {
    local handoff="$1"
    local notion_url issue_url page_id story
    printf '%s\n' "$handoff" | jq -e '(.story | type == "object")' >/dev/null 2>&1 || return 1

    notion_url=$(printf '%s\n' "$handoff" | jq -r '.story.notion_url // empty')
    if [ -n "$notion_url" ] && page_id=$(normalize_notion_page_id "$notion_url" 2>/dev/null); then
        notion_get_page "$page_id" | jq -c '.'
        return 0
    fi

    issue_url=$(printf '%s\n' "$handoff" | jq -r '.story.github_issue_url // empty')
    if [ -n "$issue_url" ]; then
        story=$(find_story_by_issue_url "$issue_url" 2>/dev/null || true)
        if [ -n "$story" ] && [ "$story" != "null" ]; then
            printf '%s\n' "$story" | jq -c '.'
            return 0
        fi
    fi

    return 1
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

github_issue_url_from_ref() {
    local ref="$1"
    local repo num
    [ -n "$ref" ] || return 1

    if printf '%s\n' "$ref" | grep -Eq '^https://github.com/.+/issues/[0-9]+$'; then
        printf '%s\n' "$ref"
        return 0
    fi

    if printf '%s\n' "$ref" | grep -Eq '^[^/[:space:]]+/[^/#[:space:]]+#[0-9]+$'; then
        repo=$(printf '%s\n' "$ref" | sed -E 's/#([0-9]+)$//')
        num=$(printf '%s\n' "$ref" | grep -oE '[0-9]+$')
        printf 'https://github.com/%s/issues/%s\n' "$repo" "$num"
        return 0
    fi

    if printf '%s\n' "${ref#\#}" | grep -Eq '^[0-9]+$'; then
        printf 'https://github.com/%s/issues/%s\n' "$GITHUB_REPO" "${ref#\#}"
        return 0
    fi

    return 1
}

load_story_from_issue_url() {
    local issue_url="$1"
    local story task story_id repo num payload row body handoff

    story=$(find_story_by_issue_url "$issue_url" 2>/dev/null || true)
    if [ -n "$story" ] && [ "$story" != "null" ]; then
        printf '%s\n' "$story" | jq -c '.'
        return 0
    fi

    task=$(find_task_by_issue_url "$issue_url" 2>/dev/null || true)
    story_id=$(printf '%s\n' "$task" | jq -r '.properties["📜 Story"].relation[0].id // empty' 2>/dev/null || true)
    if [ -n "$story_id" ]; then
        notion_get_page "$story_id" | jq -c '.'
        return 0
    fi

    repo=$(repo_slug_from_issue_url "$issue_url")
    num=$(issue_num_from_url "$issue_url")
    if [ -n "$repo" ] && [ -n "$num" ]; then
        payload=$(gh issue view "$num" --repo "$repo" --json body,comments 2>/dev/null || true)
        while IFS= read -r row; do
            body=$(printf '%s' "$row" | base64 -d | jq -r '.body // ""')
            handoff=$(printf '%s\n' "$body" | extract_handoff_json_from_text)
            if [ -n "$handoff" ] && load_story_from_handoff_json "$handoff"; then
                return 0
            fi
        done < <(printf '%s\n' "$payload" | jq -r '([{body: .body}] + (.comments // [] | map({body: .body}))) | reverse | .[] | @base64' 2>/dev/null)
    fi

    return 1
}

load_story_from_handoff_file() {
    local path="$1"
    local issue_url
    [ -f "$path" ] || return 1
    jq -e '(.story | type == "object")' "$path" >/dev/null 2>&1 || return 1

    CONTEXT_HANDOFF_PATH="$path"
    load_story_from_handoff_json "$(cat "$path")" && return 0

    issue_url=$(jq -r '.story.github_issue_url // empty' "$path")
    [ -n "$issue_url" ] && load_story_from_issue_url "$issue_url"
}

load_story_from_local_context() {
    local current base base_wt issue_num issue_url

    load_story_from_handoff_file "tmp/story-handoff.json" && return 0

    current=$(git branch --show-current 2>/dev/null || true)
    if [ -n "$current" ]; then
        base=$(git config "branch.$current.gh-merge-base" 2>/dev/null || true)
        if [ -n "$base" ]; then
            base_wt=$(worktree_for_branch "$base" 2>/dev/null || true)
            [ -n "$base_wt" ] && load_story_from_handoff_file "$base_wt/tmp/story-handoff.json" && return 0
        fi
    fi

    issue_num=$(issue_num_from_branch 2>/dev/null || true)
    if [ -n "$issue_num" ]; then
        issue_url=$(gh issue view "$issue_num" --repo "$GITHUB_REPO" --json url --jq .url 2>/dev/null || true)
        [ -n "$issue_url" ] && load_story_from_issue_url "$issue_url" && return 0
    fi

    return 1
}

filter_stories_for_repo_project() {
    local rows="$1"
    echo "$rows" | jq -c --argjson projectIds "$REPO_PROJECT_IDS_JSON" '
        if ($projectIds | length) == 0 then
            .
        else
            map(
                . as $story
                | ($story.properties["🛡️ Project "].relation[0].id // $story.properties["🛡️ Project"].relation[0].id // "") as $pid
                | select($projectIds | index($pid))
            )
        end
    '
}

validate_story_project_for_repo() {
    local story="$1"
    local project_id title
    project_id=$(story_project_id "$story")
    title=$(story_title "$story")

    [ -n "$project_id" ] || {
        echo "Story에서 Project relation을 찾을 수 없습니다: $title" >&2
        return 1
    }

    if ! echo "$REPO_PROJECT_IDS_JSON" | jq -e --arg pid "$project_id" 'index($pid)' >/dev/null; then
        echo "Story의 Project가 현재 repository의 Project와 일치하지 않습니다." >&2
        echo "  Repository: $GITHUB_REPO" >&2
        echo "  Story: $title" >&2
        echo "  Story Project: $project_id" >&2
        echo "  Repository Project(s): $(echo "$REPO_PROJECT_IDS_JSON" | jq -r 'join(", ")')" >&2
        return 1
    fi
}

select_story_from_json() {
    local rows="$1"
    local count
    count=$(echo "$rows" | jq 'length')
    [ "$count" -gt 0 ] || { echo "조건에 맞는 Story가 없습니다." >&2; return 1; }
    if [ "$count" -eq 1 ]; then
        echo "$rows" | jq -c '.[0]'
        return 0
    fi
    echo "Story를 선택하세요." >&2
    echo "$rows" | jq -r 'to_entries[] | "  [\(.key + 1)] \(.value.properties.Title.title[0].plain_text // .value.properties.Name.title[0].plain_text // "(제목 없음)") [\(.value.properties.Status.status.name // "")]"' >&2
    read -r -p "선택 [1-${count}/q]: " pick
    [ "$pick" = "q" ] || [ -z "$pick" ] && return 1
    [ "$pick" -ge 1 ] 2>/dev/null && [ "$pick" -le "$count" ] || { echo "잘못된 선택" >&2; return 1; }
    echo "$rows" | jq -c ".[$((pick - 1))]"
}

load_story() {
    local ref="$1"
    local page_id issue_url filter rows
    if [ -n "$ref" ] && page_id=$(normalize_notion_page_id "$ref" 2>/dev/null); then
        notion_get_page "$page_id" | jq -c '.'
        return 0
    fi

    if [ -n "$ref" ] && [ -f "$ref" ]; then
        load_story_from_handoff_file "$ref" && return 0
    fi

    if [ -n "$ref" ] && issue_url=$(github_issue_url_from_ref "$ref" 2>/dev/null); then
        load_story_from_issue_url "$issue_url" && return 0
    fi

    if [ -n "$ref" ]; then
        filter=$(jq -nc --arg q "$ref" '{property: "Title", title: {contains: $q}}')
        rows=$(notion_query_ds "$STORY_DB" "$filter" | jq -c '.results')
        rows=$(filter_stories_for_repo_project "$rows")
        select_story_from_json "$rows"
        return
    fi

    load_story_from_local_context && return 0

    filter=$(jq -nc --arg uid "$ASSIGNEE_ID" '{
        or: [
            {property: "Status", status: {equals: "진행 중"}},
            {property: "Assignee", people: {contains: $uid}}
        ]
    }')
    rows=$(notion_query_ds "$STORY_DB" "$filter" | jq -c '.results')
    rows=$(filter_stories_for_repo_project "$rows")
    select_story_from_json "$rows"
}

STORY=$(load_story "$STORY_REF") || exit 1
STORY_ID=$(echo "$STORY" | jq -r .id)
STORY_TITLE=$(story_title "$STORY")
STORY_URL=$(echo "$STORY" | jq -r '.url // empty')
PROJECT_ID=$(story_project_id "$STORY")
validate_story_project_for_repo "$STORY" || exit 1

if [ -z "$TASK_NAME" ]; then
    echo "Story: $STORY_TITLE"
    read -r -p "Task Name: " TASK_NAME
fi
[ -n "$TASK_NAME" ] || { echo "Task Name은 필수입니다." >&2; exit 1; }

if [ -z "$PLANNED_START" ] && [ -t 0 ]; then
    default_start=$(date +%Y-%m-%d)
    read -r -p "Planned start [$default_start]: " PLANNED_START
    PLANNED_START="${PLANNED_START:-$default_start}"
fi
if [ -z "$PLANNED_END" ] && [ -t 0 ]; then
    read -r -p "Planned end [same]: " PLANNED_END
fi
if [ -z "$DESCRIPTION" ] && [ -t 0 ]; then
    read -r -p "Description (선택): " DESCRIPTION
fi

WEEK_ID=$(current_week_id 2>/dev/null || true)
PARENT_TASK_IDS_JSON=$(printf '%s\n' "${PARENT_TASK_IDS[@]}" | jq -R -s -c 'split("\n") | map(select(length > 0))')

echo "▸ GitHub Issue 생성 중..."
ISSUE_BODY=$(mktemp)
trap 'rm -f "$ISSUE_BODY"' EXIT
{
    echo "$DESCRIPTION"
    echo ""
    echo "---"
    [ -n "$STORY_URL" ] && echo "Notion Story: $STORY_URL"
} > "$ISSUE_BODY"
ISSUE_URL=$(gh issue create --repo "$GITHUB_REPO" --title "$TASK_NAME" --body-file "$ISSUE_BODY") || {
    echo "GitHub Issue 생성 실패" >&2
    exit 1
}
ISSUE_NUM=$(echo "$ISSUE_URL" | grep -oE '[0-9]+$')

echo "▸ Notion Task 생성 중..."
props=$(jq -nc \
    --arg name "$TASK_NAME" \
    --arg topic "$TOPIC" \
    --arg sid "$STORY_ID" \
    --arg pid "$PROJECT_ID" \
    --arg uid "$ASSIGNEE_ID" \
    --arg iurl "$ISSUE_URL" \
    --arg rid "$REPO_ID" \
    --arg wid "$WEEK_ID" \
    --arg ps "$PLANNED_START" \
    --arg pe "$PLANNED_END" \
    --argjson parents "$PARENT_TASK_IDS_JSON" \
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

if [ -z "$TASK_TEMPLATE_ID" ]; then
    echo "ERROR: Task template id is empty" >&2
    echo "빈 Task page 생성을 중단합니다. TASK_TEMPLATE_ID 설정을 확인하세요." >&2
    exit 1
fi
desc_blocks=$(md_to_blocks "$DESCRIPTION")
task_resp=$(notion_create_page_from_template "$TASK_DB" "$props" "$TASK_TEMPLATE_ID")
TASK_ID=$(echo "$task_resp" | jq -r .id)
TASK_URL=$(echo "$task_resp" | jq -r .url)
if ! echo "$task_resp" | jq -e .id >/dev/null 2>&1; then
    echo "Notion Task 생성 실패" >&2
    echo "$task_resp" >&2
    exit 1
fi
notion_wait_for_template_applied "$TASK_ID" || exit 1
notion_insert_blocks_after_text "$TASK_ID" "$desc_blocks" "설명" || {
    echo "Notion Task description 삽입 실패" >&2
    exit 1
}

branch_topic=$(topic_branch_component "$TOPIC")
branch="${ISSUE_NUM}-${branch_topic}-$(make_slug "$TASK_NAME")"
WT_PATH=""
BASE_USED=""

resolve_base_branch() {
    if [ -n "$BASE_BRANCH" ]; then
        echo "$BASE_BRANCH"
        return 0
    fi
    if git show-ref --verify --quiet "refs/remotes/origin/dev" 2>/dev/null; then
        echo "dev"
        return 0
    fi
    local base
    base=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
    echo "${base:-main}"
}

if [ "$HERE" -eq 1 ]; then
    echo "▸ --here: 브랜치/worktree 생성 생략"
elif [ "$NO_CHECKOUT" -eq 1 ]; then
    base_branch=$(resolve_base_branch)
    BASE_USED="$base_branch"
    base_ref="$base_branch"
    git show-ref --verify --quiet "refs/remotes/origin/$base_branch" 2>/dev/null && base_ref="origin/$base_branch"
    if git show-ref --verify --quiet "refs/heads/$branch"; then
        echo "▸ 기존 브랜치 사용: $branch"
    else
        git branch "$branch" "$base_ref"
        echo "▸ 브랜치 생성: $branch"
    fi
    git config "branch.$branch.gh-merge-base" "$base_branch" 2>/dev/null || true
else
    echo "▸ Worktree 생성 중..."
    BASE_USED=$(resolve_base_branch)
    WT_PATH=$("$WORKFLOW_SCRIPTS_DIR/ult-wt-add.sh" "$branch" --base "$BASE_USED")
fi

if [ -n "$BASE_USED" ]; then
    branch_note="Branch: $branch
Base Branch: $BASE_USED"
    [ -n "$WT_PATH" ] && branch_note="$branch_note
Worktree: $WT_PATH"
    notion_add_comment "$TASK_ID" "$branch_note" >/dev/null || true
    gh issue comment "$ISSUE_NUM" --body "$branch_note" >/dev/null || true
fi

append_task_to_handoff() {
    local handoff_json handoff_md task_item parent_issue_urls parent_id parent_page parent_issue parent_summary tmp_json handoff_comment handoff_dir
    if [ -n "$CONTEXT_HANDOFF_PATH" ] && [ -f "$CONTEXT_HANDOFF_PATH" ]; then
        handoff_json="$CONTEXT_HANDOFF_PATH"
        handoff_dir=$(dirname "$handoff_json")
        handoff_md="$handoff_dir/story-handoff.md"
    elif [ -n "$WT_PATH" ]; then
        handoff_dir="$WT_PATH/tmp"
        mkdir -p "$handoff_dir"
        handoff_json="$handoff_dir/story-handoff.json"
        handoff_md="$handoff_dir/story-handoff.md"
        jq -nc \
            --arg title "$STORY_TITLE" \
            --arg notion_id "$STORY_ID" \
            --arg notion_url "$STORY_URL" \
            --arg repo "$GITHUB_REPO" \
            --arg base "${BASE_USED:-}" \
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
            }' > "$handoff_json"
        {
            echo "# Story Handoff"
            echo ""
            echo "Story: $STORY_TITLE"
            echo "Notion Story: $STORY_URL"
            echo "Story Base Branch: ${BASE_USED:-"-"}"
            echo ""
            echo "## Task Map"
            echo ""
            echo "| Task | Repo | Issue | Branch | Base Branch | Worktree | Parents | Status |"
            echo "| --- | --- | --- | --- | --- | --- | --- | --- |"
        } > "$handoff_md"
    else
        return 0
    fi

    parent_issue_urls='[]'
    for parent_id in "${PARENT_TASK_IDS[@]}"; do
        parent_page=$(notion_get_page "$parent_id" 2>/dev/null || true)
        parent_issue=$(printf '%s\n' "$parent_page" | jq -r '.properties["Issue URL"].url // empty' 2>/dev/null || true)
        if [ -n "$parent_issue" ]; then
            parent_issue_urls=$(printf '%s\n' "$parent_issue_urls" | jq -c --arg u "$parent_issue" '. + [$u]')
        fi
    done
    parent_summary=$(printf '%s\n' "$parent_issue_urls" | jq -r 'if length == 0 then "-" else join(", ") end')

    task_item=$(jq -nc \
        --arg name "$TASK_NAME" \
        --arg topic "$TOPIC" \
        --arg repo "$GITHUB_REPO" \
        --arg id "$TASK_ID" \
        --arg issue "$ISSUE_URL" \
        --arg num "$ISSUE_NUM" \
        --arg branch "$branch" \
        --arg base "$BASE_USED" \
        --arg wt "$WT_PATH" \
        --argjson parent_ids "$PARENT_TASK_IDS_JSON" \
        --argjson parent_urls "$parent_issue_urls" \
        '{
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
        }')

    tmp_json=$(mktemp)
    jq --argjson task "$task_item" '.updated_at = (now | todate) | .tasks += [$task]' "$handoff_json" > "$tmp_json" \
        && mv "$tmp_json" "$handoff_json" \
        || { rm -f "$tmp_json"; return 0; }

    if [ -f "$handoff_md" ]; then
        printf '| %s | %s | %s | %s | %s | %s | %s | Ready |\n' \
            "$TASK_NAME" "$GITHUB_REPO" "$ISSUE_URL" "$branch" "${BASE_USED:-"-"}" "${WT_PATH:-"-"}" "$parent_summary" >> "$handoff_md"
    fi

    if [ -n "$WT_PATH" ]; then
        mkdir -p "$WT_PATH/tmp"
        cp "$handoff_json" "$WT_PATH/tmp/story-handoff.json"
        [ -f "$handoff_md" ] && cp "$handoff_md" "$WT_PATH/tmp/story-handoff.md"
    fi

    handoff_comment="Story Handoff Update

Added Task: $TASK_NAME
Issue: $ISSUE_URL
Branch: $branch
Base Branch: ${BASE_USED:-"-"}"
    [ -n "$WT_PATH" ] && handoff_comment="$handoff_comment
Worktree: $WT_PATH"
    notion_add_comment "$STORY_ID" "$handoff_comment" >/dev/null || true
}

append_task_to_handoff

echo ""
echo "✅ Task 생성 완료"
echo "  Story: $STORY_TITLE"
echo "  Task: #${ISSUE_NUM} $TASK_NAME"
echo "  Issue: $ISSUE_URL"
echo "  Notion: $TASK_URL"
echo "  Branch: $branch"
if [ -n "$BASE_USED" ]; then
    echo "  Base Branch: $BASE_USED"
fi
if [ -n "$WT_PATH" ]; then
    echo "  Worktree: $WT_PATH"
fi
