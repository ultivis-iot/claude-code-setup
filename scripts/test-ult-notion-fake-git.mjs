#!/usr/bin/env node
// 테스트용 git 래퍼 (ULT_GIT_BIN). fetch 만 로컬 bare 저장소($FAKE_GIT_BARE)로 우회한다.
// remote url 은 github 그대로 두어 slug 판별이 실제와 같게 한다. 나머지는 진짜 git 으로 그대로 넘긴다.
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const bare = process.env.FAKE_GIT_BARE;
const full = bare && args.includes("fetch")
  ? ["-c", `url.${bare}.insteadOf=https://github.com/ultivis/demo.git`, ...args]
  : args;
const r = spawnSync("git", full, { stdio: "inherit", windowsHide: true });
process.exit(r.status === null ? 1 : r.status);
