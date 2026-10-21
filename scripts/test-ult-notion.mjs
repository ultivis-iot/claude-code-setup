// ult-notion.mjs 통합 테스트 (mock Notion + 가짜 gh + 임시 HOME/git repo). 실제 Notion API 는 호출하지 않는다.
// 저장소의 scripts/ 와 codex/skills/ux-review/scripts/ 를 임시 HOME 의 ~/.claude 로 "설치"한 뒤 그 설치본을 실행한다.
//   node scripts/test-ult-notion.mjs        (KEEP=1 이면 임시 디렉토리를 남긴다)
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, delimiter } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createMock, T, RT, SEL, STA, URLP, REL, PEO, DATE, NUM, FNUM, FDATE } from "./test-ult-notion-mock.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const ROOT = mkdtempSync(join(tmpdir(), "ult-notion-test-"));
const HOME = join(ROOT, "home"), WT = join(ROOT, "wt"), GHDIR = join(ROOT, "gh"), BARE = join(ROOT, "bare.git"), REPO = join(ROOT, "git", "demo");

// 설치 시뮬레이션: setup.sh 와 같은 규칙(test-*.mjs 제외, scripts/lib 포함)으로 ~/.claude 에 복사한다.
const INSTALLED = join(HOME, ".claude");
mkdirSync(join(INSTALLED, "scripts", "lib"), { recursive: true });
for (const f of readdirSync(join(REPO_ROOT, "scripts"))) {
  if (/^(?!test-).*\.mjs$/.test(f)) cpSync(join(REPO_ROOT, "scripts", f), join(INSTALLED, "scripts", f));
}
for (const f of readdirSync(join(REPO_ROOT, "scripts", "lib"))) cpSync(join(REPO_ROOT, "scripts", "lib", f), join(INSTALLED, "scripts", "lib", f));
cpSync(join(REPO_ROOT, "codex", "skills", "ux-review", "scripts"), join(INSTALLED, "skills", "ux-review", "scripts"), { recursive: true });
const PLUGIN = INSTALLED; // 아래 경로 조합용 (scripts/ult-notion.mjs, skills/ux-review/scripts/capture-origin.mjs)
const CLI = join(PLUGIN, "scripts", "ult-notion.mjs");
const lib = await import(pathToFileURL(join(PLUGIN, "scripts", "lib", "notion.mjs")).href);
const { DB, P } = lib;

let fails = 0, passes = 0;
const check = (name, cond, detail = "") => {
  if (cond) { passes++; console.log(`  PASS ${name}`); } else { fails++; console.log(`  FAIL ${name}${detail ? "\n       " + String(detail).slice(0, 600) : ""}`); }
};
const section = (n) => console.log(`\n== ${n}`);

// ---------------------------------------------------------------- 환경
for (const d of [join(HOME, ".claude"), WT, GHDIR, REPO]) mkdirSync(d, { recursive: true });
const SHIMDIR = join(ROOT, "shim"); mkdirSync(SHIMDIR);
// 가짜 gh/git 은 ULT_GH_BIN/ULT_GIT_BIN(.mjs)로 지정하므로 셸 shim 이 필요 없다(Windows 에서도 동작).
// SHIMDIR 은 ux-review capture-origin 테스트(POSIX 전용)의 gh shim 용.
const FAKE_GIT = join(HERE, "test-ult-notion-fake-git.mjs");
const SHIMPATH = SHIMDIR + delimiter + process.env.PATH;
const hasCmd = (name) => spawnSync(process.platform === "win32" ? "where" : "which", [name], { stdio: "ignore" }).status === 0;
const g = (args, cwd = REPO) => { const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, PATH: SHIMPATH, HOME, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return r.stdout.trim(); };
g(["init", "-b", "main"]);
writeFileSync(join(REPO, "README.md"), "hi\n");
g(["add", "."]); g(["commit", "-m", "init"]);
g(["init", "--bare", "-b", "main", BARE], ROOT);
g(["remote", "add", "origin", "https://github.com/ultivis/demo.git"]);
g(["branch", "dev"]); g(["push", BARE, "main:main", "dev:dev"]); g(["-c", `url.${BARE}.insteadOf=https://github.com/ultivis/demo.git`, "fetch", "origin"]);

const mock = createMock();
await mock.start();
const U1 = { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "테스터" };
const U2 = { id: "aaaaaaaa-0000-4000-8000-000000000002", name: "다른사람" };
mock.users.set(U1.id, U1.name); mock.users.set(U2.id, U2.name);

const day = (n) => { const d = new Date(Date.now() + n * 86400000); return lib.localDate(d); };
mock.addPage(DB.MEMBER, { Name: T("테스터"), Github: RT("tester"), Notion: PEO([U1]) });
mock.addPage(DB.MEMBER, { Name: T("다른사람"), Github: RT("other"), Notion: PEO([U2]) });
mock.addPage(DB.MEMBER, { Name: T("미등록"), Github: RT(""), Notion: PEO([]) });
const P1 = mock.addPage(DB.PROJECT, { Title: T("Ultivis CRM"), Status: STA("진행 중"), Manager: PEO([U1]), "Project Duration": DATE("2026-01-01", "2026-12-31"), "Work Progress": NUM(40) });
const P2 = mock.addPage(DB.PROJECT, { Title: T("Ultivis Vision"), Status: STA("진행 중") });
const R1 = mock.addPage(DB.REPOSITORY, { Name: T("ultivis/demo"), URL: URLP("https://github.com/ultivis/demo"), [P.REPO_PROJECT]: REL([P1.id]) });
const W0 = mock.addPage(DB.WEEK, { DateFrom: DATE("2026-10-12"), DateTo: FDATE("2026-10-18") });
const W1 = mock.addPage(DB.WEEK, { DateFrom: DATE("2026-10-19"), DateTo: FDATE("2026-10-25") });
const S1 = mock.addPage(DB.STORY, { Title: T("다크모드 설정"), Status: STA("진행 중"), Tag: SEL("Feature"), Priority: SEL("High"), [P.STORY_PROJECT]: REL([P1.id]), Assignee: PEO([U1]), "Issue URL": URLP(""), "Work Progress": NUM(30) });
const S0 = mock.addPage(DB.STORY, { Title: T("옛날 스토리"), Status: STA("완료"), Tag: SEL("Feature"), Priority: SEL("Low"), [P.STORY_PROJECT]: REL([P1.id]), Assignee: PEO([U1]) });
const S9 = mock.addPage(DB.STORY, { Title: T("다른 프로젝트 스토리"), Status: STA("진행 중"), Tag: SEL("Feature"), Priority: SEL("Low"), [P.STORY_PROJECT]: REL([P2.id]), Assignee: PEO([U2]) });
const tomorrow3 = day(3);
const T1 = mock.addPage(DB.TASK, { Name: T("설정 화면 토글"), Status: STA("진행 중"), Topic: SEL("Feature"), Assignee: PEO([U1]), "Issue URL": URLP("https://github.com/ultivis/demo/issues/7"), "PR URL": URLP(""), [P.STORY]: REL([S1.id]), [P.REPOSITORY]: REL([R1.id]), [P.PROJECT]: REL([P1.id]), [P.WEEK]: REL([W1.id]), "Planned Date": DATE(tomorrow3), "Working Time": FNUM(3.5), "Planned Time": FNUM(4), "On Time Rate": FNUM(70), "First Commit": FDATE("2026-10-20"), "Last Commit": FDATE("2026-10-21"), [P.COMMIT]: REL(["c1", "c2"]) });
const T2 = mock.addPage(DB.TASK, { Name: T("리팩터링 정리"), Status: STA("시작 전"), Topic: SEL("Refactor"), Assignee: PEO([U1]), "Issue URL": URLP(""), [P.STORY]: REL([S1.id]), [P.REPOSITORY]: REL([R1.id]), [P.PROJECT]: REL([P1.id]) },
  { children: [{ type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: "목표" } }] } }, { type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ type: "text", text: { content: "정리 A" } }] } }] });
