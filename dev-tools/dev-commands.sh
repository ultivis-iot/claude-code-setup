#!/bin/bash
# Isaac dev-tools: Git Worktree + tmux + Claude Code
# 여러 프로젝트를 지원 (MAIN_PROJECT 없음, 현재 git 컨텍스트로 동작)

# ============================================================
# 설정 로드
# ============================================================
DEV_TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# .env 로드 (없으면 기본값으로 자동 생성)
if [ -f "$DEV_TOOLS_DIR/.env" ]; then
    source "$DEV_TOOLS_DIR/.env"
else
    echo "ℹ️  .env 없음 — 기본값으로 생성 ($DEV_TOOLS_DIR/.env)"
    cat > "$DEV_TOOLS_DIR/.env" <<EOF
# Isaac dev-tools 환경 설정 (자동 생성)
WORKTREE_ROOT="\$HOME/Git"
EOF
    source "$DEV_TOOLS_DIR/.env"
fi

# 하위 호환: AX_DIR → WORKTREE_ROOT
[ -z "$WORKTREE_ROOT" ] && [ -n "$AX_DIR" ] && WORKTREE_ROOT="$AX_DIR"
[ -z "$WORKTREE_ROOT" ] && WORKTREE_ROOT="$HOME/Git"

# WORKTREE_ROOT 디렉토리 없으면 생성
if [ ! -d "$WORKTREE_ROOT" ]; then
    mkdir -p "$WORKTREE_ROOT" 2>/dev/null \
        && echo "📁 WORKTREE_ROOT 생성: $WORKTREE_ROOT" \
        || echo "⚠️  WORKTREE_ROOT 생성 실패: $WORKTREE_ROOT"
fi

# ============================================================
# 멀티유저 포트 자동 설정 (사용자명 해시 기반, project-maker 호환)
# ============================================================
if [ -z "$COMPOSE_PROJECT_NAME" ]; then
    export COMPOSE_PROJECT_NAME="pm-$(whoami)"
fi

if [ -z "$PM_PORT_OFFSET" ]; then
    PM_PORT_OFFSET=$(( $(echo -n "$(whoami)" | cksum | cut -d' ' -f1) % 50 ))
fi

export PM_TRAEFIK_PORT="${PM_TRAEFIK_PORT:-$(( 30080 + PM_PORT_OFFSET * 100 ))}"
export PM_TRAEFIK_HTTPS_PORT="${PM_TRAEFIK_HTTPS_PORT:-$(( 30443 + PM_PORT_OFFSET * 100 ))}"
export PM_TRAEFIK_DASHBOARD_PORT="${PM_TRAEFIK_DASHBOARD_PORT:-$(( 30081 + PM_PORT_OFFSET * 100 ))}"
export PM_API_PORT="${PM_API_PORT:-$(( 38000 + PM_PORT_OFFSET * 100 ))}"
export PM_PG_PORT="${PM_PG_PORT:-$(( 35432 + PM_PORT_OFFSET * 100 ))}"
export PM_REDIS_PORT="${PM_REDIS_PORT:-$(( 36379 + PM_PORT_OFFSET * 100 ))}"
export PM_MINIO_PORT="${PM_MINIO_PORT:-$(( 39000 + PM_PORT_OFFSET * 100 ))}"
export PM_MINIO_CONSOLE_PORT="${PM_MINIO_CONSOLE_PORT:-$(( 39001 + PM_PORT_OFFSET * 100 ))}"
export PM_FLOWER_PORT="${PM_FLOWER_PORT:-$(( 35555 + PM_PORT_OFFSET * 100 ))}"
export PM_SMTP_PORT="${PM_SMTP_PORT:-$(( 32525 + PM_PORT_OFFSET * 100 ))}"
export PM_VITE_PORT="${PM_VITE_PORT:-$(( 20173 + PM_PORT_OFFSET * 100 ))}"

# ============================================================
# 내부 헬퍼
# ============================================================

# 현재 위치의 git 메인 worktree 경로
_current_main_repo() {
    local cwd_root
    cwd_root=$(git rev-parse --show-toplevel 2>/dev/null) || return 1
    git -C "$cwd_root" worktree list 2>/dev/null | head -1 | awk '{print $1}'
}

# 현재 프로젝트 이름 (메인 worktree의 basename)
_current_repo_name() {
    local main
    main=$(_current_main_repo) || return 1
    basename "$main"
}

# Repo 이름 → abbr (하이픈 세그먼트 첫 글자)
# project-maker → pm, ultivis-base → ub, claude-code-setup → ccs
_repo_abbr() {
    echo "$1" | awk -F- '{for(i=1;i<=NF;i++) printf "%s", tolower(substr($i,1,1))}'
}

