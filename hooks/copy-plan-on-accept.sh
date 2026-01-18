#!/bin/bash

# Claude Code - Plan Accept 시 current-plan.md로 복사하는 Hook 스크립트
# PostToolUse hook에서 ExitPlanMode 도구 사용 시 실행됩니다.

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

# tool_input.plan에서 직접 plan 내용 추출 (가장 확실한 방법)
PLAN_CONTENT=$(echo "$INPUT" | jq -r '.tool_input.plan // ""')

if [ -z "$PLAN_CONTENT" ]; then
    echo "tool_input.plan이 비어있습니다." >&2
    exit 0
fi

# tmp 디렉토리 생성
TARGET_DIR="$CWD/tmp"
mkdir -p "$TARGET_DIR"

# Plan 내용을 파일로 저장
TARGET_FILE="$TARGET_DIR/current-plan.md"
echo "$PLAN_CONTENT" > "$TARGET_FILE"

# 성공 메시지 (Claude에게 전달됨)
echo "{\"decision\": \"approve\", \"reason\": \"Plan이 $TARGET_FILE로 저장되었습니다.\"}"
exit 0
