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
topic=$(echo "$selected" | jq -r '.properties.Topic.select.name // "Other"' | tr '[:upper:]' '[:lower:]')
task_name=$(echo "$selected" | jq -r '.properties.Name.title[0].plain_text')

# 기존 브랜치 검색 (Issue 번호 포함)
existing_branch=""
if [ -n "$issue_num" ]; then
    existing_branch=$(git branch --list "*${issue_num}*" --format='%(refname:short)' | head -1)
fi

# 브랜치 이름 결정
if [ -n "$existing_branch" ]; then
    branch="$existing_branch"
    echo "ℹ️  기존 브랜치 사용: $branch"
else
    slug=$(echo "$task_name" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9 ]//g' | tr ' ' '-' | sed 's/--*/-/g' | sed 's/^-\|-$//g')
    [ -z "$slug" ] && slug="task"
    [ -z "$issue_num" ] && issue_num="no-issue"
    branch="${topic}/${issue_num}-${slug}"
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
