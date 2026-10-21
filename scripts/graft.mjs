#!/usr/bin/env node
// Graft 구조 그래프 도우미. 실패해도 항상 종료코드 0(워크플로우를 막지 않는다).
//   graft.mjs refresh [repo-path] [reason]   worktree 의 구조 그래프 갱신
//   graft.mjs ensure                          고정 버전 CLI 확인/설치 (GRAFT_INSTALL=ask|yes|no)
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

const PKG = process.env.GRAFT_PACKAGE || "@nanonets/graft@0.18.0";
const VERSION = PKG.slice(PKG.lastIndexOf("@") + 1);
const err = (...a) => process.stderr.write(a.join(" ") + "\n");
const run = (c, a, o = {}) => spawnSync(c, a, { encoding: "utf8", windowsHide: true, shell: process.platform === "win32" && ["npm", "graft"].includes(c), ...o });
const recommend = () => {
  err(`[graft] 권장: Node.js 20 이상에서 'npm install -g ${PKG}'를 실행하세요.`);
  err("[graft] tree-sitter 네이티브 호환 오류가 나면 검증된 LTS Node 24를 사용하세요.");
};
const nodeMajor = () => Number(process.versions.node.split(".")[0]);
const hasCmd = (c) => run(c, ["--version"]).status === 0;
const graftVersion = () => { const r = run("graft", ["--version"]); return r.status === 0 ? r.stdout.trim().split(/\r?\n/).pop().trim() : ""; };

const [, , cmd, ...args] = process.argv;

if (cmd === "refresh") {
  const repoPath = args[0] || ".";
  const reason = args[1] || "manual";
  const top = run("git", ["-C", repoPath, "rev-parse", "--show-toplevel"]);
  if (top.status !== 0) { err(`[graft] WARNING: Git 저장소가 아니어서 그래프 갱신을 건너뜁니다: ${repoPath}`); process.exit(0); }
  const root = top.stdout.trim();
  if (nodeMajor() < 20) { err(`[graft] WARNING: 현재 Node ${nodeMajor()}; Node.js 20 이상이 아니어서 ${root} 그래프 갱신을 건너뜁니다.`); recommend(); process.exit(0); }
  if (!graftVersion()) { err(`[graft] WARNING: Graft CLI가 없어 ${root} 그래프 갱신을 건너뜁니다.`); recommend(); process.exit(0); }
  err(`[graft] 구조 그래프 갱신 중 (${reason}): ${root}`);
  const r = run("graft", ["build", root], { env: { ...process.env, DO_NOT_TRACK: "1" }, stdio: ["ignore", "inherit", "inherit"] });
  if (r.status === 0) err(`[graft] 구조 그래프 갱신 완료: ${root}`);
  else { err(`[graft] WARNING: Graft 빌드가 실패했습니다: ${root}`); recommend(); }
  process.exit(0);
}

if (cmd === "ensure") {
  if (nodeMajor() < 20) { err(`[graft] 현재 Node ${nodeMajor()}; Graft는 Node.js 20 이상이 필요합니다.`); recommend(); process.exit(0); }
  const installed = graftVersion();
  if (installed === VERSION) { err(`[graft] CLI ${installed} 준비됨 (Node ${process.version}).`); process.exit(0); }
  const action = installed ? `업데이트 (${installed} → ${VERSION})` : "설치";
  const mode = (process.env.GRAFT_INSTALL || "ask").toLowerCase();
  let install = false;
  if (["1", "yes", "true", "always"].includes(mode)) install = true;
  else if (["0", "no", "false", "never"].includes(mode)) { err(`[graft] CLI ${action} 건너뜀 (GRAFT_INSTALL=${mode}).`); recommend(); process.exit(0); }
  else if (mode === "ask") {
    if (!process.stdin.isTTY) { err(`[graft] 비대화형 실행이라 CLI ${action}을 건너뜁니다.`); recommend(); process.exit(0); }
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const ans = await new Promise((res) => rl.question(`[graft] ${PKG} CLI를 ${action}할까요? [Y/n] `, res));
    rl.close();
    install = !/^n(o)?$/i.test(ans.trim());
  } else { err(`[graft] 알 수 없는 GRAFT_INSTALL 값: ${mode}`); recommend(); process.exit(0); }
  if (install && hasCmd("npm")) {
    const r = run("npm", ["install", "-g", PKG], { stdio: ["ignore", "inherit", "inherit"] });
    if (r.status === 0) {
      if (graftVersion() === VERSION) { err(`[graft] CLI ${VERSION} ${action} 완료.`); process.exit(0); }
      err("[graft] CLI를 설치했지만 현재 Node 환경에서 시작하지 못했습니다.");
    }
    err(`[graft] CLI ${action} 실패.`);
  }
  recommend();
  process.exit(0);
}

err("사용법: graft.mjs <refresh [repo-path] [reason] | ensure>");
process.exit(0);
