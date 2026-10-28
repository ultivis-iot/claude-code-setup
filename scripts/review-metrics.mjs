#!/usr/bin/env node
// 기계 리뷰(OCR + Codex 브리지) 지표 집계. 코드 리뷰 개선 계획의 "기록할 지표" 를 쌓인 데이터로 뽑는다.
//
//   node review-metrics.mjs --pr 24,25,27 [--repo <o/r>] [--bot <login>] [--json]
//   node review-metrics.mjs --input <file> [--json]      (테스트용: {prs: [{pr, comments, ledger}]})
//
// 입력은 PR 코멘트의 <!-- ocr-review:v1 --> 블록과 review-findings.mjs record 가 남긴 처리 기록
// (tmp/review-findings-<PR>.json, 로컬 파일)이다. 읽기만 한다. 블록이 없거나 깨진 보고서는 세지 않는다.
// - 지적은 id·별칭으로 라운드를 넘어 같은 원인으로 묶는다.
// - 라운드는 리뷰한 HEAD 수다. 같은 HEAD 를 다시 리뷰한 보고서는 마지막 것을 쓴다.
// - 2라운드부터의 새 지적이 이미 리뷰한 코드에서 나왔는지: 바뀐 부분만 리뷰한 라운드는 블록의
//   earlier_code_findings(게시하지 않고 뺀 수)를 쓰고, 전체 리뷰 라운드는 직전 HEAD 이후 바뀐 줄(±3) 밖인지
//   git 으로 본다. 커밋이 로컬에 없으면 모름으로 센다.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_BOT, DEFAULT_ROUND_CAP, parseBlock, reportProblem, wellFormed } from "./review-findings.mjs";

const MARGIN = 3;
const DECISIONS = ["fixed", "wrong", "intentional", "irrelevant"];
const count = (items, key) => items.reduce((acc, item) => {
  const k = item[key] ?? "unknown";
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});
const isActive = (f) => f.status !== "resolved" && f.verification !== "rejected" && f.provenance !== "pre_existing";

// 지적이 직전 HEAD 이후 바뀐 줄 근처인가. 위치 하나라도 근처면 true, 아니면 모르는 위치가 있으면 null, 모두 밖이면 false.
function nearness(report, finding, changedNear) {
  // 바뀐 부분만 리뷰한 라운드는 바뀐 줄 근처 지적만 남긴다
  if (report.review_mode === "incremental") return true;
  const locations = Array.isArray(finding.locations) ? finding.locations : [];
  if (!locations.length) return null;
  let unknown = false;
  for (const location of locations) {
    const near = changedNear(report.parent_head_sha, report.head_sha, location);
    if (near === true) return true;
    if (near === null) unknown = true;
  }
  return unknown ? null : false;
}

/**
 * PR 하나의 지표. changedNear(parent, head, location) 은 위치가 parent..head 사이에 바뀐 줄 ±3 안이면 true,
 * 밖이면 false, 알 수 없으면 null 을 돌려준다(없으면 전체 리뷰 라운드의 새 지적은 모두 모름).
 */
