#!/bin/bash

# Claude Code - Plan Accept 시 current-plan.md로 복사하는 Hook 스크립트
# PostToolUse hook에서 ExitPlanMode 도구 사용 시 실행됩니다.
#
# ExitPlanMode 도구에는 plan 파라미터가 없으므로,
# ~/.claude/plans/에서 가장 최근 수정된 Plan 파일을 복사합니다.

# stdin으로 받은 JSON에서 정보 추출
INPUT=$(cat)

# 디버그 로깅 (필요시 활성화)
# echo "$(date): $INPUT" >> /tmp/hook-debug.log

# 도구 이름 확인 (ExitPlanMode가 아니면 종료)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
if [ "$TOOL_NAME" != "ExitPlanMode" ]; then
    exit 0
fi

# 현재 작업 디렉토리
CWD=$(echo "$INPUT" | jq -r '.cwd // ""')
if [ -z "$CWD" ]; then
    exit 0
fi

# ~/.claude/plans/에서 최신 Plan 파일 찾기
PLANS_DIR="$HOME/.claude/plans"
LATEST_PLAN=$(ls -t "$PLANS_DIR"/*.md 2>/dev/null | head -1)

if [ -z "$LATEST_PLAN" ] || [ ! -f "$LATEST_PLAN" ]; then
    echo '{"decision": "approve", "reason": "Plan 파일을 찾을 수 없습니다."}'
    exit 0
fi

# Plan 내용 읽기
PLAN_CONTENT=$(cat "$LATEST_PLAN")

if [ -z "$PLAN_CONTENT" ]; then
    echo '{"decision": "approve", "reason": "Plan 내용이 비어있습니다."}'
    exit 0
fi

# tmp 디렉토리 생성
TARGET_DIR="$CWD/tmp"
mkdir -p "$TARGET_DIR"

# Plan 내용을 파일로 저장
TARGET_FILE="$TARGET_DIR/current-plan.md"
echo "$PLAN_CONTENT" > "$TARGET_FILE"

# 현재 위치가 worktree인지 감지 — git worktree list 기준
WORKTREE_CONTEXT="unknown"
CURRENT_WT_ROOT=""

if command -v git >/dev/null 2>&1; then
    CURRENT_WT_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null || echo "")
    if [ -n "$CURRENT_WT_ROOT" ]; then
        local_main=$(git -C "$CWD" worktree list 2>/dev/null | head -1 | awk '{print $1}')
        if [ "$CURRENT_WT_ROOT" = "$local_main" ]; then
            WORKTREE_CONTEXT="main"
        else
            WORKTREE_CONTEXT="worktree"
        fi
    fi
fi

# 성공 메시지 (Claude에게 전달됨) — worktree 컨텍스트별 분기
if [ "$WORKTREE_CONTEXT" = "worktree" ]; then
    WT_NAME=$(basename "$CURRENT_WT_ROOT")
    REASON="Plan이 $TARGET_FILE로 저장되었습니다.

현재 위치: **worktree \`$WT_NAME\`** (이미 작업 중)
→ 새 worktree/브랜치를 만들지 마세요. 현재 브랜치에서 작업 이어갑니다.

Plan 성격에 따라 추천:

  • **현재 Task의 보완/메모** → \`/isaac-task-note '메모'\`
    → 현재 Task에 코멘트만 추가, 새 Task 안 만듦

  • **현재 Story에 관련 Task 추가** → \`/isaac-task-create --here\`
    → Task + Issue만 생성, 브랜치/worktree는 현재 것 유지

  • **작은 변경** → 발행 없이 그대로 Build 시작

현재 worktree 컨텍스트에서 완전히 새로운 Story를 시작해야 한다면, 먼저 main으로 복귀하거나 사용자에게 확인하세요."
else
    REASON="Plan이 $TARGET_FILE로 저장되었습니다.

현재 위치: **메인 프로젝트** (또는 git 외부)
→ 새 worktree/브랜치 생성 옵션 사용 가능.

Plan 성격에 따라 추천:

  • **거대한 Plan (새 사용자 가치, 여러 단계)** → \`/isaac-story-create\`
    → 새 Story + Task N개 + Github Issue N개 + 브랜치 N개 일괄 생성

  • **기존 Story의 추가 작업** → \`/isaac-task-create <story>\`
    → 기존 Story에 Task 1개 + Issue + 브랜치 추가

  • **현재 Task의 보완/메모** → \`/isaac-task-note '메모'\`
    → 현재 브랜치 Task에 코멘트 추가, 새 항목 안 만듦

  • **작은 일회성 변경** → 발행 없이 그대로 Build 시작

현재 브랜치/Task 컨텍스트 확인은 \`/issue\` 사용. 사용자가 명시적으로 거부하지 않으면 추천만 하고 사용자 선택 받기."
fi

echo "{\"decision\": \"approve\", \"reason\": $(echo "$REASON" | jq -Rs .)}"
exit 0
