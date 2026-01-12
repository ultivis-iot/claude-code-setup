#!/bin/bash

# Claude Code - Plan Accept 시 current-plan.md로 복사하는 Hook 스크립트
# PostToolUse hook에서 ExitPlanMode 도구 사용 시 실행됩니다.

# stdin으로 받은 JSON에서 정보 추출
INPUT=$(cat)

# 디버그 로깅 (필요시 활성화)
# echo "$INPUT" >> /tmp/hook-debug.log

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

# Claude plans 디렉토리에서 가장 최근 수정된 plan 파일 찾기
PLANS_DIR="$HOME/.claude/plans"
if [ ! -d "$PLANS_DIR" ]; then
    echo "Plans 디렉토리가 없습니다: $PLANS_DIR" >&2
    exit 0
fi

# 가장 최근 수정된 .md 파일 찾기 (최근 5분 이내)
LATEST_PLAN=$(find "$PLANS_DIR" -name "*.md" -mmin -5 -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)

if [ -z "$LATEST_PLAN" ]; then
    echo "최근 수정된 plan 파일을 찾을 수 없습니다." >&2
    exit 0
fi

# tmp 디렉토리 생성
TARGET_DIR="$CWD/tmp"
mkdir -p "$TARGET_DIR"

# Plan 파일 복사
TARGET_FILE="$TARGET_DIR/current-plan.md"
cp "$LATEST_PLAN" "$TARGET_FILE"

# 성공 메시지 (Claude에게 전달됨)
echo "{\"decision\": \"approve\", \"reason\": \"Plan이 $TARGET_FILE로 복사되었습니다.\"}"
exit 0
