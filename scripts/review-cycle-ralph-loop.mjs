#!/usr/bin/env node
// /review-cycle: ralph-loop 플러그인의 setup 스크립트를 찾아 호출한다.
// (setup-ralph-loop.sh 는 ralph-loop 플러그인 소유의 bash 스크립트라 Windows 에서는 Git Bash 가 필요하다.)
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args.includes("--once")) process.exit(0);

const max = process.env.REVIEW_CYCLE_MAX_ITERATIONS ?? "15";
if (!/^\d+$/.test(max)) { console.error("ERROR: REVIEW_CYCLE_MAX_ITERATIONS must be a non-negative integer."); process.exit(1); }

const home = homedir();
const candidates = [
  process.env.CLAUDE_PLUGIN_ROOT && join(process.env.CLAUDE_PLUGIN_ROOT, "scripts", "setup-ralph-loop.sh"),
  join(home, ".claude", "plugins", "marketplaces", "claude-plugins-official", "plugins", "ralph-loop", "scripts", "setup-ralph-loop.sh"),
  join(home, ".claude", "plugins", "ralph-loop", "scripts", "setup-ralph-loop.sh"),
  join(home, "plugins", "ralph-loop", "scripts", "setup-ralph-loop.sh"),
].filter(Boolean);
const setup = candidates.find((c) => existsSync(c));
if (!setup) {
  console.error("ERROR: Ralph Loop setup script was not found.\n\nInstall or enable the ralph-loop plugin, then run /review-cycle again.");
  process.exit(1);
}
const r = spawnSync("bash", [setup, "/review-cycle", ...args, "--once", "--completion-promise", "REVIEW COMPLETE", "--max-iterations", max], { stdio: "inherit", windowsHide: true });
if (r.error) { console.error("ERROR: bash 를 실행할 수 없습니다 (Windows 는 Git for Windows 설치 필요): " + r.error.message); process.exit(1); }
process.exit(r.status ?? 1);