export function summarize({ pr, comments, ledger = { decisions: {} }, bot = DEFAULT_BOT, changedNear = () => null, roundCap = DEFAULT_ROUND_CAP }) {
  // HEAD 별 마지막 보고서. 순서는 그 HEAD 를 처음 리뷰한 시점.
  // 깨진 보고서(최상위 필드나 지적 모양이 틀림)는 review-findings.mjs 와 같은 기준으로 통째로 뺀다.
  const byHead = new Map();
  let skipped = 0;
  for (const c of [...comments].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    if (c.login !== bot) continue;
    const block = parseBlock(c.body);
    if (!block) continue;
    if (typeof block.head_sha !== "string" || !block.head_sha || reportProblem(block) || !block.findings.every(wellFormed)) { skipped++; continue; }
    byHead.set(block.head_sha, block);
  }
  const reports = [...byHead.values()];

  const canonical = new Map();  // id·별칭 → 원인 id
  const causes = new Map();     // 원인 id → { ids, latest, round }
  const newPerRound = [];
  const later = { new: 0, changed_code: 0, earlier_code: 0, unknown: 0, dropped_as_earlier: 0 };
  reports.forEach((report, index) => {
    let fresh = 0;
    for (const f of report.findings) {
      const ids = [f.id, ...(Array.isArray(f.aliases) ? f.aliases : [])].filter((x) => typeof x === "string");
      // 별칭 집합이 이전의 여러 원인을 이으면 하나로 합친다(첫 원인으로).
      const found = [...new Set(ids.map((id) => canonical.get(id)).filter(Boolean))];
      const cause = found[0] || ids[0];
      for (const other of found.slice(1)) {
        for (const [id, c] of canonical) if (c === other) canonical.set(id, cause);
        causes.get(cause).round = Math.min(causes.get(cause).round, causes.get(other).round);
        causes.delete(other);
      }
      for (const id of ids) canonical.set(id, cause);
      if (!causes.has(cause)) {
        causes.set(cause, { latest: f, round: index + 1 });
        if (!f.carried) {
          fresh++;
          if (index > 0) {
            later.new++;
            const near = nearness(report, f, changedNear);
            if (near === true) later.changed_code++;
            else if (near === false) later.earlier_code++;
            else later.unknown++;
          }
        }
      } else {
        causes.get(cause).latest = f;
      }
    }
    if (index > 0 && report.review_mode === "incremental") later.dropped_as_earlier += Number(report.earlier_code_findings) || 0;
    newPerRound.push(fresh);
  });

  const decisions = ledger?.decisions || {};
  const human = { fixed: 0, wrong: 0, intentional: 0, irrelevant: 0, undecided: 0 };
  for (const [cause, info] of causes) {
    const ids = [...canonical].filter(([, c]) => c === cause).map(([id]) => id);
    // 같은 원인에 판단이 여럿이면 가장 최근(at) 것을 쓴다. at 이 없는 예전 기록은 가장 오래된 것으로 본다.
    const time = (entry) => { const t = Date.parse(entry?.at); return Number.isFinite(t) ? t : -Infinity; };
    const entries = ids.filter((id) => Object.hasOwn(decisions, id) && DECISIONS.includes(decisions[id]?.decision)).map((id) => decisions[id]);
    const decided = entries.reduce((best, e) => (!best || time(e) > time(best) ? e : best), null)?.decision;
    human[decided || "undecided"]++;
    info.decision = decided || null;
  }
  const latest = [...causes.values()].map((c) => c.latest);
  const last = reports.at(-1);
  return {
    pr,
    rounds: reports.length,
    skipped_reports: skipped,
    round_cap_reached: reports.length >= roundCap,
    first_round_clean: reports.length > 0 && reports[0].findings.length === 0,
    new_per_round: newPerRound,
    final: { head_sha: last?.head_sha ?? null, open: last ? last.findings.filter(isActive).length : 0 },
    findings: { total: causes.size, by_severity: count(latest, "severity"), by_kind: count(latest, "kind") },
    bot: {
      rejected: latest.filter((f) => f.verification === "rejected").length,
      pre_existing: latest.filter((f) => f.provenance === "pre_existing").length,
      resolved: latest.filter((f) => f.status === "resolved").length,
    },
    human,
    later_rounds: later,
  };
}

const sum = (items, pick) => items.reduce((acc, item) => {
  for (const [k, v] of Object.entries(pick(item))) acc[k] = (acc[k] || 0) + v;
  return acc;
}, {});
const ratio = (a, b) => (b ? a / b : null);

