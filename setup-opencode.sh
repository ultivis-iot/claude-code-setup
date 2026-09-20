#!/usr/bin/env bash
#
# 사내 OpenCode 배포 스크립트 (단일 파일)
#   vanilla OpenCode + 사내 vLLM(Qwen3.8-27B) 엔드포인트 설정
#
#   신규 설치 :  bash setup-opencode.sh
#   설정만 갱신:  bash setup-opencode.sh --config-only   (이미 설치한 사람용)
#
#   환경변수:
#     ULTIVIS_ENDPOINT   (필수) 사내 vLLM 엔드포인트 URL
#     OPENCODE_VERSION   (선택) 고정할 버전 (기본 1.18.31) / "latest" 로 최신 추적
#     SKIP_SMOKE=1       (선택) 스모크 테스트 건너뛰기
#
set -euo pipefail

VERSION_PIN="${OPENCODE_VERSION:-1.18.31}"
ENDPOINT="${ULTIVIS_ENDPOINT:?ULTIVIS_ENDPOINT 환경변수가 필요합니다. (예: export ULTIVIS_ENDPOINT=http://<사내 vLLM 주소>:8000/v1)}"
MODEL_ID="ultivis-vl"
CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
CONF="$CONF_DIR/opencode.json"
CONFIG_ONLY=0

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m경고:\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m오류:\033[0m %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)    sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --config-only) CONFIG_ONLY=1; shift ;;
    *) die "알 수 없는 옵션: $1  (--help 참고)" ;;
  esac
done

command -v curl >/dev/null 2>&1 || die "curl 이 필요합니다."
case "$(uname -s)" in
  Linux|Darwin) : ;;
  *) die "Linux/macOS 전용입니다. Windows 는 https://opencode.ai/install 참고" ;;
esac

# ── 1) 설치 / 버전 정렬 ─────────────────────────────────────────
if [ "$CONFIG_ONLY" = "1" ]; then
  command -v opencode >/dev/null 2>&1 || die "--config-only 인데 opencode 가 없습니다. 옵션 없이 실행하세요."
  FINAL="$(opencode --version 2>/dev/null | tr -d '[:space:]')"
  say "설정만 갱신 모드 (설치/업그레이드 건너뜀, 현재 v${FINAL})"
else
  if command -v opencode >/dev/null 2>&1; then
    CURRENT="$(opencode --version 2>/dev/null | tr -d '[:space:]')"
    say "기존 설치 감지: v${CURRENT}"
  else
    say "OpenCode 설치 중..."
    curl -fsSL https://opencode.ai/install | bash || die "설치 실패. 네트워크를 확인하세요."
    export PATH="$HOME/.opencode/bin:$PATH"
    command -v opencode >/dev/null 2>&1 \
      || die "설치 후에도 opencode 를 찾을 수 없습니다. PATH 에 \$HOME/.opencode/bin 을 추가하세요."
    CURRENT="$(opencode --version 2>/dev/null | tr -d '[:space:]')"
    say "설치 완료: v${CURRENT}"
  fi
  if [ "$VERSION_PIN" = "latest" ]; then
    say "최신 버전으로 업그레이드 중..."
    opencode upgrade >/dev/null 2>&1 || die "업그레이드 실패"
  elif [ "$CURRENT" != "$VERSION_PIN" ]; then
    say "버전 정렬: v${CURRENT} -> v${VERSION_PIN}"
    opencode upgrade "$VERSION_PIN" >/dev/null 2>&1 || die "v${VERSION_PIN} 업그레이드 실패"
  fi
  FINAL="$(opencode --version 2>/dev/null | tr -d '[:space:]')"
  [ "$VERSION_PIN" = "latest" ] || [ "$FINAL" = "$VERSION_PIN" ] \
    || die "버전 불일치: 기대 v${VERSION_PIN}, 실제 v${FINAL}"
  say "OpenCode 버전 확정: v${FINAL}"
fi

# ── 2) 엔드포인트 확인 (설정을 건드리기 전에) ───────────────────
say "엔드포인트 확인: ${ENDPOINT}"
HTTP="$(curl -s -o /dev/null -w '%{http_code}' -m 15 \
  -X POST "${ENDPOINT}/chat/completions" \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"${MODEL_ID}\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"max_tokens\":4}" \
  2>/dev/null)" || HTTP="000"
case "$HTTP" in
  200) say "엔드포인트 정상 (HTTP 200)" ;;
  000) die "엔드포인트에 연결할 수 없습니다. 사내망/VPN 을 확인하세요. (${ENDPOINT})" ;;
  401|403) die "엔드포인트 인증 거부 (HTTP ${HTTP}). ULTIVIS_API_KEY 발급 여부를 확인하세요." ;;
  *) die "엔드포인트 비정상 응답 (HTTP ${HTTP}). 서버 담당자에게 문의하세요." ;;
