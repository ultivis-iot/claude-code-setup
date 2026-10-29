#!/bin/bash

# Kiro 스킬 설치 스크립트
# codex/skills/ 의 정본 스킬을 Kiro user-level 스킬 경로(~/.kiro/skills)로 배포한다.
# 사용법: ./setup-kiro.sh [--update|-u] | --validation-on | --validation-off
#   --validation-on : Claude Code 검증 위임을 켠다. 읽기 전용 Kiro agent(claude-validator)를 설치하고
#                     스위치 ~/.claude/kiro-validation.json 을 enabled:true 로 둔다. 검증할 코드가 Kiro(AWS)로 전송된다.
#   --validation-off: 스위치를 꺼서 검증을 원래 Claude subagent 로 되돌린다.
#   기본 설치·--update 는 검증 위임을 새로 켜지 않는다. 스위치 파일이 있으면(켰다가 끈 경우 포함) Kiro agent 설정만 갱신한다.

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

SWITCH_FILE="$HOME/.claude/kiro-validation.json"
# 스위치의 enabled 만 바꾸고 다른 값(model 등)은 둔다. 파일이 깨졌으면 새로 쓴다.
set_switch() {
    mkdir -p "$(dirname "$SWITCH_FILE")"
    node -e 'const [f,on]=process.argv.slice(1),fs=require("fs");let c={};try{c=JSON.parse(fs.readFileSync(f,"utf8"))}catch{}c.enabled=on==="true";fs.writeFileSync(f,JSON.stringify(c,null,2)+"\n")' "$SWITCH_FILE" "$1"
}
install_validator_agent() {
    mkdir -p "$KIRO_DIR/agents"
    cp "$SCRIPT_DIR/templates/kiro/claude-validator.json" "$KIRO_DIR/agents/claude-validator.json"
}
if [ "$1" = "--validation-on" ]; then
    if ! command -v kiro-cli >/dev/null 2>&1; then
        echo -e "${YELLOW}kiro-cli 가 없어 켜지 않습니다. kiro-cli 를 설치하고 로그인한 뒤 다시 실행하세요.${NC}"
        exit 1
    fi
    # 실행기와 그것을 부르는 계약 단락은 setup.sh 가 설치한다. 없으면 켜도 Kiro 가 불리지 않는다.
    if [ ! -f "$HOME/.claude/scripts/kiro-validate.mjs" ] || ! grep -q "kiro-validate" "$HOME/.claude/docs/references/validation-contract.md" 2>/dev/null; then
        echo -e "${YELLOW}설치된 Claude Code 설정에 Kiro 실행기가 없어 켜지 않습니다. ./setup.sh --update 를 먼저 실행하세요.${NC}"
        exit 1
    fi
    install_validator_agent
    set_switch true
    echo -e "${GREEN}✓ Kiro 검증 위임을 켰습니다 (~/.kiro/agents/claude-validator.json, ~/.claude/kiro-validation.json)${NC}"
    echo -e "${YELLOW}  검증할 코드가 Kiro(AWS)로 전송됩니다. 허용되지 않은 저장소에서는 ./setup-kiro.sh --validation-off${NC}"
    exit 0
fi
if [ "$1" = "--validation-off" ]; then
    [ -f "$SWITCH_FILE" ] && set_switch false
    echo -e "${GREEN}✓ Kiro 검증 위임을 껐습니다. 검증은 Claude subagent 로 돕니다.${NC}"
    exit 0
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

echo "3. Claude Code 검증 위임 (선택)..."
if [ -f "$SWITCH_FILE" ] && command -v kiro-cli >/dev/null 2>&1; then
    install_validator_agent
    echo -e "${GREEN}   ✓ ~/.kiro/agents/claude-validator.json 갱신 (켜고 끄기는 스위치 그대로)${NC}"
elif [ -f "$SWITCH_FILE" ]; then
    echo -e "${YELLOW}   - kiro-cli 가 없어 건너뜁니다 (검증은 Claude subagent 로 돕니다)${NC}"
else
    echo -e "${YELLOW}   - 켜져 있지 않습니다. 켜려면 ./setup-kiro.sh --validation-on (코드가 Kiro(AWS)로 전송됨)${NC}"
fi

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
