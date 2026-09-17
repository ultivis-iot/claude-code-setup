#!/bin/bash
# Refresh a worktree-local Graft structural graph without an LLM.

set -uo pipefail

REPO_PATH="${1:-.}"
REASON="${2:-manual}"
GRAFT_PACKAGE="${GRAFT_PACKAGE:-@nanonets/graft@0.18.0}"

warn() {
    echo "[graft] WARNING: $*" >&2
    echo "[graft] 권장: Node.js 20 이상에서 'npm install -g $GRAFT_PACKAGE'를 실행하세요." >&2
    echo "[graft] tree-sitter 네이티브 호환 오류가 나면 LTS Node 24로 다시 시도하세요." >&2
}

REPO_ROOT=$(git -C "$REPO_PATH" rev-parse --show-toplevel 2>/dev/null) || {
    warn "Git 저장소가 아니어서 그래프 갱신을 건너뜁니다: $REPO_PATH"
    exit 0
}

if ! command -v node >/dev/null 2>&1; then
    warn "Node.js를 찾지 못해 $REPO_ROOT 그래프 갱신을 건너뜁니다."
    exit 0
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)
if ! [[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] || [ "$NODE_MAJOR" -lt 20 ]; then
    warn "현재 Node ${NODE_MAJOR:-unknown}; Node.js 20 이상이 아니어서 $REPO_ROOT 그래프 갱신을 건너뜁니다."
    exit 0
fi
if ! command -v graft >/dev/null 2>&1; then
    warn "Graft CLI가 없어 $REPO_ROOT 그래프 갱신을 건너뜁니다."
    exit 0
fi

export DO_NOT_TRACK=1
echo "[graft] 구조 그래프 갱신 중 ($REASON): $REPO_ROOT" >&2
if graft build "$REPO_ROOT" >&2; then
    echo "[graft] 구조 그래프 갱신 완료: $REPO_ROOT" >&2
    exit 0
fi

warn "Graft 빌드가 실패했습니다: $REPO_ROOT"
exit 0
