#!/bin/bash
# AX 개발 환경 명령어
# Git Worktree + tmux + Claude Code 워크플로우

# ============================================================
# 설정 로드
# ============================================================
DEV_TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$DEV_TOOLS_DIR/.env" ]; then
    source "$DEV_TOOLS_DIR/.env"
else
    echo "⚠️  $DEV_TOOLS_DIR/.env 파일이 없습니다."
    echo "   cp $DEV_TOOLS_DIR/.env.example $DEV_TOOLS_DIR/.env 후 경로를 수정하세요."
    return 1 2>/dev/null || exit 1
fi

# Docker Worktree 상태 자동 로드
_load_worktree_state() {
    local state_file="$DEV_TOOLS_DIR/.worktree-active"
    if [ -f "$state_file" ]; then
        local active_wt=$(cat "$state_file")
        if [ -n "$active_wt" ] && [ "$active_wt" != "project-maker" ]; then
            local wt_path="$AX_DIR/$active_wt"
            if [ -d "$wt_path/apps/api/src" ]; then
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

# wt: Worktree 목록 보기
wt() {
    cd "$MAIN_PROJECT" 2>/dev/null

    # 원격 브랜치 정보 업데이트
    git fetch origin --prune 2>/dev/null

    # 원격 브랜치 목록 가져오기
    local remote_branches=$(git branch -r 2>/dev/null | sed 's/^ *//' | sed 's/^origin\///')

    echo ""
    echo "Git Worktrees"
    echo "─────────────────────────────────────────────────────────────"

    git worktree list 2>/dev/null | while read -r line; do
        local dir=$(echo "$line" | awk '{print $1}')
        local branch=$(echo "$line" | awk '{print $3}' | tr -d '[]')
        local name=$(basename "$dir")
        local status=""

        # main, dev는 체크 안 함
        if [ "$branch" != "main" ] && [ "$branch" != "dev" ]; then
            # origin에서 삭제되었는지 확인
            if ! echo "$remote_branches" | grep -q "^${branch}$"; then
                status=" [merged]"
            else
                # PR 상태 확인
                local pr_state=$(gh pr list --head "$branch" --json state,number --jq '.[0] | "\(.state):\(.number)"' 2>/dev/null)
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
    cd - > /dev/null 2>&1
}

# wa: Worktree 추가 (대화형)
wa() {
    cd "$MAIN_PROJECT"
    echo ""
    echo "=== Worktree 추가 ==="
    echo "원격 브랜치 확인 중..."
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
        if echo "$used_branches" | grep -q "^${branch}$"; then continue; fi
        if [ "$branch" = "HEAD" ] || [ "$branch" = "main" ] || [ "$branch" = "dev" ]; then continue; fi
        branches+=("$branch")
        printf "║  [%d] %-55s ║\n" "$i" "$branch"
        i=$((i + 1))
        if [ $i -gt 9 ]; then break; fi
    done < <(git for-each-ref --sort=-committerdate --format='%(refname:short)' refs/remotes/origin/ 2>/dev/null | head -20)

    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo ""

    read -p "선택 (1-9, 0=직접입력, q=취소): " choice

    local branch=""
    case "$choice" in
        q|Q) echo "취소됨"; return 1 ;;
        0) read -p "브랜치 이름 입력: " branch ;;
        [1-9])
            local idx=$((choice - 1))
            if [ $idx -lt ${#branches[@]} ]; then
                branch="${branches[$idx]}"
            else
                echo "잘못된 선택"
                return 1
            fi
            ;;
        *) echo "잘못된 입력"; return 1 ;;
    esac

    if [ -z "$branch" ]; then echo "취소됨"; return 1; fi

    # worktree 이름 생성 (pm-이슈번호)
    local wtname="pm-${branch%%-*}"
    local wtpath="$AX_DIR/$wtname"

    echo ""
    echo "브랜치: $branch"
    echo "경로: $wtpath"
    read -p "계속? (y/n): " confirm

    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo "취소됨"
        return 1
    fi

    if git show-ref --verify --quiet "refs/remotes/origin/$branch" 2>/dev/null; then
        echo "원격 브랜치에서 worktree 생성..."
        git worktree add "$wtpath" "origin/$branch"
        cd "$wtpath"
        git checkout -b "$branch" 2>/dev/null || git checkout "$branch"
    else
        echo "새 브랜치로 worktree 생성 (dev 기반)..."
        git worktree add -b "$branch" "$wtpath" dev
    fi

    echo ""
    echo "✅ Worktree 생성 완료: $wtpath"
    cd "$wtpath"
}

