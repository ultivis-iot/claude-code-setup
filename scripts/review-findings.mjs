#!/usr/bin/env node
// review-cycle 이 기계 리뷰(OCR + Codex 브리지)의 PR 코멘트를 지적 단위로 읽는 도구.
//
//   node review-findings.mjs status --pr <N> [--repo <o/r>] [--bot <login>] [--round-cap 3] [--input <file>]
//   node review-findings.mjs record --pr <N> --id <finding id> --decision fixed|wrong|intentional|irrelevant
//                                   --reason <text> [--commit <sha>]
//   node review-findings.mjs stop-loop
//
// status 는 현재 PR HEAD 를 리뷰한 보고서의 <!-- ocr-review:v1 --> 블록을 읽어, 이번 라운드에
// 고칠 지적과 사람에게 넘길 지적을 나눠 JSON 으로 출력한다. 블록이 없는 예전 보고서는 지적을
// 참고로만 읽고 현재 HEAD 의 완료 증거로 쓰지 않는다. record 는 지적별 처리 결과를
// tmp/review-findings-<PR>.json 에 남긴다(오탐률 집계의 원천이자 같은 지적을 다시 고치지
// 않기 위한 기록). stop-loop 는 완료 신호 없이 Ralph Loop 를 멈춘다(사람에게 넘기거나 라운드
// 상한에 닿았을 때). --input 은 gh 대신 {head_sha, comments, checks} JSON 을 읽는다(테스트용).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_BOT = "isaac-notion-bot";
export const DEFAULT_ROUND_CAP = 3;
const DECISIONS = new Set(["fixed", "wrong", "intentional", "irrelevant"]);
const FIXABLE_PROVENANCE = new Set(["introduced", "ported", "uncertain"]);
const BLOCK = /<!-- ocr-review:v1 (.*?) -->/gs;

export function parseBlock(body) {
  const matches = [...String(body || "").matchAll(BLOCK)];
  if (!matches.length) return null;
  try {
    const block = JSON.parse(matches[matches.length - 1][1]);
    return block && block.version === 1 ? block : null;
  } catch {
    return null;
  }
}

