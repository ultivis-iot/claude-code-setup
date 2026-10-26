#!/usr/bin/env node
// UserPromptSubmit: 리뷰·탐색처럼 보이는 요청이고 위임 설정이 되어 있으면, ultivis-delegate 스킬을 쓰라는
// 한 줄을 모델 컨텍스트에 붙인다. 스킬 설명만으로는 메인 모델이 직접 읽는 쪽을 골랐다(실측: 같은 리뷰를
// 직접 처리해 Claude 토큰 111만). 해당하지 않는 요청에는 아무것도 붙이지 않는다.
import { readFileSync, writeSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readPiModel, which } from "../skills/ultivis-delegate/scripts/delegate.mjs";

// 결함 찾기·코드 흐름 파악 요청.
const REVIEW_OR_EXPLORE = /리뷰|검토|버그|결함|취약|경합|멱등|재시도|어디서\s*(쓰|호출|사용|참조)|호출\s*(흐름|경로)|흐름을?\s*(파악|정리|설명|추적)|구조를?\s*(파악|정리|설명|요약)|추적해|\breview\b|\baudit\b|\bbugs?\b|race condition|where (is|are) .+ used|how does .+ (work|flow)/i;
// 사용자가 직접 하라고 했거나 구현을 요청하면 붙이지 않는다 — 구현 위임은 Claude 토큰을 늘렸다. 리뷰가 "수정 방향"
// "fix sketch" 를 함께 달라는 것은 구현 요청이 아니므로 요청형 동사만 본다.
const OPT_OUT_OR_IMPLEMENT = /직접\s*(해|봐|확인|처리)|위임\s*(하지|말)|(구현|수정|추가|변경)\s*해\s*(줘|주)|(만들어|고쳐|바꿔)\s*(줘|주)|\bimplement\b|\bfix (it|this|that|the)\b|do it yourself/i;

export const NUDGE = "[ultivis-delegate] 이 요청은 사내 모델 위임 대상(리뷰·탐색)으로 분류됐습니다. 파일을 읽기 전에 Skill 도구로 " +
  "`ultivis-delegate:ultivis-delegate` 를 호출하고 그 절차를 따르세요. 직접 읽으면 Claude 토큰을 약 3배 씁니다(같은 리뷰 실측 82만 대 27만). " +
  "위임하지 않는 경우는 둘뿐입니다: 파일 하나에서 바로 답이 나오는 짧은 질문, 또는 사용자가 직접 하라고 한 경우.";

// 이 훅은 사람이 친 프롬프트 말고도 백그라운드 서브에이전트의 보고·작업 알림·다른 세션 메시지에도 불린다.
// 위임 결과 보고에는 "리뷰" 같은 말이 들어 있어, 거기에 붙이면 같은 일을 다시 위임하게 된다.
const NOT_TYPED_BY_USER = /<task-notification>|hand-back|\[SYSTEM NOTIFICATION|<agent-message|\[ultivis-delegate\]/i;

export function shouldNudge(prompt) {
  if (typeof prompt !== "string" || prompt.trim().length < 8) return false;
  if (prompt.trim().startsWith("/")) return false; // 슬래시 명령은 사용자가 이미 고른 길
  if (NOT_TYPED_BY_USER.test(prompt)) return false;
  return REVIEW_OR_EXPLORE.test(prompt) && !OPT_OUT_OR_IMPLEMENT.test(prompt);
}

function ready() {
  return Boolean(which("pi")) && !readPiModel().error;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let input = {};
  try { input = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }
  if (shouldNudge(input.prompt) && ready()) {
    // 파이프로 연결된 stdout 에 대한 process.stdout.write 는 비동기라, 곧바로 끝나면 출력이 사라질 수 있다
    // (실측: Claude Code 가 빈 출력을 받았다). 동기 쓰기로 다 내보낸 뒤 자연스럽게 끝낸다.
    writeSync(1, JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: NUDGE } }));
  }
}