# wr: Worktree 삭제 (대화형)
wr() {
    cd "$MAIN_PROJECT" 2>/dev/null

    # 원격 브랜치 정보 업데이트
    git fetch origin --prune 2>/dev/null

    # 원격 브랜치 목록
    local remote_branches=$(git branch -r 2>/dev/null | sed 's/^ *//' | sed 's/^origin\///')

    echo ""
    echo "=== Worktree 삭제 ==="
    echo ""

    # worktree 목록 수집 (merged 우선 정렬)
    local merged_list=()
    local active_list=()

    while read -r line; do
        local dir=$(echo "$line" | awk '{print $1}')
        local branch=$(echo "$line" | awk '{print $3}' | tr -d '[]')
        local name=$(basename "$dir")

        # 메인 프로젝트는 제외
        if [ "$dir" = "$MAIN_PROJECT" ]; then continue; fi

        # merged 여부 확인
        local is_merged=false
        if [ "$branch" != "main" ] && [ "$branch" != "dev" ]; then
            if ! echo "$remote_branches" | grep -q "^${branch}$"; then
                is_merged=true
            fi
        fi

        if [ "$is_merged" = true ]; then
            merged_list+=("$dir|$name|$branch|merged")
        else
            active_list+=("$dir|$name|$branch|active")
        fi
    done < <(git worktree list 2>/dev/null)

    # 합치기 (merged 먼저)
    local all_list=("${merged_list[@]}" "${active_list[@]}")

    if [ ${#all_list[@]} -eq 0 ]; then
        echo "삭제할 worktree가 없습니다."
        return 0
    fi

    # 목록 표시
    echo "삭제할 worktree 선택 (q=취소)"
    echo "─────────────────────────────────────────────────────────────"

    local i=1
    for item in "${all_list[@]}"; do
        local dir=$(echo "$item" | cut -d'|' -f1)
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
    if [ $idx -lt 0 ] || [ $idx -ge ${#all_list[@]} ]; then
        echo "잘못된 선택"
        return 1
    fi

    local selected="${all_list[$idx]}"
    local wtpath=$(echo "$selected" | cut -d'|' -f1)
    local wtname=$(echo "$selected" | cut -d'|' -f2)
    local wtbranch=$(echo "$selected" | cut -d'|' -f3)

    # 깨끗한 상태인지 확인
    local dirty=$(git -C "$wtpath" status --porcelain 2>/dev/null)
    if [ -n "$dirty" ]; then
        echo ""
        echo "❌ $wtname 에 커밋되지 않은 변경사항이 있습니다:"
        git -C "$wtpath" status --short
        echo ""
        echo "변경사항을 커밋하거나 삭제한 후 다시 시도하세요."
        return 1
    fi

    echo ""
    echo "삭제 대상: $wtname ($wtbranch)"
    read -p "정말 삭제하시겠습니까? (y/n): " confirm

    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo "취소됨"
        return 1
    fi

    # Docker worktree 안전장치: 삭제 대상이 활성 Docker 워크트리면 초기화
    local state_file="$DEV_TOOLS_DIR/.worktree-active"
    if [ -f "$state_file" ]; then
        local active_dw=$(cat "$state_file")
        if [ "$active_dw" = "$wtname" ]; then
            echo "⚠️  삭제 대상이 활성 Docker 워크트리입니다. 상태를 초기화합니다."
            echo "project-maker" > "$state_file"
            unset PM_PROJECT_ROOT
        fi
    fi

    git worktree remove "$wtpath"
    echo "✅ 삭제 완료: $wtname"
    echo ""
    wt
}

# ============================================================
# Claude Code 세션 명령어
# ============================================================

# cc: Claude Code 세션 시작/접속
cc() {
    local target="$1"
    local session_name=""
    local work_dir=""

    # 인자 없으면 현재 디렉토리
    if [ -z "$target" ]; then
        work_dir="$(pwd)"
        session_name="$(basename "$work_dir")"
    # 숫자만 입력하면 pm-{숫자}로 해석
    elif [[ "$target" =~ ^[0-9]+$ ]]; then
        work_dir=$(find "$AX_DIR" -maxdepth 1 -type d -name "pm-$target*" 2>/dev/null | head -1)
        if [ -z "$work_dir" ]; then
            echo "❌ pm-$target* 디렉토리를 찾을 수 없습니다"
            return 1
        fi
        session_name="$(basename "$work_dir")"
    # main 또는 m이면 메인 프로젝트
    elif [ "$target" = "main" ] || [ "$target" = "m" ]; then
        session_name="$(basename "$MAIN_PROJECT")"
        work_dir="$MAIN_PROJECT"
    # 그 외는 그대로 사용
    else
        session_name="$target"
        if [ -d "$AX_DIR/$target" ]; then
            work_dir="$AX_DIR/$target"
        elif [ -d "$target" ]; then
            work_dir="$target"
            session_name="$(basename "$work_dir")"
        else
            echo "❌ 디렉토리를 찾을 수 없습니다: $target"
            return 1
        fi
    fi

    echo "📂 $work_dir"
    echo "🖥️  세션: $session_name"

    # 세션이 없으면 생성
    if ! tmux has-session -t "$session_name" 2>/dev/null; then
        echo "✨ 새 세션 생성 중..."
        tmux new-session -d -s "$session_name" -c "$work_dir"
        tmux send-keys -t "$session_name" "claude" Enter
    fi

    # attach 또는 switch
    if [ -z "$TMUX" ]; then
        tmux attach-session -t "$session_name"
    else
        tmux switch-client -t "$session_name"
    fi
}

# ccs: Claude Code 세션 상태 보기
ccs() {
    echo ""
    echo "╔═══════════════════════════════════════════════════════════════════╗"
    echo "║  Claude Code Sessions                                             ║"
    echo "╠═══════════════════════════════════════════════════════════════════╣"

    local worktrees=$(git -C "$MAIN_PROJECT" worktree list 2>/dev/null)

    while IFS= read -r line; do
        local dir=$(echo "$line" | awk '{print $1}')
        local branch=$(echo "$line" | awk '{print $3}' | tr -d '[]')
        local name=$(basename "$dir")
        local status="○"
        local status_text="stopped"

        if tmux has-session -t "$name" 2>/dev/null; then
            status="●"
            status_text="running"
        fi

        printf "║  %s %-18s %-20s [%-7s]       ║\n" "$status" "$name" "$branch" "$status_text"
    done <<< "$worktrees"

    echo "╚═══════════════════════════════════════════════════════════════════╝"
    echo ""
}

# cca: 모든 Worktree 세션 생성
cca() {
    echo "🚀 모든 worktree를 세션으로 생성 중..."

    git -C "$MAIN_PROJECT" worktree list 2>/dev/null | while read -r line; do
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
    echo "완료! ccs로 상태 확인"
}

# ============================================================
# Docker Worktree 전환
# ============================================================

# dw: Docker 볼륨 마운트를 다른 워크트리로 전환 + reboot
dw() {
    local target="$1"

    # 인자 없으면 현재 상태 표시
    if [ -z "$target" ]; then
        local state_file="$DEV_TOOLS_DIR/.worktree-active"
        if [ -f "$state_file" ]; then
            local active=$(cat "$state_file")
            if [ -n "$active" ] && [ "$active" != "project-maker" ]; then
                echo "🐳 Docker worktree: $active ($AX_DIR/$active)"
                echo "   PM_PROJECT_ROOT=$PM_PROJECT_ROOT"
            else
                echo "🐳 Docker worktree: project-maker (기본)"
            fi
        else
            echo "🐳 Docker worktree: project-maker (기본)"
        fi
        return
    fi

    local wt_name=""
    local wt_path=""

    # 숫자만 입력하면 pm-{숫자}로 해석 (cc와 동일 패턴)
    if [[ "$target" =~ ^[0-9]+$ ]]; then
        wt_path=$(find "$AX_DIR" -maxdepth 1 -type d -name "pm-$target*" 2>/dev/null | head -1)
        if [ -z "$wt_path" ]; then
            echo "❌ pm-$target* 디렉토리를 찾을 수 없습니다"
            return 1
        fi
        wt_name=$(basename "$wt_path")
    # main 또는 m이면 기본값 복원
    elif [ "$target" = "main" ] || [ "$target" = "m" ]; then
        wt_name="project-maker"
        wt_path="$MAIN_PROJECT"
    else
        echo "❌ 사용법: dw [숫자|main|m]"
        echo "   dw 583  → pm-583 워크트리로 전환"
        echo "   dw main → 기본 project-maker로 복원"
        echo "   dw      → 현재 상태 표시"
        return 1
    fi

    # 검증: apps/api/src 존재 확인
    if [ ! -d "$wt_path/apps/api/src" ]; then
        echo "❌ $wt_path/apps/api/src 가 존재하지 않습니다"
        return 1
    fi

    # 상태 파일 저장
    echo "$wt_name" > "$DEV_TOOLS_DIR/.worktree-active"

    # PM_PROJECT_ROOT 설정
    if [ "$wt_name" = "project-maker" ]; then
        unset PM_PROJECT_ROOT
        echo "🐳 Docker worktree → project-maker (기본)"
    else
        export PM_PROJECT_ROOT="$wt_path"
        echo "🐳 Docker worktree → $wt_name ($wt_path)"
    fi

    # Reboot
    _dw_reboot "$wt_path"
}

_dw_reboot() {
    local wt_path="$1"
    local prev_dir="$(pwd)"
    cd "$MAIN_PROJECT"

    # 타겟 워크트리의 alembic head revision 파싱
    local target_versions_dir="$wt_path/apps/api/alembic/versions"
    local target_head=""
    if [ -d "$target_versions_dir" ]; then
        target_head=$(grep -h '^revision = ' "$target_versions_dir"/*.py 2>/dev/null \
            | sed 's/revision = "//;s/"//' | sort -t_ -k1 -n | tail -1)
    fi

    # 현재 컨테이너에서 타겟 revision까지 downgrade
    if [ -n "$target_head" ]; then
        echo "⏳ Alembic downgrade → $target_head ..."
        if ! docker compose -f docker/docker-compose.dev.yml exec backend uv run alembic downgrade "$target_head"; then
            echo "⚠️  Alembic downgrade 실패. 수동 확인 필요."
        fi
    fi

    echo "⏳ Docker down..."
    docker compose -f docker/docker-compose.dev.yml down --remove-orphans

    echo "⏳ init-dev.sh..."
    bash scripts/init-dev.sh

    echo "⏳ Docker build + up (with workers)..."
    docker compose -f docker/docker-compose.dev.yml --profile workers up -d --build

    echo "⏳ Alembic upgrade head..."
    if ! docker compose -f docker/docker-compose.dev.yml exec backend uv run alembic upgrade head; then
        echo "⚠️  Alembic 마이그레이션 실패 (워크트리 간 버전 차이 가능). 수동 확인 필요."
    fi

    # 기존 Vite dev server 종료
    local vite_pid=$(lsof -ti:20173 2>/dev/null)
    if [ -n "$vite_pid" ]; then
        echo "⏳ 기존 Vite dev server 종료 (PID: $vite_pid)..."
        kill $vite_pid 2>/dev/null
        sleep 1
    fi

    # 워크트리에서 pnpm install + api-client 빌드 + Vite dev server 시작
    cd "$wt_path"
    if [ ! -d "node_modules" ] || [ "pnpm-lock.yaml" -nt "node_modules" ]; then
        echo "⏳ pnpm install ($wt_path)..."
        pnpm install
    fi
    if [ ! -d "packages/api-client/dist" ]; then
        echo "⏳ api-client 빌드..."
        pnpm -C packages/api-client run build
    fi
    echo "⏳ Vite dev server 시작 ($wt_path)..."
    nohup pnpm run dev:web > /tmp/dw-vite.log 2>&1 &
    echo "   PID: $!, 로그: /tmp/dw-vite.log"

    echo ""
    echo "✅ Docker worktree switched + reboot complete (backend + frontend)"
    cd "$prev_dir"
}

# ============================================================
# Aliases
# ============================================================

# Worktree
alias gw='git -C "$MAIN_PROJECT" worktree list'

# tmux
alias tl='tmux list-sessions 2>/dev/null || echo "세션 없음"'
alias tk='tmux kill-session -t'
alias tka='tmux kill-server 2>/dev/null && echo "모든 세션 종료됨"'
alias td='tmux detach'

# Claude Code 단축
alias cc0='cc "$(basename "$MAIN_PROJECT")"'
alias ccm='cc "$(basename "$MAIN_PROJECT")"'

# Git 테스트
alias gtest='cd "$MAIN_PROJECT" && git merge --no-commit --no-ff'
alias greset='cd "$MAIN_PROJECT" && git merge --abort 2>/dev/null; git reset --hard HEAD; git clean -fd'

# ============================================================
echo "✅ AX 개발 명령어 로드됨 (wt, wa, wr, dw, cc, ccs, cca, gw, tl, tk, tka, td, gtest, greset)"
