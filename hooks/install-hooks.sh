#!/bin/bash

# Claude Code 개발 플로우 - Git Hooks 설치 스크립트
# 프로젝트 루트에서 실행하세요.

# 색상 정의
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==================================="
echo "Claude Code Git Hooks 설치"
echo "==================================="
echo ""

# Git 저장소 확인
if [ ! -d ".git" ]; then
    echo -e "${RED}오류: Git 저장소가 아닙니다.${NC}"
    echo "프로젝트 루트에서 실행하세요."
    exit 1
fi

# hooks 디렉토리 확인
mkdir -p .git/hooks

# pre-commit hook 설치
HOOK_FILE=".git/hooks/pre-commit"

if [ -f "$HOOK_FILE" ]; then
    echo -e "${YELLOW}기존 pre-commit hook 발견${NC}"
    read -p "덮어쓸까요? (y/N) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "설치 취소됨"
        exit 0
    fi
fi

# Hook 복사
cp "$SCRIPT_DIR/pre-commit" "$HOOK_FILE"
chmod +x "$HOOK_FILE"

echo -e "${GREEN}✓ pre-commit hook 설치 완료${NC}"
echo ""

# tmp 디렉토리 생성
if [ ! -d "tmp" ]; then
    mkdir -p tmp
    echo -e "${GREEN}✓ tmp 디렉토리 생성${NC}"
fi

# .gitignore에 tmp 추가
if [ -f ".gitignore" ]; then
    if ! grep -q "^tmp/$" .gitignore 2>/dev/null; then
        echo "tmp/" >> .gitignore
        echo -e "${GREEN}✓ .gitignore에 tmp/ 추가${NC}"
    fi
else
    echo "tmp/" > .gitignore
    echo -e "${GREEN}✓ .gitignore 생성 (tmp/ 포함)${NC}"
fi

echo ""
echo "==================================="
echo -e "${GREEN}설치 완료!${NC}"
echo "==================================="
echo ""
echo "사용 방법:"
echo "  1. /commit-and-verify로 검증 후 커밋"
echo "  2. 검증 없이 커밋: git commit --no-verify"
echo ""