export function aggregate(summaries) {
  const reviewed = summaries.filter((s) => s.rounds > 0);
  const human = sum(summaries, (s) => s.human);
  const bot = sum(summaries, (s) => s.bot);
  const later = sum(summaries, (s) => s.later_rounds);
  const total = summaries.reduce((acc, s) => acc + s.findings.total, 0);
  const decided = DECISIONS.reduce((acc, d) => acc + (human[d] || 0), 0);
  return {
    prs: summaries.length,
    findings: { total, by_severity: sum(summaries, (s) => s.findings.by_severity), by_kind: sum(summaries, (s) => s.findings.by_kind) },
    bot,
    human,
    later_rounds: later,
    rounds: {
      max: Math.max(0, ...reviewed.map((s) => s.rounds)),
      mean: reviewed.length ? reviewed.reduce((acc, s) => acc + s.rounds, 0) / reviewed.length : null,
      cap_reached: summaries.filter((s) => s.round_cap_reached).length,
      clean_first_round: summaries.filter((s) => s.first_round_clean).length,
    },
    rates: {
      false_positive: ratio(human.wrong || 0, decided),
      fixed: ratio(human.fixed || 0, decided),
      bot_rejected: ratio(bot.rejected || 0, total),
      earlier_code_in_later_rounds: ratio((later.earlier_code || 0) + (later.dropped_as_earlier || 0),
        (later.changed_code || 0) + (later.earlier_code || 0) + (later.dropped_as_earlier || 0)),
    },
  };
}

const pct = (v) => (v === null ? "-" : `${Math.round(v * 100)}%`);

export function formatMarkdown(total, summaries) {
  const lines = [
    "## 기계 리뷰 지표", "",
    `PR ${total.prs}개, 지적(원인 기준) ${total.findings.total}건.`, "",
    "| 지표 | 값 |", "|---|---|",
    `| 오탐률(사람이 틀림으로 판정 ÷ 판정한 것) | ${pct(total.rates.false_positive)} |`,
    `| 고친 비율(고침 ÷ 판정한 것) | ${pct(total.rates.fixed)} |`,
    `| 리뷰 봇이 스스로 오탐으로 본 비율 | ${pct(total.rates.bot_rejected)} |`,
    `| 2라운드부터 새 지적 중 이미 리뷰한 코드 | ${pct(total.rates.earlier_code_in_later_rounds)} (모름 ${total.later_rounds.unknown || 0}건 제외) |`,
    `| 리뷰 라운드 평균 / 최대 | ${total.rounds.mean === null ? "-" : total.rounds.mean.toFixed(1)} / ${total.rounds.max} |`,
    `| 라운드 상한 도달 PR | ${total.rounds.cap_reached} |`,
    `| 1라운드에 지적 0건 | ${total.rounds.clean_first_round} |`,
    "",
    "| PR | 라운드 | 라운드별 새 지적 | 원인 | 고침 | 틀림 | 의도됨 | 상관없음 | 미판정 | 봇 오탐 | 기존 코드 | 마지막 열린 지적 |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...summaries.map((s) => `| #${s.pr} | ${s.rounds} | ${s.new_per_round.join("·") || "-"} | ${s.findings.total} | ${s.human.fixed} | ${s.human.wrong} | ${s.human.intentional} | ${s.human.irrelevant} | ${s.human.undecided} | ${s.bot.rejected} | ${s.bot.pre_existing} | ${s.final.open} |`),
  ];
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------- CLI
function fail(message) {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
}

function gh(argv) {
  const r = spawnSync("gh", argv, { encoding: "utf8", windowsHide: true });
  if (r.error || r.status !== 0) fail(`gh ${argv.join(" ")}: ${(r.stderr || r.error?.message || "").trim()}`);
  return r.stdout;
}

function repoRoot() {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : process.cwd();
}

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

// parent..head 사이에 바뀐 head 쪽 줄. 커밋이 로컬에 없으면 null.
// SHA 는 리뷰 봇이 쓴 블록에서 오므로 형식을 확인한다('--output=<경로>' 같은 값이 git 옵션으로 읽히지 않게).
export function gitChangedNear() {
  const cache = new Map();
  return (parent, head, location) => {
    if (!SHA.test(String(parent)) || !SHA.test(String(head)) || typeof location?.file !== "string" || !Number.isInteger(location.line)) return null;
    const key = `${parent}\0${head}\0${location.file}`;
    if (!cache.has(key)) {
      const r = spawnSync("git", ["diff", "-U0", "--no-color", "--no-ext-diff", parent, head, "--", location.file], { encoding: "utf8" });
      if (r.status !== 0) cache.set(key, null);
      else {
        const lines = [];
        for (const m of r.stdout.matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)) {
          const start = Number(m[1]), n = m[2] === undefined ? 1 : Number(m[2]);
          lines.push([start, start + Math.max(n, 1) - 1]);
        }
        cache.set(key, lines);
      }
    }
    const lines = cache.get(key);
    if (lines === null) return null;
    return lines.some(([a, b]) => location.line >= a - MARGIN && location.line <= b + MARGIN);
  };
}

