#!/bin/bash
# 내 Task 목록 조회 + 선택 시 브랜치 자동 체크아웃/생성
# Usage: ult-my-tasks.sh [--week | --all]

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/workflow-env.sh"
. "$SCRIPT_DIR/notion-api.sh"

MODE="default"
case "$1" in
    --week) MODE="week" ;;
    --all)  MODE="all" ;;
esac

# 1. Github 사용자
gh_user=$(gh api user --jq .login 2>/dev/null) || { echo "gh CLI 인증 필요" >&2; exit 1; }

# 2. Notion user ID
notion_id=$(member_notion_id "$gh_user")
if [ -z "$notion_id" ]; then
    echo "Member DB에 Github 계정($gh_user)이 등록되지 않았습니다." >&2
    echo "PM에게 Member DB 추가 요청하세요." >&2
    exit 1
fi
name=$(member_name "$gh_user")

# 3. 필터 구성
case "$MODE" in
    default)
        filter=$(jq -nc --arg uid "$notion_id" '{
            and: [
                {property: "Assignee", people: {contains: $uid}},
                {or: [
                    {property: "Status", status: {equals: "시작 전"}},
                    {property: "Status", status: {equals: "진행 중"}}
                ]}
            ]
        }')
        ;;
    all)
        filter=$(jq -nc --arg uid "$notion_id" '{
            property: "Assignee", people: {contains: $uid}
        }')
        ;;
    week)
        # TODO: Week 페이지 검색 후 Week relation 필터 추가
        filter=$(jq -nc --arg uid "$notion_id" '{
            property: "Assignee", people: {contains: $uid}
        }')
        ;;
esac

# 4. Task 조회 — Planned Date 정렬
body=$(jq -nc --argjson f "$filter" '{
    filter: $f,
    sorts: [{property: "Planned Date", direction: "ascending"}],
    page_size: 50
}')
resp=$(notion_api POST "/data_sources/${TASK_DB}/query" "$body")
count=$(echo "$resp" | jq '.results | length')

if [ "$count" = "0" ]; then
    echo "${name}님 할당 Task 없음."
    exit 0
fi

# 5. 연관 Story/Repository ID 수집 후 병렬 fetch
story_ids=$(echo "$resp" | jq -r '.results[].properties["📜 Story"].relation[]?.id' | sort -u)
repo_ids=$(echo "$resp" | jq -r '.results[].properties["🥨 Repository"].relation[]?.id' | sort -u)

# 캐시 디렉토리
CACHE_DIR="/tmp/ult-tasks-cache-$$"
mkdir -p "$CACHE_DIR"
trap 'rm -rf "$CACHE_DIR"' EXIT

# 병렬 fetch (xargs -P)
fetch_page() {
    local id="$1" type="$2"
    notion_get_page "$id" | jq -r '.properties | (.Title.title[0].plain_text // .Name.title[0].plain_text // "(제목 없음)")' > "$CACHE_DIR/${type}-${id}"
}
export -f fetch_page notion_get_page notion_api _notion_token
export CACHE_DIR

for id in $story_ids; do
    fetch_page "$id" story &
done
for id in $repo_ids; do
    fetch_page "$id" repo &
done
wait

# 6. 포맷 출력 + 선택지 수집
today=$(date +%Y-%m-%d)

github_repo_for_task() {
    local repo_id="$1"
    local repo=""
    if [ -n "$repo_id" ]; then
        repo=$(repository_github_slug_by_id "$repo_id" 2>/dev/null || true)
    fi
    if [ -z "$repo" ]; then
        repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)
    fi
    [ -n "$repo" ] || return 1
    echo "$repo"
}

