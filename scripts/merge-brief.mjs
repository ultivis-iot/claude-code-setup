#!/usr/bin/env node
// 머지 전 이해 확인(docs/references/merge-readiness.md)에서 물을 질문 수를 PR 의 바뀐 파일로 정한다.
//
//   node merge-brief.mjs tier --pr <N> [--repo <o/r>]
//   node merge-brief.mjs tier --input <file>      (테스트용: {files: [{path, additions, deletions}]})
//
// 결과는 {tier, questions, lines, files, reasons} JSON 이다. 질문 수는 최소값이다. agent 는 늘릴 수 있지만
// 줄이지 않는다. 가장 높은 분류를 쓰고 상한은 5 다.
// - docs: README·CHANGELOG·LICENSE·*.txt·docs/(docs/references/ 제외)만 바뀜 → 0(브리프만)
// - code: 그 밖의 파일. agent 가 읽는 참조 문서·명령·스킬 Markdown 도 동작을 정하므로 여기 든다
//   → 1, 바뀐 줄이 150 을 넘으면 +1, 파일이 5 개를 넘으면 +1
// - sensitive: 검증·설치·hook·스키마·agent 정의·CI·인증·비밀·권한·토큰·마이그레이션 경로 → 4, 바뀐 줄이 300 을 넘으면 5
// 생성본(codex/plugins/dev-workflow/)은 원본과 같은 내용이라 세지 않는다.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MAX_QUESTIONS = 5;
const GENERATED = /^codex\/plugins\/dev-workflow\//;
const SENSITIVE = /^(hooks|schemas|agents|\.github)\/|(^|\/)(setup|install)[^/]*$|validation-gate|auth|secret|permission|token|migration/i;
const DOCS = /(^|\/)(README|CHANGELOG|LICENSE)[^/]*$|\.txt$/i;

function category(path) {
  if (SENSITIVE.test(path)) return "sensitive";
  if (DOCS.test(path) || (path.startsWith("docs/") && !path.startsWith("docs/references/"))) return "docs";
  return "code";
}

const count = (n) => Number.isInteger(n) && n >= 0;

export function classify(files) {
  if (!Array.isArray(files) || !files.every((f) => f && typeof f.path === "string" && f.path !== "" && count(f.additions) && count(f.deletions))) {
    throw new Error("files 는 {path, additions, deletions} 목록이어야 합니다");
  }
  const counted = files.filter((f) => !GENERATED.test(f.path)).map((f) => ({ path: f.path, lines: f.additions + f.deletions, category: category(f.path) }));
  const lines = counted.reduce((sum, f) => sum + f.lines, 0);
  const of = (name) => counted.filter((f) => f.category === name).map((f) => f.path);
  const sensitive = of("sensitive"), code = of("code");
  const reasons = [];
  let tier = "docs", questions = 0;
  if (sensitive.length) {
    tier = "sensitive";
    questions = 4 + (lines > 300 ? 1 : 0);
    reasons.push(`민감 경로: ${sensitive.join(", ")}`);
  } else if (code.length) {
    tier = "code";
    questions = 1 + (lines > 150 ? 1 : 0) + (counted.length > 5 ? 1 : 0);
    reasons.push(`코드: ${code.join(", ")}`);
  }
  if (tier !== "docs" && lines > (tier === "sensitive" ? 300 : 150)) reasons.push(`바뀐 줄 ${lines}`);
  if (tier === "code" && counted.length > 5) reasons.push(`파일 ${counted.length}개`);
  return { tier, questions: Math.min(questions, MAX_QUESTIONS), lines, files: counted, reasons };
}

function fail(message) {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
}

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

function loadFromGitHub(pr, repo) {
  const r = spawnSync("gh", ["pr", "view", pr, "--json", "files", ...(repo ? ["--repo", repo] : [])], { encoding: "utf8", windowsHide: true });
  if (r.error) fail(`gh 를 실행할 수 없습니다: ${r.error.message}`);
  if (r.status !== 0) fail(`gh pr view ${pr}: ${r.stderr.trim()}`);
  return JSON.parse(r.stdout);
}

function main() {
  const { cmd, opt } = args(process.argv.slice(2));
  if (cmd !== "tier") fail("사용법: merge-brief.mjs tier --pr <N> [--repo <o/r>] | --input <file>");
  // 값을 빠뜨린 옵션은 args() 에서 true 가 된다.
  for (const key of ["pr", "repo", "input"]) if (opt[key] === true) fail(`--${key} 에 값이 필요합니다`);
  if (!opt.input && !opt.pr) fail("--pr <번호> 또는 --input <파일> 이 필요합니다");
  if (opt.pr !== undefined && !/^\d+$/.test(opt.pr)) fail("--pr 은 PR 번호입니다");
  if (opt.repo !== undefined && !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(opt.repo)) fail("--repo 는 owner/name 형식입니다");
  const data = opt.input ? JSON.parse(readFileSync(opt.input, "utf8")) : loadFromGitHub(opt.pr, opt.repo);
  try {
    process.stdout.write(JSON.stringify(classify(data.files), null, 2) + "\n");
  } catch (error) {
    fail(error.message);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