_current_repo_abbr() {
    local name
    name=$(_current_repo_name) || return 1
    _repo_abbr "$name"
}

# 번호로 worktree 경로 해결
# - 현재 repo abbr 우선 (<abbr>-<num>*)
# - 없으면 전체 *-<num>* 검색
# - 여러 개면 사용자에게 선택 프롬프트
# 출력: worktree 절대 경로 (stdout). 실패 시 return 1
_resolve_wt_by_num() {
    local num="$1"
    local matches abbr

    # 1. 현재 repo abbr 먼저
    abbr=$(_current_repo_abbr 2>/dev/null)
    if [ -n "$abbr" ]; then
        matches=$(find "$WORKTREE_ROOT" -maxdepth 1 -type d -name "${abbr}-${num}*" 2>/dev/null)
    fi

    # 2. 없으면 전체에서
    if [ -z "$matches" ]; then
        matches=$(find "$WORKTREE_ROOT" -maxdepth 1 -type d -name "*-${num}*" 2>/dev/null)
    fi

    local count
    count=$(echo -n "$matches" | grep -c . 2>/dev/null || echo 0)

    if [ "$count" = "0" ]; then
        echo "❌ *-${num}* worktree 없음 (WORKTREE_ROOT=$WORKTREE_ROOT)" >&2
        read -r -p "   wa로 새 worktree를 만들까요? (y/N): " ans >&2
        if [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then
            wa >&2 && return 1   # wa 이후는 사용자가 다시 cc/dw 호출
        fi
        return 1
    elif [ "$count" = "1" ]; then
        echo "$matches" | head -1
    else
        # 여러 개 → 선택
        echo "여러 worktree가 매치됩니다:" >&2
        local -a list
        local i=1
        while IFS= read -r p; do
            [ -z "$p" ] && continue
            echo "  [$i] $(basename "$p")" >&2
            list[$i]="$p"
            i=$((i+1))
        done <<< "$matches"
        read -r -p "선택 [1-$((i-1))]: " pick >&2
        [ -z "${list[$pick]}" ] && { echo "❌ 잘못된 선택" >&2; return 1; }
        echo "${list[$pick]}"
    fi
}

# Docker Worktree 상태 자동 로드 (PM_PROJECT_ROOT 호환 유지)
_load_worktree_state() {
    local state_file="$DEV_TOOLS_DIR/.worktree-active"
    if [ -f "$state_file" ]; then
        local active_wt=$(cat "$state_file")
        if [ -n "$active_wt" ]; then
            local wt_path="$WORKTREE_ROOT/$active_wt"
            if [ -d "$wt_path" ]; then
                export PM_PROJECT_ROOT="$wt_path"
                return
            fi
        fi
    fi
    unset PM_PROJECT_ROOT
}
_load_worktree_state

# ============================================================
# Worktree 명령어
# ============================================================

# wt: 현재 프로젝트의 Worktree 목록
wt() {
    local main_repo
    main_repo=$(_current_main_repo) || { echo "❌ git repo 아님"; return 1; }

    git -C "$main_repo" fetch origin --prune 2>/dev/null

    local remote_branches
    remote_branches=$(git -C "$main_repo" branch -r 2>/dev/null | sed 's/^ *//' | sed 's/^origin\///')

    echo ""
    echo "Git Worktrees — $(_current_repo_name)"
    echo "─────────────────────────────────────────────────────────────"

    git -C "$main_repo" worktree list 2>/dev/null | while read -r line; do
        local dir=$(echo "$line" | awk '{print $1}')
        local branch=$(echo "$line" | awk '{print $3}' | tr -d '[]')
        local name=$(basename "$dir")
        local status=""

        if [ "$branch" != "main" ] && [ "$branch" != "master" ] && [ "$branch" != "dev" ]; then
            if ! echo "$remote_branches" | grep -q "^${branch}$"; then
                status=" [merged]"
            else
                local pr_state
                pr_state=$(gh pr list --head "$branch" --json state,number --jq '.[0] | "\(.state):\(.number)"' 2>/dev/null)
                if [ -n "$pr_state" ]; then
                    local state=$(echo "$pr_state" | cut -d: -f1)
                    local pr_num=$(echo "$pr_state" | cut -d: -f2)
                    case "$state" in
                        OPEN)   status=" [PR #$pr_num]" ;;
                        MERGED) status=" [merged]" ;;
                        CLOSED) status=" [closed]" ;;
                    esac
                fi
            fi
        fi

        echo "  $name → $branch$status"
    done
    echo ""
}

