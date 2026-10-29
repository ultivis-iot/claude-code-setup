#!/bin/bash

# Kiro 스킬 설치 스크립트
# codex/skills/ 의 정본 스킬을 Kiro user-level 스킬 경로(~/.kiro/skills)로 배포한다.
# 사용법: ./setup-kiro.sh [--update|-u]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIRO_DIR="${KIRO_HOME:-$HOME/.kiro}"
SKILLS_SOURCE="$SCRIPT_DIR/codex/skills"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

UPDATE_MODE=false
if [ "$1" = "--update" ] || [ "$1" = "-u" ]; then
    UPDATE_MODE=true
fi

echo "==================================="
if [ "$UPDATE_MODE" = true ]; then
    echo "Kiro 스킬 업데이트"
else
    echo "Kiro 스킬 설치"
fi
echo "==================================="
echo ""

echo "1. 디렉토리 생성..."
mkdir -p "$KIRO_DIR/skills"

echo "2. Skill 설치..."
INSTALLED=0
for skill_dir in "$SKILLS_SOURCE"/*/; do
    if [ -d "$skill_dir" ] && [ -f "$skill_dir/SKILL.md" ]; then
        skill_name=$(basename "$skill_dir")
        rm -rf "$KIRO_DIR/skills/$skill_name"
        cp -R "$skill_dir" "$KIRO_DIR/skills/$skill_name"
        echo -e "${GREEN}   ✓ ~/.kiro/skills/$skill_name${NC}"
        INSTALLED=$((INSTALLED + 1))
    fi
done
echo -e "${GREEN}   총 $INSTALLED개 스킬 설치${NC}"
echo -e "${YELLOW}     codex/skills/ 의 정본 스킬을 그대로 복사합니다. Kiro가 쓰지 않는 agents/openai.yaml 등도 함께 복사되지만 무해합니다.${NC}"

echo ""
echo "==================================="
echo -e "${GREEN}설치 완료!${NC}"
echo "==================================="
echo ""
echo "설치된 파일:"
echo "  ~/.kiro/skills/*/SKILL.md"
echo ""
echo "사용 방법:"
echo "  1. 새 Kiro 세션을 시작하면 ~/.kiro/skills 의 스킬이 자동으로 discover됩니다."
echo "  2. 요청 내용이 스킬 description과 맞으면 자동 활성화되고, 슬래시로 직접 호출할 수도 있습니다."
echo "  3. 워크스페이스 전용으로 덮어쓰려면 해당 저장소의 .kiro/skills/ 에 같은 이름으로 두세요."
