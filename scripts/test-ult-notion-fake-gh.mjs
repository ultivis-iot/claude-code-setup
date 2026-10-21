#!/usr/bin/env node
// 테스트용 가짜 gh. 상태는 $FAKE_GH_DIR/state.json
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.FAKE_GH_DIR;
const defRepo = process.env.FAKE_GH_REPO || "ultivis/demo";
const args = process.argv.slice(2);
const stateFile = join(dir, "state.json");
const lock = join(dir, "lock");
appendFileSync(join(dir, "calls.log"), JSON.stringify(args) + "\n");

function withState(fn) {
  for (let i = 0; i < 2000; i++) { try { mkdirSync(lock); break; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); } }
  try {
    const st = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : { next: 100, issues: [] };
    const r = fn(st);
    writeFileSync(stateFile, JSON.stringify(st));
    return r;
  } finally { try { rmdirSync(lock); } catch {} }
}
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const jq = (obj) => {
  const e = opt("--jq");
  if (e === undefined) return console.log(JSON.stringify(obj));
  const v = e.replace(/^\./, "").split(".").reduce((a, k) => a?.[k], obj);
  console.log(typeof v === "string" ? v : JSON.stringify(v));
};
const fail = (m) => { console.error(m); process.exit(1); };

const [a, b] = args;
if (a === "api" && b === "user") { console.log(process.env.FAKE_GH_LOGIN || "tester"); process.exit(0); }
if (a === "repo" && b === "view") { jq({ name: defRepo.split("/")[1], nameWithOwner: defRepo }); process.exit(0); }
if (a === "issue" && b === "create") {
  const repo = opt("--repo") || defRepo;
  const body = opt("--body") ?? readFileSync(opt("--body-file"), "utf8");
  const num = withState((st) => { const n = st.next++; st.issues.push({ num: n, repo, title: opt("--title"), body, state: "OPEN", comments: [] }); return n; });
  console.log(`https://github.com/${repo}/issues/${num}`);
  process.exit(0);
}
if (a === "issue" && b === "view") {
  const num = Number(args[2]);
  const repo = opt("--repo") || defRepo;
  const st = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : { issues: [] };
  const i = st.issues.find((x) => x.num === num && x.repo === repo);
  if (!i) fail(`no such issue ${repo}#${num}`);
  jq({ url: `https://github.com/${i.repo}/issues/${i.num}`, title: i.title, body: i.body, state: i.state, labels: i.labels || [], assignees: i.assignees || [], createdAt: "2026-10-01T00:00:00Z", author: { login: "someone" }, comments: i.comments.map((c) => ({ author: { login: "tester" }, createdAt: "2026-10-02T00:00:00Z", body: c })) });
  process.exit(0);
}
if (a === "issue" && b === "comment") {
  const num = Number(args[2]); const repo = opt("--repo") || defRepo;
  const body = opt("--body") ?? readFileSync(opt("--body-file"), "utf8");
  withState((st) => { const i = st.issues.find((x) => x.num === num && x.repo === repo); if (i) i.comments.push(body); });
  process.exit(0);
}
fail(`fake gh: unsupported ${args.join(" ")}`);
