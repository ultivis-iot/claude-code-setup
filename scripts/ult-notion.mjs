#!/usr/bin/env node
// Ultivis Notion 워크플로 CLI (Notion REST API 직접 호출, Node >= 20, 의존성 없음).
// 원본 bash 스크립트(ult-my-tasks.sh 등)를 1:1 로 대체한다. gh / git / worktree / handoff 는 ult-flow.mjs 를 호출한다.
//
//   my-tasks [--week|--all] [--select N]       ult-my-tasks.sh
//   task-status [<issue>] [<action>] [--reason <사유>]   ult-task-status.sh
//   task-note "<메모>"                          ult-task-note.sh
//   task-link-issue [issue] [--task ref|--name q|--auto|--yes]   ult-task-link-issue.sh
//   sync-task [note-or-action]                  ult-sync-task.sh
//   issue                                       issue.sh
//   weekly-collect [--week DATE] [--team]       ult-weekly-collect.sh
//   weekly-publish ["<title>"] <date> [template] [--project p] [--template t] < markdown   ult-weekly-publish.sh
//   story-create <spec.json|->                  ult-story-create-exec.sh
//   task-create [story] [--name ...]            ult-task-create.sh
//   story-run [ref] [--publish] [--json]        ult-story-run.sh
//   story-run-fetch [ref]                       ult-story-run.sh 의 Notion fallback (story-eval --input 형식 JSON 출력)
//   story-comment <story id|url> --file <path>  Story 페이지에 코멘트 추가(--publish 용)
//   cache-refresh [--quiet] [--strict]          ult-cache-refresh.sh
//   find-task-by-issue-url <url>                Task 페이지 URL 출력 (없으면 빈 출력)
//   find-story-by-issue-url <url>               Story 페이지 URL 출력 (없으면 빈 출력)

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import * as N from "./lib/notion.mjs";
import { DB, P, NotionError } from "./lib/notion.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FLOW = join(HERE, "ult-flow.mjs");
const SELF = process.argv[1] || join(HERE, "ult-notion.mjs");

// ---------------------------------------------------------------- 공통
const say = (...a) => console.log(...a);
const warn = (...a) => console.error(...a);
class UserError extends Error {}
const die = (msg) => { throw new UserError(msg); };
const interactive = () => Boolean(process.stdin.isTTY);

// 한 번만 만든 readline 으로 줄 단위 큐를 유지한다(질문마다 새로 만들면 붙여넣기/파이프 입력의 뒷줄을 잃는다).
let _rl = null, _closed = false;
const _lines = [], _waiters = [];
async function ask(question) {
  if (!_rl) {
    _rl = createInterface({ input: process.stdin, terminal: false });
    _rl.on("line", (l) => { const w = _waiters.shift(); if (w) w(l.trim()); else _lines.push(l.trim()); });
    _rl.on("close", () => { _closed = true; while (_waiters.length) _waiters.shift()(""); });
  }
  process.stderr.write(question);
  if (_lines.length) return _lines.shift();
  if (_closed) return "";
  return new Promise((res) => _waiters.push(res));
}

function parseArgs(argv, { value = {}, bool = {}, multi = [] } = {}) {
  const opt = {}, pos = [];
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i], inline;
    if (a.startsWith("--") && a.includes("=")) { inline = a.slice(a.indexOf("=") + 1); a = a.slice(0, a.indexOf("=")); }
    if (Object.hasOwn(value, a)) {
      const key = value[a];
      const v = inline ?? argv[++i];
      if (v === undefined) die(`${a} 에 값이 필요합니다`);
      if (multi.includes(key)) (opt[key] ||= []).push(v); else opt[key] = v;
    } else if (Object.hasOwn(bool, a)) opt[bool[a]] = true;
    else if (a === "--help" || a === "-h") opt.help = true;
    else if (a.startsWith("-") && a.length > 1 && !/^-\d/.test(a)) die(`알 수 없는 옵션: ${a}`);
    else pos.push(a);
  }
  return { opt, pos };
}

// ult-flow.mjs 를 비동기 서브프로세스로 호출 (Promise.all 로 병렬 실행 가능)
function flow(sub, args = [], { cwd } = {}) {
  return new Promise((resolveP) => {
    const p = spawn(process.execPath, [FLOW, sub, ...args], { cwd, windowsHide: true, env: process.env });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => resolveP({ ok: false, json: null, error: e.message, detail: "" }));
    p.on("close", (code) => {
      let json = null;
      try { json = JSON.parse(out); } catch { /* 비 JSON */ }
      resolveP({ ok: code === 0, json, error: json?.error || err.trim() || out.trim(), detail: json?.detail || "" });
    });
  });
}

function tmpWorkdir() { return mkdtempSync(join(tmpdir(), "ult-notion-")); }
const cleanup = (d) => { try { rmSync(d, { recursive: true, force: true }); } catch { /* 무시 */ } };

const currentBranch = () => N.git(["branch", "--show-current"]).out;

async function whoAmI({ needNotion = true } = {}) {
  const login = N.githubLogin();
  if (!login) die("gh CLI 인증 필요");
  if (!needNotion) return { login };
  const notionId = await N.memberNotionId(login);
  if (!notionId) die(`Member DB에 Github 계정(${login})이 등록되지 않았습니다.\nPM에게 Member DB 추가 요청하세요.`);
  const name = await N.memberName(login);
  return { login, notionId, name };
}

// 코멘트 작성자 이름: Member 캐시 → gh 로그인 → unknown (실패해도 진행)
async function authorName() {
  const login = N.githubLogin() || "unknown";
  try { return (await N.memberName(login)) || login; } catch { return login; }
}

function ghIssueUrl(num, repo) {
  const args = ["issue", "view", String(num), "--json", "url", "--jq", ".url"];
  if (repo) args.push("--repo", repo);
  const r = N.gh(args);
  return r.ok ? r.out : "";
}

function branchesForIssue(num) {
  if (!num) return "";
  const re = new RegExp(`^${num}($|[-_/])`);
  const cur = currentBranch();
  if (re.test(cur)) return cur;
  return N.git(["branch", "--format=%(refname:short)"]).out.split(/\r?\n/).find((b) => re.test(b)) || "";
}

