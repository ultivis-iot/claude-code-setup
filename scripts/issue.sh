#!/bin/bash
# 현재 브랜치의 GitHub 이슈 정보 조회

set -e

# 현재 브랜치에서 이슈 번호 추출
BRANCH=$(git branch --show-current)
ISSUE_NUM=$(echo "$BRANCH" | grep -oE '^[0-9]+' || echo "")

if [ -z "$ISSUE_NUM" ]; then
    # pm-549-xxx 형태도 지원
    ISSUE_NUM=$(echo "$BRANCH" | grep -oE 'pm-([0-9]+)' | grep -oE '[0-9]+' || echo "")
fi

if [ -z "$ISSUE_NUM" ]; then
    echo "브랜치 이름에서 이슈 번호를 찾을 수 없습니다: $BRANCH"
    exit 1
fi

echo "브랜치: $BRANCH"
echo "이슈 번호: #$ISSUE_NUM"
echo ""

# GitHub 이슈 정보 조회
gh issue view "$ISSUE_NUM" --json title,body,state,labels,comments,assignees,createdAt,author
