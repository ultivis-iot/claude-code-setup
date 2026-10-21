#!/usr/bin/env node
// Notion 이 아닌 부분(gh / git / worktree / handoff 파일)을 처리하는 헬퍼.
// Notion 읽기·쓰기는 ult-notion.mjs(Notion REST API)가 담당한다. 이 파일은 jq / bash 에 의존하지 않는다.
//
// 모든 서브커맨드는 결과를 stdout 에 JSON 한 덩어리로 출력한다(진행 메시지는 stderr).
// 실패하면 종료코드 1 + {"error": "..."}.
//
//   slug <text>
//   branch-name --issue <n> --topic <Topic> --title <text>
//   repo-info                               현재 저장소 slug / default branch / base 후보
//   issue-create --repo <o/r> --title <t> --body-file <f>
//   issue-comment --repo <o/r> --num <n> --body-file <f>
//   wt-add --branch <b> [--repo-path <p> | --repo-slug <o/r>] [--base <b>]
//   handoff-init --file <path> --title <t> --notion-id <id> --notion-url <u> --repo <o/r> --base <b>
//   handoff-add-task --file <path> --task-json <json|@file>      (json/md 갱신, 각 worktree 로 복사)
//   handoff-comment --file <path>                                (Notion Story 코멘트용 본문을 1800자 단위로 분할)
//   handoff-load [ref]                                           (로컬 → GitHub Issue 코멘트 순서)
//   story-eval --input <json|@file> [--out-dir <dir>]            (Ready/Blocked 판정 + subagent prompt 생성)
//
// 환경: WORKTREE_ROOT (기본 ~/Git). ~/.claude/dev-tools/.env 에 있으면 읽는다. ULT_GH_BIN 으로 gh 실행 파일을 바꿀 수 있다(테스트용).

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------- util ----------
const out = (o) => { process.stdout.write(JSON.stringify(o, null, 2) + "\n"); };
const fail = (msg, extra = {}) => { out({ error: msg, ...extra }); process.exit(1); };
const log = (...a) => process.stderr.write(a.join(" ") + "\n");

function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      opt[k] = v;
    } else pos.push(a);
  }
  return { pos, opt };
}

function run(cmd, args, o = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, ...o });
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim(), status: r.status };
}
// 테스트용 ULT_GH_BIN/ULT_GIT_BIN 이 .mjs/.js 이면 node 로 실행한다 (Windows 는 shebang 스크립트를 직접 실행할 수 없다).
const runBin = (bin, args) => (/\.[cm]?js$/i.test(bin) ? run(process.execPath, [bin, ...args]) : run(bin, args));
const git = (args, cwd) => runBin(process.env.ULT_GIT_BIN || "git", cwd ? ["-C", cwd, ...args] : args);
const gh = (args) => runBin(process.env.ULT_GH_BIN || "gh", args);

function readJsonArg(v) {
  if (!v || v === true) fail("JSON 인자가 필요합니다");
  const raw = String(v).startsWith("@") ? readFileSync(String(v).slice(1), "utf8") : String(v);
  try { return JSON.parse(raw); } catch (e) { fail("JSON 파싱 실패: " + e.message); }
}

export function slug(s) {
  let x = String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/ +/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!x) x = "task";
  return x.slice(0, 50).replace(/-$/, "");
}

const TOPIC = { feature: "feature", fix: "fix", bug: "fix", update: "update", refactor: "refactor", style: "style", other: "chore" };
const topicComponent = (t) => TOPIC[String(t || "").toLowerCase()] || "chore";

function issueNumFromUrl(u) { const m = String(u || "").match(/(\d+)$/); return m ? m[1] : ""; }
function repoFromIssueUrl(u) { return String(u || "").replace(/^https:\/\/github\.com\//, "").replace(/\/issues\/\d+$/, ""); }

// .env 는 예전 bash 가 source 하던 파일이라 WORKTREE_ROOT="$HOME/Git" 처럼 변수를 쓴다.
// 작은따옴표가 아니면 $VAR / ${VAR} 와 맨 앞 ~ 를 bash 처럼 펼친다.
function expandEnvValue(raw, envs) {
  const s = raw.trim();
  if (/^'.*'$/.test(s)) return s.slice(1, -1);
  const lookup = (k) => envs[k] ?? process.env[k] ?? (k === "HOME" ? homedir() : "");
  return s
    .replace(/^"|"$/g, "")
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, a, b) => lookup(a || b))
    .replace(/^~(?=$|[\/\\])/, homedir());
}

