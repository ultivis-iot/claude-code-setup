#!/bin/bash
# Worktree 생성 (또는 이미 있으면 경로만 반환)
#
# Usage:
#   ult-wt-add.sh <branch> [-r <repo_path>] [--base <base_branch>]
#
# Options:
#   -r, --repo   대상 repo 경로 (기본: 현재 디렉토리의 git repo)
#   --base       새 브랜치 생성 시 기반 브랜치 (기본: origin의 default branch)
#   --quiet      진행 메시지 생략 (경로만 출력)
#
# Output:
#   worktree 절대 경로 (stdout)
#   진행 메시지는 stderr

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/workflow-env.sh"

BRANCH=""
REPO_PATH=""
BASE_BRANCH=""
QUIET=false

while [ $# -gt 0 ]; do
    case "$1" in
        -r|--repo) REPO_PATH="$2"; shift 2 ;;
        --base)    BASE_BRANCH="$2"; shift 2 ;;
        --quiet)   QUIET=true; shift ;;
        -*) echo "알 수 없는 옵션: $1" >&2; exit 1 ;;
        *)  BRANCH="$1"; shift ;;
    esac
done

[ -z "$BRANCH" ] && { echo "Usage: $0 <branch> [-r <repo>] [--base <branch>]" >&2; exit 1; }

# Repo 결정
if [ -z "$REPO_PATH" ]; then
    REPO_PATH=$(git rev-parse --show-toplevel 2>/dev/null) \
        || { echo "ERROR: git repo 아님. -r 로 repo 경로 지정" >&2; exit 1; }
fi
REPO_PATH=$(realpath "$REPO_PATH")
[ -d "$REPO_PATH/.git" ] || [ -f "$REPO_PATH/.git" ] \
    || { echo "ERROR: $REPO_PATH 는 git repo 아님" >&2; exit 1; }

# 메인 worktree 경로 (fork 방지)
MAIN_REPO=$(git -C "$REPO_PATH" worktree list | head -1 | awk '{print $1}')
REPO_NAME=$(basename "$MAIN_REPO")

# Repo abbreviation: 하이픈 세그먼트 첫 글자
# project-maker → pm, ultivis-base → ub, claude-code-setup → ccs
REPO_ABBR=$(echo "$REPO_NAME" | awk -F- '{for(i=1;i<=NF;i++) printf "%s", tolower(substr($i,1,1))}')

# WORKTREE_ROOT 로드
if [ -f "$WORKFLOW_DEV_TOOLS_DIR/.env" ]; then
    # shellcheck disable=SC1091
    . "$WORKFLOW_DEV_TOOLS_DIR/.env"
fi
[ -z "$WORKTREE_ROOT" ] && [ -n "$AX_DIR" ] && WORKTREE_ROOT="$AX_DIR"
WORKTREE_ROOT="${WORKTREE_ROOT:-$HOME/Git}"
mkdir -p "$WORKTREE_ROOT"

# Worktree 이름: <abbr>-<번호 or slug>
SUFFIX=$(echo "$BRANCH" | grep -oE '[0-9]+' | head -1)
[ -z "$SUFFIX" ] && SUFFIX=$(echo "$BRANCH" | sed 's|/|-|g' | sed 's|[^a-zA-Z0-9-]||g' | head -c 40)
WT_NAME="${REPO_ABBR}-${SUFFIX}"
WT_PATH="$WORKTREE_ROOT/$WT_NAME"

_log() { $QUIET || echo "$@" >&2; }

normalize_base_branch_name() {
    case "$1" in
        origin/*) echo "${1#origin/}" ;;
        *)        echo "$1" ;;
    esac
}

if git -C "$MAIN_REPO" remote get-url origin >/dev/null 2>&1; then
    _log "🔄 origin 최신 상태 가져오는 중..."
    git -C "$MAIN_REPO" fetch origin --prune >&2 || {
        echo "ERROR: origin fetch 실패" >&2
        exit 1
    }
fi

# 이미 존재하면 경로만 반환 (idempotent)
if [ -d "$WT_PATH" ]; then
    _log "ℹ️  이미 존재: $WT_PATH"
    if [ -n "$BASE_BRANCH" ]; then
        git -C "$WT_PATH" config "branch.$BRANCH.gh-merge-base" "$(normalize_base_branch_name "$BASE_BRANCH")" 2>/dev/null || true
    fi
    echo "$WT_PATH"
    exit 0
fi

# Base 브랜치 결정
if [ -z "$BASE_BRANCH" ]; then
    BASE_BRANCH=$(git -C "$MAIN_REPO" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
    [ -z "$BASE_BRANCH" ] && BASE_BRANCH="main"
fi
BASE_BRANCH=$(normalize_base_branch_name "$BASE_BRANCH")
BASE_REF="$BASE_BRANCH"
if git -C "$MAIN_REPO" show-ref --verify --quiet "refs/remotes/origin/$BASE_BRANCH" 2>/dev/null; then
    BASE_REF="origin/$BASE_BRANCH"
fi

# Worktree 생성
if git -C "$MAIN_REPO" show-ref --verify --quiet "refs/remotes/origin/$BRANCH" 2>/dev/null; then
    _log "📂 원격 브랜치 $BRANCH 기반으로 worktree 생성..."
    git -C "$MAIN_REPO" worktree add "$WT_PATH" "origin/$BRANCH" >&2
    # 로컬 브랜치 생성/체크아웃
    git -C "$WT_PATH" checkout -B "$BRANCH" "origin/$BRANCH" >/dev/null 2>&1 || true
else
    _log "📂 새 브랜치 $BRANCH 생성 ($BASE_BRANCH 기반) + worktree..."
    git -C "$MAIN_REPO" worktree add -b "$BRANCH" "$WT_PATH" "$BASE_REF" >&2
fi

git -C "$WT_PATH" config "branch.$BRANCH.gh-merge-base" "$BASE_BRANCH" 2>/dev/null || true

_log "✓ Worktree: $WT_PATH"
echo "$WT_PATH"
