#!/bin/bash
# Notion API 공통 헬퍼
# Usage: source 이 파일 후 notion_* 함수 호출

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/workflow-env.sh"

# 토큰 읽기 (user scope 또는 project scope의 mcpServers.notion-api.env.NOTION_TOKEN)
_notion_token() {
    if [ -n "$NOTION_TOKEN" ]; then
        echo "$NOTION_TOKEN"
        return 0
    fi
    local token
    # user scope → 모든 project scope 중 첫 매치 순으로 탐색
    token=$(jq -r '
        .mcpServers["notion-api"].env.NOTION_TOKEN //
        ([.projects[]?.mcpServers["notion-api"].env.NOTION_TOKEN] | map(select(. != null)) | .[0]) //
        empty
    ' "$WORKFLOW_CONFIG_JSON" 2>/dev/null)
    if [ -z "$token" ]; then
        echo "ERROR: Notion 토큰을 찾을 수 없습니다. WORKFLOW_CONFIG_JSON 또는 NOTION_TOKEN 확인 필요." >&2
        return 1
    fi
    echo "$token"
}

# Notion API 호출 wrapper
# notion_api <METHOD> <PATH> [JSON_BODY]
notion_api() {
    local method="$1"
    local path="$2"
    local body="$3"
    local token
    token=$(_notion_token) || return 1

    local args=(
        -sS
        -X "$method"
        "https://api.notion.com/v1${path}"
        -H "Authorization: Bearer $token"
        -H "Notion-Version: 2025-09-03"
        -H "Content-Type: application/json"
    )
    if [ -n "$body" ]; then
        args+=(-d "$body")
    fi
    curl "${args[@]}"
}

# Data Source 쿼리
# notion_query_ds <data_source_id> [filter_json] [sorts_json]
notion_query_ds() {
    local ds="$1"
    local filter="${2:-}"
    local sorts="${3:-}"
    local body
    if [ -n "$filter" ] && [ "$filter" != "{}" ]; then
        body=$(jq -nc --argjson f "$filter" '{filter: $f, page_size: 100}')
    else
        body='{"page_size": 100}'
    fi
    if [ -n "$sorts" ]; then
        body=$(echo "$body" | jq -c --argjson s "$sorts" '. + {sorts: $s}')
    fi
    notion_api POST "/data_sources/${ds}/query" "$body"
}

# 페이지 단건 조회
notion_get_page() {
    local id="$1"
    notion_api GET "/pages/${id}"
}

# 페이지 속성 업데이트
# notion_patch_page <page_id> <properties_json>
notion_patch_page() {
    local id="$1"
    local props="$2"
    local body
    body=$(jq -nc --argjson p "$props" '{properties: $p}')
    notion_api PATCH "/pages/${id}" "$body"
}

# 페이지 생성
# notion_create_page <parent_data_source_id> <properties_json> [children_json]
notion_create_page() {
    local ds="$1"
    local props="$2"
    local children="${3:-[]}"
    local body
    body=$(jq -nc --arg ds "$ds" --argjson p "$props" --argjson c "$children" \
        '{parent: {data_source_id: $ds}, properties: $p, children: $c}')
    notion_api POST "/pages" "$body"
}

# 코멘트 추가
# notion_add_comment <page_id> <content>
notion_add_comment() {
    local page_id="$1"
    local content="$2"
    local body
    body=$(jq -nc --arg pid "$page_id" --arg c "$content" \
        '{parent: {page_id: $pid}, rich_text: [{type: "text", text: {content: $c}}]}')
    notion_api POST "/comments" "$body"
}

# ---- DB 상수 ----
TASK_DB="b89060b1-037c-480d-8671-f206aec117b6"
STORY_DB="338b9757-d10f-462f-92c9-4777cb747c78"
PROJECT_DB="0848664d-6ecf-441e-b3d5-6b1f4fd540f8"
REPOSITORY_DB="23a729af-8b39-4fe9-accb-c0eb44538ce0"
WEEK_DB="2caff747-77ab-8055-b249-000bec1e846b"
MEMBER_DB="11bab65b-33f6-417a-aaf2-ccdb7f574b71"
DAILY_REPORT_DB="f365bbd5-d7e3-49c9-bf0d-89c757de27df"

# ---- 캐시 ----
CACHE_DIR="$WORKFLOW_CACHE_DIR"
mkdir -p "$CACHE_DIR/schemas" 2>/dev/null

# 기존 위치(notion-member.json)와의 호환을 위해 첫 사용 시 이동
[ -f "$HOME/.claude/notion-member.json" ] && [ ! -f "$CACHE_DIR/members.json" ] \
    && mv "$HOME/.claude/notion-member.json" "$CACHE_DIR/members.json"

_cache_fresh() {
    local path="$1" ttl="$2"
    [ -f "$path" ] && find "$path" -mmin -${ttl} -print 2>/dev/null | grep -q .
}

# ---- Member 캐시 (24h TTL) ----
MEMBER_CACHE="$CACHE_DIR/members.json"
member_cache_refresh() {
    local resp
    resp=$(notion_query_ds "$MEMBER_DB") || return 1
    local now
    now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    echo "$resp" | jq --arg now "$now" '
        {
            version: 1, cached_at: $now,
            by_github: (
                .results | map(select(.properties.Github.rich_text | length > 0))
                | map({
                    key: .properties.Github.rich_text[0].plain_text,
                    value: {
                        notion_id: .properties.Notion.people[0].id,
                        name: .properties.Name.title[0].plain_text
                    }
                }) | from_entries
            )
        }' > "$MEMBER_CACHE"
}
member_notion_id() {
    _cache_fresh "$MEMBER_CACHE" 1440 || member_cache_refresh >/dev/null || return 1
    jq -r --arg u "$1" '.by_github[$u].notion_id // empty' "$MEMBER_CACHE"
}
member_name() {
    _cache_fresh "$MEMBER_CACHE" 1440 || member_cache_refresh >/dev/null || return 1
    jq -r --arg u "$1" '.by_github[$u].name // empty' "$MEMBER_CACHE"
}

# ---- Project 캐시 (6h TTL) ----
PROJECT_CACHE="$CACHE_DIR/projects.json"
project_cache_refresh() {
    notion_query_ds "$PROJECT_DB" \
        | jq '{cached_at: now|todate, items: [.results[] | {id, name: (.properties.Title.title[0].plain_text // "(제목없음)")}]}' \
        > "$PROJECT_CACHE"
}
project_id_by_name() {
    _cache_fresh "$PROJECT_CACHE" 360 || project_cache_refresh >/dev/null || return 1
    jq -r --arg n "$1" '.items[] | select(.name == $n) | .id' "$PROJECT_CACHE" | head -1
}
projects_list_json() {
    _cache_fresh "$PROJECT_CACHE" 360 || project_cache_refresh >/dev/null || return 1
    jq '.items' "$PROJECT_CACHE"
}

# ---- Repository 캐시 (6h TTL) ----
REPO_CACHE="$CACHE_DIR/repositories.json"
repo_cache_refresh() {
    notion_query_ds "$REPOSITORY_DB" \
        | jq '{cached_at: now|todate, items: [.results[] | {
            id,
            name: (.properties.Name.title[0].plain_text // "(제목없음)"),
            url: (.properties.URL.url // ""),
            project_ids: [.properties["🛡️ Project DB "].relation[]?.id]
        }]}' > "$REPO_CACHE"
}
repository_id_by_name() {
    _cache_fresh "$REPO_CACHE" 360 || repo_cache_refresh >/dev/null || return 1
    jq -r --arg n "$1" '.items[] | select(.name == $n) | .id' "$REPO_CACHE" | head -1
}
repository_project_ids() {
    _cache_fresh "$REPO_CACHE" 360 || repo_cache_refresh >/dev/null || return 1
    jq -r --arg id "$1" '.items[] | select(.id == $id) | .project_ids[]' "$REPO_CACHE"
}
repository_url_by_id() {
    _cache_fresh "$REPO_CACHE" 360 || repo_cache_refresh >/dev/null || return 1
    jq -r --arg id "$1" '.items[] | select(.id == $id) | .url // empty' "$REPO_CACHE" | head -1
}
github_repo_from_url() {
    local url="$1"
    [ -n "$url" ] || return 1
    printf '%s\n' "$url" \
        | sed -E 's#^git@github.com:##; s#^https://github.com/##; s#^http://github.com/##; s#\.git$##' \
        | grep -E '^[^/]+/[^/]+$' || return 1
}
repository_github_slug_by_id() {
    local url
    url=$(repository_url_by_id "$1") || return 1
    github_repo_from_url "$url"
}
repository_id_by_github_slug() {
    local slug="$1"
    _cache_fresh "$REPO_CACHE" 360 || repo_cache_refresh >/dev/null || return 1
    jq -r --arg slug "$slug" '
        .items[]
        | select(
            (.name == $slug)
            or (.url | sub("^git@github.com:"; "") | sub("^https://github.com/"; "") | sub("^http://github.com/"; "") | sub("\\.git$"; "") == $slug)
        )
        | .id
    ' "$REPO_CACHE" | head -1
}
repositories_list_json() {
    _cache_fresh "$REPO_CACHE" 360 || repo_cache_refresh >/dev/null || return 1
    jq '.items' "$REPO_CACHE"
}