# wa: Worktree 추가
#   wa              — 대화형 (원격 브랜치 중 선택)
#   wa <branch>     — 지정 브랜치로 바로 생성 (비대화형)
#   wa -r <repo> <branch>  — 다른 repo 지정
wa() {
    # 인자 있으면 비대화형 — isaac-wt-add.sh로 위임
    if [ $# -gt 0 ]; then
        local wt_path
        wt_path=$("$HOME/.claude/scripts/isaac-wt-add.sh" "$@") || return 1
        echo "✅ $wt_path"
        cd "$wt_path" 2>/dev/null
        return 0
    fi

    # 대화형 — 원격 브랜치 목록에서 선택
    local main_repo repo_name
    main_repo=$(_current_main_repo) || { echo "❌ git repo 아님"; return 1; }
    repo_name=$(basename "$main_repo")

    cd "$main_repo" || return 1
    echo ""
    echo "=== Worktree 추가 ($repo_name) ==="
    git fetch origin --prune 2>/dev/null

    local used_branches=$(git worktree list | awk '{print $3}' | tr -d '[]')

    echo ""
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║  최근 원격 브랜치 (1-9 선택, 0=직접입력, q=취소)              ║"
    echo "╠═══════════════════════════════════════════════════════════════╣"

    local branches=()
    local i=1
    while IFS= read -r branch; do
        branch="${branch#origin/}"
        echo "$used_branches" | grep -q "^${branch}$" && continue
        [ "$branch" = "HEAD" ] || [ "$branch" = "main" ] || [ "$branch" = "master" ] || [ "$branch" = "dev" ] && continue
        branches+=("$branch")
        printf "║  [%d] %-55s ║\n" "$i" "$branch"
        i=$((i + 1))
        [ $i -gt 9 ] && break
    done < <(git for-each-ref --sort=-committerdate --format='%(refname:short)' refs/remotes/origin/ 2>/dev/null | head -20)

    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo ""
    read -p "선택 (1-9, 0=직접입력, q=취소): " choice

    local branch=""
    case "$choice" in
        q|Q) echo "취소"; return 1 ;;
        0) read -p "브랜치 이름: " branch ;;
        [1-9])
            local idx=$((choice - 1))
            [ $idx -lt ${#branches[@]} ] && branch="${branches[$idx]}" || { echo "잘못된 선택"; return 1; }
            ;;
        *) echo "잘못된 입력"; return 1 ;;
    esac
    [ -z "$branch" ] && { echo "취소"; return 1; }

    local wt_path
    wt_path=$("$HOME/.claude/scripts/isaac-wt-add.sh" "$branch") || return 1
    echo ""
    echo "✅ $wt_path"
    cd "$wt_path"
}