function resolveBaseBranch(explicit) {
  if (explicit) return explicit;
  if (N.git(["show-ref", "--verify", "--quiet", "refs/remotes/origin/dev"]).ok) return "dev";
  const h = N.git(["symbolic-ref", "refs/remotes/origin/HEAD"]);
  return (h.ok && h.out.replace(/^refs\/remotes\/origin\//, "")) || "main";
}

const branchNameFor = async (issue, topic, title) => {
  const r = await flow("branch-name", ["--issue", String(issue), "--topic", topic, "--title", title]);
  if (!r.ok) die(`브랜치 이름 생성 실패: ${r.error}`);
  return r.json.branch;
};

async function createGithubIssue(repo, title, body) {
  const dir = tmpWorkdir();
  try {
    const f = join(dir, "issue-body.md");
    writeFileSync(f, body);
    return await flow("issue-create", ["--repo", repo, "--title", title, "--body-file", f]);
  } finally { cleanup(dir); }
}

async function ghIssueComment(repo, num, body) {
  const dir = tmpWorkdir();
  try {
    const f = join(dir, "c.md");
    writeFileSync(f, body);
    return await flow("issue-comment", ["--repo", repo, "--num", String(num), "--body-file", f]);
  } finally { cleanup(dir); }
}

const titleProp = (text) => ({ title: [{ type: "text", text: { content: text } }] });
const relProp = (ids) => ({ relation: ids.map((id) => ({ id })) });

// ---------------------------------------------------------------- link-issue
async function linkIssue({ ref = "", taskRef = "", nameQuery = "", auto = false, yes = false, quiet = false } = {}) {
  const out = (...a) => { if (!quiet) say(...a); };
  let issueNum = "", repo = "";
  const um = String(ref).match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/);
  if (um) { repo = um[1]; issueNum = um[2]; } else if (ref) issueNum = String(ref).replace(/^#/, "");
  if (!issueNum) {
    issueNum = N.issueNumFromBranch(currentBranch());
    if (!issueNum) die("Issue 번호를 인자로 주거나 issue 번호가 포함된 브랜치에서 실행하세요.");
  }
  if (!/^\d+$/.test(issueNum)) die(`Issue 번호 형식이 올바르지 않습니다: ${issueNum}`);

  const args = ["issue", "view", issueNum, "--json", "title,url,state"];
  if (repo) args.push("--repo", repo);
  const iv = N.gh(args);
  if (!iv.ok) die(`GitHub Issue #${issueNum} 조회 실패`);
  let issue;
  try { issue = JSON.parse(iv.out); } catch { die(`GitHub Issue #${issueNum} 조회 실패`); }
  const issueUrl = issue.url;
  const query = nameQuery || issue.title;

  const patchIssueUrl = async (task) => {
    const name = N.taskName(task);
    const current = N.urlOf(task, "Issue URL");
    if (current === issueUrl) {
      out(`✓ 이미 연결됨: #${issueNum} ${name}`);
      out(`  ${issueUrl}`);
      return task;
    }
    if (current && !yes && !auto) {
      if (!interactive()) die(`Task에 이미 다른 Issue URL이 있습니다: ${current}\n덮어쓰려면 --yes 를 지정하세요.`);
      say("Task에 이미 다른 Issue URL이 있습니다.");
      say(`  Task: ${name}`);
      say(`  현재: ${current}`);
      say(`  변경: ${issueUrl}`);
      const ow = await ask("덮어쓸까요? [y/N]: ");
      if (!/^(y|yes)$/i.test(ow)) { out("취소됨"); return null; }
    } else if (current && current !== issueUrl && !yes && auto) {
      die(`자동 모드에서는 기존 Issue URL을 덮어쓰지 않습니다: ${name}`);
    }
    const r = await N.patchPage(task.id, { "Issue URL": { url: issueUrl } });
    if (!r?.id) die("Task Issue URL 업데이트 실패");
    out("✓ Task와 GitHub Issue 연결됨");
    out(`  Task: #${issueNum} ${name}`);
    out(`  Issue: ${issueUrl}`);
    return r;
  };

  if (taskRef) {
    const id = N.normalizeNotionPageId(taskRef);
    if (!id) die(`Notion page id/URL을 해석할 수 없습니다: ${taskRef}`);
    let task;
    try { task = await N.getPage(id); } catch (e) { die(`Notion Task 조회 실패: ${taskRef}\n${e.message}`); }
    return patchIssueUrl(task);
  }

  // 정확한 Issue URL 로만 찾는다 (번호만으로는 찾지 않음)
  const existing = await N.findTaskByIssueUrl(issueUrl);
  if (existing) return patchIssueUrl(existing);

  const candidates = await N.findUnlinkedTasksByTitle(query);
  if (candidates.length === 0) {
    die(`Issue URL이 비어 있고 title이 매칭되는 Task를 찾지 못했습니다.\n  Issue: #${issueNum} ${issue.title}\n  검색어: ${query}\nNotion Task URL을 알고 있으면 --task <url>로 다시 실행하세요.`);
  }
  if (candidates.length === 1) return patchIssueUrl(candidates[0]);

  const list = candidates.map((c, i) => `  [${i + 1}] ${N.taskName(c)} [${N.statusOf(c)}]  ${c.id}`);
  if (auto || !interactive()) {
    die("매칭 Task가 여러 개라 자동 연결을 중단합니다.\n" + candidates.map((c) => `  - ${c.id} ${N.taskName(c)} [${N.statusOf(c)}]`).join("\n") + "\n하나를 골라 --task <page_id>로 다시 실행하세요.");
  }
  say(`Issue #${issueNum}: ${issue.title}`);
  say("연결할 Notion Task를 선택하세요.");
  say(list.join("\n"));
  const pick = await ask(`선택 [1-${candidates.length}/q]: `);
  if (!pick || pick === "q") return null;
  const n = Number(pick);
  if (!(n >= 1 && n <= candidates.length)) die("잘못된 선택");
  return patchIssueUrl(candidates[n - 1]);
}

async function cmdTaskLinkIssue(argv) {
  const { opt, pos } = parseArgs(argv, {
    value: { "--task": "task", "-t": "task", "--name": "name", "-n": "name" },
    bool: { "--auto": "auto", "--yes": "yes", "-y": "yes" },
  });
  if (opt.help) return say("사용법: task-link-issue [issue_num|issue_url] [--task <notion_page_id_or_url>] [--name <title>] [--auto] [--yes]");
  if (pos.length > 1) die(`알 수 없는 인자: ${pos[1]}`);
  await linkIssue({ ref: pos[0] || "", taskRef: opt.task || "", nameQuery: opt.name || "", auto: !!opt.auto, yes: !!opt.yes });
}

// status / note 공통: 이슈 URL 로 Task 를 찾고, 없으면 title 매칭으로 자동 연결을 시도한다.
async function findTaskWithRecovery(num, issueUrl) {
  let task = issueUrl ? await N.findTaskByIssueUrl(issueUrl) : null;
  if (!task) {
    warn(`Task #${num} 을(를) Notion에서 찾을 수 없음. Issue URL 자동 연결을 시도합니다.`);
    try {
      await linkIssue({ ref: issueUrl || num, auto: true, quiet: true });
      if (issueUrl) task = await N.findTaskByIssueUrl(issueUrl);
    } catch (e) { warn(e.message); }
  }
  return task;
}

// ---------------------------------------------------------------- task-status
const STATUS_OF_ACTION = { cancel: "미완료", reopen: "시작 전", todo: "시작 전", "in-progress": "진행 중", done: "완료" };

async function cmdTaskStatus(argv) {
  const { opt, pos } = parseArgs(argv, { value: { "--reason": "reason" } });
  if (opt.help) return say("사용법: task-status [<issue_num>] [<action>] [--reason <사유>]\n  action: cancel | reopen | todo | in-progress | done");
  let issueNum = "", action = "", repo = "";
  if (pos.length) {
    const um = pos[0].match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/);
    if (um) { repo = um[1]; issueNum = um[2]; action = pos[1] || ""; }
    else if (/^#?\d+$/.test(pos[0])) { issueNum = pos[0].replace(/^#/, ""); action = pos[1] || ""; }
    else action = pos[0];
  }
  if (!issueNum) {
    issueNum = N.issueNumFromBranch(currentBranch());
    if (!issueNum) die("브랜치에서 Issue 번호를 찾을 수 없음");
  }
  const issueUrl = ghIssueUrl(issueNum, repo);
  const task = await findTaskWithRecovery(issueNum, issueUrl);
  if (!task) {
    die(`Task #${issueNum} 을(를) Notion에서 찾을 수 없음\n수동 연결: node "${SELF}" task-link-issue #${issueNum} --task <notion_task_url>`);
  }
  const taskName = N.taskName(task);
  const current = N.statusOf(task);
  say(`Task #${issueNum}: ${taskName}`);
  say(`현재 상태: ${current}`);

  if (!action) {
    say("");
    say("전이 옵션:");
    say("  [1] cancel      → 미완료");
    say("  [2] reopen      → 시작 전");
    say("  [3] in-progress → 진행 중");
    say("  [4] done        → 완료");
    say("  [c] 취소");
    if (!interactive()) die("action 인자가 필요합니다 (cancel | reopen | todo | in-progress | done). 예: task-status #" + issueNum + " done");
    const c = await ask("선택 [1-4/c]: ");
    action = { 1: "cancel", 2: "reopen", 3: "in-progress", 4: "done" }[c] || "";
    if (!action) return say("취소됨");
  }
  const newStatus = STATUS_OF_ACTION[action];
  if (!newStatus) die(`알 수 없는 action: ${action}`);

  let reason = opt.reason || "";
  if (!reason && interactive()) reason = await ask("사유 (Enter로 생략): ");

  const r = await N.patchPage(task.id, { Status: { status: { name: newStatus } } });
  if (!r?.id) die("상태 업데이트 실패");

  const author = await authorName();
  await N.addComment(task.id, `[${author}] 상태 변경: ${current} → ${newStatus}` + (reason ? `\n사유: ${reason}` : ""));

  say(`✓ Task #${issueNum} 상태: ${current} → ${newStatus}`);
  if (reason) say(`  사유: ${reason}`);
}

// ---------------------------------------------------------------- task-note
async function cmdTaskNote(argv) {
  const content = argv.join(" ");
  if (!content) die('사용법: /ult-task-note "<메모 내용>"');
  const num = N.issueNumFromBranch(currentBranch());
  if (!num) die("브랜치에서 Issue 번호를 찾을 수 없음");
  const issueUrl = ghIssueUrl(num);
  const task = await findTaskWithRecovery(num, issueUrl);
  if (!task) {
    die(`Task #${num} 을(를) Notion에서 찾을 수 없음 (Issue URL 미등록 상태일 수 있음)\n수동 연결: node "${SELF}" task-link-issue #${num} --task <notion_task_url>`);
  }
  const author = await authorName();
  const body = `[${author}] ${content}`;
  const r = await N.addComment(task.id, body);
  if (!r?.id) die("코멘트 추가 실패");
  say(`✓ Task #${num} (${N.taskName(task)}) 에 코멘트 추가됨`);
  say(`  ${body}`);
}

// ---------------------------------------------------------------- sync-task
async function cmdSyncTask(argv) {
  if (argv.length === 0) return cmdIssue([]);
  if (["cancel", "reopen", "todo", "in-progress", "done"].includes(argv[0])) return cmdTaskStatus([argv[0]]);
  return cmdTaskNote(argv);
}

// ---------------------------------------------------------------- issue
const dateRange = (d) => (d?.start ? d.start + (d.end ? ` ~ ${d.end}` : "") : "");
const v = (x) => (x === null || x === undefined ? "" : x);

async function cmdIssue() {
  const branch = currentBranch();
  const num = N.issueNumFromBranch(branch);
  if (!num) die(`브랜치 이름에서 이슈 번호를 찾을 수 없습니다: ${branch}`);
  const iv = N.gh(["issue", "view", num, "--json", "title,body,state,labels,comments,assignees,createdAt,author,url"]);
  if (!iv.ok) die(`GitHub Issue #${num} 조회 실패${iv.err ? `: ${iv.err}` : ""}`);
  const issue = JSON.parse(iv.out);

  say(`### Issue #${num}: ${issue.title}`);
  say("");
  say(`- **상태**: ${issue.state}`);
  say(`- **브랜치**: ${branch}`);
  say(`- **URL**: ${issue.url}`);
  say(`- **작성자**: ${issue.author?.login || ""}`);
  say(`- **라벨**: ${(issue.labels || []).map((l) => l.name).join(", ")}`);
  say(`- **담당자**: ${(issue.assignees || []).map((a) => a.login).join(", ")}`);
  say("");
  say("#### 본문");
  say(issue.body || "");
  say("");

  try {
    const task = await N.findTaskByIssueUrl(issue.url);
    if (task) await printTaskContext(task);
    else {
      const story = await N.findStoryByIssueUrl(issue.url);
      if (story) await printStoryContext(story);
      else {
        say("---");
        say("");
        say("Notion Task/Story를 찾지 못했습니다. Task의 Issue URL이 비어 있으면 다음으로 연결하세요:");
        say(`  node "${SELF}" task-link-issue #${num} --task <notion_task_url>`);
      }
    }
  } catch (e) {
    say("---");
    say("");
    say(`Notion 조회 실패: ${e.message}`);
  }

  if ((issue.comments || []).length > 0) {
    say("");
    say("---");
    say("");
    say("#### 코멘트 (GitHub)");
    for (const c of issue.comments) say(`- **${c.author?.login}** (${c.createdAt}): ${String(c.body || "").replace(/\n/g, " ")}`);
  }
}

const tryGetPage = async (id) => { if (!id) return null; try { return await N.getPage(id); } catch { return null; } };

async function printTaskContext(task) {
  const [story, project, repo] = await Promise.all([
    tryGetPage(N.relIds(task, P.STORY)[0]),
    tryGetPage(N.relIds(task, P.PROJECT)[0]),
    tryGetPage(N.relIds(task, P.REPOSITORY)[0]),
  ]);
  const working = N.numberOf(task, "Working Time");
  const planned = N.numberOf(task, "Planned Time");
  const rate = N.numberOf(task, "On Time Rate");
  let workingStr = String(v(working));
  if (working !== null && planned !== null) workingStr += `h (계획 ${planned}h${rate !== null ? `, On Time Rate ${rate}%` : ""})`;

  say("---");
  say("");
  say("### 📋 Notion Task");
  say("");
  say(`- **이름**: ${N.taskName(task)}`);
  say(`- **상태**: ${N.statusOf(task)}`);
  say(`- **Topic**: ${N.selectOf(task, "Topic")}`);
  say(`- **Planned Date**: ${dateRange(N.dateOf(task, "Planned Date"))}`);
  say(`- **Working Time**: ${workingStr}`);
  say(`- **First Commit**: ${v(N.dateOf(task, "First Commit")?.start)}`);
  say(`- **Last Commit**: ${v(N.dateOf(task, "Last Commit")?.start)}`);
  if (repo) say(`- **Repository**: ${N.pageTitle(repo, "")}`);

  if (story) {
    say("");
    say(`#### 📜 Story: ${N.pageTitle(story)}`);
    say(`- **Tag**: ${N.selectOf(story, "Tag")}`);
    say(`- **Priority**: ${N.selectOf(story, "Priority")}`);
    say(`- **Status**: ${N.statusOf(story)}`);
    say(`- **Work Progress**: ${v(N.numberOf(story, "Work Progress"))}`);
  }
  if (project) await printProject(project, true);
}

async function printProject(project, full) {
  say("");
  say(`#### 🛡️ Project: ${N.pageTitle(project)}`);
  if (full) {
    say(`- **Manager**: ${(project.properties?.Manager?.people || []).map((p) => p.name).join(", ")}`);
    say(`- **Duration**: ${dateRange(project.properties?.["Project Duration"]?.date)}`);
  }
  say(`- **Status**: ${N.statusOf(project)}`);
  say(`- **Work Progress**: ${v(N.numberOf(project, "Work Progress"))}`);
}

async function printStoryContext(story) {
  const project = await tryGetPage(N.relIds(story, P.STORY_PROJECT)[0] || N.relIds(story, P.PROJECT)[0]);
  say("---");
  say("");
  say("### 📜 Notion Story");
  say("");
  say(`- **이름**: ${N.pageTitle(story)}`);
  say(`- **상태**: ${N.statusOf(story)}`);
  say(`- **Tag**: ${N.selectOf(story, "Tag")}`);
  say(`- **Priority**: ${N.selectOf(story, "Priority")}`);
  say(`- **Issue URL**: ${N.urlOf(story, "Issue URL")}`);
  say(`- **PR URL**: ${N.urlOf(story, "PR URL")}`);
  say(`- **Work Progress**: ${v(N.numberOf(story, "Work Progress"))}`);
  if (project) await printProject(project, false);
}

// ---------------------------------------------------------------- my-tasks
const dayNumber = (s) => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d) / 86400000; };