# ---- Schema 캐시 (7d TTL, 옵션 변경 거의 없음) ----
schema_refresh() {
    local name="$1" ds_id="$2"
    notion_api GET "/data_sources/${ds_id}" > "$CACHE_DIR/schemas/${name}.json"
}
schema_options() {
    # schema_options <db_name> <property_name> [select|status]
    local name="$1" prop="$2" type="${3:-select}"
    local path="$CACHE_DIR/schemas/${name}.json"
    if ! _cache_fresh "$path" 10080; then
        case "$name" in
            task) schema_refresh task "$TASK_DB" >/dev/null ;;
            story) schema_refresh story "$STORY_DB" >/dev/null ;;
            project) schema_refresh project "$PROJECT_DB" >/dev/null ;;
        esac
    fi
    jq -r --arg p "$prop" --arg t "$type" \
        '.properties[$p][$t].options[]?.name' "$path" 2>/dev/null
}

# ---- 템플릿 캐시 (1주 TTL) ----
# Story Tag → 템플릿 ID
story_template_id() {
    case "$1" in
        Feature)  echo "1f5ff747-77ab-80fa-8c93-f4b636c102e4" ;;
        Update)   echo "1fbff747-77ab-800b-922b-fa5e761d7ee0" ;;
        Refactor) echo "1ffff747-77ab-80c6-b148-e0b56d3e3fb4" ;;
        Bug)      echo "1fbff747-77ab-806a-ae8e-f642b3ed4b17" ;;
    esac
}
TASK_TEMPLATE_ID="1f5ff747-77ab-80b1-975a-d04aeb3adf56"