esac

# ── 3) 기존 설정 백업 ───────────────────────────────────────────
mkdir -p "$CONF_DIR"
if [ -f "$CONF" ]; then
  BACKUP="${CONF}.bak.$(date +%Y%m%d-%H%M%S)"
  cp "$CONF" "$BACKUP"; say "기존 설정 백업: ${BACKUP}"
fi
for f in "$CONF_DIR/package.json" "$CONF_DIR/bun.lock"; do
  [ -f "$f" ] && { mv "$f" "${f}.disabled" 2>/dev/null || true; \
                   warn "플러그인 잔재 비활성화: $(basename "$f")"; }
done

# ── 4) 설정 작성 ────────────────────────────────────────────────
#  주의: options 안의 키는 OpenCode 가 이름을 바꾸지 않고 그대로 전송합니다.
#        reasoningEffort 만 reasoning_effort 로 변환됩니다.
#        따라서 나머지는 반드시 snake_case 로 적어야 vLLM 에 적용됩니다.
cat > "$CONF" <<'JSON'
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "ultivis": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ultivis vLLM (Qwen3.8-27B)",
      "options": {
        "baseURL": "__ENDPOINT__",
        "apiKey": "{env:ULTIVIS_API_KEY}"
      },
      "models": {
        "ultivis-vl": {
          "name": "Qwen3.8 27B [사내·안전]",
          "attachment": true,
          "tool_call": true,
          "reasoning": true,
          "limit": { "context": 262144, "output": 32768 },
          "modalities": { "input": ["text", "image"], "output": ["text"] },
          "options": {
            "reasoningEffort": "xhigh",
            "chat_template_kwargs": { "enable_thinking": true },
            "temperature": 1.0,
            "top_p": 0.95,
            "top_k": 20,
            "presence_penalty": 0.0,
            "max_tokens": 64000
          }
        }
      }
    },
    "opencode": {
      "models": {
        "muse-spark-1.3-contributor-free": { "name": "Muse Spark 1.3 [외부] 사내코드 금지" },
        "muse-spark-1.2-contributor-free": { "name": "Muse Spark 1.2 [외부] 사내코드 금지" },
        "big-pickle":                      { "name": "Big Pickle [외부] 사내코드 금지" },
        "nemotron-3-ultra-free":           { "name": "Nemotron 3 Ultra [외부] 사내코드 금지" },
        "nemotron-3.5-lightning-free":     { "name": "Nemotron 3.5 Lightning [외부] 사내코드 금지" },
        "mimo-v2.5-free":                  { "name": "MiMo V2.5 [외부] 사내코드 금지" },
        "ling-3.0-flash-fin-free":         { "name": "Ling 3.0 Fin [외부] 사내코드 금지" }
      }
    }
  },
  "model": "ultivis/ultivis-vl"
}
JSON

if sed --version >/dev/null 2>&1; then sed -i "s|__ENDPOINT__|${ENDPOINT}|" "$CONF"
else sed -i '' "s|__ENDPOINT__|${ENDPOINT}|" "$CONF"; fi
grep -q '__ENDPOINT__' "$CONF" && die "엔드포인트 치환 실패"
say "설정 작성: ${CONF}"

# ── 5) 스모크 테스트 ────────────────────────────────────────────
if [ "${SKIP_SMOKE:-0}" = "1" ]; then
  warn "스모크 테스트 건너뜀 (SKIP_SMOKE=1)"
else
  say "스모크 테스트 중... (약 10-20초)"
  TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
  printf 'def add(a, b):\n    return a - b\n' > "$TMPD/m.py"
  ( cd "$TMPD" && opencode run --pure \
      "Fix add() in m.py: it subtracts instead of adds. Edit the file." \
      </dev/null >/dev/null 2>&1 ) || true
  grep -q 'a + b' "$TMPD/m.py" 2>/dev/null \
    && say "스모크 테스트 통과" \
    || die "스모크 테스트 실패. 수동 확인: opencode run --pure \"hello\" < /dev/null"
fi

cat <<EOF

────────────────────────────────────────────────────────
 완료
────────────────────────────────────────────────────────
 버전      : v${FINAL}
 엔드포인트: ${ENDPOINT}
 기본 모델 : Qwen3.8 27B (사내 서버)
 thinking  : ON (reasoning_effort=xhigh)

 사용법:  cd ~/your-project && opencode

 주의: 모델 목록의 [외부] 표시 모델은 사내 코드를 외부로
       전송하고 학습에 사용합니다. 선택하지 마세요.
────────────────────────────────────────────────────────
EOF