function loadEnvFile() {
  const envs = {};
  const dirs = [join(homedir(), ".claude", "dev-tools", ".env"), join(homedir(), ".codex", "dev-tools", ".env")];
  for (const f of dirs) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)=(.*)$/);
      if (m) envs[m[1]] = expandEnvValue(m[2], envs);
    }
  }
  return envs;
}

function worktreeRoot() {
  const e = loadEnvFile();
  const r = process.env.WORKTREE_ROOT || e.WORKTREE_ROOT || process.env.AX_DIR || e.AX_DIR || join(homedir(), "Git");
  mkdirSync(r, { recursive: true });
  return r;
}

function defaultBase(repoPath) {
  const c = repoPath || undefined;
  if (git(["remote", "get-url", "origin"], c).ok) git(["fetch", "origin", "--prune"], c);
  if (git(["show-ref", "--verify", "--quiet", "refs/remotes/origin/dev"], c).ok) return "dev";
  const h = git(["symbolic-ref", "refs/remotes/origin/HEAD"], c);
  return (h.ok && h.out.replace(/^refs\/remotes\/origin\//, "")) || "main";
}

function slugForRepoPath(p) {
  const u = git(["remote", "get-url", "origin"], p).out;
  if (!u) return "";
  return u.replace(/^git@github\.com:/, "").replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
}

function repoPathForSlug(slugStr) {
  const name = slugStr.split("/").pop();
  const top = git(["rev-parse", "--show-toplevel"]);
  if (top.ok && slugForRepoPath(top.out) === slugStr) return top.out;
  const roots = [worktreeRoot(), join(homedir(), "Git")];
  for (const r of roots) {
    const c = join(r, name);
    if (existsSync(c) && git(["rev-parse", "--show-toplevel"], c).ok && slugForRepoPath(c) === slugStr) return c;
  }
  return "";
}

// ---------- commands ----------
const cmds = {};

cmds.slug = ({ pos }) => out({ slug: slug(pos.join(" ")) });

cmds["branch-name"] = ({ opt }) => {
  if (!opt.issue) fail("--issue 필요");
  out({ branch: `${opt.issue}-${topicComponent(opt.topic)}-${slug(opt.title)}` });
};

cmds["repo-info"] = () => {
  const r = gh(["repo", "view", "--json", "nameWithOwner,defaultBranchRef", "--jq", "[.nameWithOwner,.defaultBranchRef.name]|@tsv"]);
  const [slugStr, def] = r.ok ? r.out.split("\t") : ["", ""];
  const top = git(["rev-parse", "--show-toplevel"]);
  const branch = git(["branch", "--show-current"]).out;
  out({ repo: slugStr, default_branch: def, git_root: top.ok ? top.out : "", current_branch: branch, base: top.ok ? defaultBase() : def });
};

cmds["issue-create"] = ({ opt }) => {
  if (!opt.repo || !opt.title || !opt["body-file"]) fail("--repo --title --body-file 필요");
  const r = gh(["issue", "create", "--repo", opt.repo, "--title", opt.title, "--body-file", opt["body-file"]]);
  if (!r.ok) fail("gh issue create 실패", { detail: r.err });
  const url = r.out.split(/\r?\n/).pop();
  out({ issue_url: url, issue_num: issueNumFromUrl(url), repo: opt.repo });
};

cmds["issue-comment"] = ({ opt }) => {
  if (!opt.repo || !opt.num || !opt["body-file"]) fail("--repo --num --body-file 필요");
  const r = gh(["issue", "comment", String(opt.num), "--repo", opt.repo, "--body-file", opt["body-file"]]);
  out({ ok: r.ok, detail: r.err });
};

function normalizeBase(b) { return String(b || "").replace(/^origin\//, ""); }

function graftRefresh(wt, reason) {
  const f = join(HERE, "graft.mjs");
  if (!existsSync(f)) return;
  spawnSync(process.execPath, [f, "refresh", wt, reason], { stdio: "ignore", windowsHide: true });
}

cmds["wt-add"] = ({ opt }) => {
  const branch = opt.branch;
  if (!branch) fail("--branch 필요");
  let repoPath = opt["repo-path"];
  if (!repoPath && opt["repo-slug"]) repoPath = repoPathForSlug(opt["repo-slug"]);
  // --repo-slug 를 줬는데 로컬에서 못 찾았으면 현재 저장소로 대체하지 않는다(다른 저장소에 worktree 가 생기는 것을 막음)
  if (!repoPath && !opt["repo-slug"]) { const t = git(["rev-parse", "--show-toplevel"]); if (t.ok) repoPath = t.out; }
  if (!repoPath) fail("저장소 로컬 체크아웃을 찾지 못했습니다", { repo_slug: opt["repo-slug"] || "" });
  try { repoPath = realpathSync(repoPath); } catch { fail("저장소 경로를 찾을 수 없습니다", { path: repoPath }); }

  const main = git(["worktree", "list", "--porcelain"], repoPath).out.split(/\r?\n/).find((l) => l.startsWith("worktree "))?.slice(9) || repoPath;
  const abbr = basename(main).split("-").map((s) => (s[0] || "").toLowerCase()).join("");
  const suffix = (branch.match(/\d+/) || [branch.replace(/\//g, "-").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40)])[0];
  const wt = join(worktreeRoot(), `${abbr}-${suffix}`);

  if (git(["remote", "get-url", "origin"], main).ok) {
    const f = git(["fetch", "origin", "--prune"], main);
    if (!f.ok) fail("origin fetch 실패", { detail: f.err });
  }

  let base = normalizeBase(opt.base);

  if (existsSync(wt)) {
    const cur = git(["branch", "--show-current"], wt).out;
    if (cur !== branch) fail("worktree 경로가 다른 브랜치로 이미 존재합니다", { path: wt, expected: branch, actual: cur || "unknown" });
    // 재사용할 때는 --base 를 명시한 경우에만 base 설정을 바꾼다 (기존 브랜치의 base 를 기본값으로 덮어쓰지 않음)
    if (base) git(["config", `branch.${branch}.gh-merge-base`, base], wt);
    else base = git(["config", `branch.${branch}.gh-merge-base`], wt).out || defaultBase(main);
    graftRefresh(wt, "worktree-reuse");
    return out({ worktree: wt, branch, base, reused: true, repo_path: main });
  }

  if (!base) base = defaultBase(main);
  const baseRef = git(["show-ref", "--verify", "--quiet", `refs/remotes/origin/${base}`], main).ok ? `origin/${base}` : base;
  let r;
  if (git(["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`], main).ok) {
    r = git(["worktree", "add", wt, `origin/${branch}`], main);
    if (r.ok) git(["checkout", "-B", branch, `origin/${branch}`], wt);
  } else {
    r = git(["worktree", "add", "-b", branch, wt, baseRef], main);
  }
  if (!r.ok) fail("worktree 생성 실패", { detail: r.err });
  git(["config", `branch.${branch}.gh-merge-base`, base], wt);
  graftRefresh(wt, "worktree-create");
  out({ worktree: wt, branch, base, reused: false, repo_path: main });
};

// ---- handoff ----
const mdHeader = (h) =>
  [
    "# Story Handoff", "", `Story: ${h.story.title}`, `Notion Story: ${h.story.notion_url}`,
    `Story Base Branch: ${h.story.base_branch || "-"}`, "",
    "Execution source: Notion Story comment and local handoff files in Task worktrees.", "",
    "## Task Map", "",
    "| Task | Repo | Issue | Branch | Base Branch | Worktree | Parents | Status |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ].join("\n") + "\n";

const mdRow = (t) =>
  `| ${t.name} | ${t.repo} | ${t.issue_url} | ${t.branch || "-"} | ${t.base_branch || "-"} | ${t.worktree || "-"} | ${
    (t.parent_issue_urls || []).join(", ") || "-"
  } | ${t.status || "Ready"} |\n`;

function renderMd(h) { return mdHeader(h) + (h.tasks || []).map(mdRow).join(""); }

function writeHandoff(file, h) {
  h.updated_at = new Date().toISOString();
  mkdirSync(dirname(resolve(file)), { recursive: true });
  writeFileSync(file, JSON.stringify(h, null, 2));
  const md = join(dirname(resolve(file)), "story-handoff.md");
  writeFileSync(md, renderMd(h));
  for (const t of h.tasks || []) {
    if (!t.worktree) continue;
    const d = join(t.worktree, "tmp");
    mkdirSync(d, { recursive: true });
    if (resolve(d) === dirname(resolve(file))) continue;
    copyFileSync(file, join(d, "story-handoff.json"));
    copyFileSync(md, join(d, "story-handoff.md"));
  }
  return md;
}

cmds["handoff-init"] = ({ opt }) => {
  if (!opt.file || !opt.title) fail("--file --title 필요");
  const h = {
    version: 1, updated_at: "",
    story: { title: opt.title, notion_id: opt["notion-id"] || "", notion_url: opt["notion-url"] || "", github_repo: opt.repo || "", base_branch: opt.base || "" },
    tasks: [],
  };
  const md = writeHandoff(opt.file, h);
  out({ json: opt.file, md });
};

cmds["handoff-add-task"] = ({ opt }) => {
  if (!opt.file) fail("--file 필요");
  const task = readJsonArg(opt["task-json"]);
  const h = existsSync(opt.file) ? JSON.parse(readFileSync(opt.file, "utf8")) : fail("handoff 파일이 없습니다: " + opt.file);
  h.tasks = h.tasks || [];
  const i = h.tasks.findIndex((t) => t.issue_url && t.issue_url === task.issue_url);
  const full = { pr_url: "", parent_task_ids: [], parent_issue_urls: [], status: "Ready", ...task };
  if (i >= 0) h.tasks[i] = { ...h.tasks[i], ...full }; else h.tasks.push(full);
  const md = writeHandoff(opt.file, h);
  out({ json: opt.file, md, tasks: h.tasks.length });
};

cmds["handoff-comment"] = ({ opt }) => {
  if (!opt.file) fail("--file 필요");
  const h = JSON.parse(readFileSync(opt.file, "utf8"));
  const body = renderMd(h) + `\n<!-- ult-story-handoff-json\n${JSON.stringify(h, null, 2)}\n-->`;
  const parts = [];
  for (let o = 0, n = 1; o < body.length; o += 1800, n++) parts.push(`[Story handoff ${n}]\n${body.slice(o, o + 1800)}`);
  out({ parts });
};

function extractHandoff(text) {
  const m = String(text || "").match(/<!-- ult-story-handoff-json\s*([\s\S]*?)-->/);
  if (!m) return null;
  try { const j = JSON.parse(m[1]); return j && j.story && Array.isArray(j.tasks) ? j : null; } catch { return null; }
}

function loadHandoff(ref) {
  const valid = (j) => j && typeof j.story === "object" && Array.isArray(j.tasks);
  if (ref && existsSync(ref) && statSync(ref).isFile()) {
    try { const j = JSON.parse(readFileSync(ref, "utf8")); if (valid(j)) return { ...j, _source: `local:${ref}` }; } catch {}
  }
  if (!ref) {
    for (const c of ["tmp/story-handoff.json", join(process.cwd(), "tmp", "story-handoff.json")]) {
      if (!existsSync(c)) continue;
      try { const j = JSON.parse(readFileSync(c, "utf8")); if (valid(j)) return { ...j, _source: `local:${c}` }; } catch {}
    }
  }
  // GitHub Issue (본문 + 코멘트, 최신 우선)
  let repo = "", num = "";
  if (/^https:\/\/github\.com\/.+\/issues\/\d+$/.test(ref || "")) { repo = repoFromIssueUrl(ref); num = issueNumFromUrl(ref); }
  else {
    const n = String(ref || "").replace(/^#/, "");
    const br = git(["branch", "--show-current"]).out;
    const fromBranch = (br.match(/^(\d+)/) || br.match(/^[a-zA-Z]+\/(\d+)/) || br.match(/pm-(\d+)/) || [])[1];
    num = /^\d+$/.test(n) ? n : !ref ? fromBranch || "" : "";
    if (num) repo = gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).out;
  }
  if (repo && num) {
    const r = gh(["issue", "view", num, "--repo", repo, "--json", "url,body,comments"]);
    if (r.ok) {
      const p = JSON.parse(r.out);
      const bodies = [p.body, ...(p.comments || []).map((c) => c.body)].reverse();
      for (const b of bodies) { const j = extractHandoff(b); if (j) return { ...j, _source: `github:${p.url}` }; }
    }
  }
  return null;
}

cmds["handoff-load"] = ({ pos }) => {
  const h = loadHandoff(pos[0]);
  out(h ? { found: true, handoff: h } : { found: false });
};

// ---- story-eval ----
const DONE_STATUS = new Set(["완료", "개발 완료", "Done"]);

function prState(repo, prUrl, branch) {
  if (prUrl) {
    const r = gh(["pr", "view", prUrl, "--json", "state,mergedAt,url"]);
    if (r.ok) return JSON.parse(r.out);
  }
  if (repo && branch) {
    const r = gh(["pr", "list", "--repo", repo, "--head", branch, "--state", "all", "--json", "url,state,mergedAt"]);
    if (r.ok) {
      const l = JSON.parse(r.out || "[]").sort((a, b) => String(b.mergedAt || "").localeCompare(String(a.mergedAt || "")));
      if (l[0]) return l[0];
    }
  }
  return null;
}
const issueState = (url) => {
  const repo = repoFromIssueUrl(url), num = issueNumFromUrl(url);
  if (!repo || !num) return "";
  const r = gh(["issue", "view", num, "--repo", repo, "--json", "state", "--jq", ".state"]);
  return r.ok ? r.out : "";
};
const branchForIssue = (num) => {
  if (!num) return "";
  const cur = git(["branch", "--show-current"]).out;
  const re = new RegExp(`^${num}($|[-_/])`);
  if (re.test(cur)) return cur;
  return git(["branch", "--format=%(refname:short)"]).out.split(/\r?\n/).find((b) => re.test(b)) || "";
};
const worktreeForBranch = (branch) => {
  if (!branch) return "";
  let wt = "";
  for (const l of git(["worktree", "list", "--porcelain"]).out.split(/\r?\n/)) {
    if (l.startsWith("worktree ")) wt = l.slice(9);
    if (l === `branch refs/heads/${branch}`) return wt;
  }
  return "";
};
const branchBase = (branch) => {
  const c = branch ? git(["config", `branch.${branch}.gh-merge-base`]).out : "";
  if (c) return c;
  return git(["show-ref", "--verify", "--quiet", "refs/remotes/origin/dev"]).ok ? "dev" : "main";
};

const promptFor = (story, t) => `You are a Task owner subagent. You are not alone in the codebase; do not revert changes made by others, and work only in your assigned worktree.

Story:
- Title: ${story.title}
- Notion Story: ${story.notion_url || ""}

Task:
- Name: ${t.name}
- Repository: ${t.repo}
- GitHub Issue: ${t.issue_url}
- Notion Task ID: ${t.task_id}
- Branch: ${t.branch}
- Base branch: ${t.base_branch}
- Worktree: ${t.worktree || "(not found; create from base branch if needed)"}
- Parent Task status: ${t.parents}

Rules:
- Use only the assigned Task worktree.
- Preserve Story context and Task scope.
- Do not edit another Task owner's worktree.
- Do not create additional Notion Tasks, GitHub Issues, branches, or worktrees unless the user explicitly approves that new Task creation.
- If you find out-of-scope follow-up work, record it as carryover in the Story handoff/Notion Story instead of creating a subtask.
- Verify locally using the repository's existing commands.
- Commit and push the Task branch.
- Create the Task PR targeting the base branch: ${t.base_branch || "(base branch required)"}.
- Run or request review-cycle for the Task PR until AI review and CI are clear.
- Update the Story handoff with results, PR URL, tests, and carryover.

Deliverable:
- Implementation summary
- Files changed
- Verification commands and results
- Task PR URL
- Any Story-wide carryover
`;

// input: { source, story:{title,notion_id,notion_url,github_repo,base_branch},
//          tasks:[{notion_task_id,name,status,topic,issue_url,pr_url,repo,branch?,base_branch?,worktree?,
//                  parent_issue_urls?:[], parent_task_ids?:[], parents?:[{name,status,issue_url,pr_url}]}] }
cmds["story-eval"] = ({ opt }) => {
  const input = readJsonArg(opt.input);
  const story = input.story || {};
  const tasks = input.tasks || [];
  const runKey = story.notion_id ? String(story.notion_id).replace(/-/g, "") : slug(story.title);
  const dir = opt["out-dir"] ? resolve(opt["out-dir"]) : join(process.cwd(), "tmp", "story-run", runKey);
  mkdirSync(join(dir, "prompts"), { recursive: true });

  const byIssue = new Map(tasks.map((t) => [t.issue_url, t]));
  const items = tasks.map((t) => {
    const issueUrl = t.issue_url || "";
    const num = issueNumFromUrl(issueUrl);
    const repo = t.repo || repoFromIssueUrl(issueUrl) || story.github_repo || "";
    const branch = t.branch || branchForIssue(num);
    const base = t.base_branch || branchBase(branch);
    const worktree = t.worktree || worktreeForBranch(branch);

    // parent 평가
    let parentReady = true, parentSummary = "";
    const purls = t.parent_issue_urls || [];
    if (purls.length === 0 && (t.parent_task_ids || []).length > 0 && !(t.parents || []).length) {
      parentReady = false; parentSummary = "Parent Task IDs present; GitHub issue URLs missing";
    } else {
      const plist = purls.length ? purls.map((u) => ({ issue_url: u, ...(byIssue.get(u) || {}) })) : (t.parents || []);
      for (const p of plist) {
        const st = p.issue_url ? issueState(p.issue_url) : "";
        const pr = prState(p.repo || repoFromIssueUrl(p.issue_url), p.pr_url, p.branch);
        const ok = st === "CLOSED" || DONE_STATUS.has(p.status) || (pr && (pr.state === "MERGED" || pr.mergedAt));
        if (!ok) parentReady = false;
        parentSummary += `${p.name || (p.issue_url ? `${repoFromIssueUrl(p.issue_url)}#${issueNumFromUrl(p.issue_url)}` : "?")}(${st || p.status || "unknown"}); `;
      }
      if (!parentSummary) parentSummary = "-";
    }

    const pr = prState(repo, t.pr_url, branch);
    const prUrl = pr?.url || t.pr_url || "";
    const issueCur = issueUrl ? issueState(issueUrl) : "";
    let state = "Ready";
    if (pr && (pr.state === "MERGED" || pr.mergedAt) || issueCur === "CLOSED") state = "Done";
    else if (pr?.state === "OPEN" || t.status === "AI검토중") state = "Review";
    else if (pr?.state === "CLOSED" || t.status === "미완료") state = "Stopped";
    // Notion 상태가 이미 완료면 선행 Task 와 무관하게 Done (예전 Notion fallback 판정과 같음)
    else if (DONE_STATUS.has(t.status)) state = "Done";
    else if (!parentReady) state = "Blocked";

    return {
      state, task_id: t.notion_task_id || t.task_id || "", name: t.name || "(제목 없음)", status: t.status || "", repo,
      issue_url: issueUrl, pr_url: prUrl, branch, base_branch: base, worktree, parents: parentSummary,
    };
  });

  const ready = items.filter((i) => i.state === "Ready");
  const lines = [
    "# Story Run Summary", "", `- Source: ${input.source || "handoff"}`, `- Story: ${story.title || "(제목 없음)"}`,
    `- Notion Story: ${story.notion_url || ""}`, `- Story Base: ${story.base_branch || "(unknown)"}`, "", "## Tasks", "",
    "| State | Task | Repo | Issue | Branch | Base | Worktree | Parents |", "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const it of items) {
    let ref = it.worktree;
    if (it.state === "Ready") {
      const pf = join(dir, "prompts", `task-${issueNumFromUrl(it.issue_url) || it.task_id}.md`);
      writeFileSync(pf, promptFor(story, it));
      it.prompt = pf;
      ref = ref || `prompt: ${pf}`;
    }
    lines.push(`| ${it.state} | ${it.name} | ${it.repo} | ${it.issue_url || "-"} | ${it.branch || "-"} | ${it.base_branch || "-"} | ${ref || "-"} | ${it.parents} |`);
  }
  const summaryMd = join(dir, "summary.md");
  writeFileSync(summaryMd, lines.join("\n") + "\n");
  writeFileSync(join(dir, "summary.json"), JSON.stringify({ story, output_dir: dir, tasks: items, ready_tasks: ready }, null, 2));
  writeFileSync(join(dir, "ready-tasks.json"), JSON.stringify(ready, null, 2));
  out({ output_dir: dir, summary_md: summaryMd, summary: lines.join("\n"), ready: ready.length, total: items.length });
};

// ---------- main ----------
const [, , cmd, ...rest] = process.argv;
if (!cmd || !cmds[cmd]) {
  process.stderr.write("사용법: ult-flow.mjs <" + Object.keys(cmds).join("|") + "> [옵션]\n");
  process.exit(cmd ? 1 : 0);
}
try {
  cmds[cmd](parseArgs(rest));
} catch (e) {
  fail(e && e.message ? e.message : String(e));
}