# 템플릿 페이지의 children blocks를 fetch + 정제 + 캐시
template_blocks_cached() {
    local template_id="$1"
    local cache_path="$CACHE_DIR/templates/${template_id}.json"
    mkdir -p "$CACHE_DIR/templates"
    if _cache_fresh "$cache_path" 10080; then
        jq 'def clean_nulls:
                walk(if type == "object" then with_entries(select(.value != null)) else . end);
            clean_nulls' "$cache_path"
        return 0
    fi
    notion_api GET "/blocks/${template_id}/children?page_size=100" \
        | jq 'def clean_nulls:
                walk(if type == "object" then with_entries(select(.value != null)) else . end);
            [.results[]
            | select(.type != "child_database" and .type != "child_page" and .type != "unsupported")
            | del(.id, .parent, .created_time, .last_edited_time, .created_by, .last_edited_by, .has_children, .in_trash, .archived, .request_id)
            | clean_nulls
        ]' | tee "$cache_path"
}

story_template_blocks() {
    local tag="$1"
    local tid
    tid=$(story_template_id "$tag")
    [ -z "$tid" ] && { echo "[]"; return; }
    template_blocks_cached "$tid"
}

task_template_blocks() {
    template_blocks_cached "$TASK_TEMPLATE_ID"
}