function readLedger(pr) {
  const f = join(repoRoot(), "tmp", `review-findings-${pr}.json`);
  if (!existsSync(f)) return { decisions: {} };
  try { return JSON.parse(readFileSync(f, "utf8")); } catch { fail(`${f} 를 읽을 수 없습니다`); }
}

function main() {
  const args = process.argv.slice(2);
  const opt = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === "--json") { opt.json = true; continue; }
    if (!["--pr", "--repo", "--bot", "--input"].includes(key) || i + 1 >= args.length) fail(`알 수 없는 옵션이거나 값이 없습니다: ${key}`);
    opt[key.slice(2)] = args[++i];
  }
  if (opt.bot !== undefined && !/^[A-Za-z0-9-]+(\[bot\])?$/.test(opt.bot)) fail("--bot 은 GitHub 로그인입니다");
  let summaries;
  if (opt.input) {
    let data;
    try { data = JSON.parse(readFileSync(opt.input, "utf8")); } catch (e) { fail(`${opt.input} 를 읽을 수 없습니다: ${e.message}`); }
    summaries = (data.prs || []).map((p) => summarize({ pr: p.pr, comments: p.comments || [], ledger: p.ledger, bot: opt.bot || DEFAULT_BOT }));
  } else {
    if (!opt.pr || !/^\d+(,\d+)*$/.test(opt.pr)) fail("--pr <번호[,번호...]> 가 필요합니다");
    if (opt.repo !== undefined && !(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(opt.repo) && opt.repo.split("/").every((p) => p !== "." && p !== ".."))) fail("--repo 는 owner/name 형식입니다");
    // 처리 기록과 git 이력은 지금 checkout 의 것이다. 다른 저장소를 집계하면 섞지 않고 모름·미판정으로 둔다.
    const local = spawnSync("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], { encoding: "utf8", windowsHide: true });
    const localSlug = local.status === 0 ? local.stdout.trim() : null;
    const slug = opt.repo || localSlug || fail("저장소를 알 수 없습니다. --repo owner/name 을 주세요");
    const sameRepo = localSlug !== null && slug.toLowerCase() === localSlug.toLowerCase();
    if (!sameRepo) process.stderr.write(`경고: ${slug} 는 지금 checkout(${localSlug || "알 수 없음"})이 아니라 처리 기록과 git 비교를 쓰지 않습니다(미판정·모름으로 셉니다).\n`);
    const changedNear = sameRepo ? gitChangedNear() : () => null;
    summaries = opt.pr.split(",").map(Number).map((pr) => {
      const comments = gh(["api", `repos/${slug}/issues/${pr}/comments`, "--paginate", "--jq", ".[] | {id, created_at, login: .user.login, body} | tojson"])
        .split("\n").filter(Boolean).map((line) => JSON.parse(line));
      return summarize({ pr, comments, ledger: sameRepo ? readLedger(pr) : { decisions: {} }, bot: opt.bot || DEFAULT_BOT, changedNear });
    });
  }
  const total = aggregate(summaries);
  process.stdout.write(opt.json ? JSON.stringify({ total, prs: summaries }, null, 2) + "\n" : formatMarkdown(total, summaries));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
