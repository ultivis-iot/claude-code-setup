#!/usr/bin/env node
// settings.json 에 Plan accept hook 을 설치하고, 예전 bash hook 경로를 Node hook 으로 옮긴다 (jq 불필요).
//
//   node install-settings.mjs <settings.json> <hook-command>
//     예) node install-settings.mjs ~/.claude/settings.json 'node ~/.claude/hooks/copy-plan-on-accept.mjs'
//
//   - 파일이 없으면 enabledPlugins + hooks 를 가진 새 파일을 만든다.
//   - "hooks" 가 없으면 PostToolUse(ExitPlanMode) hook 만 추가한다. 다른 설정은 건드리지 않는다.
//   - "hooks" 가 있으면 copy-plan-on-accept.sh 를 가리키는 command 만 <hook-command> 로 바꾼다.
//     그 밖의 사용자 hook 과 이미 새 command 인 항목은 그대로 둔다.
//   - JSON 이 깨져 있으면 파일을 그대로 두고 경고만 낸다 (종료 코드 0, 설치를 막지 않는다).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const [file, command] = process.argv.slice(2);
if (!file || !command) {
  console.error("사용법: install-settings.mjs <settings.json> <hook-command>");
  process.exit(2);
}

const OLD_HOOK = /copy-plan-on-accept\.sh/;
const entry = () => ({ matcher: "ExitPlanMode", hooks: [{ type: "command", command, timeout: 10 }] });
const write = (obj) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
};

if (!existsSync(file)) {
  write({ enabledPlugins: { "security-guidance@claude-plugins-official": true }, hooks: { PostToolUse: [entry()] } });
  console.log("created");
  process.exit(0);
}

let settings;
try {
  settings = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("최상위 값이 객체가 아닙니다");
} catch (e) {
  console.error(`warning: ${file} 을 JSON 으로 읽지 못해 건드리지 않습니다 (${e.message})`);
  console.log("unchanged-invalid");
  process.exit(0);
}

if (!("hooks" in settings)) {
  settings.hooks = { PostToolUse: [entry()] };
  write(settings);
  console.log("added");
  process.exit(0);
}

let migrated = 0;
const walk = (node) => {
  if (Array.isArray(node)) return node.forEach(walk);
  if (!node || typeof node !== "object") return;
  if (typeof node.command === "string" && OLD_HOOK.test(node.command)) { node.command = command; migrated++; }
  for (const v of Object.values(node)) walk(v);
};
walk(settings.hooks);
if (migrated) { write(settings); console.log(`migrated:${migrated}`); } else console.log("unchanged");