async function taskBlocksMarkdown(taskId) {
  try { return N.blocksToMarkdown(await N.listChildren(taskId, { all: false })); } catch { return ""; }
}

async function githubRepoForTask(repoId) {
  let slug = "";
  if (repoId) { try { slug = await N.repositorySlugById(repoId); } catch { /* 아래 fallback */ } }
  if (!slug) { const r = N.gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]); if (r.ok) slug = r.out; }
  return slug;
}

async function publishIssueForTask(row) {
  const repoId = N.relIds(row, P.REPOSITORY)[0] || "";
  const repo = await githubRepoForTask(repoId);
  if (!repo) {
    die("GitHub repository를 확인할 수 없어 Issue를 만들 수 없습니다.\nTask의 Repository relation 또는 현재 git remote를 확인하세요.");
  }
  const content = await taskBlocksMarkdown(row.id);
  const body = content ? `Notion Task: ${row.url || ""}\n\n${content}\n` : `Notion Task: ${row.url || ""}`;
  const r = await createGithubIssue(repo, N.taskName(row), body);
  if (!r.ok) die(`GitHub Issue 생성 실패: ${repo} / ${N.taskName(row)}\n${r.error}${r.detail ? "\n" + r.detail : ""}`);
  const issueUrl = r.json.issue_url;
  const resp = await N.patchPage(row.id, { "Issue URL": { url: issueUrl } });
  if (!resp?.id) die("Task Issue URL 업데이트 실패");
  return { issueUrl, repo };
}

async function cmdMyTasks(argv) {
  const { opt } = parseArgs(argv, { value: { "--select": "select" }, bool: { "--week": "week", "--all": "all" } });
  if (opt.help) return say("사용법: my-tasks [--week | --all] [--select N]");
  const mode = opt.all ? "all" : opt.week ? "week" : "default";

  const me = await whoAmI();
  const assignee = { property: "Assignee", people: { contains: me.notionId } };
  let filter;
  if (mode === "default") {
    filter = { and: [assignee, { or: [{ property: "Status", status: { equals: "시작 전" } }, { property: "Status", status: { equals: "진행 중" } }] }] };
  } else if (mode === "week") {
    // 원본은 TODO(assignee 만 필터)였다. 여기서는 현재 Week relation 으로 한정한다. Week 를 못 찾으면 assignee 만 쓴다.
    let weekId = "";
    try { weekId = await N.currentWeekId(); } catch { /* fallback */ }
    filter = weekId ? { and: [assignee, { property: P.WEEK, relation: { contains: weekId } }] } : assignee;
  } else filter = assignee;

  const rows = await N.queryDs(DB.TASK, { filter, sorts: [{ property: "Planned Date", direction: "ascending" }], pageSize: 50 });
  if (rows.length === 0) return say(`${me.name}님 할당 Task 없음.`);

  const uniq = (key) => [...new Set(rows.flatMap((r) => N.relIds(r, key)))];
  const names = new Map();
  await Promise.all([...uniq(P.STORY), ...uniq(P.REPOSITORY)].map(async (id) => {
    const p = await tryGetPage(id);
    names.set(id, p ? N.pageTitle(p) : "");
  }));

  const today = N.localDate();
  const issueNumOf = (r) => N.formulaString(r, "Issue Number") || (N.urlOf(r, "Issue URL").match(/(\d+)$/) || [])[1] || "";
  const render = (r, idx) => {
    const planned = N.dateOf(r, "Planned Date");
    const plannedDay = planned?.end || planned?.start || "";
    let deadline = "마감 미정";
    if (plannedDay) {
      const days = dayNumber(plannedDay) - dayNumber(today);
      deadline = days > 0 ? `D-${days}` : days === 0 ? "D+0 ⚠ 오늘 마감" : `D+${-days} ⚠ 지남`;
    }
    const num = issueNumOf(r);
    const storyName = names.get(N.relIds(r, P.STORY)[0]) || "(Story 없음)";
    const repoName = names.get(N.relIds(r, P.REPOSITORY)[0]) || "";
    const lines = [`  ${num ? "#" + num : "#(미발행)"} [${N.selectOf(r, "Topic") || "—"}] ${N.taskName(r)}`, `       📜 ${storyName} · ${deadline}`];
    if (repoName) lines.push(`       🥨 ${repoName}`);
    if (N.urlOf(r, "Issue URL")) lines.push(`       ${N.urlOf(r, "Issue URL")}`);
    lines.push(`       [${idx}] 선택`);
    return lines.join("\n");
  };

  say(`${me.name}님 할당 Task ${rows.length}건`);
  say("");
  const choices = [];
  const groupNames = ["진행 중", "시작 전"];
  const others = [...new Set(rows.map((r) => N.statusOf(r)).filter((s) => !groupNames.includes(s)))];
  for (const g of [...groupNames, ...others]) {
    const rs = rows.filter((r) => N.statusOf(r) === g);
    if (!rs.length) continue;
    say(`${g === "진행 중" ? "📍" : g === "시작 전" ? "⏳" : "📦"} ${g || "(상태 없음)"} (${rs.length})`);
    for (const r of rs) { choices.push(r); say(render(r, choices.length)); }
    say("");
  }

  let pick = opt.select !== undefined ? String(opt.select) : null;
  if (pick === null) {
    if (!interactive()) {
      const flag = mode === "all" ? " --all" : mode === "week" ? " --week" : "";
      return say(`선택하려면 --select <번호> 로 다시 실행하세요. 예: node "${SELF}" my-tasks${flag} --select 1`);
    }
    pick = await ask(`선택 [1-${choices.length} / q]: `);
  }
  if (!pick || pick === "q") return;
  const n = Number(pick);
  if (!(Number.isInteger(n) && n >= 1 && n <= choices.length)) die("잘못된 선택");

  const sel = choices[n - 1];
  let issueUrl = N.urlOf(sel, "Issue URL");
  let issueNum = issueNumOf(sel);
  const taskName = N.taskName(sel);
  let repoSlug = "";
  try { repoSlug = await N.repositorySlugById(N.relIds(sel, P.REPOSITORY)[0]); } catch { /* 현재 저장소 사용 */ }

  if (!issueNum) {
    say("");
    say("선택한 Task에 Issue URL이 없어 GitHub Issue를 생성하고 연결합니다.");
    const pub = await publishIssueForTask(sel);
    issueUrl = pub.issueUrl;
    issueNum = (issueUrl.match(/(\d+)$/) || [])[1] || "";
    repoSlug = pub.repo;
    say(`✓ GitHub Issue 생성 및 Task 연결: ${issueUrl}`);
  }

  let branch = branchesForIssue(issueNum);
  if (branch) say(`ℹ️  기존 브랜치 사용: ${branch}`);
  else {
    if (!issueNum) die("Issue 번호가 없어 브랜치를 만들 수 없습니다.");
    branch = await branchNameFor(issueNum, N.selectOf(sel, "Topic") || "Other", taskName);
  }

  let wt = await flow("wt-add", ["--branch", branch, ...(repoSlug ? ["--repo-slug", repoSlug] : [])]);
  if (!wt.ok && repoSlug) wt = await flow("wt-add", ["--branch", branch]); // 로컬에서 해당 저장소를 못 찾으면 현재 저장소로
  if (!wt.ok) die(`Worktree 생성 실패: ${wt.error}${wt.detail ? "\n" + wt.detail : ""}`);
  const wtPath = wt.json.worktree;
  const wtName = basename(wtPath);

  say("");
  say(`✅ Worktree: ${wtPath}`);
  say("");
  say("다음 명령으로 이동:");
  say(`   cc ${wtName}    # tmux 세션 + Claude Code`);
  say(`   cd ${wtPath}`);
  say("");
  say("/issue 로 상세 컨텍스트 확인");
}