# ---- 현재 Week ----
current_week_id() {
    local today="${1:-$(date +%Y-%m-%d)}"
    local filter
    filter=$(jq -nc --arg t "$today" '{
        and: [
            {property: "DateFrom", date: {on_or_before: $t}}
        ]
    }')
    local body
    body=$(jq -nc --argjson f "$filter" '{
        filter: $f,
        sorts: [{property: "DateFrom", direction: "descending"}],
        page_size: 1
    }')
    notion_api POST "/data_sources/${WEEK_DB}/query" "$body" \
        | jq -r '.results[0].id // empty'
}

# ---- 유틸 ----

normalize_notion_page_id() {
    local ref="$1"
    local uuid compact
    uuid=$(printf '%s\n' "$ref" | grep -oE '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' | tail -1 || true)
    if [ -n "$uuid" ]; then
        printf '%s\n' "$uuid"
        return 0
    fi
    compact=$(printf '%s\n' "$ref" | grep -oE '[0-9a-fA-F]{32}' | tail -1 || true)
    if [ -n "$compact" ]; then
        printf '%s-%s-%s-%s-%s\n' \
            "${compact:0:8}" "${compact:8:4}" "${compact:12:4}" "${compact:16:4}" "${compact:20:12}"
        return 0
    fi
    return 1
}

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

topic_branch_component() {
    case "$1" in
        Feature|feature) echo "feature" ;;
        Fix|fix) echo "fix" ;;
        Update|update) echo "update" ;;
        Refactor|refactor) echo "refactor" ;;
        Style|style) echo "style" ;;
        Other|other) echo "chore" ;;
        *) echo "chore" ;;
    esac
}

make_slug() {
    local s="$1"
    s=$(echo "$s" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9 ]//g' | tr ' ' '-' | sed 's/--*/-/g' | sed 's/^-\|-$//g')
    [ -z "$s" ] && s="task"
    echo "${s:0:50}"
}

# 현재 브랜치에서 Issue 번호 추출
issue_num_from_branch() {
    local branch="${1:-$(git branch --show-current 2>/dev/null)}"
    [ -z "$branch" ] && return 1
    local num
    num=$(echo "$branch" | grep -oE '^[0-9]+')
    [ -n "$num" ] || num=$(echo "$branch" | grep -oE '^[a-zA-Z]+/([0-9]+)' | grep -oE '[0-9]+')
    [ -n "$num" ] || num=$(echo "$branch" | grep -oE 'pm-([0-9]+)' | grep -oE '[0-9]+')
    [ -n "$num" ] && echo "$num"
}

# Issue 번호로 Task page 찾기 (첫 번째 매치만)
find_task_by_issue() {
    local num="$1"
    local filter
    filter=$(jq -nc --arg n "$num" '{property: "Issue Number", formula: {string: {equals: $n}}}')
    notion_query_ds "$TASK_DB" "$filter" | jq -r '.results[0] // empty'
}

find_task_by_issue_url() {
    local url="$1"
    local filter
    filter=$(jq -nc --arg u "$url" '{property: "Issue URL", url: {equals: $u}}')
    notion_query_ds "$TASK_DB" "$filter" | jq -r '.results[0] // empty'
}

find_unlinked_tasks_by_title() {
    local title="$1"
    local filter
    filter=$(jq -nc --arg t "$title" '{
        and: [
            {property: "Name", title: {contains: $t}},
            {property: "Issue URL", url: {is_empty: true}}
        ]
    }')
    notion_query_ds "$TASK_DB" "$filter" | jq -c '.results'
}
