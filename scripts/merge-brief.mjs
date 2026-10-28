#!/usr/bin/env node
// 머지 전 이해 확인(docs/references/merge-readiness.md)에서 물을 질문 수를 PR 의 바뀐 파일로 정한다.
//
//   node merge-brief.mjs tier --pr <N> [--repo <o/r>]
//   node merge-brief.mjs tier --input <file>      (테스트용: {files: [{path, previous_path?, additions, deletions}]})
//
// 결과는 {tier, questions, lines, files, reasons} JSON 이다. 질문 수는 최소값이다. agent 는 늘릴 수 있지만
// 줄이지 않는다. 가장 높은 분류를 쓴다(최대 5).
// - docs: 최상위 README·CHANGELOG·LICENSE(확장자 없음·.md·.txt·.rst)와 docs/(docs/references/ 제외)의 .md·.txt·.rst 만 바뀜
//   → 0(브리프만)
// - code: 그 밖의 파일. agent 가 읽는 참조 문서·명령·스킬·템플릿도 동작을 정하므로 여기 든다
//   → 1, 바뀐 줄이 150 을 넘으면 +1, 파일이 5 개를 넘으면 +1
// - sensitive: 어느 깊이든(디렉터리 이름 포함) 아래 SENSITIVE 의 경로 → 4, 바뀐 줄이 300 을 넘으면 5. 검증·리뷰 게이트, 설치·
//   설정·배포, hook, 스키마, agent 정의, 에이전트·CI·패키지·컨테이너 설정, 사용자 설정에 설치되는 지시문(CLAUDE.md·
//   templates/global-claude.md), 환경·키 파일, 인증·비밀·권한·토큰·마이그레이션 이름이다. 이 밖의 위험(세션·암호화 코드 등)은
//   이름으로 다 알 수 없다.
// 이름을 바꾼 파일은 이전 경로로도 분류한다. 생성본(codex/plugins/dev-workflow/{skills,commands}/)은 같은 PR 에서
// 원본도 바뀌었을 때 분류·파일 수에서 빼지만 바뀐 줄로는 센다(이름을 바꿔 생성본 자리로 온 파일은 빼지 않는다).
// 이 도구는 이해 확인 질문의 최소 개수를 정할 뿐 보안 게이트가 아니다. 경로 이름만 보므로 내용이나 파일 모드(심볼릭 링크 등)의
// 위험은 알아내지 못한다. 그런 위험은 agent 가 diff 를 보고 질문을 늘린다. 새 검증·설치 스크립트를 더하면 SENSITIVE 에도 더한다.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CODE_LINES = 150, CODE_FILES = 5, SENSITIVE_LINES = 300;
const SENSITIVE = new RegExp([
  // hook·스키마·agent 정의·CI·에이전트 설정 디렉터리
  "(^|/)(hooks|schemas|agents|\\.github|\\.circleci|\\.buildkite|\\.gitea|\\.semaphore|\\.claude|\\.codex|\\.codex-plugin|\\.husky)/",
  // 설치·설정·게이트·배포 (디렉터리 이름이나 파일 이름의 앞부분)
  "(^|/)(setup|install|installer|gates?|deploy|release)s?([/._-]|$)",
  // 이 저장소의 검증·리뷰 도구와 Notion 자격 증명을 다루는 스크립트(새로 만들면 여기에 더한다)
  "(^|/)(validation-gate|review[-_]findings|merge-brief|verify-workflow|sync-workflow|graft|ult-notion|ult-flow|notion|review-cycle-ralph-loop)\\.[^/]*$",
  // 패키지·빌드·CI·컨테이너 설정, 환경 파일, 사용자 설정에 설치되는 지시문
  "(^|/)(\\.env[^/]*|package\\.json|\\.npmrc|makefile|dockerfile|docker-compose[^/]*|\\.gitlab-ci\\.ya?ml|\\.travis\\.ya?ml|jenkinsfile|azure-pipelines\\.ya?ml|bitbucket-pipelines\\.ya?ml|\\.drone\\.ya?ml|cloudbuild\\.ya?ml|appveyor\\.ya?ml|justfile|taskfile\\.ya?ml|claude\\.md|global-claude\\.md)$",
  // 키 파일
  "(\\.(pem|key)|(^|/)id_(rsa|ed25519|ecdsa)[^/]*)$",
  // 인증·비밀·권한·자격 증명 단어
  "(^|[/._-])(auth|authn|authz|authentication|oauth|jwt|secrets?|permissions?|tokens?|migrations?|credentials?|passwords?|api[-_]?keys?|keychain)([/._-]|$)",
].join("|"), "i");
const DOCS = /^(README|CHANGELOG|LICENSE)(\.(md|txt|rst))?$/i;
const TEXT_DOC = /\.(md|txt|rst)$/i;
// 생성본 자리와 그 원본. sync-workflow.mjs 가 원본을 그대로(명령은 .claude/ → .codex/ 만 바꿔) 복사한다.
const GENERATED = [["codex/plugins/dev-workflow/skills/", "codex/skills/"], ["codex/plugins/dev-workflow/commands/", "commands/"]];