// 블록이 없던 시기의 보고서. 상세 리뷰 영역의 "- `file:line` **title**" 만 읽는다
// (요약 목록 'Potential Risks' 는 같은 지적을 반복하므로 세지 않는다).
export function parseLegacy(body) {
  const text = String(body || "");
  const start = text.indexOf("## Codex PR 코드 리뷰");
  if (start < 0) return [];
  const labels = { "치명적": "critical", "높음": "high", "보통": "medium", "낮음": "low" };
  let severity = null;
  const findings = [];
  for (const line of text.slice(start).split(/\r?\n/)) {
    const heading = line.match(/^### (\S+)/);
    if (heading) { severity = labels[heading[1]] || null; continue; }
    const item = line.match(/^- `([^`]+):(\d+)` \*\*(.+?)\*\*/);
    if (!item || !severity) continue;
    const [, file, lineNo, title] = item;
    const id = "legacy-" + createHash("sha256").update(`${file}\0${lineNo}\0${title}`).digest("hex").slice(0, 16);
    findings.push({ id, aliases: [], locations: [{ file, line: Number(lineNo) }], severity, title, legacy: true });
  }
  return findings;
}

const idsOf = (finding) => [finding.id, ...(finding.aliases || [])];
// 리뷰 봇이 PR 작성자의 diff 에 유도될 수 있으므로, 이 경로를 건드리는 지적은 자동으로 고치지 않는다.
const SENSITIVE_PATH = /^(\.github|\.claude)\//;

function ledgerDecision(ledger, finding) {
  const decisions = ledger.decisions || {};
  for (const id of idsOf(finding)) if (Object.hasOwn(decisions, id)) return { id, ...decisions[id] };
  return null;
}

// 블록은 리뷰 봇이 쓴 외부 데이터다. 쓰는 필드의 모양만 확인하고, 맞지 않으면 사람에게 넘긴다.
function wellFormed(finding) {
  return typeof finding?.id === "string" && finding.id !== ""
    && (finding.aliases === undefined || (Array.isArray(finding.aliases) && finding.aliases.every((a) => typeof a === "string")))
    && Array.isArray(finding.locations) && finding.locations.length > 0
    && finding.locations.every((l) => typeof l?.file === "string" && l.file !== "" && !l.file.startsWith("-"));
}

const filesOf = (finding) => [...new Set(finding.locations.map((l) => l.file))];

// 지적 하나가 어느 목록에 들어가는지 정한다. hold 는 needs_user 로 보내는 이유다.
function classify(finding, { ledger, changedSince, partial, prFiles }) {
  if (!wellFormed(finding)) return { list: "needs_user", entry: { raw: finding, hold: "malformed finding" } };
  const entry = { ...finding, file: finding.locations[0].file, line: finding.locations[0].line };
  if (finding.status === "resolved") return { list: "resolved", entry };
  if (finding.verification === "rejected") return { list: "rejected", entry };
  if (finding.provenance === "pre_existing") return { list: "pre_existing", entry };

  const earlier = ledgerDecision(ledger, finding);
  if (earlier && earlier.decision === "fixed") {
    entry.reopened = earlier;  // 고쳤다고 기록했는데 리뷰는 아직 남아 있다고 본다
  } else if (earlier) {
    // 틀림·의도됨·상관없음 판단은 그 뒤 지적 위치의 파일이 바뀌었으면 다시 연다. 판단 시점을 모르면 묻어 두지 않고 연다.
    if (!earlier.head_sha) entry.reopened = { ...earlier, reason: "decision has no recorded head" };
    else if (changedSince(earlier.head_sha, filesOf(finding))) entry.reopened = { ...earlier, reason: "files changed since decision" };
    else return { list: "declined", entry: { ...entry, decision: earlier } };
  }

  // 반증을 거치고 이 PR 의 책임으로 판정된 지적만 자동으로 고친다.
  if (partial) entry.hold = "partial report";
  else if (finding.verification !== "confirmed") entry.hold = "not verified";
  else if (!FIXABLE_PROVENANCE.has(finding.provenance)) entry.hold = "unknown provenance";
  else if (filesOf(finding).some((f) => SENSITIVE_PATH.test(f))) entry.hold = "sensitive path";
  else if (prFiles && filesOf(finding).some((f) => !prFiles.has(f))) entry.hold = "outside PR files";
  return { list: entry.hold ? "needs_user" : "to_fix", entry };
}

/**
 * 현재 HEAD 에 대한 리뷰 상태를 판정한다.
 * state: no_review | waiting | legacy | needs_user | actionable | round_cap | clear
 *   waiting   현재 HEAD 를 리뷰한 블록이 아직 없다(이전 HEAD 보고서만 있음).
 *   legacy    블록 없는 보고서만 있다. 지적은 참고용이고 완료 증거가 아니다.
 *   needs_user 자동으로 고치지 않을 지적만 남았다. 각 지적의 hold 가 이유다.
 *   actionable 이번 라운드에 고칠 지적이 있다.
 *   round_cap 상한 라운드인데 지적이 남았다. 고치지 않고 사람에게 넘긴다.
 *   clear     고칠 지적이 없다. 완료하려면 보고서가 complete 이고 checks 도 통과해야 한다(complete 필드).
 * 틀림·의도됨·상관없음으로 기록한 지적은, 기록한 뒤 지적 위치의 파일이 바뀌었으면(changedSince) 다시
 * 연다. 해결 확인은 다음 리뷰 블록의 status=resolved 가 기록이다. prFiles 를 주면 PR 이 바꾼 파일 밖을
 * 짚는 지적은 자동으로 고치지 않는다.
 */
export function assess({ headSha, comments, checks = [], bot = DEFAULT_BOT, ledger = { decisions: {} }, roundCap = DEFAULT_ROUND_CAP, changedSince = () => false, prFiles = null }) {
  const reports = comments
    .filter((c) => c.login === bot)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map((c) => ({ comment_id: c.id, created_at: c.created_at, block: parseBlock(c.body), body: c.body }));
  const pendingChecks = checks.filter((c) => !["SUCCESS", "NEUTRAL", "SKIPPED"].includes(c.conclusion || c.state));
  const base = {
    head_sha: headSha,
    checks: { total: checks.length, not_passed: pendingChecks.map((c) => c.name) },
    to_fix: [], needs_user: [], declined: [], pre_existing: [], rejected: [], resolved: [],
    round: null, round_cap: roundCap, round_cap_reached: false, complete: false,
  };
  if (!reports.length) return { ...base, state: "no_review", report: null };

  const current = [...reports].reverse().find((r) => r.block?.head_sha === headSha);
  if (!current) {
    const latest = reports[reports.length - 1];
    if (latest.block) return { ...base, state: "waiting", report: { comment_id: latest.comment_id, head_sha: latest.block.head_sha } };
    return { ...base, state: "legacy", report: { comment_id: latest.comment_id, head_sha: null }, needs_user: parseLegacy(latest.body) };
  }

  const block = current.block;
  const out = { ...base, report: { comment_id: current.comment_id, head_sha: block.head_sha, completeness: block.completeness, parent_head_sha: block.parent_head_sha } };
  out.round = block.round ?? null;
  out.round_cap_reached = (block.round ?? 0) >= roundCap;
  const partial = block.completeness !== "complete";
  const files = prFiles ? new Set(prFiles) : null;
  for (const finding of Array.isArray(block.findings) ? block.findings : []) {
    const { list, entry } = classify(finding, { ledger, changedSince, partial, prFiles: files });
    out[list].push(entry);
  }
  // 상한 라운드에 지적이 남았으면 더 고치지 않고 사람에게 넘긴다.
  if (out.round_cap_reached && out.to_fix.length + out.needs_user.length) out.state = "round_cap";
  else out.state = out.to_fix.length ? "actionable" : out.needs_user.length ? "needs_user" : "clear";
  out.complete = out.state === "clear" && !partial && pendingChecks.length === 0;
  return out;
}

// ---------------------------------------------------------------- CLI
function args(argv) {
  const [cmd, ...rest] = argv;
  const opt = {};
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith("--")) continue;
    const key = rest[i].slice(2);
    opt[key] = rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[++i] : true;
  }
  return { cmd, opt };
}

function fail(message) {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
}

function gh(argv) {
  const r = spawnSync("gh", argv, { encoding: "utf8", windowsHide: true });
  if (r.error) fail(`gh 를 실행할 수 없습니다: ${r.error.message}`);
  if (r.status !== 0) fail(`gh ${argv.join(" ")}: ${r.stderr.trim()}`);
  return r.stdout;
}

function gitOk(argv) {
  return spawnSync("git", argv, { encoding: "utf8" });
}

const commitExists = (sha) => gitOk(["cat-file", "-e", `${sha}^{commit}`]).status === 0;

// 판단을 기록한 HEAD 부터 PR HEAD(로컬에 없으면 지금 체크아웃한 HEAD)까지 files 가 바뀌었는가.
// 기록한 HEAD 를 로컬에서 찾지 못하면 바뀐 것으로 본다(지적을 묻어 두지 않는다).
function gitChangedSince(headSha) {
  const target = headSha && commitExists(headSha) ? headSha : "HEAD";
  return (recorded, files) => {
    if (!files.length) return false;
    if (!commitExists(recorded)) return true;
    const r = gitOk(["diff", "--name-only", recorded, target, "--", ...files]);
    return r.status !== 0 || r.stdout.trim() !== "";
  };
}

function repoRoot() {
  const r = gitOk(["rev-parse", "--show-toplevel"]);
  return r.status === 0 ? r.stdout.trim() : process.cwd();
}

const ledgerPath = (pr) => join(repoRoot(), "tmp", `review-findings-${pr}.json`);

function readLedger(pr) {
  const f = ledgerPath(pr);
  if (!existsSync(f)) return { pr: Number(pr), decisions: {} };
  try { return JSON.parse(readFileSync(f, "utf8")); } catch { fail(`${f} 를 읽을 수 없습니다`); }
}

function loadFromGitHub(pr, repo) {
  const slug = repo || gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).trim();
  const view = JSON.parse(gh(["pr", "view", String(pr), "--repo", slug, "--json", "headRefOid,statusCheckRollup,files"]));
  const comments = gh(["api", `repos/${slug}/issues/${pr}/comments`, "--paginate", "--jq", ".[] | {id, created_at, login: .user.login, body} | tojson"])
    .split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const checks = (view.statusCheckRollup || []).map((c) => ({ name: c.name || c.context, conclusion: c.conclusion, state: c.state }));
  return { head_sha: view.headRefOid, comments, checks, files: (view.files || []).map((f) => f.path) };
}

function main() {
  const { cmd, opt } = args(process.argv.slice(2));
  if (cmd === "stop-loop") {
    // ralph-loop 플러그인은 이 상태 파일이 없으면 다음 반복을 걸지 않는다(/cancel-ralph 와 같은 방식).
    const state = join(repoRoot(), ".claude", "ralph-loop.local.md");
    const active = existsSync(state);
    if (active) rmSync(state);
    process.stdout.write(JSON.stringify({ stopped: active }) + "\n");
    return;
  }
  if (!opt.pr || !/^\d+$/.test(String(opt.pr))) fail("--pr <번호> 가 필요합니다");
  if (cmd === "status") {
    if (opt.repo !== undefined && !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(String(opt.repo))) fail("--repo 는 owner/name 형식입니다");
    if (opt.bot !== undefined && !/^[A-Za-z0-9-]+(\[bot\])?$/.test(String(opt.bot))) fail("--bot 은 GitHub 로그인입니다");
    const data = opt.input ? JSON.parse(readFileSync(opt.input, "utf8")) : loadFromGitHub(opt.pr, opt.repo);
    const result = assess({
      headSha: data.head_sha, comments: data.comments, checks: data.checks || [],
      bot: opt.bot || DEFAULT_BOT, ledger: readLedger(opt.pr), roundCap: Number(opt["round-cap"] || DEFAULT_ROUND_CAP),
      changedSince: gitChangedSince(data.head_sha), prFiles: Array.isArray(data.files) ? data.files : null,
    });
    process.stdout.write(JSON.stringify({ pr: Number(opt.pr), ...result }, null, 2) + "\n");
    return;
  }
  if (cmd === "record") {
    if (!opt.id || opt.id === true) fail("--id 가 필요합니다");
    if (!DECISIONS.has(opt.decision)) fail(`--decision 은 ${[...DECISIONS].join("|")} 중 하나입니다`);
    if (!opt.reason || opt.reason === true) fail("--reason 이 필요합니다");
    const ledger = readLedger(opt.pr);
    const head = gitOk(["rev-parse", "HEAD"]);
    ledger.decisions[opt.id] = {
      decision: opt.decision, reason: opt.reason, commit: opt.commit || null,
      head_sha: head.status === 0 ? head.stdout.trim() : null, at: new Date().toISOString(),
    };
    const f = ledgerPath(opt.pr);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify(ledger, null, 2) + "\n");
    process.stdout.write(JSON.stringify({ recorded: opt.id, decision: opt.decision, ledger: f }) + "\n");
    return;
  }
  fail("사용법: review-findings.mjs status|record --pr <N> ... | stop-loop");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
