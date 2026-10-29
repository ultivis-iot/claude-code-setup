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
// 상한에 닿았을 때). --input 은 gh 대신 {head_sha, comments, checks, files, author_association, required_checks} JSON 을 읽는다(테스트용,
// required_checks 가 없으면 필수 check 가 없는 것으로 본다).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_BOT = "isaac-notion-bot";
export const DEFAULT_ROUND_CAP = 3;
const DECISIONS = new Set(["fixed", "wrong", "intentional", "irrelevant"]);
const FIXABLE_PROVENANCE = new Set(["introduced", "ported", "uncertain"]);
const BLOCK = /<!-- ocr-review:v1 (.*?) -->/gs;
const BLOCK_MARK = /<!-- ocr-review:v1 /;
// 봇이 남기는 코멘트 중 리뷰 보고서만 판단 근거로 본다(같은 봇의 다른 안내 코멘트는 건너뛴다).
const REPORT_HEADER = "## 🤖 AI Code Review Report";
const isReport = (body) => String(body || "").includes(REPORT_HEADER) || BLOCK_MARK.test(String(body || ""));
const COMPLETENESS = new Set(["complete", "partial"]);

// 완료와 라운드 상한 판정에 쓰는 최상위 필드. 하나라도 틀리면 그 보고서로는 아무것도 판정하지 않는다.
export function reportProblem(block) {
  if (!Array.isArray(block.findings)) return "findings is not a list";
  if (!Number.isInteger(block.round) || block.round < 1) return "round is not a positive integer";
  if (!COMPLETENESS.has(block.completeness)) return "unknown completeness";
  return null;
}

// 블록이 둘 이상이면 어느 것이 리뷰 봇의 것인지 모르므로 읽지 않는다(깨진 보고서로 다룬다).
// 리뷰 봇은 블록을 줄 맨 앞부터, 보고서 맨 끝(뒤에는 공백과 </details> 만)에 쓴다. 본문에 인용·코드로
// 들어간 블록 하나만 있는 코멘트를 그 블록으로 읽지 않는다. 닫히지 않은 코드 펜스 안의 블록도 마찬가지다.
export function parseBlock(body) {
  const text = String(body || "");
  const matches = [...text.matchAll(BLOCK)];
  if (matches.length !== 1) return null;
  const { index } = matches[0];
  const atLineStart = index === 0 || text[index - 1] === "\n";
  const tail = text.slice(index + matches[0][0].length);
  if (!atLineStart || !/^(?:\s|<\/details>)*$/.test(tail) || inCodeFence(text.slice(0, index))) return null;
  try {
    const block = JSON.parse(matches[0][1]);
    return block && block.version === 1 ? block : null;
  } catch {
    return null;
  }
}