task_blocks_markdown() {
    local task_id="$1"
    notion_api GET "/blocks/${task_id}/children?page_size=100" \
        | jq -r '
            def text($rt): [$rt[]?.plain_text] | join("");
            .results[]?
            | if .type == "heading_1" then "# " + text(.heading_1.rich_text)
              elif .type == "heading_2" then "## " + text(.heading_2.rich_text)
              elif .type == "heading_3" then "### " + text(.heading_3.rich_text)
              elif .type == "paragraph" then text(.paragraph.rich_text)
              elif .type == "bulleted_list_item" then "- " + text(.bulleted_list_item.rich_text)
              elif .type == "numbered_list_item" then "1. " + text(.numbered_list_item.rich_text)
              elif .type == "to_do" then "- [" + (if .to_do.checked then "x" else " " end) + "] " + text(.to_do.rich_text)
              elif .type == "quote" then "> " + text(.quote.rich_text)
              elif .type == "code" then "```" + (.code.language // "") + "\n" + text(.code.rich_text) + "\n```"
              else empty
              end
        ' | sed '/^$/N;/^\n$/D'
}

publish_issue_for_task() {
    local row="$1"
    local task_id task_name repo_id page_url repo content body issue_url props resp

    task_id=$(echo "$row" | jq -r '.id')
    task_name=$(echo "$row" | jq -r '.properties.Name.title[0].plain_text // "(제목 없음)"')
    repo_id=$(echo "$row" | jq -r '.properties["🥨 Repository"].relation[0].id // ""')
    page_url=$(echo "$row" | jq -r '.url // ""')
    repo=$(github_repo_for_task "$repo_id") || {
        echo "GitHub repository를 확인할 수 없어 Issue를 만들 수 없습니다." >&2
        echo "Task의 Repository relation 또는 현재 git remote를 확인하세요." >&2
        return 1
    }

    content=$(task_blocks_markdown "$task_id" || true)
    if [ -n "$content" ]; then
        body=$(printf 'Notion Task: %s\n\n%s\n' "$page_url" "$content")
    else
        body="Notion Task: ${page_url}"
    fi
    issue_url=$(gh issue create --repo "$repo" --title "$task_name" --body "$body") || {
        echo "GitHub Issue 생성 실패: ${repo} / ${task_name}" >&2
        return 1
    }

    props=$(jq -nc --arg u "$issue_url" '{"Issue URL": {url: $u}}')
    resp=$(notion_patch_page "$task_id" "$props")
    if ! echo "$resp" | jq -e .id >/dev/null 2>&1; then
        echo "ERROR: Task Issue URL 업데이트 실패" >&2
        echo "$resp" >&2
        return 1
    fi

    echo "$issue_url"
}

render_task() {
    local row="$1" idx="$2"
    local name topic status planned story_id repo_id issue_num issue_url
    name=$(echo "$row" | jq -r '.properties.Name.title[0].plain_text // "(제목 없음)"')
    topic=$(echo "$row" | jq -r '.properties.Topic.select.name // "—"')
    status=$(echo "$row" | jq -r '.properties.Status.status.name // ""')
    planned=$(echo "$row" | jq -r '.properties["Planned Date"].date.end // .properties["Planned Date"].date.start // ""')
    issue_num=$(echo "$row" | jq -r '.properties["Issue Number"].formula.string // ""')
    issue_url=$(echo "$row" | jq -r '.properties["Issue URL"].url // ""')
    story_id=$(echo "$row" | jq -r '.properties["📜 Story"].relation[0].id // ""')
    repo_id=$(echo "$row" | jq -r '.properties["🥨 Repository"].relation[0].id // ""')

    local story_name="(Story 없음)"
    [ -n "$story_id" ] && [ -f "$CACHE_DIR/story-$story_id" ] && story_name=$(cat "$CACHE_DIR/story-$story_id")
    local repo_name=""
    [ -n "$repo_id" ] && [ -f "$CACHE_DIR/repo-$repo_id" ] && repo_name=$(cat "$CACHE_DIR/repo-$repo_id")

    # 마감 표시
    local deadline=""
    if [ -n "$planned" ]; then
        local days
        days=$(( ( $(date -d "$planned" +%s) - $(date -d "$today" +%s) ) / 86400 ))
        if [ "$days" -gt 0 ]; then deadline="D-$days"
        elif [ "$days" -eq 0 ]; then deadline="D+0 ⚠ 오늘 마감"
        else deadline="D+$((-days)) ⚠ 지남"; fi
    else
        deadline="마감 미정"
    fi

    local tag="#${issue_num:-?}"
    [ -z "$issue_num" ] && tag="#(미발행)"

    echo "  $tag [$topic] $name"
    echo "       📜 $story_name · $deadline"
    [ -n "$repo_name" ] && echo "       🥨 $repo_name"
    [ -n "$issue_url" ] && echo "       $issue_url"
    echo "       [$idx] 선택"
}

echo "${name}님 할당 Task ${count}건"
echo ""

# 상태별 그룹핑
declare -a choices
idx=1
for group in "진행 중" "시작 전"; do
    rows=$(echo "$resp" | jq -c --arg s "$group" '[.results[] | select(.properties.Status.status.name == $s)]')
    gcount=$(echo "$rows" | jq 'length')
    [ "$gcount" -eq 0 ] && continue

    case "$group" in
        "진행 중") icon="📍" ;;
        "시작 전") icon="⏳" ;;
    esac
    echo "$icon $group ($gcount)"

    for i in $(seq 0 $((gcount-1))); do
        row=$(echo "$rows" | jq -c ".[$i]")
        render_task "$row" "$idx"
        choices[$idx]=$(echo "$row" | jq -c '.')
        idx=$((idx+1))
    done
    echo ""