// ---------------------------------------------------------------- weekly
async function cmdWeeklyCollect(argv) {
  const { opt } = parseArgs(argv, { value: { "--week": "week" }, bool: { "--team": "team" } });
  const errOut = (m) => { say(JSON.stringify({ error: m })); process.exitCode = 1; };

  const target = opt.week || N.localDate();
  const weekId = await N.currentWeekId(target);
  if (!weekId) return errOut("Week not found");
  const week = await N.getPage(weekId);
  const weekFrom = week.properties?.DateFrom?.date?.start || "";
  const weekTo = week.properties?.DateTo?.formula?.date?.start || "";

  let notionId = "", userName = "";
  if (!opt.team) {
    const login = N.githubLogin();
    if (login) {
      try { notionId = await N.memberNotionId(login); } catch { /* 아래에서 처리 */ }
      userName = (await N.memberName(login).catch(() => "")) || login;
    }
    if (!notionId) return errOut("Notion user not mapped");
  }
  const weekFilter = { property: P.WEEK, relation: { contains: weekId } };
  const filter = opt.team ? weekFilter : { and: [weekFilter, { property: "Assignee", people: { contains: notionId } }] };
  const rows = await N.queryDs(DB.TASK, { filter, all: true });

  const nameOf = new Map();
  const ids = (key) => [...new Set(rows.flatMap((r) => N.relIds(r, key)))];
  await Promise.all([...ids(P.STORY), ...ids(P.PROJECT)].map(async (id) => {
    const p = await tryGetPage(id);
    nameOf.set(id, p ? N.pt(p.properties?.Title?.title) || N.pt(p.properties?.Name?.title) : "");
  }));

  const nn = (x) => (x === undefined ? null : x);
  const tasks = rows.map((r) => {
    const planned = N.dateOf(r, "Planned Date");
    const storyId = N.relIds(r, P.STORY)[0];
    const projectId = N.relIds(r, P.PROJECT)[0];
    return {
      id: r.id,
      name: N.pt((r.properties?.Name?.title || []).slice(0, 1)) || null,
      topic: N.selectOf(r, "Topic") || null,
      status: N.statusOf(r) || null,
      issue_num: N.formulaString(r, "Issue Number") || null,
      issue_url: N.urlOf(r, "Issue URL") || null,
      pr_url: N.urlOf(r, "PR URL") || null,
      planned_start: nn(planned?.start),
      planned_end: nn(planned?.end),
      working_time: N.numberOf(r, "Working Time"),
      planned_time: N.numberOf(r, "Planned Time"),
      on_time_rate: N.numberOf(r, "On Time Rate"),
      first_commit: nn(N.dateOf(r, "First Commit")?.start),
      last_commit: nn(N.dateOf(r, "Last Commit")?.start),
      story_id: storyId || null,
      story_name: (storyId && nameOf.get(storyId)) || "",
      project_id: projectId || null,
      project_name: (projectId && nameOf.get(projectId)) || "",
      commit_count: (r.properties?.[P.COMMIT]?.relation || []).length,
      assignees: (r.properties?.Assignee?.people || []).map((p) => p.name),
    };
  });

  const today = N.localDate();
  const by_status = {};
  for (const t of tasks) by_status[t.status] = (by_status[t.status] || 0) + 1;
  const sum = (f) => tasks.reduce((a, t) => a + (f(t) || 0), 0);
  const stats = {
    total: tasks.length,
    by_status,
    total_commits: sum((t) => t.commit_count),
    total_working: sum((t) => t.working_time),
    total_planned: sum((t) => t.planned_time),
    overdue: tasks
      .filter((t) => !["완료", "미완료", "취소"].includes(t.status) && (t.planned_end || t.planned_start) && String(t.planned_end || t.planned_start).slice(0, 10) < today)
      .map((t) => t.name),
    on_time_low: tasks.filter((t) => (t.on_time_rate ?? 100) < 80 && (t.on_time_rate ?? 0) > 0).map((t) => ({ name: t.name, on_time_rate: t.on_time_rate })),
  };
  say(JSON.stringify({ week: { date_from: weekFrom, date_to: weekTo }, user: userName, team_mode: !!opt.team, stats, tasks }));
}

const PROJECT_SHORT = { "Ultivis CRM": "CRM", "표준협회 AI 진단 모델": "Diag", "Ultivis Vision": "Vision", "Ultivis IoT": "IoT", "Ultivis LLM": "LLM", Agent: "Agent" };
const projectShortName = (name) => {
  if (PROJECT_SHORT[name]) return PROJECT_SHORT[name];
  const s = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-+/g, "-");
  return s || "Weekly";
};

function sectionLines(markdown, target) {
  const out = [];
  let section = "";
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    const plain = line.replace(/^#+\s*/, "");
    if (plain === "새로 추가된 기능") { section = "features"; continue; }
    if (plain === "기타 업데이트 내용") { section = "updates"; continue; }
    if (plain === "Task 보기") { section = ""; continue; }
    if (/^#+\s*/.test(line)) { section = ""; continue; }
    if (section === target && line) out.push(line.replace(/^[-*]\s+/, ""));
  }
  return out;
}
const bullets = (lines) => lines.map((t) => ({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ type: "text", text: { content: t } }] } }));