const T3 = mock.addPage(DB.TASK, { Name: T("다른 저장소 작업"), Status: STA("시작 전"), Topic: SEL("Fix"), Assignee: PEO([U1]), "Issue URL": URLP("https://github.com/other/repo/issues/7") });
const T4 = mock.addPage(DB.TASK, { Name: T("링크 대상 작업"), Status: STA("시작 전"), Topic: SEL("Fix"), Assignee: PEO([U2]), "Issue URL": URLP("") });
const T5a = mock.addPage(DB.TASK, { Name: T("중복 A"), Status: STA("시작 전"), Assignee: PEO([U2]), "Issue URL": URLP("") });
const T5b = mock.addPage(DB.TASK, { Name: T("중복 B"), Status: STA("시작 전"), Assignee: PEO([U2]), "Issue URL": URLP("") });
const T6 = mock.addPage(DB.TASK, { Name: T("복구 대상"), Status: STA("시작 전"), Assignee: PEO([U2]), "Issue URL": URLP("") });

const h = (t, text) => ({ type: t, [t]: { rich_text: [{ type: "text", text: { content: text } }] } });
const TPL = [h("heading_2", "설명"), h("paragraph", "(설명을 입력하세요)"), h("heading_2", "체크리스트"), { type: "to_do", to_do: { rich_text: [{ type: "text", text: { content: "항목" } }], checked: false } }];
for (const id of [lib.TASK_TEMPLATE_ID, ...Object.values(lib.STORY_TEMPLATES)]) mock.blocks.set(id, TPL.map((b) => mock.mkBlock(b)));
mock.addPage(DB.WEEKLY_REVIEW, { Title: T("마케팅 템플릿"), [P.PROJECT]: REL([P1.id]) }, {
  id: lib.WEEKLY_REVIEW_MARKETING_TEMPLATE_ID,
  children: [h("heading_2", "새로 추가된 기능"), { type: "bulleted_list_item", bulleted_list_item: { rich_text: [] } }, h("heading_2", "기타 업데이트 내용"), { type: "bulleted_list_item", bulleted_list_item: { rich_text: [] } }, h("heading_2", "Task 보기")],
});

const gi = (num, title, body = "본문입니다") => ({ num, repo: "ultivis/demo", title, body, state: "OPEN", comments: [] });
writeFileSync(join(GHDIR, "state.json"), JSON.stringify({ next: 100, issues: [{ ...gi(7, "설정 화면 토글"), comments: ["첫 코멘트\n둘째 줄"], labels: [{ name: "feature" }], assignees: [{ login: "tester" }] }, gi(8, "링크 대상 작업"), gi(9, "중복"), gi(10, "복구 대상"), gi(11, "존재하지 않는 Task")] }));

const FAKE_GH = join(HERE, "test-ult-notion-fake-gh.mjs");
const baseEnv = () => {
  const e = { ...process.env, PATH: SHIMPATH, HOME, USERPROFILE: HOME, NOTION_API_BASE: mock.base, NOTION_TOKEN: "tok-env", ULT_GH_BIN: FAKE_GH, ULT_GIT_BIN: FAKE_GIT, FAKE_GIT_BARE: BARE, FAKE_GH_DIR: GHDIR, WORKTREE_ROOT: WT,
    ULT_NOTION_RETRY_BASE_MS: "5", ULT_NOTION_TEMPLATE_POLL_MS: "40", GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  for (const k of ["WORKFLOW_HOME", "APP_HOME", "WORKFLOW_CONFIG_JSON", "WORKFLOW_DEV_TOOLS_DIR", "WORKFLOW_CACHE_DIR", "ULT_NOTION_TEMPLATE_WAIT_SECONDS"]) delete e[k];
  return e;
};
function cli(args, { input, env = {}, cwd = REPO, unset = [] } = {}) {
  return new Promise((resolve) => {
    const e = { ...baseEnv(), ...env };
    for (const k of unset) delete e[k];
    const p = spawn(process.execPath, [CLI, ...args], { cwd, env: e, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out, err, all: out + err }));
    if (input !== undefined) p.stdin.write(input);
    p.stdin.end();
  });
}
const ghState = () => JSON.parse(readFileSync(join(GHDIR, "state.json"), "utf8"));
const commentsOf = (id) => mock.comments.filter((c) => c.page_id === id).map((c) => c.text);
const children = (id) => mock.blocks.get(id) || [];
const btext = (b) => (b[b.type].rich_text || []).map((x) => x.plain_text).join("");

