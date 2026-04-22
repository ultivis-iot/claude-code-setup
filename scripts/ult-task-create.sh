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
  --story, -s        Story title, Notion page URL, page id
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
    local page_id filter rows
    if [ -n "$ref" ] && page_id=$(normalize_notion_page_id "$ref" 2>/dev/null); then
        notion_get_page "$page_id" | jq -c '.'
        return 0
    fi

    if [ -n "$ref" ]; then
        filter=$(jq -nc --arg q "$ref" '{property: "Title", title: {contains: $q}}')
        rows=$(notion_query_ds "$STORY_DB" "$filter" | jq -c '.results')
        rows=$(filter_stories_for_repo_project "$rows")
        select_story_from_json "$rows"
        return
    fi

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
ISSUE_URL=$(gh issue create --repo "$GITHUB_REPO" --title "$TASK_NAME" --body "$DESCRIPTION") || {
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

task_template_b=$(task_template_blocks)
if ! echo "$task_template_b" | jq -e 'type == "array" and length > 0' >/dev/null 2>&1; then
    echo "ERROR: Task template blocks are empty" >&2
    echo "빈 Task page 생성을 중단합니다. TASK_TEMPLATE_ID와 Notion template 접근 권한을 확인하세요." >&2
    exit 1
fi
desc_blocks=$(md_to_blocks "$DESCRIPTION")
task_blocks=$(jq -nc --argjson t "$task_template_b" --argjson d "$desc_blocks" '$t + $d')
task_resp=$(notion_create_page "$TASK_DB" "$props" "$task_blocks")
TASK_ID=$(echo "$task_resp" | jq -r .id)
TASK_URL=$(echo "$task_resp" | jq -r .url)
if ! echo "$task_resp" | jq -e .id >/dev/null 2>&1; then
    echo "Notion Task 생성 실패" >&2
    echo "$task_resp" >&2
    exit 1
fi

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