async function cmdWeeklyPublish(argv) {
  const { opt, pos } = parseArgs(argv, { value: { "--project": "project", "-p": "project", "--template": "template", "-t": "template" } });
  const usage = 'Usage: weekly-publish ["<title>"] "<YYYY-MM-DD>" [template-name-or-id] [--project <name-or-id-or-url>] < markdown';
  if (opt.help) return say(usage);
  let title = pos[0] || "", date = pos[1] || "";
  const templateRef = opt.template || pos[2] || "마케팅";
  if (!date && /^\d{4}-\d{2}-\d{2}$/.test(title)) { date = title; title = ""; }
  if (!date) die(usage);

  const markdown = readFileSync(0, "utf8");
  if (!markdown.trim()) die("표준입력으로 마크다운 필요");

  const weekId = await N.currentWeekId(date);
  if (!weekId) die(`Week not found for date: ${date}`);
  const week = await N.getPage(weekId);
  const weekFrom = week.properties?.DateFrom?.date?.start || "";

  const templateId = N.weeklyReviewTemplateId(templateRef);
  if (!templateId) die(`Weekly Review template id is empty: ${templateRef}`);
  let templatePage;
  try { templatePage = await N.getPage(templateId); } catch (e) { die(`Weekly Review template 조회 실패: ${templateRef} (${templateId})\n${e.message}`); }

  let projectRelations;
  if (opt.project) {
    let pid = N.normalizeNotionPageId(opt.project);
    if (!pid) pid = await N.projectIdByName(opt.project);
    if (!pid) die(`Project를 찾을 수 없습니다: ${opt.project}\nProject name, Notion page id, 또는 URL을 확인하세요.`);
    projectRelations = [{ id: pid }];
  } else projectRelations = templatePage.properties?.[P.PROJECT]?.relation || [];

  if (!title) {
    let projectName = "";
    if (projectRelations[0]?.id) {
      const pp = await tryGetPage(projectRelations[0].id);
      if (pp) projectName = N.pt(pp.properties?.Title?.title) || N.pt(pp.properties?.Name?.title);
    }
    const weekStart = (weekFrom || "").split("T")[0] || date;
    const [yy, mm, dd] = [weekStart.slice(2, 4), weekStart.slice(5, 7), Number(weekStart.slice(8, 10))];
    title = `${projectShortName(projectName || "Weekly")}-${yy}-${mm}-${String(Math.floor((dd - 1) / 7) + 1).padStart(2, "0")}`;
  }

  const fallbackBlocks = N.mdToBlocks(markdown);
  const featureBlocks = bullets(sectionLines(markdown, "features"));
  const updateBlocks = bullets(sectionLines(markdown, "updates"));

  const props = { Title: titleProp(title), [P.WEEK]: relProp([weekId]) };
  if (projectRelations.length) props[P.PROJECT] = { relation: projectRelations };

  const resp = await N.createPageFromTemplate(DB.WEEKLY_REVIEW, props, templateId);
  if (!resp?.id || !resp.url) die("Weekly Review 발행 실패\n" + JSON.stringify(resp));
  const pageId = resp.id;

  await N.waitForTemplateApplied(pageId);
  if (featureBlocks.length || updateBlocks.length) {
    // 템플릿의 빈 bullet 을 치운 뒤 각 섹션 제목 뒤에 항목을 넣는다
    for (const b of await N.listChildren(pageId)) {
      if (b.type !== "bulleted_list_item" || (b.bulleted_list_item?.rich_text || []).length) continue;
      try { await N.notionApi("PATCH", `/blocks/${b.id}`, { archived: true }); }
      catch { try { await N.notionApi("PATCH", `/blocks/${b.id}`, { in_trash: true }); } catch { /* 빈 bullet 이 남아도 치명적이지 않음 */ } }
    }
    for (const [heading, blocks] of [["새로 추가된 기능", featureBlocks], ["기타 업데이트 내용", updateBlocks]]) {
      if (!blocks.length) continue;
      await N.insertBlocksAfterText(pageId, blocks, heading);
    }
  } else await N.appendBlocks(pageId, fallbackBlocks);

  say(`✓ 발행됨: ${resp.url}`);
}

// ---------------------------------------------------------------- handoff / story 공통
async function parentIssueUrls(parentIds, created = []) {
  const urls = [];
  for (const pid of parentIds) {
    let u = created.find((r) => r.task_id === pid)?.issue_url || "";
    if (!u) { const pg = await tryGetPage(pid); u = pg ? N.urlOf(pg, "Issue URL") : ""; }
    if (u) urls.push(u);
  }
  return urls;
}

async function addTaskToHandoff(file, item) {
  const dir = tmpWorkdir();
  try {
    const tf = join(dir, "task.json");
    writeFileSync(tf, JSON.stringify(item));
    return await flow("handoff-add-task", ["--file", file, "--task-json", "@" + tf]);
  } finally { cleanup(dir); }
}

const TERMINAL_STATUS = ["완료", "개발 완료", "미완료", "취소", "Canceled", "Cancelled", "Done", "Closed"];
const isTerminal = (s) => TERMINAL_STATUS.includes(s);

// ---------------------------------------------------------------- story-create
async function cmdStoryCreate(argv) {
  const { pos } = parseArgs(argv);
  const src = pos[0];
  let raw;
  if (src === "-") raw = readFileSync(0, "utf8");
  else if (src && existsSync(src)) raw = readFileSync(src, "utf8");
  else die("Usage: story-create <spec.json> | -");
  let spec;
  try { spec = JSON.parse(raw); } catch (e) { die("spec JSON 파싱 실패: " + e.message); }
  if (!spec?.story?.title || !spec.github_repo || !Array.isArray(spec.tasks) || spec.tasks.length === 0) {
    die("spec 형식 오류 (story.title, github_repo, tasks 필수)");
  }
  const st = spec.story;
  for (const k of ["tag", "priority", "project_id"]) if (!st[k]) die(`spec 형식 오류 (story.${k} 필수)`);
  let assignee = st.assignee_notion_id;
  if (!assignee) assignee = (await whoAmI()).notionId;

  const templateId = N.storyTemplateId(st.tag);
  if (!templateId) die(`Story template id is empty for tag: ${st.tag}\n빈 Story page 생성을 중단합니다. story_template_id 매핑을 확인하세요.`);

  // ---- 1단계: Story
  say("▸ Story 생성 중...");
  const storyProps = {
    Title: titleProp(st.title),
    Tag: { select: { name: st.tag } },
    Priority: { select: { name: st.priority } },
    [P.STORY_PROJECT]: relProp([st.project_id]),
    Assignee: { people: [{ id: assignee }] },
  };
  const planBlocks = N.mdToBlocks(st.body_markdown || "");
  const storyResp = await N.createPageFromTemplate(DB.STORY, storyProps, templateId);
  if (!storyResp?.id) die("Story 생성 실패\n" + JSON.stringify(storyResp));
  const storyId = storyResp.id, storyUrl = storyResp.url;
  await N.waitForTemplateApplied(storyId);
  if (planBlocks.length) await N.insertBlocksAfterText(storyId, planBlocks, "설명");
  say(`  ✓ ${st.title}`);
  say(`    ${storyUrl}`);

  const storyBase = resolveBaseBranch();
  if (st.branch) say(`  ℹ story.branch override는 더 이상 Story용 GitHub branch를 만들지 않으므로 무시합니다: ${st.branch}`);

  // ---- 2단계: Task (Issue + Notion Task). parent 가 없는 Task 는 Promise.all 로 병렬 생성
  say("");
  say("▸ Task 생성 중...");
  const specTasks = spec.tasks.map((t) => ({ ...t, github_repo: t.github_repo || spec.github_repo }));
  for (const t of specTasks) {
    if (!t.repository_id) continue;
    try { const s = await N.repositorySlugById(t.repository_id); if (s) t.github_repo = s; } catch { /* 기본 repo 유지 */ }
  }

  const workdir = tmpWorkdir();
  const created = new Array(specTasks.length).fill(null);

  const processTask = async (t, idx) => {
    const parentIds = [...(t.parent_task_ids || []).filter(Boolean)];
    for (const pi of t.parent_task_indexes || []) { const id = created[pi]?.task_id; if (id) parentIds.push(id); }
    const repo = t.github_repo;
    const topic = t.topic || "Feature";
    const desc = t.description || "";
    const issueBody = `${desc}\n\n---\nNotion Story: ${storyUrl}\nTask Base Branch: ${storyBase}\n`;
    const ir = await createGithubIssue(repo, t.name, issueBody);
    if (!ir.ok) return { idx, error: "gh issue create 실패", response: ir.error + (ir.detail ? "\n" + ir.detail : "") };
    const issueUrl = ir.json.issue_url, issueNum = ir.json.issue_num;

    const props = {
      Name: titleProp(t.name),
      Topic: { select: { name: topic } },
      [P.STORY]: relProp([storyId]),
      [P.PROJECT]: relProp([st.project_id]),
      Assignee: { people: [{ id: assignee }] },
      "Issue URL": { url: issueUrl },
    };
    if (t.repository_id) props[P.REPOSITORY] = relProp([t.repository_id]);
    if (t.week_id) props[P.WEEK] = relProp([t.week_id]);
    if (parentIds.length) props["Parent Task"] = relProp(parentIds);
    if (t.planned_start) props["Planned Date"] = { date: { start: t.planned_start, ...(t.planned_end ? { end: t.planned_end } : {}) } };

    let resp;
    try {
      resp = await N.createPageFromTemplate(DB.TASK, props, N.TASK_TEMPLATE_ID);
      if (!resp?.id) return { idx, error: "Notion Task 생성 실패", response: JSON.stringify(resp) };
      await N.waitForTemplateApplied(resp.id);
      const blocks = N.mdToBlocks(desc);
      if (blocks.length) await N.insertBlocksAfterText(resp.id, blocks, "설명");
    } catch (e) {
      return { idx, error: resp?.id ? "Notion Task template 적용/본문 삽입 실패" : "Notion Task 생성 실패", response: e.message };
    }
    return {
      idx, task_id: resp.id, issue_url: issueUrl, issue_num: issueNum, name: t.name, topic, repo,
      repository_id: t.repository_id || "", parent_task_ids: parentIds, pr_url: "",
    };
  };

  // wave 단위 실행: parent_task_indexes 로 같은 spec 안의 Task 를 선행으로 지정할 수 있다(선택 확장).
  let pending = specTasks.map((t, i) => i);
  while (pending.length) {
    const ready = pending.filter((i) => (specTasks[i].parent_task_indexes || []).every((p) => created[p] && !created[p].error));
    const stuck = pending.filter((i) => !ready.includes(i));
    const wave = ready.length ? ready : stuck;
    if (!ready.length) {
      // 순환 또는 실패한 선행 Task: 만들 수 없는 항목은 에러로 기록
      for (const i of stuck) created[i] = { idx: i, error: "선행 Task(parent_task_indexes)를 만들 수 없어 건너뜀" };
      break;
    }
    const outs = await Promise.all(wave.map((i) => processTask(specTasks[i], i)));
    outs.forEach((o) => { created[o.idx] = o; });
    pending = pending.filter((i) => !wave.includes(i));
  }

  const results = created.filter(Boolean);
  const errs = results.filter((r) => r.error);
  if (errs.length) {
    cleanup(workdir);
    warn("ERROR: 일부 Task 생성 실패");
    warn(JSON.stringify(results, null, 2));
    process.exitCode = 1;
    return;
  }
  for (const r of results) { say(`  ✓ #${r.issue_num} [${r.topic}] ${r.name}`); say(`    ${r.issue_url}`); }

  // ---- 3단계: Worktree + handoff
  say("");
  say("▸ Worktree 생성 중...");
  const handoffFile = join(workdir, "story-handoff.json");
  await flow("handoff-init", ["--file", handoffFile, "--title", st.title, "--notion-id", storyId, "--notion-url", storyUrl, "--repo", spec.github_repo, "--base", storyBase]);

  let firstWt = "";
  for (const r of results) {
    const parentUrls = await parentIssueUrls(r.parent_task_ids, results);
    const branch = await branchNameFor(r.issue_num, r.topic, r.name);
    const base = { name: r.name, topic: r.topic, repo: r.repo, notion_task_id: r.task_id, issue_url: r.issue_url, issue_num: r.issue_num, pr_url: "", branch, parent_task_ids: r.parent_task_ids, parent_issue_urls: parentUrls };
    const wt = await flow("wt-add", ["--branch", branch, "--repo-slug", r.repo]);
    if (!wt.ok) {
      const noRepo = /저장소 로컬 체크아웃을 찾지 못했습니다/.test(wt.error);
      if (noRepo) say(`  ⚠ #${r.issue_num} repository local checkout 없음: ${r.repo}`);
      else say(`  ⚠ #${r.issue_num} worktree 생성 실패`);
      await addTaskToHandoff(handoffFile, { ...base, base_branch: storyBase, worktree: "", status: "Worktree Failed" });
      continue;
    }
    const { worktree: wtPath, base: taskBase } = wt.json;
    try { await N.addComment(r.task_id, `Branch: ${branch}\nBase Branch: ${taskBase}\nWorktree: ${wtPath}\nNotion Story: ${storyUrl}`); } catch { /* best-effort */ }
    if (!firstWt) firstWt = wtPath;
    await addTaskToHandoff(handoffFile, { ...base, base_branch: taskBase, worktree: wtPath, status: "Ready" });
    say(`  ✓ #${r.issue_num} → ${wtPath}`);
  }

  const hc = await flow("handoff-comment", ["--file", handoffFile]);
  if (hc.ok) {
    for (const part of hc.json.parts || []) {
      try { await N.addComment(storyId, part); } catch (e) { warn(`WARN: Story handoff 코멘트 추가 실패: ${e.message}`); break; }
    }
  }
  cleanup(workdir);

  say("");
  say("✅ 발행 완료");
  say(`  Story: ${storyUrl}`);
  say(`  Task ${results.length}개, Issue ${results.length}개, Worktree ${results.length}개`);
  say("  Handoff: 각 Task worktree의 tmp/story-handoff.md");
  say("  Handoff JSON: 각 Task worktree의 tmp/story-handoff.json");
  say("");
  say("  첫 Task로 이동:");
  if (firstWt) {
    say(`    cc ${basename(firstWt)}    # tmux 세션 + Claude Code`);
    say(`    cd ${firstWt}`);
  }

  if (existsSync("tmp/current-plan.md")) {
    mkdirSync("tmp/archived-plans", { recursive: true });
    const d = new Date(), p2 = (n) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
    const sl = (await flow("slug", [st.title])).json?.slug || "story";
    const archive = `tmp/archived-plans/${stamp}-${sl}.md`;
    renameSync("tmp/current-plan.md", archive);
    say(`  Plan archive: ${archive}`);
  }
}