# wr: Worktree 삭제 (대화형)
wr() {
    local main_repo
    main_repo=$(_current_main_repo) || { echo "❌ git repo 아님"; return 1; }

    git -C "$main_repo" fetch origin --prune 2>/dev/null
    local remote_branches=$(git -C "$main_repo" branch -r 2>/dev/null | sed 's/^ *//' | sed 's/^origin\///')

    echo ""
    echo "=== Worktree 삭제 ($(basename "$main_repo")) ==="
    echo ""

    local merged_list=() active_list=()
    while read -r line; do
        local dir=$(echo "$line" | awk '{print $1}')
        local branch=$(echo "$line" | awk '{print $3}' | tr -d '[]')
        local name=$(basename "$dir")

        # 메인은 제외
        [ "$dir" = "$main_repo" ] && continue

        local is_merged=false
        if [ "$branch" != "main" ] && [ "$branch" != "master" ] && [ "$branch" != "dev" ]; then
            if ! echo "$remote_branches" | grep -q "^${branch}$"; then
                is_merged=true
            fi
        fi
        if [ "$is_merged" = true ]; then
            merged_list+=("$dir|$name|$branch|merged")
        else
            active_list+=("$dir|$name|$branch|active")
        fi
    done < <(git -C "$main_repo" worktree list 2>/dev/null)

    local all_list=("${merged_list[@]}" "${active_list[@]}")
    [ ${#all_list[@]} -eq 0 ] && { echo "삭제할 worktree 없음."; return 0; }

    echo "삭제할 worktree 선택 (q=취소)"
    echo "─────────────────────────────────────────────────────────────"
    local i=1
    for item in "${all_list[@]}"; do
        local name=$(echo "$item" | cut -d'|' -f2)
        local branch=$(echo "$item" | cut -d'|' -f3)
        local status=$(echo "$item" | cut -d'|' -f4)
        if [ "$status" = "merged" ]; then
            echo "  [$i] $name → $branch [merged]"
        else
            echo "  [$i] $name → $branch"
        fi
        i=$((i + 1))
    done
    echo ""
    read -p "선택 (1-${#all_list[@]}, q=취소): " choice

    case "$choice" in
        q|Q) echo "취소됨"; return 1 ;;
        ''|*[!0-9]*) echo "잘못된 입력"; return 1 ;;
    esac

    local idx=$((choice - 1))
    [ $idx -lt 0 ] || [ $idx -ge ${#all_list[@]} ] && { echo "잘못된 선택"; return 1; }

    local selected="${all_list[$idx]}"
    local wtpath=$(echo "$selected" | cut -d'|' -f1)
    local wtname=$(echo "$selected" | cut -d'|' -f2)
    local wtbranch=$(echo "$selected" | cut -d'|' -f3)

    local dirty=$(git -C "$wtpath" status --porcelain 2>/dev/null)
    if [ -n "$dirty" ]; then
        echo ""
        echo "❌ $wtname 에 커밋되지 않은 변경사항이 있습니다:"
        git -C "$wtpath" status --short
        return 1
    fi

    echo ""
    echo "삭제: $wtname ($wtbranch)"
    read -p "정말 삭제? (y/n): " confirm
    [ "$confirm" != "y" ] && [ "$confirm" != "Y" ] && { echo "취소됨"; return 1; }

    # 활성 worktree 안전장치
    local state_file="$DEV_TOOLS_DIR/.worktree-active"
    if [ -f "$state_file" ] && [ "$(cat "$state_file")" = "$wtname" ]; then
        echo "⚠️  삭제 대상이 활성 worktree — 상태 초기화"
        rm -f "$state_file"
        unset PM_PROJECT_ROOT
    fi

    git -C "$main_repo" worktree remove "$wtpath"
    echo "✅ 삭제: $wtname"
    wt
}

# ============================================================
# Claude Code 세션
# ============================================================

# cc: Claude Code 세션 시작/접속
cc() {
    local target="$1"
    local session_name="" work_dir=""

    if [ -z "$target" ]; then
        work_dir="$(pwd)"
        session_name="$(basename "$work_dir")"
    elif [[ "$target" =~ ^[0-9]+$ ]]; then
        # 숫자: 현재 repo abbr 우선 → 전체에서 검색 → 다수면 선택
        work_dir=$(_resolve_wt_by_num "$target") || return 1
        session_name="$(basename "$work_dir")"
    elif [ "$target" = "main" ] || [ "$target" = "m" ]; then
        work_dir=$(_current_main_repo) || { echo "❌ 현재 git repo 아님"; return 1; }
        session_name="$(basename "$work_dir")"
    else
        session_name="$target"
        if [ -d "$WORKTREE_ROOT/$target" ]; then
            work_dir="$WORKTREE_ROOT/$target"
        elif [ -d "$target" ]; then
            work_dir="$target"
            session_name="$(basename "$work_dir")"
        else
            echo "❌ 디렉토리 없음: $target"
            return 1
        fi
    fi

    echo "📂 $work_dir"
    echo "🖥️  세션: $session_name"

    if ! tmux has-session -t "$session_name" 2>/dev/null; then
        echo "✨ 새 세션 생성..."
        tmux new-session -d -s "$session_name" -c "$work_dir"
        tmux send-keys -t "$session_name" "claude" Enter
    fi

    if [ -z "$TMUX" ]; then
        tmux attach-session -t "$session_name"
    else
        tmux switch-client -t "$session_name"
    fi
}

# ccs: 세션 상태
ccs() {
    local main_repo
    main_repo=$(_current_main_repo) || { echo "❌ git repo 아님"; return 1; }

    echo ""
    echo "╔═══════════════════════════════════════════════════════════════════╗"
    echo "║  Claude Code Sessions — $(basename "$main_repo")"
    echo "╠═══════════════════════════════════════════════════════════════════╣"

    while IFS= read -r line; do
        local dir=$(echo "$line" | awk '{print $1}')
        local branch=$(echo "$line" | awk '{print $3}' | tr -d '[]')
        local name=$(basename "$dir")
        local status="○" status_text="stopped"

        if tmux has-session -t "$name" 2>/dev/null; then
            status="●" status_text="running"
        fi
        printf "║  %s %-25s %-20s [%-7s]  ║\n" "$status" "$name" "$branch" "$status_text"
    done < <(git -C "$main_repo" worktree list 2>/dev/null)

    echo "╚═══════════════════════════════════════════════════════════════════╝"
    echo ""
}

# cca: 현재 프로젝트의 모든 worktree를 세션으로
cca() {
    local main_repo
    main_repo=$(_current_main_repo) || { echo "❌ git repo 아님"; return 1; }

    echo "🚀 모든 worktree 세션 생성..."
    git -C "$main_repo" worktree list 2>/dev/null | while read -r line; do
        local dir=$(echo "$line" | awk '{print $1}')
        local name=$(basename "$dir")
        if tmux has-session -t "$name" 2>/dev/null; then
            echo "  ⏭️  $name (이미 있음)"
            continue
        fi
        echo "  ✨ $name"
        tmux new-session -d -s "$name" -c "$dir"
        tmux send-keys -t "$name" "claude" Enter
    done
    echo ""
    echo "완료. ccs로 확인"
}

# ============================================================
# dw: Worktree 전환 + 프로젝트 hook 실행
# ============================================================

dw() {
    local target="$1"
    local state_file="$DEV_TOOLS_DIR/.worktree-active"

    # 상태 표시
    if [ -z "$target" ]; then
        if [ -f "$state_file" ]; then
            local active=$(cat "$state_file")
            echo "🐳 활성 worktree: $active ($WORKTREE_ROOT/$active)"
        else
            echo "🐳 활성 worktree: (없음)"
        fi
        return
    fi

    local wt_name="" wt_path="" repo_name
    repo_name=$(_current_repo_name 2>/dev/null)

    # 1. $WORKTREE_ROOT/<target> 폴더 직접 지정
    if [ -d "$WORKTREE_ROOT/$target" ]; then
        wt_path="$WORKTREE_ROOT/$target"
        wt_name="$target"
    # 2. main/m → 현재 repo 메인
    elif [ "$target" = "main" ] || [ "$target" = "m" ]; then
        wt_path=$(_current_main_repo) || { echo "❌ 현재 git repo 아님"; return 1; }
        wt_name=$(basename "$wt_path")
    # 3. 숫자 → abbr 우선, 다수면 선택
    elif [[ "$target" =~ ^[0-9]+$ ]]; then
        wt_path=$(_resolve_wt_by_num "$target") || return 1
        wt_name=$(basename "$wt_path")
    else
        echo "❌ 사용법: dw [<folder> | <num> | m | main]"
        return 1
    fi

    echo "$wt_name" > "$state_file"
    export PM_PROJECT_ROOT="$wt_path"
    echo "🐳 Worktree → $wt_name ($wt_path)"

    # 2-tier Hook 조회
    # 1) repo 내 .isaac/dw.sh (팀 공유)
    # 2) ~/.claude/dev-tools/hooks/<repo>.sh (개인)
    local hook="" hook_source=""
    local repo_basename
    repo_basename=$(basename "$(git -C "$wt_path" worktree list 2>/dev/null | head -1 | awk '{print $1}')")

    if [ -f "$wt_path/.isaac/dw.sh" ]; then
        hook="$wt_path/.isaac/dw.sh"
        hook_source="repo"
    elif [ -f "$HOME/.claude/dev-tools/hooks/${repo_basename}.sh" ]; then
        hook="$HOME/.claude/dev-tools/hooks/${repo_basename}.sh"
        hook_source="home"
    fi

    if [ -n "$hook" ]; then
        echo "🪝 hook 실행 ($hook_source): $hook"
        local main_path
        main_path=$(git -C "$wt_path" worktree list 2>/dev/null | head -1 | awk '{print $1}')
        TARGET_WORKTREE_PATH="$wt_path" \
        ACTIVE_WORKTREE_NAME="$wt_name" \
        MAIN_PROJECT_PATH="$main_path" \
            bash "$hook"
        return $?
    fi

    # 3) 레거시 project-maker 자동 감지
    if [ -d "$wt_path/apps/api/alembic" ] && [ -d "$wt_path/apps/api/src" ]; then
        echo "ℹ️  hook 미발견 — 레거시 project-maker 로직 사용"
        _dw_reboot "$wt_path"
        return
    fi

    echo "ℹ️  hook 없음 — 환경변수만 갱신"
    read -r -p "   지금 dw-hook 생성할까요? (y/N): " ans
    if [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then
        (cd "$wt_path" && isaac-init dw-hook)
    fi
}

_dw_reboot() {
    local wt_path="$1"
    local prev_dir="$(pwd)"
    local main_repo
    main_repo=$(_current_main_repo) || return 1
    cd "$main_repo"

    local target_versions_dir="$wt_path/apps/api/alembic/versions"
    local target_head=""
    if [ -d "$target_versions_dir" ]; then
        target_head=$(grep -h '^revision = ' "$target_versions_dir"/*.py 2>/dev/null \
            | sed 's/revision = "//;s/"//' | sort -t_ -k1 -n | tail -1)
    fi

    if [ -n "$target_head" ]; then
        echo "⏳ Alembic downgrade → $target_head ..."
        docker compose -f docker/docker-compose.dev.yml exec backend uv run alembic downgrade "$target_head" || echo "⚠️  downgrade 실패"
    fi

    echo "⏳ Docker down..."
    docker compose -f docker/docker-compose.dev.yml down --remove-orphans

    echo "⏳ init-dev.sh..."
    bash scripts/init-dev.sh

    echo "⏳ Docker up (workers)..."
    docker compose -f docker/docker-compose.dev.yml --profile workers up -d --build

    echo "⏳ Alembic upgrade head..."
    docker compose -f docker/docker-compose.dev.yml exec backend uv run alembic upgrade head || echo "⚠️  upgrade 실패"

    local vite_pid=$(lsof -ti:20173 2>/dev/null)
    [ -n "$vite_pid" ] && { echo "⏳ Vite 종료..."; kill $vite_pid 2>/dev/null; sleep 1; }

    cd "$wt_path"
    [ ! -d "node_modules" ] && { echo "⏳ pnpm install..."; pnpm install; }
    [ ! -d "packages/api-client/dist" ] && { echo "⏳ api-client 빌드..."; pnpm -C packages/api-client run build; }

    echo "⏳ Vite dev server 시작..."
    nohup pnpm run dev:web > /tmp/dw-vite.log 2>&1 &
    echo "   PID: $!, 로그: /tmp/dw-vite.log"
    echo ""
    echo "✅ Worktree switched + reboot complete"
    cd "$prev_dir"
}

# ============================================================
# Aliases
# ============================================================

alias gw='git worktree list'
alias tl='tmux list-sessions 2>/dev/null || echo "세션 없음"'
alias tk='tmux kill-session -t'
alias tka='tmux kill-server 2>/dev/null && echo "모든 세션 종료됨"'
alias td='tmux detach'
alias ccm='cc m'

# ============================================================
# isaac-init: dev-tools 셋업 도우미
# ============================================================

isaac-init() {
    local sub="${1:-status}"
    local env_file="$DEV_TOOLS_DIR/.env"

    case "$sub" in
    status|"")
        echo ""
        echo "🔧 Isaac dev-tools 상태"
        echo "─────────────────────────────────────────────"
        if [ -d "$WORKTREE_ROOT" ]; then
            echo "  ✓ WORKTREE_ROOT: $WORKTREE_ROOT"
        else
            echo "  ✗ WORKTREE_ROOT: $WORKTREE_ROOT (디렉토리 없음)"
        fi

        local cur_root
        cur_root=$(git rev-parse --show-toplevel 2>/dev/null)
        if [ -n "$cur_root" ]; then
            local repo_basename
            repo_basename=$(basename "$cur_root")
            echo "  📂 현재 프로젝트: $repo_basename ($cur_root)"
            local home_hook="$HOME/.claude/dev-tools/hooks/${repo_basename}.sh"
            if [ -f "$cur_root/.isaac/dw.sh" ]; then
                echo "     ✓ hook (팀): $cur_root/.isaac/dw.sh"
            elif [ -f "$home_hook" ]; then
                echo "     ✓ hook (개인): $home_hook"
            else
                echo "     ○ hook 없음 → isaac-init dw-hook 으로 생성"
            fi
        else
            echo "  ⚠ 현재 디렉토리가 git repo 아님"
        fi

        local state_file="$DEV_TOOLS_DIR/.worktree-active"
        if [ -f "$state_file" ]; then
            echo "  ● 활성 worktree: $(cat "$state_file")"
        fi

        echo ""
        echo "  📋 명령어:  wt, wa, wr, cc <num>, ccs, cca, dw <num>"
        echo "  📋 셋업:   isaac-init setup | check | dw-hook"
        echo ""
        ;;

    setup)
        echo ""
        echo "🔧 Isaac dev-tools 셋업"
        echo "─────────────────────────────────────────────"
        local cur_root=""
        [ -n "$WORKTREE_ROOT" ] && cur_root="$WORKTREE_ROOT"

        local prompt="WORKTREE_ROOT (worktree 루트)"
        [ -n "$cur_root" ] && prompt="$prompt [$cur_root]"
        read -r -p "$prompt: " new_root
        new_root="${new_root:-$cur_root}"
        [ -z "$new_root" ] && { echo "❌ 필수"; return 1; }

        # Expand $HOME if present
        new_root="${new_root/#\~/$HOME}"

        cat > "$env_file" <<EOF
# Isaac dev-tools 환경 설정
WORKTREE_ROOT="$new_root"
EOF
        echo "✓ 저장: $env_file"
        echo "  → 새 셸 또는 source $env_file"
        ;;

    check)
        echo ""
        echo "🔍 유효성 검증"
        echo "─────────────────────────────────────────────"
        local ok=true
        [ -f "$env_file" ] || { echo "  ✗ .env 없음"; ok=false; }
        [ -d "$WORKTREE_ROOT" ] || { echo "  ✗ WORKTREE_ROOT 없음: $WORKTREE_ROOT"; ok=false; }
        command -v gh >/dev/null 2>&1 || { echo "  ✗ gh CLI 없음"; ok=false; }
        command -v jq >/dev/null 2>&1 || { echo "  ✗ jq 없음"; ok=false; }
        command -v tmux >/dev/null 2>&1 || echo "  ⚠ tmux 없음 (cc 미작동)"
        $ok && echo "  ✓ 모두 정상"
        ;;

    dw-hook)
        local cur_root
        cur_root=$(git rev-parse --show-toplevel 2>/dev/null)
        [ -z "$cur_root" ] && { echo "❌ git repo 아님 — repo 안에서 실행하세요"; return 1; }
        local repo_name
        repo_name=$(basename "$cur_root")

        # ── 1. 타입 감지 ──
        local type="generic"
        local has_alembic=false has_compose=false has_pnpm=false has_django=false has_nextjs=false
        [ -d "$cur_root/apps/api/alembic" ] && has_alembic=true
        { [ -f "$cur_root/docker-compose.yml" ] || [ -f "$cur_root/compose.yml" ] || [ -f "$cur_root/docker/docker-compose.dev.yml" ]; } && has_compose=true
        [ -f "$cur_root/pnpm-lock.yaml" ] && has_pnpm=true
        [ -f "$cur_root/manage.py" ] && has_django=true
        [ -f "$cur_root/next.config.js" ] || [ -f "$cur_root/next.config.mjs" ] && has_nextjs=true

        if $has_alembic && $has_compose; then type="project-maker"
        elif $has_compose; then type="compose"
        elif $has_django; then type="django"
        elif $has_nextjs; then type="nextjs"
        elif $has_pnpm; then type="pnpm"
        fi

        echo ""
        echo "╔══════════════════════════════════════════════════════════╗"
        echo "║  dw-hook 셋업                                              ║"
        echo "╚══════════════════════════════════════════════════════════╝"
        echo ""
        echo "📂 프로젝트: $repo_name"
        echo "   $cur_root"
        echo ""
        echo "🔍 감지된 마커:"
        echo "   alembic:  $has_alembic"
        echo "   compose:  $has_compose"
        echo "   pnpm:     $has_pnpm"
        echo "   django:   $has_django"
        echo "   nextjs:   $has_nextjs"
        echo "   → 추천 타입: $type"
        echo ""

        # ── 2. 저장 위치 선택 ──
        echo "어디에 hook을 저장할까요?"
        echo "   [1] repo 루트 ($cur_root/.isaac/dw.sh)"
        echo "       → git에 커밋해서 팀 공유"
        echo "   [2] 개인 ($HOME/.claude/dev-tools/hooks/${repo_name}.sh)"
        echo "       → 본인 머신에만 존재, repo에 영향 없음"
        echo ""
        read -r -p "선택 [1-2]: " loc_choice

        local hook_path=""
        local is_personal=false
        case "$loc_choice" in
        1) hook_path="$cur_root/.isaac/dw.sh" ;;
        2)
            hook_path="$HOME/.claude/dev-tools/hooks/${repo_name}.sh"
            is_personal=true
            ;;
        *) echo "취소"; return 0 ;;
        esac

        if [ -f "$hook_path" ]; then
            echo ""
            echo "⚠️  이미 존재: $hook_path"
            read -r -p "덮어쓸까요? (y/N): " ans
            [ "$ans" != "y" ] && [ "$ans" != "Y" ] && { echo "취소"; return 0; }
        fi

        # ── 3. 타입 수동 선택 (원하면) ──
        echo ""
        echo "템플릿 타입:"
        echo "   [1] $type (자동 감지, 추천)"
        echo "   [2] compose     — docker compose 기본 restart"
        echo "   [3] pnpm        — pnpm install만"
        echo "   [4] project-maker — alembic + docker + pnpm (레거시 호환)"
        echo "   [5] generic     — 빈 템플릿"
        echo ""
        read -r -p "선택 [Enter=자동]: " type_choice
        case "$type_choice" in
        ""|1) ;;
        2) type="compose" ;;
        3) type="pnpm" ;;
        4) type="project-maker" ;;
        5) type="generic" ;;
        *) ;;
        esac

        mkdir -p "$(dirname "$hook_path")"
        case "$type" in
        project-maker)
            cat > "$hook_path" <<'EOF'
#!/bin/bash
# dw hook - project-maker 스타일
set -e
cd "$TARGET_WORKTREE_PATH"

target_head=$(grep -h '^revision = ' apps/api/alembic/versions/*.py 2>/dev/null \
    | sed 's/revision = "//;s/"//' | sort -t_ -k1 -n | tail -1)

if [ -n "$target_head" ]; then
    echo "⏳ Alembic downgrade → $target_head ..."
    (cd "$MAIN_PROJECT_PATH" && docker compose -f docker/docker-compose.dev.yml exec backend uv run alembic downgrade "$target_head") || echo "⚠️  downgrade 실패"
fi

echo "⏳ Docker down..."
(cd "$MAIN_PROJECT_PATH" && docker compose -f docker/docker-compose.dev.yml down --remove-orphans)

echo "⏳ init-dev.sh..."
(cd "$MAIN_PROJECT_PATH" && bash scripts/init-dev.sh)

echo "⏳ Docker up (workers)..."
(cd "$MAIN_PROJECT_PATH" && docker compose -f docker/docker-compose.dev.yml --profile workers up -d --build)

echo "⏳ Alembic upgrade head..."
(cd "$MAIN_PROJECT_PATH" && docker compose -f docker/docker-compose.dev.yml exec backend uv run alembic upgrade head) || echo "⚠️  upgrade 실패"

vite_pid=$(lsof -ti:20173 2>/dev/null || true)
[ -n "$vite_pid" ] && kill $vite_pid 2>/dev/null

cd "$TARGET_WORKTREE_PATH"
[ ! -d node_modules ] && pnpm install
[ ! -d packages/api-client/dist ] && pnpm -C packages/api-client run build

echo "✓ $ACTIVE_WORKTREE_NAME 전환 완료"
EOF
            ;;
        compose)
            cat > "$hook_path" <<'EOF'
#!/bin/bash
# dw hook - docker compose 프로젝트
set -e
cd "$TARGET_WORKTREE_PATH"
compose_file=""
for f in docker-compose.yml compose.yml docker/docker-compose.dev.yml; do
    [ -f "$f" ] && compose_file="$f" && break
done
[ -z "$compose_file" ] && { echo "❌ compose 파일 없음"; exit 1; }
echo "⏳ Docker restart..."
docker compose -f "$compose_file" down --remove-orphans
docker compose -f "$compose_file" up -d --build
echo "✓ $ACTIVE_WORKTREE_NAME 전환 완료"
EOF
            ;;
        pnpm)
            cat > "$hook_path" <<'EOF'
#!/bin/bash
# dw hook - pnpm workspace
set -e
cd "$TARGET_WORKTREE_PATH"
if [ ! -d node_modules ] || [ pnpm-lock.yaml -nt node_modules ]; then
    echo "⏳ pnpm install..."
    pnpm install
fi
echo "✓ $ACTIVE_WORKTREE_NAME 전환 완료"
EOF
            ;;
        *)
            cat > "$hook_path" <<'EOF'
#!/bin/bash
# dw hook - 프로젝트별 로직 추가
set -e
cd "$TARGET_WORKTREE_PATH"
# TODO: docker compose, DB, package install 등
echo "✓ $ACTIVE_WORKTREE_NAME 전환 완료 (템플릿, 추가 로직 필요)"
EOF
            ;;
        esac

        # 팀 공유 hook은 개인 오버라이드 훅 자동 부착
        if ! $is_personal; then
            cat >> "$hook_path" <<'OVERRIDE'

# 개인 오버라이드 (선택, .gitignore 권장)
[ -f "$TARGET_WORKTREE_PATH/.isaac/dw.local.sh" ] && bash "$TARGET_WORKTREE_PATH/.isaac/dw.local.sh"
OVERRIDE
        fi

        chmod +x "$hook_path"
        echo ""
        echo "✅ 생성됨: $hook_path"
        echo "   타입: $type"
        echo ""
        if $is_personal; then
            echo "📝 다음 단계:"
            echo "   필요하면 수정: vi $hook_path"
            echo "   dw로 테스트: dw m"
        else
            echo "📝 다음 단계:"
            echo "   1. 필요하면 수정: vi $hook_path"
            echo "   2. git에 커밋:"
            echo "        git add .isaac/dw.sh"
            echo "        git commit -m 'chore: add isaac dw hook'"
            echo "   3. dw로 테스트: dw m"
            echo ""
            if [ ! -f "$cur_root/.gitignore" ] || ! grep -q "^\.isaac/dw\.local\.sh" "$cur_root/.gitignore" 2>/dev/null; then
                read -r -p "   개인 오버라이드용 .isaac/dw.local.sh 를 .gitignore 에 추가할까요? (y/N): " gi
                if [ "$gi" = "y" ] || [ "$gi" = "Y" ]; then
                    echo ".isaac/dw.local.sh" >> "$cur_root/.gitignore"
                    echo "   ✓ .gitignore 업데이트됨"
                fi
            fi
        fi
        ;;

    *)
        echo "사용법: isaac-init [status | setup | check | dw-hook]"
        return 1
        ;;
    esac
}

# ============================================================
echo "✅ Isaac dev 명령어 로드 (wt, wa, wr, dw, cc, ccs, cca, isaac-init)"
