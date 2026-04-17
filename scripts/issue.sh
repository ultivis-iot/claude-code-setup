#!/bin/bash
# 현재 브랜치의 GitHub 이슈 정보 조회

set -e

BRANCH=$(git branch --show-current)
ISSUE_NUM=""

# 패턴 1: <topic>/<num>-... (예: feature/234-add-toggle)
if [ -z "$ISSUE_NUM" ]; then
    ISSUE_NUM=$(echo "$BRANCH" | grep -oE '^[a-zA-Z]+/([0-9]+)' | grep -oE '[0-9]+' || echo "")
fi

# 패턴 2: pm-NNN-... (예: pm-549-fix-bug)
if [ -z "$ISSUE_NUM" ]; then
    ISSUE_NUM=$(echo "$BRANCH" | grep -oE 'pm-([0-9]+)' | grep -oE '[0-9]+' || echo "")
fi

# 패턴 3: 숫자로 시작 (예: 234-add-toggle)
if [ -z "$ISSUE_NUM" ]; then
    ISSUE_NUM=$(echo "$BRANCH" | grep -oE '^[0-9]+' || echo "")
fi

if [ -z "$ISSUE_NUM" ]; then
    echo "브랜치 이름에서 이슈 번호를 찾을 수 없습니다: $BRANCH"
    exit 1
fi

echo "브랜치: $BRANCH"
echo "이슈 번호: #$ISSUE_NUM"
echo ""

gh issue view "$ISSUE_NUM" --json title,body,state,labels,comments,assignees,createdAt,author,url