// ---------------------------------------------------------------- task-create
const TOPICS = { Feature: "Feature", Fix: "Fix", Update: "Update", Refactor: "Refactor", Style: "Style", Other: "Other", feature: "Feature", fix: "Fix", update: "Update", refactor: "Refactor", style: "Style", other: "Other", chore: "Other" };

function ghIssueUrlFromRef(ref, githubRepo) {
  if (!ref) return "";
  if (/^https:\/\/github\.com\/.+\/issues\/\d+$/.test(ref)) return ref;
  let m = ref.match(/^([^/\s]+\/[^/#\s]+)#(\d+)$/);
  if (m) return `https://github.com/${m[1]}/issues/${m[2]}`;
  const bare = ref.replace(/^#/, "");
  if (/^\d+$/.test(bare)) return `https://github.com/${githubRepo}/issues/${bare}`;
  return "";
}

async function cmdTaskCreate(argv) {
  const { opt, pos } = parseArgs(argv, {
    value: { "--story": "story", "-s": "story", "--project": "project", "-p": "project", "--name": "name", "-n": "name", "--topic": "topic", "-t": "topic", "--description": "description", "-d": "description", "--planned-start": "plannedStart", "--planned-end": "plannedEnd", "--parent-task": "parent", "--base": "base" },
    bool: { "--here": "here", "--no-checkout": "noCheckout" },
    multi: ["parent"],
  });
  if (opt.help) return say("사용법: task-create [story-title-or-url] [--name <task>] [--topic <topic>] [--description <body>] [--project p] [--planned-start D] [--planned-end D] [--parent-task <id|url>]... [--base b] [--here | --no-checkout]");
  let storyRef = opt.story || "";
  if (pos.length) { if (storyRef) die(`알 수 없는 인자: ${pos[0]}`); storyRef = pos[0]; if (pos.length > 1) die(`알 수 없는 인자: ${pos[1]}`); }
  const parentIds = (opt.parent || []).map((p) => N.normalizeNotionPageId(p) || die(`Parent Task page id/URL을 해석할 수 없습니다: ${p}`));
  const topic = TOPICS[opt.topic || "Feature"] || die(`알 수 없는 topic: ${opt.topic}`);

  const me = await whoAmI();
  const rv = N.gh(["repo", "view", "--json", "name,nameWithOwner"]);
  if (!rv.ok) die("현재 git remote에서 GitHub repo를 확인할 수 없습니다.");
  const { name: repoName, nameWithOwner: githubRepo } = JSON.parse(rv.out);
  const repoId = (await N.repositoryIdBySlug(githubRepo)) || (await N.repositoryIdByName(githubRepo)) || (await N.repositoryIdByName(repoName));

  let repoProjectIds = repoId ? await N.repositoryProjectIds(repoId) : [];
  if (opt.project) {
    const pid = N.normalizeNotionPageId(opt.project) || (await N.projectIdByName(opt.project));
    if (!pid) die(`Project를 찾을 수 없습니다: ${opt.project}\nProject name, Notion page id, 또는 URL을 확인하세요.`);
    if (repoProjectIds.length && !repoProjectIds.includes(pid)) {
      die(`지정한 Project가 현재 repository의 Project relation에 포함되지 않습니다.\n  Repository: ${githubRepo}\n  Project: ${opt.project} (${pid})\n  Repository Project(s): ${repoProjectIds.join(", ")}`);
    }
    repoProjectIds = [pid];
  } else if (repoProjectIds.length === 0) {
    die(`Repository에서 Project relation을 찾을 수 없습니다: ${githubRepo}\nNotion Repository DB에서 repo와 Project 연결을 수정하거나, 이번 실행에 한해 --project <Project name|id|url>을 지정하세요.`);
  }

  // ---- Story 해석
  let contextHandoffPath = "";
  const storyProjectId = (s) => N.relIds(s, P.STORY_PROJECT)[0] || N.relIds(s, P.PROJECT)[0] || "";
  const forRepoProject = (rows) => (repoProjectIds.length ? rows.filter((s) => repoProjectIds.includes(storyProjectId(s))) : rows);
  const activeOnly = (rows) => rows.filter((s) => !isTerminal(N.statusOf(s)));

  const storyFromHandoffObj = async (h) => {
    if (typeof h?.story !== "object") return null;
    const id = h.story.notion_url ? N.normalizeNotionPageId(h.story.notion_url) : "";
    if (id) return tryGetPage(id);
    if (h.story.github_issue_url) return N.findStoryByIssueUrl(h.story.github_issue_url);
    return null;
  };
  const storyFromIssueUrl = async (issueUrl) => {
    const s = await N.findStoryByIssueUrl(issueUrl);
    if (s) return s;
    const task = await N.findTaskByIssueUrl(issueUrl);
    const sid = task ? N.relIds(task, P.STORY)[0] : "";
    if (sid) return tryGetPage(sid);
    const hl = await flow("handoff-load", [issueUrl]);
    if (hl.ok && hl.json?.found) return storyFromHandoffObj(hl.json.handoff);
    return null;
  };
  const storyFromHandoffFile = async (path) => {
    let h;
    try { h = JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
    if (typeof h?.story !== "object") return null;
    contextHandoffPath = resolve(path);
    const s = await storyFromHandoffObj(h);
    if (s) return s;
    return h.story.github_issue_url ? storyFromIssueUrl(h.story.github_issue_url) : null;
  };
  const selectStory = async (rows) => {
    if (!rows.length) die("조건에 맞는 Story가 없습니다.");
    if (rows.length === 1) return rows[0];
    const list = rows.map((s, i) => `  [${i + 1}] ${N.pageTitle(s)} [${N.statusOf(s)}]  ${s.url || s.id}`);
    warn("Story를 선택하세요.");
    warn(list.join("\n"));
    if (!interactive()) die("Story 후보가 여러 개입니다. --story <Notion Story URL> 로 지정해 다시 실행하세요.");
    const pick = await ask(`선택 [1-${rows.length}/q]: `);
    if (!pick || pick === "q") die("취소됨");
    const n = Number(pick);
    if (!(n >= 1 && n <= rows.length)) die("잘못된 선택");
    return rows[n - 1];
  };
  const loadStory = async (ref) => {
    if (ref) {
      const id = N.normalizeNotionPageId(ref);
      if (id) return N.getPage(id);
      if (existsSync(ref)) { const s = await storyFromHandoffFile(ref); if (s) return s; }
      const url = ghIssueUrlFromRef(ref, githubRepo);
      if (url) { const s = await storyFromIssueUrl(url); if (s) return s; }
      const rows = await N.queryDs(DB.STORY, { filter: { property: "Title", title: { contains: ref } } });
      return selectStory(activeOnly(forRepoProject(rows)));
    }
    if (existsSync("tmp/story-handoff.json")) { const s = await storyFromHandoffFile("tmp/story-handoff.json"); if (s) return s; }
    const num = N.issueNumFromBranch(currentBranch());
    if (num) {
      const url = ghIssueUrl(num, githubRepo);
      if (url) { const s = await storyFromIssueUrl(url); if (s) return s; }
    }
    const rows = await N.queryDs(DB.STORY, {
      filter: { and: [{ property: "Assignee", people: { contains: me.notionId } }, { or: [{ property: "Status", status: { equals: "시작 전" } }, { property: "Status", status: { equals: "진행 중" } }] }] },
    });
    return selectStory(activeOnly(forRepoProject(rows)));
  };

  const story = await loadStory(storyRef);
  if (!story?.id) die("Story를 찾을 수 없습니다.");
  const storyId = story.id, storyTitle = N.pageTitle(story), storyUrl = story.url || "";
  const projectId = storyProjectId(story);
  if (!projectId) die(`Story에서 Project relation을 찾을 수 없습니다: ${storyTitle}`);
  if (isTerminal(N.statusOf(story))) {
    die(`선택된 Story가 종료 상태입니다. 과거 Story에 새 Task를 붙이지 않도록 중단합니다.\n  Story: ${storyTitle}\n  Status: ${N.statusOf(story) || "unknown"}\n활성 Story를 지정하거나, 정말 재개가 필요하면 Notion에서 Story 상태를 먼저 되돌리세요.`);
  }
  if (!repoProjectIds.includes(projectId)) {
    die(`Story의 Project가 현재 repository의 Project와 일치하지 않습니다.\n  Repository: ${githubRepo}\n  Story: ${storyTitle}\n  Story Project: ${projectId}\n  Repository Project(s): ${repoProjectIds.join(", ")}`);
  }

  let taskName = opt.name || "";
  if (!taskName) {
    if (!interactive()) die("Task Name은 필수입니다. --name <task> 를 지정하세요.");
    say(`Story: ${storyTitle}`);
    taskName = await ask("Task Name: ");
  }
  if (!taskName) die("Task Name은 필수입니다.");
  let plannedStart = opt.plannedStart || "", plannedEnd = opt.plannedEnd || "", description = opt.description || "";
  if (!plannedStart && interactive()) { const d = N.localDate(); plannedStart = (await ask(`Planned start [${d}]: `)) || d; }
  if (!plannedEnd && interactive()) plannedEnd = await ask("Planned end [same]: ");
  if (!description && interactive()) description = await ask("Description (선택): ");

  let weekId = "";
  try { weekId = await N.currentWeekId(); } catch { /* Week 없이 진행 */ }

  say("▸ GitHub Issue 생성 중...");
  const issueBody = `${description}\n\n---\n${storyUrl ? `Notion Story: ${storyUrl}\n` : ""}`;
  const ir = await createGithubIssue(githubRepo, taskName, issueBody);
  if (!ir.ok) die(`GitHub Issue 생성 실패\n${ir.error}`);
  const issueUrl = ir.json.issue_url, issueNum = ir.json.issue_num;

  say("▸ Notion Task 생성 중...");
  const props = {
    Name: titleProp(taskName),
    Topic: { select: { name: topic } },
    [P.STORY]: relProp([storyId]),
    [P.PROJECT]: relProp([projectId]),
    Assignee: { people: [{ id: me.notionId }] },
    "Issue URL": { url: issueUrl },
  };
  if (repoId) props[P.REPOSITORY] = relProp([repoId]);
  if (weekId) props[P.WEEK] = relProp([weekId]);
  if (parentIds.length) props["Parent Task"] = relProp(parentIds);
  if (plannedStart) props["Planned Date"] = { date: { start: plannedStart, ...(plannedEnd ? { end: plannedEnd } : {}) } };

  const descBlocks = N.mdToBlocks(description);
  const taskResp = await N.createPageFromTemplate(DB.TASK, props, N.TASK_TEMPLATE_ID);
  if (!taskResp?.id) die("Notion Task 생성 실패\n" + JSON.stringify(taskResp));
  const taskId = taskResp.id, taskUrl = taskResp.url;
  await N.waitForTemplateApplied(taskId);
  try { if (descBlocks.length) await N.insertBlocksAfterText(taskId, descBlocks, "설명"); }
  catch (e) { die("Notion Task description 삽입 실패\n" + e.message); }

  const branch = await branchNameFor(issueNum, topic, taskName);
  let wtPath = "", baseUsed = "";
  if (opt.here) say("▸ --here: 브랜치/worktree 생성 생략");
  else if (opt.noCheckout) {
    baseUsed = resolveBaseBranch(opt.base);
    const baseRef = N.git(["show-ref", "--verify", "--quiet", `refs/remotes/origin/${baseUsed}`]).ok ? `origin/${baseUsed}` : baseUsed;
    if (N.git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).ok) say(`▸ 기존 브랜치 사용: ${branch}`);
    else {
      const r = N.git(["branch", branch, baseRef]);
      if (!r.ok) die(`브랜치 생성 실패: ${r.err}`);
      say(`▸ 브랜치 생성: ${branch}`);
    }
    N.git(["config", `branch.${branch}.gh-merge-base`, baseUsed]);
  } else {
    say("▸ Worktree 생성 중...");
    baseUsed = resolveBaseBranch(opt.base);
    const wt = await flow("wt-add", ["--branch", branch, "--base", baseUsed]);
    if (!wt.ok) die(`Worktree 생성 실패: ${wt.error}${wt.detail ? "\n" + wt.detail : ""}`);
    wtPath = wt.json.worktree;
  }

  if (baseUsed) {
    const note = `Branch: ${branch}\nBase Branch: ${baseUsed}` + (wtPath ? `\nWorktree: ${wtPath}` : "");
    try { await N.addComment(taskId, note); } catch { /* best-effort */ }
    await ghIssueComment(githubRepo, issueNum, note);
  }

  // handoff 갱신 (컨텍스트 handoff 가 있으면 append, 없고 worktree 가 있으면 새로 만든다)
  let handoffFile = "";
  if (contextHandoffPath && existsSync(contextHandoffPath)) handoffFile = contextHandoffPath;
  else if (wtPath) {
    handoffFile = join(wtPath, "tmp", "story-handoff.json");
    await flow("handoff-init", ["--file", handoffFile, "--title", storyTitle, "--notion-id", storyId, "--notion-url", storyUrl, "--repo", githubRepo, "--base", baseUsed]);
  }
  if (handoffFile) {
    const parentUrls = await parentIssueUrls(parentIds);
    await addTaskToHandoff(handoffFile, {
      name: taskName, topic, repo: githubRepo, notion_task_id: taskId, issue_url: issueUrl, issue_num: issueNum, pr_url: "", branch,
      base_branch: baseUsed, worktree: wtPath, parent_task_ids: parentIds, parent_issue_urls: parentUrls, status: "Ready",
    });
    const hc = `Story Handoff Update\n\nAdded Task: ${taskName}\nIssue: ${issueUrl}\nBranch: ${branch}\nBase Branch: ${baseUsed || "-"}` + (wtPath ? `\nWorktree: ${wtPath}` : "");
    try { await N.addComment(storyId, hc); } catch { /* best-effort */ }
  }

  say("");
  say("✅ Task 생성 완료");
  say(`  Story: ${storyTitle}`);
  say(`  Task: #${issueNum} ${taskName}`);
  say(`  Issue: ${issueUrl}`);
  say(`  Notion: ${taskUrl}`);
  say(`  Branch: ${branch}`);
  if (baseUsed) say(`  Base Branch: ${baseUsed}`);
  if (wtPath) say(`  Worktree: ${wtPath}`);
}

// ---------------------------------------------------------------- story-run
async function resolveStoryForRun(ref) {
  const fromIssueUrl = async (issueUrl) => {
    const s = await N.findStoryByIssueUrl(issueUrl);
    if (s) return s;
    const t = await N.findTaskByIssueUrl(issueUrl);
    const sid = t ? N.relIds(t, P.STORY)[0] : "";
    return sid ? N.getPage(sid) : null;
  };
  if (ref) {
    const id = N.normalizeNotionPageId(ref);
    if (id) return N.getPage(id);
    let url = "";
    if (/^https:\/\/github\.com\/.+\/issues\/\d+$/.test(ref)) url = ref;
    else if (/^\d+$/.test(ref.replace(/^#/, ""))) url = ghIssueUrl(ref.replace(/^#/, ""));
    if (url) { const s = await fromIssueUrl(url); if (s) return s; }
  }
  const num = N.issueNumFromBranch(currentBranch());
  if (num) { const url = ghIssueUrl(num); if (url) { const s = await fromIssueUrl(url); if (s) return s; } }
  return null;
}

async function storyRunFetch(ref) {
  const story = await resolveStoryForRun(ref);
  if (!story) die("Story를 찾을 수 없습니다. Story Notion URL, Task Issue, 또는 Task worktree에서 실행하세요.");
  const storyRepo = (N.gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).out) || "";
  const rows = await N.queryDs(DB.TASK, { filter: { property: P.STORY, relation: { contains: story.id } }, sorts: [{ property: "Created", direction: "ascending" }], all: true });

  const tasks = [];
  for (const r of rows) {
    const issueUrl = N.urlOf(r, "Issue URL");
    const num = (issueUrl.match(/(\d+)$/) || [])[1] || "";
    const repoId = N.relIds(r, P.REPOSITORY)[0];
    let repo = "";
    if (repoId) { try { repo = await N.repositorySlugById(repoId); } catch { /* 아래 fallback */ } }
    const name = N.taskName(r), topic = N.selectOf(r, "Topic") || "Other";
    let branch = branchesForIssue(num);
    if (!branch && num) branch = await branchNameFor(num, topic, name);
    const parentIds = N.relIds(r, "Parent Task");
    const parents = [];
    for (const pid of parentIds) {
      const pg = await tryGetPage(pid);
      if (pg) parents.push({ name: N.taskName(pg), status: N.statusOf(pg), issue_url: N.urlOf(pg, "Issue URL"), pr_url: N.urlOf(pg, "PR URL") });
    }
    tasks.push({
      notion_task_id: r.id, name, status: N.statusOf(r), topic, issue_url: issueUrl, pr_url: N.urlOf(r, "PR URL"),
      repo: repo || storyRepo, branch, parent_task_ids: parentIds, parents,
    });
  }
  const base = N.git(["show-ref", "--verify", "--quiet", "refs/remotes/origin/dev"]).ok ? "dev" : "main";
  return {
    source: "notion",
    story: { title: N.pageTitle(story), notion_id: story.id, notion_url: story.url || "", github_repo: storyRepo, base_branch: base },
    tasks,
  };
}

async function cmdStoryRunFetch(argv) {
  const { pos } = parseArgs(argv);
  say(JSON.stringify(await storyRunFetch(pos[0] || ""), null, 2));
}

async function cmdStoryRun(argv) {
  const { opt, pos } = parseArgs(argv, { bool: { "--publish": "publish", "--json": "json" } });
  if (opt.help) return say("사용법: story-run [task-issue|handoff-json|notion-story-url] [--publish] [--json]");
  const ref = pos[0] || "";
  let input;
  const hl = await flow("handoff-load", ref ? [ref] : []);
  if (hl.ok && hl.json?.found) {
    const h = hl.json.handoff;
    input = { source: h._source || "handoff", story: h.story, tasks: h.tasks };
  } else input = await storyRunFetch(ref);

  const dir = tmpWorkdir();
  try {
    const f = join(dir, "input.json");
    writeFileSync(f, JSON.stringify(input));
    const ev = await flow("story-eval", ["--input", "@" + f]);
    if (!ev.ok) die(`story-eval 실패: ${ev.error}`);
    const r = ev.json;
    if (opt.publish) {
      const sid = input.story?.notion_id || N.normalizeNotionPageId(input.story?.notion_url || "");
      if (sid) { try { await N.addComment(sid, r.summary); } catch (e) { warn(`WARN: Story 코멘트 추가 실패: ${e.message}`); } }
    }
    if (opt.json) say(readFileSync(join(r.output_dir, "summary.json"), "utf8"));
    else {
      say(r.summary);
      say("");
      say("Generated:");
      say(`- Summary: ${r.summary_md}`);
      say(`- JSON: ${join(r.output_dir, "summary.json")}`);
      say(`- Ready task prompts: ${join(r.output_dir, "prompts")}`);
    }
  } finally { cleanup(dir); }
}

async function cmdStoryComment(argv) {
  const { opt, pos } = parseArgs(argv, { value: { "--file": "file" } });
  const id = N.normalizeNotionPageId(pos[0] || "");
  if (!id || !opt.file) die("사용법: story-comment <story page id|url> --file <path>");
  const text = readFileSync(opt.file, "utf8");
  await N.addComment(id, text);
  say(`✓ 코멘트 추가됨: ${id}`);
}

// ---------------------------------------------------------------- cache-refresh
async function cmdCacheRefresh(argv) {
  const { opt } = parseArgs(argv, { bool: { "--quiet": "quiet", "--strict": "strict" } });
  if (opt.help) return say("사용법: cache-refresh [--quiet] [--strict]");
  const log = (...a) => { if (!opt.quiet) say(...a); };
  if (!N.resolveToken()) {
    const m = "Notion token not found. Set NOTION_TOKEN or configure notion-api MCP.";
    if (opt.strict) die(m);
    return say(`SKIP: ${m}`);
  }
  let failed = false;
  const step = async (label, fn) => {
    try { await fn(); log(`OK: ${label}`); } catch (e) { failed = true; warn(`WARN: failed to refresh ${label}: ${e.message.split("\n")[0]}`); }
  };
  await step("members", () => N.memberCacheRefresh());
  await step("projects", () => N.projectCacheRefresh());
  await step("repositories", () => N.repoCacheRefresh());
  await step("task schema", () => N.schemaRefresh("task", DB.TASK));
  await step("story schema", () => N.schemaRefresh("story", DB.STORY));
  await step("project schema", () => N.schemaRefresh("project", DB.PROJECT));
  await step("task template", () => N.templateBlocksCached(N.TASK_TEMPLATE_ID));
  for (const tag of ["Feature", "Update", "Refactor", "Bug"]) await step(`story template: ${tag}`, () => N.templateBlocksCached(N.storyTemplateId(tag)));
  if (failed) {
    if (opt.strict) die("Notion cache refresh 실패");
    return say(`DONE: Notion cache refresh completed with warnings at ${N.paths().cache}`);
  }
  say(`DONE: Notion cache ready at ${N.paths().cache}`);
}

// ---------------------------------------------------------------- find-*
async function cmdFindByIssueUrl(kind, argv) {
  const url = argv[0];
  if (!url) die(`사용법: find-${kind}-by-issue-url <github issue url>`);
  const page = kind === "task" ? await N.findTaskByIssueUrl(url) : await N.findStoryByIssueUrl(url);
  if (page?.url) say(page.url);
}

// ---------------------------------------------------------------- main
const COMMANDS = {
  "my-tasks": cmdMyTasks,
  "task-status": cmdTaskStatus,
  "task-note": cmdTaskNote,
  "task-link-issue": cmdTaskLinkIssue,
  "sync-task": cmdSyncTask,
  issue: cmdIssue,
  "weekly-collect": cmdWeeklyCollect,
  "weekly-publish": cmdWeeklyPublish,
  "story-create": cmdStoryCreate,
  "task-create": cmdTaskCreate,
  "story-run": cmdStoryRun,
  "story-run-fetch": cmdStoryRunFetch,
  "story-comment": cmdStoryComment,
  "cache-refresh": cmdCacheRefresh,
  "find-task-by-issue-url": (a) => cmdFindByIssueUrl("task", a),
  "find-story-by-issue-url": (a) => cmdFindByIssueUrl("story", a),
};

const [, , sub, ...rest] = process.argv;
if (!sub || sub === "--help" || sub === "-h" || !COMMANDS[sub]) {
  process.stderr.write(`사용법: ult-notion.mjs <${Object.keys(COMMANDS).join("|")}> [옵션]\n`);
  process.exitCode = sub && sub !== "--help" && sub !== "-h" ? 1 : 0;
} else {
  try {
    await COMMANDS[sub](rest);
  } catch (e) {
    if (e instanceof UserError) warn(e.message);
    else if (e instanceof NotionError) warn(`ERROR: ${e.message}`);
    else warn(`ERROR: ${e?.message || e}`);
    process.exitCode = 1;
  } finally {
    _rl?.close();
  }
}