done

# 7. 선택
read -r -p "선택 [1-$((idx-1)) / q]: " pick
[ "$pick" = "q" ] || [ -z "$pick" ] && exit 0
[ "$pick" -ge 1 ] 2>/dev/null && [ "$pick" -lt "$idx" ] || { echo "잘못된 선택"; exit 1; }

selected="${choices[$pick]}"
status=$(echo "$selected" | jq -r '.properties.Status.status.name')
issue_num=$(echo "$selected" | jq -r '.properties["Issue Number"].formula.string // ""')
issue_url=$(echo "$selected" | jq -r '.properties["Issue URL"].url // ""')
topic=$(echo "$selected" | jq -r '.properties.Topic.select.name // "Other"' | tr '[:upper:]' '[:lower:]')
task_name=$(echo "$selected" | jq -r '.properties.Name.title[0].plain_text')

if [ -z "$issue_num" ] && [ -n "$issue_url" ]; then
    issue_num=$(echo "$issue_url" | grep -oE '[0-9]+$' || echo "")
fi

if [ -z "$issue_num" ]; then
    echo ""
    echo "선택한 Task에 Issue URL이 없어 GitHub Issue를 생성하고 연결합니다."
    issue_url=$(publish_issue_for_task "$selected") || exit 1
    issue_num=$(echo "$issue_url" | grep -oE '[0-9]+$' || echo "")
    echo "✓ GitHub Issue 생성 및 Task 연결: ${issue_url}"
fi

# 기존 브랜치 검색. 이슈 번호가 단순 포함된 과거 브랜치를 잡지 않도록 prefix만 허용한다.
existing_branch=""
if [ -n "$issue_num" ]; then
    current_branch=$(git branch --show-current 2>/dev/null || true)
    if printf '%s\n' "$current_branch" | grep -Eq "^${issue_num}($|[-_/])"; then
        existing_branch="$current_branch"
    else
        existing_branch=$(git branch --format='%(refname:short)' 2>/dev/null \
            | grep -E "^${issue_num}($|[-_/])" \
            | head -1)
    fi
fi

# 브랜치 이름 결정
if [ -n "$existing_branch" ]; then
    branch="$existing_branch"
    echo "ℹ️  기존 브랜치 사용: $branch"
else
    slug=$(echo "$task_name" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9 ]//g' | tr ' ' '-' | sed 's/--*/-/g' | sed 's/^-\|-$//g')
    [ -z "$slug" ] && slug="task"
    [ -z "$issue_num" ] && { echo "Issue 번호가 없어 브랜치를 만들 수 없습니다." >&2; exit 1; }
    branch="${issue_num}-${topic}-${slug}"
fi

# Worktree 생성 (또는 기존 worktree 경로 얻기) — ult-wt-add.sh 위임
wt_path=$("$WORKFLOW_SCRIPTS_DIR/ult-wt-add.sh" "$branch") || exit 1

wt_name=$(basename "$wt_path")

echo ""
echo "✅ Worktree: $wt_path"
echo ""
echo "다음 명령으로 이동:"
echo "   cc $wt_name    # tmux 세션 + Claude Code"
echo "   cd $wt_path"
echo ""
echo "/issue 로 상세 컨텍스트 확인"