function category(path) {
  if (SENSITIVE.test(path)) return "sensitive";
  if (DOCS.test(path) || (path.startsWith("docs/") && !path.startsWith("docs/references/") && TEXT_DOC.test(path))) return "docs";
  return "code";
}

const RANK = { docs: 0, code: 1, sensitive: 2 };
// 이름을 바꾼 파일은 새 경로와 이전 경로 중 더 높은 분류를 쓴다.
const highest = (paths) => paths.filter(Boolean).map(category).reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
const count = (n) => Number.isInteger(n) && n >= 0;
const pathOk = (p) => typeof p === "string" && p !== "";

export function classify(files) {
  if (!Array.isArray(files) || !files.every((f) => f && pathOk(f.path) && (f.previous_path == null || pathOk(f.previous_path)) && count(f.additions) && count(f.deletions))) {
    throw new Error("files 는 {path, previous_path?, additions, deletions} 목록이어야 합니다");
  }
  const changed = new Set(files.map((f) => f.path));
  // 이름을 바꿔 생성본 자리로 온 파일은 원본 복사본이 아니므로 빼지 않는다(이전 경로로 분류한다).
  const copyOfChangedSource = (f) => f.previous_path == null && GENERATED.some(([copy, source]) => f.path.startsWith(copy) && changed.has(source + f.path.slice(copy.length)));
  const counted = files.filter((f) => !copyOfChangedSource(f))
    .map((f) => ({ path: f.path, lines: f.additions + f.deletions, category: highest([f.path, f.previous_path]) }));
  // 생성본 줄도 센다. 그래서 lines 는 files[].lines 의 합보다 클 수 있다.
  const lines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
  const of = (name) => counted.filter((f) => f.category === name).map((f) => f.path);
  const sensitive = of("sensitive"), code = of("code");
  const reasons = [];
  let tier = "docs", questions = 0;
  if (sensitive.length) {
    tier = "sensitive";
    questions = 4;
    reasons.push(`민감 경로: ${sensitive.join(", ")}`);
    if (lines > SENSITIVE_LINES) { questions++; reasons.push(`바뀐 줄 ${lines}`); }
  } else if (code.length) {
    tier = "code";
    questions = 1;
    reasons.push(`코드: ${code.join(", ")}`);
    if (lines > CODE_LINES) { questions++; reasons.push(`바뀐 줄 ${lines}`); }
    if (counted.length > CODE_FILES) { questions++; reasons.push(`파일 ${counted.length}개`); }
  }
  return { tier, questions, lines, files: counted, reasons };
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

function gh(argv) {
  const r = spawnSync("gh", argv, { encoding: "utf8", windowsHide: true });
  if (r.error) fail(`gh 를 실행할 수 없습니다: ${r.error.message}`);
  if (r.status !== 0) fail(`gh ${argv.join(" ")}: ${r.stderr.trim()}`);
  return r.stdout;
}

// REST 파일 목록은 이전 경로(previous_filename)를 주고 최대 3000개까지다. PR 의 changed_files 와 다르면 잘린 것이니 멈춘다.
function loadFromGitHub(pr, repo) {
  const slug = repo || "{owner}/{repo}";
  const expected = Number(gh(["api", `repos/${slug}/pulls/${pr}`, "--jq", ".changed_files"]).trim());
  const files = gh(["api", "--paginate", `repos/${slug}/pulls/${pr}/files?per_page=100`, "--jq",
    ".[] | {path: .filename, previous_path: .previous_filename, additions, deletions}"]).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  if (!Number.isInteger(expected) || files.length !== expected) fail(`PR 파일 목록이 완전하지 않습니다(받은 ${files.length}개, PR 은 ${expected}개). 결과를 내지 않으니 질문은 4개로 보세요`);
  return { files };
}

function main() {
  const { cmd, opt } = args(process.argv.slice(2));
  if (cmd !== "tier") fail("사용법: merge-brief.mjs tier --pr <N> [--repo <o/r>] | --input <file>");
  // 값을 빠뜨린 옵션은 args() 에서 true 가 된다.
  for (const key of ["pr", "repo", "input"]) if (opt[key] === true) fail(`--${key} 에 값이 필요합니다`);
  if (!opt.input && !opt.pr) fail("--pr <번호> 또는 --input <파일> 이 필요합니다");
  if (opt.pr !== undefined && !/^\d+$/.test(opt.pr)) fail("--pr 은 PR 번호입니다");
  if (opt.repo !== undefined && !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(opt.repo)) fail("--repo 는 owner/name 형식입니다");
  try {
    const data = opt.input ? JSON.parse(readFileSync(opt.input, "utf8")) : loadFromGitHub(opt.pr, opt.repo);
    process.stdout.write(JSON.stringify(classify(data?.files), null, 2) + "\n");
  } catch (error) {
    fail(error.message);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
