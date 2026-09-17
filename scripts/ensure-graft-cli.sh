#!/bin/bash
# Check and optionally install the pinned Graft CLI.

set -uo pipefail

GRAFT_PACKAGE="${GRAFT_PACKAGE:-@nanonets/graft@0.18.0}"
GRAFT_VERSION="${GRAFT_PACKAGE##*@}"

recommend() {
    echo "[graft] 권장: Node.js 20 이상에서 'npm install -g $GRAFT_PACKAGE'를 실행하세요." >&2
    echo "[graft] 네이티브 tree-sitter 호환 오류가 나면 검증된 LTS Node 24를 사용하세요." >&2
}

if ! command -v node >/dev/null 2>&1; then
    echo "[graft] Node.js가 없어 Graft 설치를 건너뜁니다." >&2
    recommend
    exit 0
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)
if ! [[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] || [ "$NODE_MAJOR" -lt 20 ]; then
    echo "[graft] 현재 Node ${NODE_MAJOR:-unknown}; Graft는 Node.js 20 이상이 필요합니다." >&2
    recommend
    exit 0
fi

INSTALLED_VERSION=""
if command -v graft >/dev/null 2>&1; then
    INSTALLED_VERSION=$(graft --version 2>/dev/null | tail -1 | tr -d '[:space:]' || true)
fi
if [ "$INSTALLED_VERSION" = "$GRAFT_VERSION" ]; then
    echo "[graft] CLI $INSTALLED_VERSION 준비됨 (Node $(node --version))." >&2
    exit 0
fi

ACTION="설치"
[ -n "$INSTALLED_VERSION" ] && ACTION="업데이트 ($INSTALLED_VERSION → $GRAFT_VERSION)"

INSTALL=false
case "${GRAFT_INSTALL:-ask}" in
    1|yes|true|always) INSTALL=true ;;
    0|no|false|never)
        echo "[graft] CLI $ACTION 건너뜀 (GRAFT_INSTALL=${GRAFT_INSTALL})." >&2
        recommend
        exit 0
        ;;
    ask)
        if [ -t 0 ]; then
            answer=""
            read -r -p "[graft] $GRAFT_PACKAGE CLI를 $ACTION할까요? [Y/n] " answer
            case "$answer" in n|N|no|NO) INSTALL=false ;; *) INSTALL=true ;; esac
        else
            echo "[graft] 비대화형 실행이라 CLI $ACTION을 건너뜁니다." >&2
            recommend
            exit 0
        fi
        ;;
    *)
        echo "[graft] 알 수 없는 GRAFT_INSTALL 값: $GRAFT_INSTALL" >&2
        recommend
        exit 0
        ;;
esac

if [ "$INSTALL" = true ] && command -v npm >/dev/null 2>&1; then
    if npm install -g "$GRAFT_PACKAGE"; then
        STARTED_VERSION=$(graft --version 2>/dev/null | tail -1 | tr -d '[:space:]' || true)
        if [ "$STARTED_VERSION" = "$GRAFT_VERSION" ]; then
            echo "[graft] CLI $GRAFT_VERSION $ACTION 완료." >&2
            exit 0
        fi
        echo "[graft] CLI를 설치했지만 현재 Node 환경에서 시작하지 못했습니다. workflow 설치는 계속합니다." >&2
    fi
    echo "[graft] CLI $ACTION 실패. workflow 설치는 계속합니다." >&2
fi

recommend
exit 0