try {
  // ------------------------------------------------------------ 0. md -> blocks
  section("md_to_blocks");
  {
    const md = "# H1\n## H2\n### H3\n- 항목\n* 별표\n1. 번호\n- [ ] 할일\n- [x] 완료\n> 인용\n---\n일반 문단\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n| 이름 | 값 |\n|---|---|\n| a | 1 |\n| b | 2 |\n끝";
    const b = lib.mdToBlocks(md);
    const types = b.map((x) => x.type).join(",");
    check("types in order", types === "heading_1,heading_2,heading_3,bulleted_list_item,bulleted_list_item,numbered_list_item,to_do,to_do,quote,divider,paragraph,code,table,paragraph", types);
    check("todo checked flags", b[6].to_do.checked === false && b[7].to_do.checked === true);
    check("code language + blank line preserved", b[11].code.language === "javascript" && b[11].code.rich_text[0].text.content === "const a = 1;\n\nconst b = 2;");
    check("table shape", b[12].table.table_width === 2 && b[12].table.has_column_header === true && b[12].table.children.length === 3 && b[12].table.children[1].table_row.cells[1][0].text.content === "1");
    check("block envelope", b[0].object === "block" && b[0].heading_1.rich_text[0].text.content === "H1");
    check("empty lines dropped, original paragraph-per-line", lib.mdToBlocks("a\n\n\nb").length === 2);
    check("2000+ chars split into rich_text items", lib.mdToBlocks("x".repeat(4500))[0].paragraph.rich_text.length === 3);
    check("empty input -> []", lib.mdToBlocks("").length === 0 && lib.mdToBlocks("\n\n").length === 0);
    check("CRLF handled", lib.mdToBlocks("## a\r\n- b\r\n").map((x) => x.type).join() === "heading_2,bulleted_list_item");
  }

  // ------------------------------------------------------------ 1. 토큰 우선순위
  section("token resolution order");
  {
    const U = "https://github.com/ultivis/demo/issues/7";
    const lastAuth = () => mock.log[mock.log.length - 1]?.auth;
    mock.expectedToken = null;
    const claudeJson = join(HOME, ".claude.json");
    const envFile = join(HOME, ".claude", "dev-tools", ".env");
    mkdirSync(dirname(envFile), { recursive: true });
    writeFileSync(envFile, '# comment\nexport NOTION_TOKEN="tok-file"\nOTHER=1\n');
    writeFileSync(claudeJson, JSON.stringify({ mcpServers: { "notion-api": { env: { NOTION_TOKEN: "tok-cfg-user" } } }, projects: { "/p": { mcpServers: { "notion-api": { env: { NOTION_TOKEN: "tok-proj" } } } } } }));
    let r = await cli(["find-task-by-issue-url", U], { env: { NOTION_TOKEN: "tok-env" } });
    check("env wins (and finds Task by URL)", lastAuth() === "Bearer tok-env" && r.out.trim() === T1.url, r.all);
    r = await cli(["find-task-by-issue-url", U], { unset: ["NOTION_TOKEN"] });
    check(".env file next", lastAuth() === "Bearer tok-file", lastAuth() + r.all);
    rmSync(envFile);
    r = await cli(["find-task-by-issue-url", U], { unset: ["NOTION_TOKEN"] });
    check("~/.claude.json mcpServers (user scope) next", lastAuth() === "Bearer tok-cfg-user", lastAuth());
    writeFileSync(claudeJson, JSON.stringify({ projects: { "/a": { mcpServers: {} }, "/b": { mcpServers: { "notion-api": { env: { NOTION_TOKEN: "tok-proj" } } } } } }));
    r = await cli(["find-task-by-issue-url", U], { unset: ["NOTION_TOKEN"] });
    check("first projects[*].mcpServers token", lastAuth() === "Bearer tok-proj", lastAuth());
    const alt = join(ROOT, "alt.json");
    writeFileSync(alt, JSON.stringify({ mcpServers: { "notion-api": { env: { NOTION_TOKEN: "tok-alt" } } } }));
    r = await cli(["find-task-by-issue-url", U], { unset: ["NOTION_TOKEN"], env: { WORKFLOW_CONFIG_JSON: alt } });
    check("WORKFLOW_CONFIG_JSON override", lastAuth() === "Bearer tok-alt", lastAuth());
    rmSync(claudeJson);
    r = await cli(["find-task-by-issue-url", U], { unset: ["NOTION_TOKEN"] });
    check("no token -> exit 1 + Korean guidance", r.code === 1 && /Notion 토큰을 찾을 수 없습니다/.test(r.err) && /setx NOTION_TOKEN/.test(r.err), r.all);
    mock.expectedToken = "tok-env";
    r = await cli(["find-task-by-issue-url", U], { env: { NOTION_TOKEN: "wrong" } });
    check("401 -> Korean auth error", r.code === 1 && /인증 실패 \(401\)/.test(r.err), r.err);
    mock.expectedToken = null;
    check("Notion-Version header 2025-09-03", mock.log.every((x) => x.version === "2025-09-03"));
  }

  // ------------------------------------------------------------ 2. 재시도 / 에러
  section("retry + errors");
  {
    const U = "https://github.com/ultivis/demo/issues/7";
    mock.log.length = 0;
    await fetch(mock.base.replace("/v1", "") + "/__faults", { method: "POST", body: JSON.stringify({ count: 2, status: 429, retryAfter: 0 }) });
    let r = await cli(["find-task-by-issue-url", U]);
    check("429 x2 retried then success", r.code === 0 && r.out.trim() === T1.url && mock.log.length === 3, `${r.all} log=${mock.log.length}`);
    await fetch(mock.base.replace("/v1", "") + "/__faults", { method: "POST", body: JSON.stringify({ count: 2, status: 503 }) });
    mock.log.length = 0;
    r = await cli(["find-task-by-issue-url", U]);
    check("503 x2 retried then success", r.code === 0 && mock.log.length === 3, r.all);
    await fetch(mock.base.replace("/v1", "") + "/__faults", { method: "POST", body: JSON.stringify({ count: 10, status: 429, retryAfter: 0 }) });
    r = await cli(["find-task-by-issue-url", U], { env: { ULT_NOTION_MAX_RETRIES: "2" } });
    check("429 exhausted -> Korean error, exit 1", r.code === 1 && /요청 한도 초과 \(429\)/.test(r.err), r.err);
    mock.faults.length = 0;
    r = await cli(["task-link-issue", "#7", "--task", "12345678-1234-4234-8234-123456789012"]);
    check("404 -> Korean hint about sharing integration", r.code === 1 && /공유\(연결\)/.test(r.err), r.err);
  }

  // ------------------------------------------------------------ 3. my-tasks
  section("my-tasks");
  let wt7;
  {
    let r = await cli(["my-tasks"]);
    check("list: header + groups + non-TTY hint", r.code === 0 && /테스터님 할당 Task 3건/.test(r.out) && /📍 진행 중 \(1\)/.test(r.out) && /⏳ 시작 전 \(2\)/.test(r.out) && /--select <번호>/.test(r.out), r.all);
    check("list: issue/num/story/repo/deadline format", /#7 \[Feature\] 설정 화면 토글/.test(r.out) && /📜 다크모드 설정 · D-3/.test(r.out) && /🥨 ultivis\/demo/.test(r.out) && /#\(미발행\) \[Refactor\] 리팩터링 정리/.test(r.out) && /마감 미정/.test(r.out) && /\[1\] 선택/.test(r.out), r.out);
    check("list: no worktree/issue side effects without --select", ghState().issues.length === 5 && !existsSync(join(WT, "d-7")));
    r = await cli(["my-tasks", "--all"]);
    check("--all lists too", /할당 Task \d+건/.test(r.out) && /--all --select 1/.test(r.out), r.out);
    r = await cli(["my-tasks", "--week"]);
    check("--week filters by current Week relation", /테스터님 할당 Task 1건/.test(r.out) && /#7/.test(r.out) && !/리팩터링/.test(r.out), r.out);
    r = await cli(["my-tasks", "--select", "9"]);
    check("invalid selection", r.code === 1 && /잘못된 선택/.test(r.err), r.all);
    r = await cli(["my-tasks", "--select", "1"]);
    wt7 = join(WT, "d-7");
    check("select 1 (#7, issue URL set): branch + worktree", r.code === 0 && /Worktree: .*d-7/.test(r.out) && existsSync(wt7) && /cc d-7/.test(r.out), r.all);
    check("worktree branch name", g(["branch", "--show-current"], wt7) === "7-feature-task", g(["branch", "--show-current"], wt7));
    check("gh merge-base configured", g(["config", "branch.7-feature-task.gh-merge-base"], wt7) === "dev");
    const before = ghState().issues.length;
    r = await cli(["my-tasks", "--select", "2"]);
    const issues = ghState().issues;
    const newIssue = issues[issues.length - 1];
    check("select 2 (unpublished): GitHub Issue created from Task body", issues.length === before + 1 && newIssue.title === "리팩터링 정리" && newIssue.repo === "ultivis/demo" && /^Notion Task: https:\/\/www\.notion\.so\//.test(newIssue.body) && /## 목표/.test(newIssue.body) && /- 정리 A/.test(newIssue.body), JSON.stringify(newIssue));
    check("Task Issue URL patched", T2.properties["Issue URL"].url === `https://github.com/ultivis/demo/issues/${newIssue.num}`, JSON.stringify(T2.properties["Issue URL"]));
    check("announces issue + worktree for new issue", /GitHub Issue 생성 및 Task 연결/.test(r.out) && existsSync(join(WT, `d-${newIssue.num}`)) && g(["branch", "--show-current"], join(WT, `d-${newIssue.num}`)) === `${newIssue.num}-refactor-task`, r.all);
  }

  // ------------------------------------------------------------ 4. task-note / status / issue
  section("task-note / task-status / issue / sync-task (cwd = worktree of #7)");
  {
    let r = await cli(["task-note", "토큰 갱신 흐름", "확인 대기"], { cwd: wt7 });
    const c1 = commentsOf(T1.id);
    check("task-note adds [author] comment on the Task found by exact Issue URL", r.code === 0 && c1.includes("[테스터] 토큰 갱신 흐름 확인 대기") && /✓ Task #7 \(설정 화면 토글\) 에 코멘트 추가됨/.test(r.out), r.all + JSON.stringify(c1));
    check("NOT attached to other-repo Task with the same issue number", commentsOf(T3.id).length === 0);
    r = await cli(["task-note", ""], { cwd: wt7 });
    check("empty note -> usage error", r.code === 1 && /사용법/.test(r.err));
    r = await cli(["task-status", "#7", "done", "--reason", "수동 확인"], { cwd: wt7 });
    check("task-status: status patched + history comment", r.code === 0 && T1.properties.Status.status.name === "완료" && commentsOf(T1.id).includes("[테스터] 상태 변경: 진행 중 → 완료\n사유: 수동 확인") && /✓ Task #7 상태: 진행 중 → 완료/.test(r.out) && /사유: 수동 확인/.test(r.out) && /현재 상태: 진행 중/.test(r.out), r.all);
    r = await cli(["task-status", "reopen"], { cwd: wt7 });
    check("task-status: action only uses current branch issue", r.code === 0 && T1.properties.Status.status.name === "시작 전", r.all);
    r = await cli(["task-status", "#7", "bogus"], { cwd: wt7 });
    check("unknown action rejected", r.code === 1 && /알 수 없는 action: bogus/.test(r.err), r.all);
    r = await cli(["task-status", "#7"], { cwd: wt7 });
    check("no action + non-TTY: menu printed and error", r.code === 1 && /\[1\] cancel/.test(r.out) && /action 인자가 필요합니다/.test(r.err), r.all);
    r = await cli(["task-status", "in-progress"], { cwd: wt7 });
    r = await cli(["sync-task", "done"], { cwd: wt7 });
    check("sync-task <action> -> status", r.code === 0 && T1.properties.Status.status.name === "완료");
    r = await cli(["sync-task", "작업", "메모", "하나"], { cwd: wt7 });
    check("sync-task <text> -> note", r.code === 0 && commentsOf(T1.id).includes("[테스터] 작업 메모 하나"));
    r = await cli(["issue"], { cwd: wt7 });
    check("issue: GitHub section", /### Issue #7: 설정 화면 토글/.test(r.out) && /- \*\*상태\*\*: OPEN/.test(r.out) && /- \*\*브랜치\*\*: 7-feature-task/.test(r.out) && /- \*\*라벨\*\*: feature/.test(r.out) && /- \*\*담당자\*\*: tester/.test(r.out) && /#### 본문\n본문입니다/.test(r.out), r.all);
    check("issue: Task block with formula values (Working Time/commits)", /### 📋 Notion Task/.test(r.out) && /- \*\*이름\*\*: 설정 화면 토글/.test(r.out) && /- \*\*상태\*\*: 완료/.test(r.out) && /- \*\*Working Time\*\*: 3\.5h \(계획 4h, On Time Rate 70%\)/.test(r.out) && /- \*\*First Commit\*\*: 2026-10-20/.test(r.out) && /- \*\*Last Commit\*\*: 2026-10-21/.test(r.out) && /- \*\*Repository\*\*: ultivis\/demo/.test(r.out), r.out);
    check("issue: Story/Project blocks (Work Progress rollup/number)", /#### 📜 Story: 다크모드 설정/.test(r.out) && /- \*\*Work Progress\*\*: 30/.test(r.out) && /#### 🛡️ Project: Ultivis CRM/.test(r.out) && /- \*\*Manager\*\*: 테스터/.test(r.out) && /- \*\*Duration\*\*: 2026-01-01 ~ 2026-12-31/.test(r.out) && /- \*\*Work Progress\*\*: 40/.test(r.out), r.out);
    check("issue: GitHub comments", /#### 코멘트 \(GitHub\)\n- \*\*tester\*\* \(2026-10-02T00:00:00Z\): 첫 코멘트 둘째 줄/.test(r.out), r.out);
    r = await cli(["sync-task"], { cwd: wt7 });
    check("sync-task (no args) == issue", /### Issue #7/.test(r.out));
    // 브랜치 이슈가 Notion 에 없는 경우
    g(["branch", "11-fix-x"], REPO);
    const wt11 = join(WT, "d-11");
    spawnSync("git", ["worktree", "add", wt11, "11-fix-x"], { cwd: REPO, env: baseEnv() });
    r = await cli(["issue"], { cwd: wt11 });
    check("issue: not found in Notion -> guidance", /Notion Task\/Story를 찾지 못했습니다/.test(r.out) && /task-link-issue #11 --task/.test(r.out), r.out);
    r = await cli(["task-note", "x"], { cwd: wt11 });
    check("task-note on unlinked issue fails with recovery hint (no number-only match)", r.code === 1 && /Notion에서 찾을 수 없음/.test(r.err) && /task-link-issue #11/.test(r.err), r.err);
  }

  // ------------------------------------------------------------ 5. task-link-issue
  section("task-link-issue");
  {
    let r = await cli(["task-link-issue", "#8", "--auto"]);
    check("--auto links the unique title match", r.code === 0 && T4.properties["Issue URL"].url === "https://github.com/ultivis/demo/issues/8" && /✓ Task와 GitHub Issue 연결됨/.test(r.out), r.all);
    r = await cli(["task-link-issue", "#8", "--auto"]);
    check("idempotent: 이미 연결됨", /✓ 이미 연결됨: #8 링크 대상 작업/.test(r.out), r.all);
    r = await cli(["task-link-issue", "#9", "--auto"]);
    check("ambiguous title -> aborts with candidate list", r.code === 1 && /여러 개라 자동 연결을 중단/.test(r.err) && /중복 A/.test(r.err) && /중복 B/.test(r.err), r.err);
    r = await cli(["task-link-issue", "#9"]);
    check("ambiguous non-TTY -> aborts too", r.code === 1 && /여러 개/.test(r.err));
    r = await cli(["task-link-issue", "https://github.com/ultivis/demo/issues/9", "--task", T5b.url]);
    check("--task <notion url> explicit link", r.code === 0 && T5b.properties["Issue URL"].url === "https://github.com/ultivis/demo/issues/9", r.all);
    r = await cli(["task-link-issue", "#9", "--task", T5a.id]);
    check("different existing URL: non-TTY refuses without --yes? (T5a empty -> links)", r.code === 0, r.all);
    r = await cli(["task-link-issue", "#9", "--task", T5b.id]);
    check("already-linked-to-same URL? T5b has /9 -> 이미 연결됨", /이미 연결됨/.test(r.out), r.all);
    r = await cli(["task-link-issue", "#8", "--task", T5b.id]);
    check("overwrite differing URL refused when non-interactive", r.code === 1 && /이미 다른 Issue URL/.test(r.err), r.all);
    r = await cli(["task-link-issue", "#8", "--task", T5b.id, "--yes"]);
    check("--yes overwrites", r.code === 0 && T5b.properties["Issue URL"].url === "https://github.com/ultivis/demo/issues/8");
    // 복구 경로: task-status 가 못 찾으면 자동 연결
    r = await cli(["task-status", "#10", "in-progress"]);
    check("task-status auto-link recovery then status change", r.code === 0 && T6.properties["Issue URL"].url === "https://github.com/ultivis/demo/issues/10" && T6.properties.Status.status.name === "진행 중" && /자동 연결을 시도합니다/.test(r.err), r.all);
    r = await cli(["task-link-issue", "#11", "--auto"]);
    check("no match at all -> error with hint", r.code === 1 && /title이 매칭되는 Task를 찾지 못했습니다/.test(r.err));
  }

  // ------------------------------------------------------------ 6. story-create
  section("story-create (2 tasks: existing-parent + in-spec parent) + task wait/after-설명");
  let createdStory, taskA, taskB;
  {
    const spec = {
      github_repo: "ultivis/demo",
      story: { title: "알림 센터 개편", tag: "Feature", priority: "High", project_id: P1.id, assignee_notion_id: U1.id, body_markdown: "## 배경\n- 사용자 알림이 흩어져 있음\n- [ ] 정리\n\n```js\nconst x = 1;\n```\n| a | b |\n|---|---|\n| 1 | 2 |" },
      tasks: [
        { name: "API 추가", topic: "Feature", description: "## 목표\n- 하나\n- 둘", planned_start: "2026-10-22", planned_end: "2026-10-24", repository_id: R1.id, week_id: W1.id, parent_task_ids: [T1.id] },
        { name: "UI 연결", topic: "Fix", description: "설명 한 줄", repository_id: R1.id, parent_task_indexes: [0] },
      ],
    };
    const t0 = Date.now();
    const r = await cli(["story-create", "-"], { input: JSON.stringify(spec) });
    check("exit 0 + completion banner", r.code === 0 && /✅ 발행 완료/.test(r.out) && /Task 2개, Issue 2개, Worktree 2개/.test(r.out), r.all);
    check("progress output format", /▸ Story 생성 중\.\.\./.test(r.out) && /✓ 알림 센터 개편/.test(r.out) && /▸ Task 생성 중\.\.\./.test(r.out) && /✓ #\d+ \[Feature\] API 추가/.test(r.out) && /✓ #\d+ \[Fix\] UI 연결/.test(r.out) && /▸ Worktree 생성 중\.\.\./.test(r.out), r.out);
    createdStory = [...mock.pages.values()].find((p) => p.ds === DB.STORY && lib.pageTitle(p) === "알림 센터 개편");
    check("Story page created with props (trailing-space Project relation, Tag, Priority, Assignee)", createdStory && createdStory.properties[P.STORY_PROJECT].relation[0].id === P1.id && createdStory.properties.Tag.select.name === "Feature" && createdStory.properties.Priority.select.name === "High" && createdStory.properties.Assignee.people[0].id === U1.id);
    const sb = children(createdStory.id).map((b) => `${b.type}:${btext(b) || ""}`);
    check("Story: template applied (waited) and Plan inserted right after '설명'", sb[0] === "heading_2:설명" && sb[1] === "heading_2:배경" && sb[2].startsWith("bulleted_list_item:사용자") && sb[3] === "to_do:정리" && sb[4].startsWith("code:") && sb[5] === "table:" && sb[6].startsWith("paragraph:(설명을") && sb.includes("heading_2:체크리스트"), sb.join(" | "));
    taskA = [...mock.pages.values()].find((p) => p.ds === DB.TASK && lib.taskName(p) === "API 추가");
    taskB = [...mock.pages.values()].find((p) => p.ds === DB.TASK && lib.taskName(p) === "UI 연결");
    check("Task A props: story/project/repo/week/parent/planned/issue url", taskA && taskA.properties[P.STORY].relation[0].id === createdStory.id && taskA.properties[P.PROJECT].relation[0].id === P1.id && taskA.properties[P.REPOSITORY].relation[0].id === R1.id && taskA.properties[P.WEEK].relation[0].id === W1.id && taskA.properties["Parent Task"].relation[0].id === T1.id && taskA.properties["Planned Date"].date.start === "2026-10-22" && taskA.properties["Planned Date"].date.end === "2026-10-24" && /\/issues\/\d+$/.test(taskA.properties["Issue URL"].url) && taskA.properties.Topic.select.name === "Feature");
    check("Task B parent = Task A (in-spec dependency)", taskB && taskB.properties["Parent Task"].relation.map((x) => x.id).join() === taskA.id);
    const ab = children(taskA.id).map((b) => `${b.type}:${btext(b)}`);
    check("Task A: description after '설명' as blocks (heading_2 + bullets)", ab[0] === "heading_2:설명" && ab[1] === "heading_2:목표" && ab[2] === "bulleted_list_item:하나" && ab[3] === "bulleted_list_item:둘" && ab[4].startsWith("paragraph:(설명을"), ab.join(" | "));
    const iss = ghState().issues;
    const ia = iss.find((i) => i.title === "API 추가");
    check("GitHub Issue bodies: description + Story URL + base branch", ia && /## 목표/.test(ia.body) && ia.body.includes(`Notion Story: ${createdStory.url}`) && /Task Base Branch: dev/.test(ia.body), ia?.body);
    const numA = ia.num, numB = iss.find((i) => i.title === "UI 연결").num;
    const wtA = join(WT, `d-${numA}`), wtB = join(WT, `d-${numB}`);
    check("worktrees created on feature branches from dev", existsSync(wtA) && existsSync(wtB) && g(["branch", "--show-current"], wtA) === `${numA}-feature-api` && g(["branch", "--show-current"], wtB) === `${numB}-fix-ui`, g(["branch", "--show-current"], wtA));
    check("Task branch comments", commentsOf(taskA.id).some((c) => c.includes(`Branch: ${numA}-feature-api`) && c.includes("Base Branch: dev") && c.includes(`Worktree: ${wtA}`) && c.includes(`Notion Story: ${createdStory.url}`)), JSON.stringify(commentsOf(taskA.id)));
    const hj = JSON.parse(readFileSync(join(wtB, "tmp", "story-handoff.json"), "utf8"));
    check("handoff JSON in each worktree (2 tasks, parent urls)", hj.tasks.length === 2 && hj.story.notion_url === createdStory.url && hj.tasks.find((t) => t.name === "UI 연결").parent_issue_urls[0] === taskA.properties["Issue URL"].url && hj.tasks.find((t) => t.name === "API 추가").parent_issue_urls[0] === T1.properties["Issue URL"].url && existsSync(join(wtA, "tmp", "story-handoff.md")) && hj.tasks.every((t) => t.status === "Ready" && t.base_branch === "dev"), JSON.stringify(hj.tasks));
    const sc = commentsOf(createdStory.id);
    check("handoff comments chunked (<=1800) with [Story handoff n] prefix and marker", sc.length >= 2 && sc.every((c, i) => c.startsWith(`[Story handoff ${i + 1}]\n`) && c.length <= 1800 + 20) && sc.map((c) => c.replace(/^\[Story handoff \d+\]\n/, "")).join("").includes("<!-- ult-story-handoff-json"), `n=${sc.length}`);
    const joined = sc.map((c) => c.replace(/^\[Story handoff \d+\]\n/, "")).join("");
    const m = joined.match(/<!-- ult-story-handoff-json\n([\s\S]*?)\n-->/);
    check("handoff comment JSON round-trips", m && JSON.parse(m[1]).tasks.length === 2);
    check("ran in parallel-capable manner within reasonable time", Date.now() - t0 < 60000);
    // spec validation
    const bad = await cli(["story-create", "-"], { input: JSON.stringify({ github_repo: "a/b", story: { title: "x" }, tasks: [] }) });
    check("invalid spec rejected", bad.code === 1 && /spec 형식 오류/.test(bad.err), bad.err);
    const badTag = await cli(["story-create", "-"], { input: JSON.stringify({ ...spec, story: { ...spec.story, tag: "Nope" } }) });
    check("unknown tag -> template id error, no blank Story created", badTag.code === 1 && /Story template id is empty for tag: Nope/.test(badTag.err), badTag.err);
  }

  // ------------------------------------------------------------ 7. task-create
  section("task-create");
  {
    let r = await cli(["task-create", "--story", S0.url, "--name", "x"]);
    check("terminal Story rejected", r.code === 1 && /종료 상태/.test(r.err), r.err);
    r = await cli(["task-create", "--story", S9.url, "--name", "x"]);
    check("Project mismatch rejected", r.code === 1 && /Project가 현재 repository의 Project와 일치하지 않습니다/.test(r.err), r.err);
    r = await cli(["task-create", "--story", S1.url]);
    check("missing --name non-TTY -> error", r.code === 1 && /Task Name은 필수/.test(r.err), r.err);
    r = await cli(["task-create", "--story", S1.url, "--name", "x", "--topic", "wat"]);
    check("unknown topic rejected", r.code === 1 && /알 수 없는 topic/.test(r.err), r.err);
    r = await cli(["task-create", "--story", S1.url, "--name", "x", "--project", "Ultivis Vision"]);
    check("--project not in repo's Projects rejected", r.code === 1 && /지정한 Project가 현재 repository의 Project relation에 포함되지 않습니다/.test(r.err), r.err);
    const before = ghState().issues.length;
    r = await cli(["task-create", "--story", S1.url, "--name", "후속 검증 작업", "--topic", "fix", "--description", "## 검증\n- 케이스 1", "--planned-start", "2026-10-25", "--parent-task", T1.url]);
    const nt = [...mock.pages.values()].find((p) => p.ds === DB.TASK && lib.taskName(p) === "후속 검증 작업");
    check("exit 0 + summary", r.code === 0 && /✅ Task 생성 완료/.test(r.out) && /Story: 다크모드 설정/.test(r.out) && /Base Branch: dev/.test(r.out) && ghState().issues.length === before + 1, r.all);
    const num = nt && (nt.properties["Issue URL"].url.match(/(\d+)$/) || [])[1];
    check("Task props (Topic normalized to Fix, parent, planned, repo auto-detected, Week)", nt && nt.properties.Topic.select.name === "Fix" && nt.properties["Parent Task"].relation[0].id === T1.id && nt.properties["Planned Date"].date.start === "2026-10-25" && nt.properties[P.REPOSITORY].relation[0].id === R1.id && nt.properties[P.STORY].relation[0].id === S1.id && nt.properties[P.PROJECT].relation[0].id === P1.id && nt.properties.Assignee.people[0].id === U1.id && nt.properties[P.WEEK].relation[0].id === W1.id);
    const ntb = children(nt.id).map((b) => `${b.type}:${btext(b)}`);
    check("description inserted after 설명", ntb[0] === "heading_2:설명" && ntb[1] === "heading_2:검증" && ntb[2] === "bulleted_list_item:케이스 1", ntb.join("|"));
    const wtn = join(WT, `d-${num}`);
    check("worktree + branch", existsSync(wtn) && g(["branch", "--show-current"], wtn) === `${num}-fix-task`, g(["branch", "--show-current"], wtn));
    check("branch note on Task + GitHub issue", commentsOf(nt.id).some((c) => c.startsWith(`Branch: ${num}-fix-task\nBase Branch: dev\nWorktree: `)) && ghState().issues.find((i) => String(i.num) === num).comments.some((c) => c.includes("Base Branch: dev")));
    const hj = JSON.parse(readFileSync(join(wtn, "tmp", "story-handoff.json"), "utf8"));
    check("new handoff created in worktree tmp/ with the Task", hj.tasks.length === 1 && hj.tasks[0].notion_task_id === nt.id && hj.story.notion_id === S1.id && hj.tasks[0].parent_issue_urls[0] === T1.properties["Issue URL"].url);
    check("Story handoff-update comment", commentsOf(S1.id).some((c) => c.startsWith("Story Handoff Update\n\nAdded Task: 후속 검증 작업")));
    // 2번째: worktree 안에서 handoff 컨텍스트로 Story 추론 + --here
    r = await cli(["task-create", "--name", "컨텍스트 추론 작업", "--here"], { cwd: wtn });
    const nt2 = [...mock.pages.values()].find((p) => p.ds === DB.TASK && lib.taskName(p) === "컨텍스트 추론 작업");
    check("Story inferred from local tmp/story-handoff.json; --here skips worktree", r.code === 0 && nt2 && nt2.properties[P.STORY].relation[0].id === S1.id && /브랜치\/worktree 생성 생략/.test(r.out) && !/Worktree:/.test(r.out.split("✅")[1] || ""), r.all);
    const hj2 = JSON.parse(readFileSync(join(wtn, "tmp", "story-handoff.json"), "utf8"));
    check("--here: appended to existing context handoff", hj2.tasks.length === 2 && hj2.tasks[1].name === "컨텍스트 추론 작업");
    // Story 를 title 로
    r = await cli(["task-create", "다크모드", "--name", "title 로 Story 선택", "--here"]);
    check("Story by title (active + repo project only)", r.code === 0 && /Story: 다크모드 설정/.test(r.out), r.all);
    // --no-checkout
    r = await cli(["task-create", "--story", S1.url, "--name", "브랜치만", "--no-checkout", "--base", "main"]);
    check("--no-checkout creates local branch only, base override", r.code === 0 && /▸ 브랜치 생성:/.test(r.out) && /Base Branch: main/.test(r.out), r.all);
  }

  // ------------------------------------------------------------ 8. weekly
  section("weekly-collect / weekly-publish");
  {
    let r = await cli(["weekly-collect", "--week", "2026-10-21"]);
    let j; try { j = JSON.parse(r.out); } catch {}
    check("collect: JSON shape (week/user/stats/tasks)", j && j.week.date_from === "2026-10-19" && j.week.date_to === "2026-10-25" && j.user === "테스터" && j.team_mode === false && j.stats.total >= 1 && j.tasks.some((x) => x.issue_num === "7"), r.all);
    const t = j?.tasks?.find((x) => x.issue_num === "7");
    check("collect: task fields incl. formulas", t && t.name === "설정 화면 토글" && t.issue_num === "7" && t.working_time === 3.5 && t.planned_time === 4 && t.on_time_rate === 70 && t.first_commit === "2026-10-20" && t.commit_count === 2 && t.story_name === "다크모드 설정" && t.project_name === "Ultivis CRM" && t.assignees[0] === "테스터", JSON.stringify(t));
    check("collect: stats", j.stats.total_working === 3.5 && j.stats.on_time_low[0].name === "설정 화면 토글" && j.stats.by_status["완료"] === 1 && j.stats.total === j.tasks.length && j.stats.overdue.length === 0, JSON.stringify(j.stats));
    r = await cli(["weekly-collect", "--week", "2026-10-21", "--team"]);
    j = JSON.parse(r.out);
    check("collect --team", j.team_mode === true && j.user === "" && j.stats.total >= 1);
    r = await cli(["weekly-collect", "--week", "2019-01-01"]);
    check("week not found -> JSON error + exit 1", r.code === 1 && JSON.parse(r.out).error === "Week not found", r.all);

    const md = "## 새로 추가된 기능\n- 다크모드 지원\n- 알림 센터\n\n## 기타 업데이트 내용\n* 토글 버그 수정\n\n## Task 보기\n- 무시됨\n";
    r = await cli(["weekly-publish", "2026-10-21", "--project", "Ultivis CRM"], { input: md });
    check("publish: ✓ 발행됨 URL", r.code === 0 && /^✓ 발행됨: https:\/\/www\.notion\.so\//m.test(r.out), r.all);
    const wr = [...mock.pages.values()].find((p) => p.ds === DB.WEEKLY_REVIEW && lib.pageTitle(p) === "CRM-26-10-03");
    check("publish: title CRM-YY-MM-WW + Week/Project relations", wr && wr.properties[P.WEEK].relation[0].id === W1.id && wr.properties[P.PROJECT].relation[0].id === P1.id, [...mock.pages.values()].filter((p) => p.ds === DB.WEEKLY_REVIEW).map((p) => lib.pageTitle(p)).join());
    const wb = children(wr.id).map((b) => `${b.type}:${btext(b)}`);
    check("publish: bullets inserted after each heading, empty template bullets removed", wb.join("|") === "heading_2:새로 추가된 기능|bulleted_list_item:다크모드 지원|bulleted_list_item:알림 센터|heading_2:기타 업데이트 내용|bulleted_list_item:토글 버그 수정|heading_2:Task 보기", wb.join("|"));
    r = await cli(["weekly-publish", "Custom-Title", "2026-10-21"], { input: "그냥 문단\n## 소제목\n- 항목" });
    const wr2 = [...mock.pages.values()].find((p) => p.ds === DB.WEEKLY_REVIEW && lib.pageTitle(p) === "Custom-Title");
    const wb2 = children(wr2.id).map((b) => b.type);
    check("publish: explicit title + default template Project relation + fallback append as blocks", r.code === 0 && wr2.properties[P.PROJECT].relation[0].id === P1.id && wb2.slice(-3).join() === "paragraph,heading_2,bulleted_list_item", r.all + wb2.join());
    r = await cli(["weekly-publish", "2026-10-21"], { input: "" });
    check("publish: empty stdin rejected", r.code === 1 && /표준입력으로 마크다운 필요/.test(r.err));
    r = await cli(["weekly-publish", "2026-10-21", "--project", "없는 프로젝트"], { input: "x" });
    check("publish: unknown project", r.code === 1 && /Project를 찾을 수 없습니다/.test(r.err), r.err);
    mock.templateNever = true;
    r = await cli(["weekly-publish", "2026-10-21"], { input: "x", env: { ULT_NOTION_TEMPLATE_WAIT_SECONDS: "1" } });
    check("template never applied -> timeout error (Korean)", r.code === 1 && /template 적용 대기 시간이 초과되었습니다/.test(r.err), r.err);
    mock.templateNever = false;
  }

  // ------------------------------------------------------------ 9. story-run
  section("story-run-fetch / story-run / story-comment");
  {
    let r = await cli(["story-run-fetch", S1.url]);
    let j; try { j = JSON.parse(r.out); } catch {}
    check("fetch: story-eval input shape", j && j.source === "notion" && j.story.title === "다크모드 설정" && j.story.notion_id === S1.id && j.story.github_repo === "ultivis/demo" && Array.isArray(j.tasks) && j.tasks.length >= 2, r.all);
    const tt = j?.tasks.find((x) => x.name === "후속 검증 작업");
    check("fetch: task fields + parents[] with status", tt && tt.issue_url && tt.repo === "ultivis/demo" && tt.parent_task_ids[0] === T1.id && tt.parents[0].name === "설정 화면 토글" && tt.parents[0].status === "완료" && tt.branch.endsWith("-fix-task"), JSON.stringify(tt));
    const cwd = join(ROOT, "run-cwd"); mkdirSync(cwd);
    spawnSync("git", ["init", "-b", "main"], { cwd, env: baseEnv() });
    r = await cli(["story-run", S1.url], { cwd });
    check("story-run (Notion fallback): summary + Generated lines", r.code === 0 && /# Story Run Summary/.test(r.out) && /Source: notion/.test(r.out) && /\| Done \| 후속 검증 작업/.test(r.out) === false && /Generated:/.test(r.out) && /Ready task prompts:/.test(r.out) && existsSync(join(cwd, "tmp", "story-run", S1.id.replace(/-/g, ""), "summary.md")), r.all);
    check("story-run: parent done -> task Ready (Notion status 완료 counts)", /\| Ready \| 후속 검증 작업/.test(r.out), r.out);
    r = await cli(["story-run", "--json"], { cwd: join(WT, `d-${ghState().issues.find((i) => i.title === "후속 검증 작업").num}`) });
    let sj; try { sj = JSON.parse(r.out); } catch {}
    check("story-run (local handoff, --json)", r.code === 0 && sj && sj.story.title === "다크모드 설정" && sj.tasks.length === 2, r.all);
    const before = commentsOf(S1.id).length;
    r = await cli(["story-run", S1.url, "--publish"], { cwd });
    check("story-run --publish comments summary on Story", r.code === 0 && commentsOf(S1.id).length === before + 1 && commentsOf(S1.id).at(-1).startsWith("# Story Run Summary"), r.all);
    writeFileSync(join(ROOT, "c.md"), "직접 코멘트");
    r = await cli(["story-comment", S1.url, "--file", join(ROOT, "c.md")]);
    check("story-comment", r.code === 0 && commentsOf(S1.id).at(-1) === "직접 코멘트");
    // 긴 코멘트(2000자 초과)는 rich_text 항목으로 분할
    const long = "가".repeat(5000);
    writeFileSync(join(ROOT, "long.md"), long);
    r = await cli(["story-comment", S1.url, "--file", join(ROOT, "long.md")]);
    check("long comment split into rich_text chunks (mock rejects >2000 per item)", r.code === 0 && commentsOf(S1.id).at(-1).length === 5000, r.all);
  }

  // ------------------------------------------------------------ 10. cache-refresh / find
  section("cache-refresh / find-*");
  {
    let r = await cli(["cache-refresh"]);
    const cd = join(HOME, ".claude", "notion-cache");
    check("cache-refresh DONE + files", r.code === 0 && /DONE: Notion cache ready at/.test(r.out) && /OK: members/.test(r.out) && existsSync(join(cd, "members.json")) && existsSync(join(cd, "projects.json")) && existsSync(join(cd, "repositories.json")) && readdirSync(join(cd, "schemas")).length === 3 && readdirSync(join(cd, "templates")).length === 5, r.all);
    const mem = JSON.parse(readFileSync(join(cd, "members.json"), "utf8"));
    check("members.json format (original-compatible)", mem.version === 1 && mem.by_github.tester.notion_id === U1.id && mem.by_github.tester.name === "테스터" && !("" in mem.by_github));
    r = await cli(["cache-refresh", "--quiet"]);
    check("--quiet hides OK lines", /^DONE/.test(r.out.trim()) && !/OK:/.test(r.out));
    r = await cli(["cache-refresh"], { unset: ["NOTION_TOKEN"] });
    check("no token -> SKIP, exit 0", r.code === 0 && /^SKIP: Notion token not found/.test(r.out));
    r = await cli(["cache-refresh", "--strict"], { unset: ["NOTION_TOKEN"] });
    check("--strict no token -> exit 1", r.code === 1);
    r = await cli(["find-story-by-issue-url", "https://github.com/ultivis/demo/issues/999"]);
    check("find-story: not found -> empty output, exit 0", r.code === 0 && r.out.trim() === "");
    mock.addPage(DB.STORY, { Title: T("이슈 연결 스토리"), "Issue URL": URLP("https://github.com/ultivis/demo/issues/555") });
    r = await cli(["find-story-by-issue-url", "https://github.com/ultivis/demo/issues/555"]);
    check("find-story: found -> URL", /^https:\/\/www\.notion\.so\//.test(r.out.trim()));
  }

  // ------------------------------------------------------------ 10b. story-create: repo 로컬 체크아웃 없음 + 페이지네이션
  section("story-create degraded path / pagination");
  {
    const spec = { github_repo: "ultivis/ghost", story: { title: "고스트 스토리", tag: "Bug", priority: "Low", project_id: P1.id }, tasks: [{ name: "ghost task", topic: "Bug", description: "d" }] };
    const r = await cli(["story-create", "-"], { input: JSON.stringify(spec) });
    check("missing local checkout: warns, does not abort; assignee defaults to current member", r.code === 0 && /⚠ #\d+ repository local checkout 없음: ultivis\/ghost/.test(r.out) && /✅ 발행 완료/.test(r.out), r.all);
    const gs = [...mock.pages.values()].find((p) => p.ds === DB.STORY && lib.pageTitle(p) === "고스트 스토리");
    check("assignee fallback via GitHub->Member DB", gs.properties.Assignee.people[0].id === U1.id);
    const hc = commentsOf(gs.id).map((c) => c.replace(/^\[Story handoff \d+\]\n/, "")).join("");
    const hj = JSON.parse(hc.match(/<!-- ult-story-handoff-json\n([\s\S]*?)\n-->/)[1]);
    check("handoff marks Worktree Failed", hj.tasks[0].status === "Worktree Failed" && hj.tasks[0].worktree === "", JSON.stringify(hj.tasks));
    // pagination (in-process)
    process.env.NOTION_API_BASE = mock.base; process.env.NOTION_TOKEN = "tok-env";
    for (let i = 0; i < 230; i++) mock.addPage("page-ds", { Name: T("row " + i) });
    const one = await lib.queryDs("page-ds", {});
    const all = await lib.queryDs("page-ds", { all: true });
    check("queryDs: single page = 100, all:true follows next_cursor (230 rows)", one.length === 100 && all.length === 230, `${one.length}/${all.length}`);
    const blocks = Array.from({ length: 250 }, (_, i) => ({ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "p" + i } }] } }));
    const host = mock.addPage("page-ds", { Name: T("host") }, { children: [h("heading_2", "설명"), h("paragraph", "tail")] });
    await lib.insertBlocksAfterText(host.id, blocks, "설명");
    const got = children(host.id).map(btext);
    check("append: 250 blocks in 100-chunks, order kept, positioned after anchor", got.length === 252 && got[0] === "설명" && got[1] === "p0" && got[250] === "p249" && got[251] === "tail", got.slice(0, 3).join() + "..." + got.slice(-2).join());
    const miss = mock.addPage("page-ds", { Name: T("miss") }, { children: [h("paragraph", "only")] });
    await lib.insertBlocksAfterText(miss.id, blocks.slice(0, 2), "설명");
    check("anchor missing -> appended at end", children(miss.id).map(btext).join() === "only,p0,p1");
    const cm = await lib.addCommentChunks(S1.id, "x".repeat(4000), { size: 1800, prefix: (n) => `[${n}]\n` });
    check("addCommentChunks splits by size", cm === 3);
  }

  // ------------------------------------------------------------ 10c. 대화형(TTY) 경로: script(1) 로 pty 를 준다
  section("interactive (pty via script)");
  {
    const hasScript = process.platform !== "win32" && hasCmd("script");
    if (!hasScript) console.log("  SKIP no script(1)");
    else {
      const pty = (args, input, cwd = REPO) => new Promise((resolve) => {
        const cmd = [process.execPath, CLI, ...args].map((a) => "'" + a.replace(/'/g, "'\\''") + "'").join(" ");
        const p = spawn("script", ["-qec", cmd, "/dev/null"], { cwd, env: baseEnv(), stdio: ["pipe", "pipe", "pipe"] });
        let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
        p.on("close", (code) => resolve({ code, out }));
        setTimeout(() => { p.stdin.write(input); }, 1500);
        setTimeout(() => p.stdin.end(), 2500);
      });
      let r = await pty(["my-tasks"], "q\n");
      check("my-tasks prompts in TTY and q exits cleanly", /선택 \[1-\d+ \/ q\]:/.test(r.out) && !/--select <번호>/.test(r.out), r.out.slice(-300));
      T1.properties.Status = STA("진행 중");
      r = await pty(["task-status", "#7"], "2\n\n", join(WT, "d-7"));
      check("task-status interactive menu + reason prompt -> reopen", /선택 \[1-4\/c\]:/.test(r.out) && /사유 \(Enter로 생략\):/.test(r.out) && T1.properties.Status.status.name === "시작 전", r.out.slice(-300));
    }
  }

  // ------------------------------------------------------------ 10d. ux-review capture-origin
  section("ux-review capture-origin -> ult-notion.mjs");
  if (process.platform === "win32") console.log("  SKIP capture-origin 은 PATH 의 gh 를 직접 실행하므로 POSIX shim 이 필요하다");
  else {
    writeFileSync(join(SHIMDIR, "gh"), `#!/bin/sh\nexec ${process.execPath} ${FAKE_GH} "$@"\n`, { mode: 0o755 });
    const scen = join(wt7, "tmp", "ux-scenario"); mkdirSync(scen, { recursive: true });
    const r = await new Promise((resolve) => { const p = spawn(process.execPath, [join(PLUGIN, "skills", "ux-review", "scripts", "capture-origin.mjs"), scen], { env: baseEnv(), cwd: wt7 }); let o = ""; let e = ""; p.stdout.on("data", (d) => (o += d)); p.stderr.on("data", (d) => (e += d)); p.on("close", (c) => resolve({ c, o, e })); });
    let j; try { j = JSON.parse(r.o); } catch {}
    check("origin.json gets notionTaskUrl via ult-notion.mjs (no bash/jq)", j && j.issue === 7 && j.issueUrl === "https://github.com/ultivis/demo/issues/7" && j.notionTaskUrl === T1.url && j.notionStoryUrl === null, r.o + r.e);
    const r2 = await new Promise((resolve) => { const p = spawn(process.execPath, [join(PLUGIN, "skills", "ux-review", "scripts", "capture-origin.mjs"), scen], { env: { ...baseEnv(), NOTION_TOKEN: "", HOME: join(ROOT, "nohome") }, cwd: wt7 }); let o = ""; p.stdout.on("data", (d) => (o += d)); p.on("close", () => resolve(o)); });
    let j2; try { j2 = JSON.parse(r2); } catch {}
    check("no token -> Notion fields stay null, capture still succeeds", j2 && j2.notionTaskUrl === null && j2.issueUrl, r2);
  }

  // ------------------------------------------------------------ 11. 잘못된 사용
  section("misc");
  {
    let r = await cli([]);
    check("no subcommand -> usage", /사용법: ult-notion\.mjs/.test(r.err));
    r = await cli(["bogus"]);
    check("unknown subcommand exit 1", r.code === 1);
    r = await cli(["my-tasks"], { env: { FAKE_GH_LOGIN: "stranger" } });
    check("gh user not in Member DB -> Korean error", r.code === 1 && /Member DB에 Github 계정\(stranger\)이 등록되지 않았습니다/.test(r.err), r.err);
    // dev-commands.sh 의 wa 가 쓰는 _wt_add: ult-flow.mjs wt-add 의 JSON 에서 worktree 경로만 뽑는다 (bash 가 있을 때만)
    if (process.platform !== "win32" && spawnSync("bash", ["-c", "true"]).status === 0) {
      cpSync(join(REPO_ROOT, "dev-tools"), join(INSTALLED, "dev-tools"), { recursive: true });
      writeFileSync(join(INSTALLED, "dev-tools", ".env"), `WORKTREE_ROOT="${WT.replace(/\\/g, "/")}"\n`);
      const sh = (script) => spawnSync("bash", ["-c", `source "$HOME/.claude/dev-tools/dev-commands.sh" >/dev/null 2>&1; ${script}`], { cwd: REPO, env: baseEnv(), encoding: "utf8" });
      const w1 = sh("_wt_add feat/wa-901");
      check("dev-commands _wt_add: worktree 경로를 stdout 으로 출력", w1.status === 0 && w1.stdout.trim() === join(WT, "d-901") && existsSync(w1.stdout.trim()), w1.stdout + w1.stderr);
      const w2 = sh("_wt_add feat/wa-901 -r \"" + REPO + "\"");
      check("dev-commands _wt_add: 같은 브랜치 재호출은 같은 경로(idempotent)", w2.status === 0 && w2.stdout.trim() === join(WT, "d-901"), w2.stdout + w2.stderr);
      const w3 = sh("_wt_add feat/wa-902 -r /nonexistent/path");
      check("dev-commands _wt_add: 오류는 한국어 메시지 + 비정상 종료", w3.status !== 0 && /저장소 경로를 찾을 수 없습니다/.test(w3.stderr), w3.stdout + w3.stderr);
    }
    // Codex 설치본(~/.codex/scripts)은 ~/.codex/notion-cache 를 쓴다 (예전 bash workflow-env.sh 와 같은 규칙)
    const codexScripts = join(HOME, ".codex", "scripts");
    mkdirSync(join(codexScripts, "lib"), { recursive: true });
    cpSync(join(INSTALLED, "scripts"), codexScripts, { recursive: true });
    const cx = await new Promise((resolve) => { const p = spawn(process.execPath, [join(codexScripts, "ult-notion.mjs"), "cache-refresh", "--quiet"], { env: baseEnv(), cwd: REPO }); let o = ""; p.stdout.on("data", (d) => (o += d)); p.on("close", (c) => resolve({ c, o })); });
    check("Codex 설치본은 ~/.codex/notion-cache 에 cache 를 만든다", cx.c === 0 && /^DONE:/m.test(cx.o) && existsSync(join(HOME, ".codex", "notion-cache", "members.json")), cx.o);
    // 토큰이 없으면 설치기를 막지 않도록 SKIP 으로 끝나고 종료 코드 0
    const nt = await new Promise((resolve) => { const p = spawn(process.execPath, [CLI, "cache-refresh", "--quiet"], { env: { ...baseEnv(), NOTION_TOKEN: "", HOME: join(ROOT, "nohome"), USERPROFILE: join(ROOT, "nohome") }, cwd: REPO }); let o = ""; p.stdout.on("data", (d) => (o += d)); p.on("close", (c) => resolve({ c, o })); });
    check("토큰 없는 cache-refresh --quiet 는 SKIP + 종료 코드 0", nt.c === 0 && /^SKIP:/m.test(nt.o), nt.c + nt.o);
    const refreshedAt = readFileSync(join(HOME, ".claude", "notion-cache", "members.json"), "utf8");
    mock.log.length = 0;
    await cli(["my-tasks"]);
    check("member cache reused within 24h (no Member DB query)", !mock.log.some((x) => x.path === `/data_sources/${DB.MEMBER}/query`), mock.log.map((x) => x.path).join());
  }
} catch (e) { fails++; console.log("EXCEPTION", e.stack); } finally {
  await mock.stop();
  console.log(`\n${passes} passed, ${fails} failed  (sandbox: ${ROOT})`);
  if (!process.env.KEEP) rmSync(ROOT, { recursive: true, force: true });
  process.exit(fails ? 1 : 0);
}