// 앞 내용이 끝날 때 Markdown 코드 펜스(``` · ~~~, 들여쓰기 3칸까지)가 열려 있는지. 같은 문자로 같거나 더 긴 펜스이고 뒤에 공백·탭만 있을 때만 닫는다.
function inCodeFence(before) {
  let open = null;
  // Markdown 의 줄바꿈은 LF·CR·CRLF 다. 펜스 뒤 내용은 U+2028 같은 문자도 포함해 그대로 받는다.
  for (const line of before.split(/\r\n?|\n/)) {
    const fence = /^ {0,3}(`{3,}|~{3,})([^]*)$/.exec(line);
    if (!fence) continue;
    const [, marks, rest] = fence;
    // 정보 문자열에 백틱이 있는 백틱 줄은 펜스가 아니다(인라인 코드).
    if (marks[0] === "`" && rest.includes("`")) continue;
    if (!open) open = marks;
    else if (marks[0] === open[0] && marks.length >= open.length && /^[ \t]*$/.test(rest)) open = null;
  }
  return open !== null;
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
// 저장소 최상위 디렉터리만 본다. Windows 는 이름 끝의 . 과 공백을 지우므로 지운 뒤 비교한다.
const SENSITIVE_DIRS = new Set([".github", ".claude", ".codex"]);
const isSensitive = (f) => f.includes("/") && SENSITIVE_DIRS.has(f.split("/")[0].replace(/[. ]+$/, "").toLowerCase());
// PR 작성자가 이 저장소의 쓰기 권한을 가진 사람일 때만 자동 수정한다(외부 기여자 PR 은 사람이 본다).
const TRUSTED_AUTHORS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

// 저장소 기준 정규화된 상대 경로만 받는다. ./x, a/../x, ../x, /abs, 옵션처럼 보이는 값, \ 구분자, 제어 문자는 모양 불량이다.
const canonicalPath = (f) => typeof f === "string" && f !== "" && !f.startsWith("-") && !posix.isAbsolute(f)
  && !/[\\\u0000-\u001f\u007f]/.test(f) && posix.normalize(f) === f && !f.split("/").includes("..");

function ledgerDecision(ledger, finding) {
  const decisions = ledger.decisions || {};
  for (const id of idsOf(finding)) if (Object.hasOwn(decisions, id)) return { id, ...decisions[id] };
  return null;
}

// 블록은 리뷰 봇이 쓴 외부 데이터다. 쓰는 필드의 모양만 확인하고, 맞지 않으면 사람에게 넘긴다.
export function wellFormed(finding) {
  return typeof finding?.id === "string" && finding.id !== ""
    && (finding.aliases === undefined || (Array.isArray(finding.aliases) && finding.aliases.every((a) => typeof a === "string")))
    && Array.isArray(finding.locations) && finding.locations.length > 0
    && finding.locations.every((l) => canonicalPath(l?.file) && Number.isInteger(l.line) && l.line >= 1);
}

const filesOf = (finding) => [...new Set(finding.locations.map((l) => l.file))];

// 지적 하나가 어느 목록에 들어가는지 정한다. hold 는 needs_user 로 보내는 이유다.
function classify(finding, { ledger, changedSince, partial, prFiles, authorAssociation }) {
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
  else if (!TRUSTED_AUTHORS.has(authorAssociation)) entry.hold = "untrusted author";
  else if (filesOf(finding).some(isSensitive)) entry.hold = "sensitive path";
  else if (!prFiles) entry.hold = "PR files unknown";
  else if (filesOf(finding).some((f) => !prFiles.has(f))) entry.hold = "outside PR files";
  return { list: entry.hold ? "needs_user" : "to_fix", entry };
}

/**
 * 현재 HEAD 에 대한 리뷰 상태를 판정한다.
 * state: no_review | waiting | legacy | malformed_report | needs_user | actionable | round_cap | clear
 *   malformed_report 현재 HEAD 보고서보다 뒤에 올라온 봇 보고서의 블록이 깨졌거나(블록이 둘 이상인 것 포함)
 *            현재 HEAD 보고서의 최상위 필드가 틀렸다. 사람에게 넘긴다.
 *   waiting   현재 HEAD 를 리뷰한 블록이 아직 없다(이전 HEAD 보고서만 있음).
 *   legacy    가장 최근 봇 보고서에 블록이 없다(예전 형식). 지적은 참고용이고 완료 증거가 아니다.
 *   needs_user 자동으로 고치지 않을 지적만 남았다. 각 지적의 hold 가 이유다.
 *   actionable 이번 라운드에 고칠 지적이 있다.
 *   round_cap 상한 라운드인데 지적이 남았다. 고치지 않고 사람에게 넘긴다.
 *   clear     고칠 지적이 없다. 완료하려면 보고서가 complete 이고 checks 도 통과하고, 대상 브랜치의 필수 check 가
 *             현재 HEAD 에 있고 성공해야 한다(complete 필드). 필수 check 를 모르면(requiredChecks null) 완료가 아니다.
 * 틀림·의도됨·상관없음으로 기록한 지적은, 기록한 뒤 지적 위치의 파일이 바뀌었으면(changedSince) 다시
 * 연다. 해결 확인은 다음 리뷰 블록의 status=resolved 가 기록이다. 자동 수정은 PR 작성자가 OWNER·MEMBER·
 * COLLABORATOR 이고 지적 위치가 PR 이 바꾼 파일(prFiles) 안일 때만이다. 둘 중 하나를 모르면 고치지 않는다.
 * resolved·rejected·pre_existing 은 리뷰 봇(통합 pass)의 판정을 그대로 믿는다. 완료는 merge 전 사람 확인을
 * 대신하지 않는다.
 */
export function assess({ headSha, comments, checks = [], requiredChecks = null, bot = DEFAULT_BOT, ledger = { decisions: {} }, roundCap = DEFAULT_ROUND_CAP, changedSince = () => false, prFiles = null, authorAssociation = null }) {
  const reports = comments
    .filter((c) => c.login === bot && isReport(c.body))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map((c) => ({ comment_id: c.id, created_at: c.created_at, block: parseBlock(c.body), body: c.body }));
  const passed = (c) => ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(c.conclusion || c.state);
  const pendingChecks = checks.filter((c) => !passed(c));
  // 대상 브랜치의 필수 check 는 현재 HEAD 에 있고 성공해야 한다. null 은 필수 check 를 알아내지 못했다는 뜻이다.
  const missingRequired = (requiredChecks || []).filter((name) => !checks.some((c) => c.name === name && passed(c)));
  const base = {
    head_sha: headSha,
    checks: { total: checks.length, not_passed: pendingChecks.map((c) => c.name), required: requiredChecks || [], missing_required: missingRequired, required_unknown: requiredChecks === null },
    to_fix: [], needs_user: [], declined: [], pre_existing: [], rejected: [], resolved: [],
    round: null, round_cap: roundCap, round_cap_reached: false, complete: false,
  };
  if (!reports.length) return { ...base, state: "no_review", report: null };

  // 판단은 현재 HEAD 를 리뷰한 가장 최근 보고서로 한다. 이전 HEAD 리뷰가 늦게 끝나 그 뒤에 올라온 보고서는
  // 건너뛴다. 읽을 수 없는 블록은 어느 HEAD 의 것인지 모르므로 건너뛰지 않고 멈춘다(더 오래된 보고서로 대신하지 않음).
  const newest = reports[reports.length - 1];
  if (!BLOCK_MARK.test(String(newest.body || ""))) {
    return { ...base, state: "legacy", report: { comment_id: newest.comment_id, head_sha: null }, needs_user: parseLegacy(newest.body) };
  }
  let current = null;
  for (const report of [...reports].reverse()) {
    if (!BLOCK_MARK.test(String(report.body || ""))) continue;
    if (!report.block) return { ...base, state: "malformed_report", report: { comment_id: report.comment_id, head_sha: null, reason: "block could not be read" } };
    if (report.block.head_sha === headSha) { current = report; break; }
  }
  if (!current) return { ...base, state: "waiting", report: { comment_id: newest.comment_id, head_sha: newest.block?.head_sha ?? null } };
  const problem = reportProblem(current.block);
  if (problem) return { ...base, state: "malformed_report", report: { comment_id: current.comment_id, head_sha: current.block.head_sha ?? null, reason: problem } };

  const block = current.block;
  const out = { ...base, report: { comment_id: current.comment_id, head_sha: block.head_sha, completeness: block.completeness, parent_head_sha: block.parent_head_sha } };
  out.round = block.round;
  out.round_cap_reached = block.round >= roundCap;
  const partial = block.completeness !== "complete";
  const files = prFiles ? new Set(prFiles) : null;
  for (const finding of block.findings) {
    const { list, entry } = classify(finding, { ledger, changedSince, partial, prFiles: files, authorAssociation });
    out[list].push(entry);
  }
  // 상한 라운드에 지적이 남았으면 더 고치지 않고 사람에게 넘긴다.
  if (out.round_cap_reached && out.to_fix.length + out.needs_user.length) out.state = "round_cap";
  else out.state = out.to_fix.length ? "actionable" : out.needs_user.length ? "needs_user" : "clear";
  out.complete = out.state === "clear" && !partial && pendingChecks.length === 0 && requiredChecks !== null && missingRequired.length === 0;
  return out;
}

// ---------------------------------------------------------------- CLI
function args(argv) {
  const [cmd, ...rest] = argv;
  const opt = {};
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith("--")) continue;
    const body = rest[i].slice(2);
    const eq = body.indexOf("=");
    if (eq !== -1) { opt[body.slice(0, eq)] = body.slice(eq + 1); continue; }
    const key = body;
    // --reason 은 자유 서술이라 값이 --repo 처럼 옵션 이름으로 시작해도 다음 인자를 값으로 삼는다.
    const takesNext = i + 1 < rest.length && (key === "reason" || !rest[i + 1].startsWith("--"));
    opt[key] = takesNext ? rest[++i] : true;
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

function ghTry(argv) {
  return spawnSync("gh", argv, { encoding: "utf8", windowsHide: true });
}

// 필수 check 목록의 모양을 확인한다. 배열이 아니거나 이름이 빈 문자열이 아니면 null(모름)이다.
const checkNames = (list, pick) => {
  if (!Array.isArray(list)) return null;
  const names = list.map(pick);
  return names.every((n) => typeof n === "string" && n !== "") ? names : null;
};

// 대상 브랜치의 필수 status check 이름. rulesets 와 기존 브랜치 보호를 합친다. 알아내지 못하면 null(완료로 보지 않음).
function requiredChecksFor(slug, base) {
  if (typeof base !== "string" || !base) return null;
  const branch = encodeURIComponent(base);
  // 한 페이지(100개)로 읽는다. 꽉 차면 뒤에 더 있을 수 있으므로 모름으로 본다.
  const rules = ghTry(["api", `repos/${slug}/rules/branches/${branch}?per_page=100`]);
  if (rules.error || rules.status !== 0) return null;
  const names = [];
  try {
    const list = JSON.parse(rules.stdout);
    if (!Array.isArray(list) || list.length >= 100) return null;
    for (const rule of list) {
      if (rule?.type !== "required_status_checks") continue;
      const required = checkNames(rule.parameters?.required_status_checks, (c) => c?.context);
      if (!required) return null;
      names.push(...required);
    }
  } catch { return null; }
  const protection = ghTry(["api", `repos/${slug}/branches/${branch}/protection/required_status_checks`]);
  if (protection.status === 0) {
    try {
      const p = JSON.parse(protection.stdout);
      const contexts = checkNames(p?.contexts, (c) => c);
      const checks = p?.checks === undefined ? [] : checkNames(p.checks, (c) => c?.context);
      if (!contexts || !checks) return null;
      names.push(...contexts, ...checks);
    } catch { return null; }
  } else if (!/HTTP 404/.test(protection.stderr || "")) return null;  // 404: 보호 없음 또는 필수 check 없음
  return [...new Set(names)];
}

function gitOk(argv) {
  return spawnSync("git", argv, { encoding: "utf8" });
}

const commitExists = (sha) => gitOk(["cat-file", "-e", `${sha}^{commit}`]).status === 0;

// 판단을 기록한 HEAD 부터 PR HEAD 까지 files 가 바뀌었는가. 기록한 HEAD 나 PR HEAD 를 로컬에서 찾지 못하면
// 바뀐 것으로 본다(지금 체크아웃한 HEAD 로 대신 비교해 지적을 묻어 두지 않는다).
export function gitChangedSince(headSha) {
  const known = Boolean(headSha) && commitExists(headSha);
  return (recorded, files) => {
    if (!files.length) return false;
    if (!known || !commitExists(recorded)) return true;
    const r = gitOk(["diff", "--name-only", recorded, headSha, "--", ...files]);
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
  const view = JSON.parse(gh(["pr", "view", String(pr), "--repo", slug, "--json", "headRefOid,baseRefName,statusCheckRollup,files"]));
  const comments = gh(["api", `repos/${slug}/issues/${pr}/comments`, "--paginate", "--jq", ".[] | {id, created_at, login: .user.login, body} | tojson"])
    .split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const checks = (view.statusCheckRollup || []).map((c) => ({ name: c.name || c.context, conclusion: c.conclusion, state: c.state }));
  // gh pr view 에는 작성자와 저장소의 관계가 없어 REST 응답에서 읽는다.
  const author = gh(["api", `repos/${slug}/pulls/${pr}`, "--jq", ".author_association"]).trim();
  return { head_sha: view.headRefOid, comments, checks, files: (view.files || []).map((f) => f.path), author_association: author || null, required_checks: requiredChecksFor(slug, view.baseRefName) };
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
    // 값을 빠뜨린 옵션은 args() 에서 true 가 된다. 기본값이나 "true" 로 통과시키지 않는다.
    for (const key of ["repo", "bot", "round-cap", "input"]) if (opt[key] === true) fail(`--${key} 에 값이 필요합니다`);
    if (opt.repo !== undefined && !(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(String(opt.repo)) && String(opt.repo).split("/").every((part) => part !== "." && part !== ".."))) fail("--repo 는 owner/name 형식입니다");
    if (opt["round-cap"] !== undefined && !/^[1-9]\d*$/.test(opt["round-cap"])) fail("--round-cap 은 1 이상의 정수입니다");
    const roundCap = opt["round-cap"] === undefined ? DEFAULT_ROUND_CAP : Number(opt["round-cap"]);
    if (opt.bot !== undefined && !/^[A-Za-z0-9-]+(\[bot\])?$/.test(String(opt.bot))) fail("--bot 은 GitHub 로그인입니다");
    const data = opt.input ? JSON.parse(readFileSync(opt.input, "utf8")) : loadFromGitHub(opt.pr, opt.repo);
    const result = assess({
      headSha: data.head_sha, comments: data.comments, checks: data.checks || [],
      // --input(테스트용)에 required_checks 가 없으면 필수 check 가 없는 것으로 본다.
      requiredChecks: Object.hasOwn(data, "required_checks") ? data.required_checks : [],
      bot: opt.bot || DEFAULT_BOT, ledger: readLedger(opt.pr), roundCap,
      changedSince: gitChangedSince(data.head_sha), prFiles: Array.isArray(data.files) ? data.files : null,
      authorAssociation: data.author_association ?? null,
    });
    process.stdout.write(JSON.stringify({ pr: Number(opt.pr), ...result }, null, 2) + "\n");
    return;
  }
  if (cmd === "record") {
    if (!opt.id || opt.id === true) fail("--id 가 필요합니다");
    if (!DECISIONS.has(opt.decision)) fail(`--decision 은 ${[...DECISIONS].join("|")} 중 하나입니다`);
    if (!opt.reason || opt.reason === true) fail("--reason 이 필요합니다");
    if (opt.commit === true) fail("--commit 에 값이 필요합니다");
    const ledger = readLedger(opt.pr);
    const head = gitOk(["rev-parse", "HEAD"]);
    // 대입하면 __proto__ 같은 id 는 객체의 프로토타입을 바꾸고 저장되지 않는다. 자기 속성으로 정의한다.
    Object.defineProperty(ledger.decisions, opt.id, { enumerable: true, writable: true, configurable: true, value: {
      decision: opt.decision, reason: opt.reason, commit: opt.commit || null,
      head_sha: head.status === 0 ? head.stdout.trim() : null, at: new Date().toISOString(),
    } });
    const f = ledgerPath(opt.pr);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify(ledger, null, 2) + "\n");
    process.stdout.write(JSON.stringify({ recorded: opt.id, decision: opt.decision, ledger: f }) + "\n");
    return;
  }
  fail("사용법: review-findings.mjs status|record --pr <N> ... | stop-loop");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
