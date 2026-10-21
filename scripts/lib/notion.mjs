// Notion REST 클라이언트 + Ultivis 워크플로 공통 헬퍼 (Node >= 20, 내장 fetch 만 사용, 의존성 없음).
// bash / jq / curl / python 이 필요 없다. Windows 에서도 동작한다.
//
// 토큰 우선순위: env NOTION_TOKEN → ~/.claude/dev-tools/.env 의 NOTION_TOKEN →
//   ~/.claude.json (WORKFLOW_CONFIG_JSON 로 변경 가능)의 .mcpServers["notion-api"].env.NOTION_TOKEN
//   → 첫 번째 .projects[*].mcpServers["notion-api"].env.NOTION_TOKEN
//
// 테스트용 환경변수: NOTION_API_BASE, ULT_GH_BIN, ULT_GIT_BIN, ULT_NOTION_RETRY_BASE_MS, ULT_NOTION_MAX_RETRIES,
//   ULT_NOTION_TEMPLATE_WAIT_SECONDS, ULT_NOTION_TEMPLATE_POLL_MS, ULT_NOTION_TIMEOUT_MS

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------- 상수
export const DB = {
  TASK: "b89060b1-037c-480d-8671-f206aec117b6",
  STORY: "338b9757-d10f-462f-92c9-4777cb747c78",
  PROJECT: "0848664d-6ecf-441e-b3d5-6b1f4fd540f8",
  REPOSITORY: "23a729af-8b39-4fe9-accb-c0eb44538ce0",
  WEEK: "2caff747-77ab-8055-b249-000bec1e846b",
  MEMBER: "11bab65b-33f6-417a-aaf2-ccdb7f574b71",
  DAILY_REPORT: "f365bbd5-d7e3-49c9-bf0d-89c757de27df",
  WEEKLY_REVIEW: "301ff747-77ab-803b-905a-000b9fc65ad9",
};

export const STORY_TEMPLATES = {
  Feature: "1f5ff747-77ab-80fa-8c93-f4b636c102e4",
  Update: "1fbff747-77ab-800b-922b-fa5e761d7ee0",
  Refactor: "1ffff747-77ab-80c6-b148-e0b56d3e3fb4",
  Bug: "1fbff747-77ab-806a-ae8e-f642b3ed4b17",
};
export const TASK_TEMPLATE_ID = "1f5ff747-77ab-80b1-975a-d04aeb3adf56";
export const WEEKLY_REVIEW_MARKETING_TEMPLATE_ID = "30fff747-77ab-8068-b92c-c06ec0167789";

export const storyTemplateId = (tag) => STORY_TEMPLATES[tag] || "";
export const weeklyReviewTemplateId = (ref) =>
  ["", "마케팅", "marketing", "Marketing"].includes(ref || "") ? WEEKLY_REVIEW_MARKETING_TEMPLATE_ID : ref;

// 속성 이름 (이모지 포함; Story 의 Project relation 이름 끝에는 공백이 있다)
export const P = {
  STORY: "\u{1F4DC} Story",
  REPOSITORY: "\u{1F968} Repository",
  PROJECT: "\u{1F6E1}️ Project", // Task, Weekly Review
  STORY_PROJECT: "\u{1F6E1}️ Project ", // Story (끝 공백 주의)
  REPO_PROJECT: "\u{1F6E1}️ Project DB ", // Repository
  WEEK: "❤️‍\u{1F525} Week",
  COMMIT: "\u{1F50E} Commit",
};

// ---------------------------------------------------------------- 경로 / env 파일
// 설치 루트 결정: WORKFLOW_HOME > APP_HOME > 이 파일이 설치본(~/.claude 또는 ~/.codex 또는 CODEX_HOME)의
// scripts/lib 아래에 있으면 그 루트 > CODEX_HOME > ~/.claude. 예전 bash workflow-env.sh 와 같은 규칙이라
// Codex 설치본은 ~/.codex/notion-cache·dev-tools/.env 를 그대로 쓴다.
function installHome() {
  const norm = (p) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
  const self = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const known = [join(homedir(), ".claude"), join(homedir(), ".codex"), process.env.CODEX_HOME].filter(Boolean);
  if (known.some((k) => norm(k) === norm(self))) return self;
  if (process.env.CODEX_HOME) return process.env.CODEX_HOME;
  return join(homedir(), ".claude");
}

export function paths() {
  const home = process.env.WORKFLOW_HOME || process.env.APP_HOME || installHome();
  return {
    home,
    devTools: process.env.WORKFLOW_DEV_TOOLS_DIR || join(home, "dev-tools"),
    cache: process.env.WORKFLOW_CACHE_DIR || join(home, "notion-cache"),
    config: process.env.WORKFLOW_CONFIG_JSON || join(homedir(), ".claude.json"),
  };
}

export function readEnvFile(file) {
  const envs = {};
  if (!existsSync(file)) return envs;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) envs[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return envs;
}

// ---------------------------------------------------------------- 토큰
export function resolveToken() {
  if (process.env.NOTION_TOKEN) return { token: process.env.NOTION_TOKEN, source: "env NOTION_TOKEN" };

  const envFile = join(paths().devTools, ".env");
  const fromFile = readEnvFile(envFile).NOTION_TOKEN;
  if (fromFile) return { token: fromFile, source: envFile };

  const cfg = paths().config;
  if (existsSync(cfg)) {
    try {
      const j = JSON.parse(readFileSync(cfg, "utf8"));
      const t1 = j?.mcpServers?.["notion-api"]?.env?.NOTION_TOKEN;
      if (t1) return { token: t1, source: `${cfg} (mcpServers.notion-api)` };
      for (const proj of Object.values(j?.projects || {})) {
        const t2 = proj?.mcpServers?.["notion-api"]?.env?.NOTION_TOKEN;
        if (t2) return { token: t2, source: `${cfg} (projects.*.mcpServers.notion-api)` };
      }
    } catch { /* 깨진 JSON 은 무시 */ }
  }
  return null;
}

let _tokenInfo = null;
function requireToken() {
  _tokenInfo = _tokenInfo || resolveToken();
  if (!_tokenInfo) {
    throw new NotionError(
      "Notion 토큰을 찾을 수 없습니다.\n" +
        "  1) 환경변수 NOTION_TOKEN 설정 (Windows: setx NOTION_TOKEN \"secret_xxx\" 후 Claude 재시작), 또는\n" +
        "  2) " + join(paths().devTools, ".env") + " 에 NOTION_TOKEN=secret_xxx 한 줄 추가, 또는\n" +
        "  3) 이전에 `claude mcp add ... -e NOTION_TOKEN=... notion-api ...` 로 등록했다면 " + paths().config + " 에서 자동 인식합니다.",
      { code: "no_token" },
    );
  }
  return _tokenInfo;
}
export function resetTokenCache() { _tokenInfo = null; }

// ---------------------------------------------------------------- REST
export class NotionError extends Error {
  constructor(message, { status = 0, code = "", body = null } = {}) {
    super(message);
    this.name = "NotionError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function describeHttpError(status, body, source) {
  const code = body?.code || "";
  const msg = body?.message || "";
  if (status === 401) return `Notion 인증 실패 (401): 토큰이 올바르지 않거나 만료되었습니다. (토큰 출처: ${source})`;
  if (status === 403) return `Notion 접근 권한이 없습니다 (403): 통합(Integration)의 권한을 확인하세요. ${msg}`.trim();
  if (status === 404)
    return `Notion에서 대상을 찾을 수 없습니다 (404 ${code}): 해당 페이지/DB가 통합(Integration)에 공유(연결)되어 있는지 확인하세요. ${msg}`.trim();
  if (status === 429) return "Notion 요청 한도 초과 (429): 재시도 후에도 실패했습니다. 잠시 후 다시 시도하세요.";
  if (status >= 500) return `Notion 서버 오류 (${status} ${code}): 잠시 후 다시 시도하세요. ${msg}`.trim();
  return `Notion 요청 실패 (${status} ${code}): ${msg}`.trim();
}

// notionApi("POST", "/pages", body) -> 파싱된 JSON. 실패하면 NotionError.
export async function notionApi(method, path, body) {
  const { token, source } = requireToken();
  const base = (process.env.NOTION_API_BASE || "https://api.notion.com/v1").replace(/\/+$/, "");
  const maxRetries = Number(process.env.ULT_NOTION_MAX_RETRIES ?? 5);
  const baseDelay = Number(process.env.ULT_NOTION_RETRY_BASE_MS ?? 500);
  const timeout = Number(process.env.ULT_NOTION_TIMEOUT_MS ?? 30000);

  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(base + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2025-09-03",
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (e) {
      if (attempt < maxRetries) {
        await sleep(Math.min(baseDelay * 2 ** attempt, 8000));
        continue;
      }
      throw new NotionError(`Notion API에 연결할 수 없습니다: ${e?.cause?.message || e?.message || e}`, { code: "network" });
    }

    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* 비 JSON 응답 */ }

    if (res.ok) return json ?? {};

    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      const ra = Number(res.headers.get("retry-after"));
      const delay = res.status === 429 && Number.isFinite(ra) && ra >= 0 ? Math.min(ra * 1000, 30000) : Math.min(baseDelay * 2 ** attempt, 8000);
      await sleep(delay);
      continue;
    }
    throw new NotionError(describeHttpError(res.status, json, source), { status: res.status, code: json?.code || "", body: json });
  }
}

// ---------------------------------------------------------------- 페이지 / DB
export async function queryDs(ds, { filter, sorts, pageSize = 100, all = false } = {}) {
  const results = [];
  let cursor;
  do {
    const body = { page_size: pageSize };
    if (filter && Object.keys(filter).length) body.filter = filter;
    if (sorts) body.sorts = sorts;
    if (cursor) body.start_cursor = cursor;
    const r = await notionApi("POST", `/data_sources/${ds}/query`, body);
    results.push(...(r.results || []));
    cursor = r.has_more ? r.next_cursor : null;
  } while (all && cursor);
  return results;
}

export const getPage = (id) => notionApi("GET", `/pages/${id}`);
export const patchPage = (id, properties) => notionApi("PATCH", `/pages/${id}`, { properties });
export const createPage = (ds, properties, children = []) =>
  notionApi("POST", "/pages", { parent: { data_source_id: ds }, properties, children });
export const createPageFromTemplate = (ds, properties, templateId, timezone = "Asia/Seoul") =>
  notionApi("POST", "/pages", {
    parent: { data_source_id: ds },
    properties,
    template: { type: "template_id", template_id: templateId, timezone },
  });

export async function listChildren(blockId, { all = true, pageSize = 100 } = {}) {
  const results = [];
  let cursor;
  do {
    const q = `?page_size=${pageSize}` + (cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : "");
    const r = await notionApi("GET", `/blocks/${blockId}/children${q}`);
    results.push(...(r.results || []));
    cursor = r.has_more ? r.next_cursor : null;
  } while (all && cursor);
  return results;
}

// children 을 100개씩 나눠 append. position 이 있으면 그 뒤에서 시작하고 청크마다 직전 마지막 블록 뒤로 이어 붙인다.
export async function appendBlocks(blockId, children, position) {
  const created = [];
  if (!children || children.length === 0) return created;
  for (let off = 0; off < children.length; off += 100) {
    const body = { children: children.slice(off, off + 100) };
    if (position) body.position = position;
    const r = await notionApi("PATCH", `/blocks/${blockId}/children`, body);
    const results = r.results || [];
    created.push(...results);
    const last = results[results.length - 1]?.id;
    if (last) position = { type: "after_block", after_block: { id: last } };
  }
  return created;
}

export const blockPlainText = (block) => {
  const rt = block?.[block?.type]?.rich_text;
  return Array.isArray(rt) ? rt.map((x) => x.plain_text ?? x.text?.content ?? "").join("") : "";
};

export async function findChildBlockByText(pageId, text) {
  const blocks = await listChildren(pageId);
  for (const b of blocks) {
    const plain = blockPlainText(b);
    if (plain === text || plain.includes(text)) return b.id;
  }
  return "";
}

export async function insertBlocksAfterText(pageId, children, text) {
  const anchor = await findChildBlockByText(pageId, text);
  if (!anchor) return appendBlocks(pageId, children);
  return appendBlocks(pageId, children, { type: "after_block", after_block: { id: anchor } });
}

// 템플릿은 비동기로 적용되므로 children 이 채워질 때까지 기다린다.
export async function waitForTemplateApplied(pageId, timeoutSec) {
  const timeout = Number(timeoutSec ?? process.env.ULT_NOTION_TEMPLATE_WAIT_SECONDS ?? 60);
  const poll = Number(process.env.ULT_NOTION_TEMPLATE_POLL_MS ?? 2000);
  const start = Date.now();
  for (;;) {
    const r = await notionApi("GET", `/blocks/${pageId}/children?page_size=1`);
    if ((r.results || []).length > 0) return true;
    if (Date.now() - start >= timeout * 1000) {
      throw new NotionError(
        `Notion template 적용 대기 시간이 초과되었습니다: ${pageId}\n템플릿이 비어 있거나 적용 권한/처리가 실패했을 수 있습니다.`,
        { code: "template_timeout" },
      );
    }
    await sleep(poll);
  }
}

const textItems = (content, max = 2000) => {
  const out = [];
  for (let i = 0; i < content.length; i += max) out.push({ type: "text", text: { content: content.slice(i, i + max) } });
  return out;
};

// 코멘트 추가. 2000자를 넘으면 rich_text 항목으로 나눈다(항목 100개 한도 → 약 20만자).
export async function addComment(pageId, content) {
  if (!content) return null;
  return notionApi("POST", "/comments", { parent: { page_id: pageId }, rich_text: textItems(String(content)).slice(0, 100) });
}

// 긴 본문을 여러 코멘트로 분할 (handoff 코멘트처럼 1800자 단위가 필요할 때)
export async function addCommentChunks(pageId, content, { size = 1800, prefix = (n) => `[${n}]\n` } = {}) {
  let n = 1;
  for (let o = 0; o < content.length; o += size, n++) await addComment(pageId, prefix(n) + content.slice(o, o + size));
  return n - 1;
}

// ---------------------------------------------------------------- 속성 읽기 헬퍼
export const pt = (arr) => (Array.isArray(arr) ? arr.map((x) => x.plain_text ?? x.text?.content ?? "").join("") : "");
export const pageTitle = (page, fallback = "(제목 없음)") =>
  pt(page?.properties?.Title?.title) || pt(page?.properties?.Name?.title) || fallback;
export const taskName = (page) => pt(page?.properties?.Name?.title) || pt(page?.properties?.Title?.title) || "(제목 없음)";
export const statusOf = (page) => page?.properties?.Status?.status?.name || "";
export const selectOf = (page, name) => page?.properties?.[name]?.select?.name || "";
export const urlOf = (page, name) => page?.properties?.[name]?.url || "";
export const relIds = (page, name) => (page?.properties?.[name]?.relation || []).map((r) => r.id);
// number / formula(number) / rollup(number) 어느 쪽이든 숫자를 꺼낸다
export const numberOf = (page, name) => {
  const p = page?.properties?.[name];
  return p?.number ?? p?.formula?.number ?? p?.rollup?.number ?? null;
};
export const formulaString = (page, name) => page?.properties?.[name]?.formula?.string ?? "";
export const dateOf = (page, name) => {
  const p = page?.properties?.[name];
  return p?.date ?? p?.formula?.date ?? null;
};

// ---------------------------------------------------------------- 외부 프로세스 (gh / git)
export function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, ...opts });
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim(), status: r.status };
}
export const ghBin = () => process.env.ULT_GH_BIN || "gh";
export const gitBin = () => process.env.ULT_GIT_BIN || "git";
// 테스트용 ULT_GH_BIN/ULT_GIT_BIN 이 .mjs/.js 이면 node 로 실행한다 (Windows 는 shebang 스크립트를 직접 실행할 수 없다).
export const shBin = (bin, args, opts) => (/\.[cm]?js$/i.test(bin) ? sh(process.execPath, [bin, ...args], opts) : sh(bin, args, opts));
export const gh = (args, opts) => shBin(ghBin(), args, opts);
export const git = (args, cwd) => shBin(gitBin(), cwd ? ["-C", cwd, ...args] : args);
export const githubLogin = () => {
  const r = gh(["api", "user", "--jq", ".login"]);
  return r.ok ? r.out : "";
};

// ---------------------------------------------------------------- 캐시
function cacheFresh(file, ttlMin) {
  try { return Date.now() - statSync(file).mtimeMs < ttlMin * 60000; } catch { return false; }
}
function cachePath(...p) {
  const dir = join(paths().cache, ...p.slice(0, -1));
  mkdirSync(dir, { recursive: true });
  return join(paths().cache, ...p);
}
function readJson(file) { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } }
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

// Member (24h)
export async function memberCacheRefresh() {
  const rows = await queryDs(DB.MEMBER, { all: true });
  const by_github = {};
  for (const r of rows) {
    const gh_ = pt(r.properties?.Github?.rich_text).trim();
    const nid = r.properties?.Notion?.people?.[0]?.id;
    if (!gh_ || !nid) continue;
    by_github[gh_] = { notion_id: nid, name: pt(r.properties?.Name?.title) };
  }
  const data = { version: 1, cached_at: nowIso(), by_github };
  writeFileSync(cachePath("members.json"), JSON.stringify(data, null, 2));
  return data;
}
async function members() {
  const f = cachePath("members.json");
  if (cacheFresh(f, 1440)) { const j = readJson(f); if (j?.by_github) return j; }
  return memberCacheRefresh();
}
function memberEntry(data, login) {
  if (!login) return null;
  if (data.by_github[login]) return data.by_github[login];
  const k = Object.keys(data.by_github).find((x) => x.toLowerCase() === login.toLowerCase());
  return k ? data.by_github[k] : null;
}
export async function memberNotionId(login) { return memberEntry(await members(), login)?.notion_id || ""; }
export async function memberName(login) { return memberEntry(await members(), login)?.name || ""; }

// Project (6h)
export async function projectCacheRefresh() {
  const rows = await queryDs(DB.PROJECT, { all: true });
  const data = { cached_at: nowIso(), items: rows.map((r) => ({ id: r.id, name: pt(r.properties?.Title?.title) || "(제목없음)" })) };
  writeFileSync(cachePath("projects.json"), JSON.stringify(data, null, 2));
  return data;
}
async function projects() {
  const f = cachePath("projects.json");
  if (cacheFresh(f, 360)) { const j = readJson(f); if (j?.items) return j; }
  return projectCacheRefresh();
}
export async function projectIdByName(name) { return (await projects()).items.find((i) => i.name === name)?.id || ""; }
export async function projectsList() { return (await projects()).items; }

// Repository (6h)
export async function repoCacheRefresh() {
  const rows = await queryDs(DB.REPOSITORY, { all: true });
  const data = {
    cached_at: nowIso(),
    items: rows.map((r) => ({
      id: r.id,
      name: pt(r.properties?.Name?.title) || "(제목없음)",
      url: r.properties?.URL?.url || "",
      project_ids: relIds(r, P.REPO_PROJECT),
    })),
  };
  writeFileSync(cachePath("repositories.json"), JSON.stringify(data, null, 2));
  return data;
}
async function repos() {
  const f = cachePath("repositories.json");
  if (cacheFresh(f, 360)) { const j = readJson(f); if (j?.items) return j; }
  return repoCacheRefresh();
}
export function githubRepoFromUrl(url) {
  if (!url) return "";
  const s = String(url).replace(/^git@github\.com:/, "").replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/+$/, "");
  return /^[^/]+\/[^/]+$/.test(s) ? s : "";
}
export async function repositoriesList() { return (await repos()).items; }
export async function repositoryIdByName(name) { return (await repos()).items.find((i) => i.name === name)?.id || ""; }
export async function repositoryProjectIds(id) { return (await repos()).items.find((i) => i.id === id)?.project_ids || []; }
export async function repositoryUrlById(id) { return (await repos()).items.find((i) => i.id === id)?.url || ""; }
export async function repositorySlugById(id) { return githubRepoFromUrl(await repositoryUrlById(id)); }
export async function repositoryIdBySlug(slug) {
  return (await repos()).items.find((i) => i.name === slug || githubRepoFromUrl(i.url) === slug)?.id || "";
}

// Schema (7d) / Template blocks (7d) — cache-refresh 용
const SCHEMA_DS = { task: DB.TASK, story: DB.STORY, project: DB.PROJECT };
export async function schemaRefresh(name, dsId = SCHEMA_DS[name]) {
  const r = await notionApi("GET", `/data_sources/${dsId}`);
  writeFileSync(cachePath("schemas", `${name}.json`), JSON.stringify(r, null, 2));
  return r;
}
export async function schemaOptions(name, prop, type = "select") {
  const f = cachePath("schemas", `${name}.json`);
  const j = cacheFresh(f, 10080) ? readJson(f) : await schemaRefresh(name);
  return (j?.properties?.[prop]?.[type]?.options || []).map((o) => o.name);
}
const stripNulls = (v) =>
  Array.isArray(v) ? v.map(stripNulls)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, stripNulls(x)]))
  : v;
export async function templateBlocksCached(templateId) {
  const f = cachePath("templates", `${templateId}.json`);
  if (cacheFresh(f, 10080)) { const j = readJson(f); if (Array.isArray(j)) return stripNulls(j); }
  const blocks = await listChildren(templateId);
  const drop = ["id", "parent", "created_time", "last_edited_time", "created_by", "last_edited_by", "has_children", "in_trash", "archived", "request_id"];
  const cleaned = blocks
    .filter((b) => !["child_database", "child_page", "unsupported"].includes(b.type))
    .map((b) => stripNulls(Object.fromEntries(Object.entries(b).filter(([k]) => !drop.includes(k)))));
  writeFileSync(f, JSON.stringify(cleaned, null, 2));
  return cleaned;
}

// ---------------------------------------------------------------- Week / 파인더
export async function currentWeekId(today = localDate()) {
  const rows = await queryDs(DB.WEEK, {
    filter: { and: [{ property: "DateFrom", date: { on_or_before: today } }] },
    sorts: [{ property: "DateFrom", direction: "descending" }],
    pageSize: 1,
  });
  return rows[0]?.id || "";
}

export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Task 는 반드시 정확한 Issue URL 로만 찾는다 (이슈 번호만으로 찾지 않는다: 저장소마다 번호가 겹친다)
export async function findTaskByIssueUrl(url) {
  if (!url) return null;
  const rows = await queryDs(DB.TASK, { filter: { property: "Issue URL", url: { equals: url } } });
  return rows[0] || null;
}
export async function findStoryByIssueUrl(url) {
  if (!url) return null;
  const rows = await queryDs(DB.STORY, { filter: { property: "Issue URL", url: { equals: url } } });
  return rows[0] || null;
}
export async function findUnlinkedTasksByTitle(title) {
  return queryDs(DB.TASK, {
    filter: { and: [{ property: "Name", title: { contains: title } }, { property: "Issue URL", url: { is_empty: true } }] },
  });
}

// ---------------------------------------------------------------- 유틸
export function normalizeNotionPageId(ref) {
  const s = String(ref || "");
  const uuid = [...s.matchAll(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g)].pop();
  if (uuid) return uuid[0];
  const c = [...s.matchAll(/[0-9a-fA-F]{32}/g)].pop();
  if (c) { const x = c[0]; return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`; }
  return "";
}

export function issueNumFromBranch(branch) {
  if (!branch) return "";
  return (branch.match(/^(\d+)/) || branch.match(/^[a-zA-Z]+\/(\d+)/) || branch.match(/pm-(\d+)/) || [])[1] || "";
}
export const issueNumFromUrl = (u) => (String(u || "").match(/(\d+)$/) || [])[1] || "";
export const repoFromIssueUrl = (u) => String(u || "").replace(/^https:\/\/github\.com\//, "").replace(/\/issues\/\d+$/, "");

// ---------------------------------------------------------------- markdown -> Notion blocks
const CODE_LANGS = new Set([
  "abap", "arduino", "bash", "basic", "c", "clojure", "coffeescript", "c++", "c#", "css", "dart", "diff", "docker", "elixir", "elm",
  "erlang", "flow", "fortran", "f#", "gherkin", "glsl", "go", "graphql", "groovy", "haskell", "html", "java", "javascript", "json",
  "julia", "kotlin", "latex", "less", "lisp", "livescript", "lua", "makefile", "markdown", "markup", "matlab", "mermaid", "nix",
  "objective-c", "ocaml", "pascal", "perl", "php", "plain text", "powershell", "prolog", "protobuf", "python", "r", "reason", "ruby",
  "rust", "sass", "scala", "scheme", "scss", "shell", "sql", "swift", "typescript", "vb.net", "verilog", "vhdl", "visual basic",
  "webassembly", "xml", "yaml", "java/c/c++/c#",
]);
const LANG_ALIAS = {
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript", tsx: "typescript", py: "python", sh: "shell",
  zsh: "shell", yml: "yaml", md: "markdown", cpp: "c++", cs: "c#", csharp: "c#", rs: "rust", rb: "ruby", ps1: "powershell", dockerfile: "docker",
  text: "plain text", txt: "plain text", plaintext: "plain text", "": "plain text", jsonc: "json", golang: "go", kt: "kotlin", objc: "objective-c",
};
const notionLang = (l) => {
  const k = String(l || "").toLowerCase();
  const m = LANG_ALIAS[k] || k;
  return CODE_LANGS.has(m) ? m : "plain text";
};

const rtext = (content) => (content === "" ? [] : textItems(content));
const mkBlock = (type, payload) => ({ object: "block", type, [type]: payload });

function parseTableRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

// 원본 bash md_to_blocks(heading/bullet/numbered/todo/paragraph, 빈 줄 제거)의 상위 호환:
// 코드 펜스, 표, 인용, 구분선, 들여쓴 목록(평탄화)을 추가로 처리한다. 인라인 서식(**굵게** 등)은 변환하지 않는다.
export function mdToBlocks(md) {
  const lines = String(md ?? "").split("\n").map((l) => l.replace(/\r$/, ""));
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0 || /^\s*$/.test(line)) continue;

    let m = line.match(/^\s*```\s*([^\s`]*)\s*$/);
    if (m) {
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) buf.push(lines[i++]);
      blocks.push(mkBlock("code", { rich_text: rtext(buf.join("\n")), language: notionLang(m[1]) }));
      continue;
    }

    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const rows = [parseTableRow(line)];
      i += 2; // 헤더 + 구분 행
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(parseTableRow(lines[i++]));
      i--;
      const width = Math.max(...rows.map((r) => r.length));
      blocks.push(
        mkBlock("table", {
          table_width: width,
          has_column_header: true,
          has_row_header: false,
          children: rows.map((r) => mkBlock("table_row", { cells: Array.from({ length: width }, (_, c) => rtext(r[c] ?? "")) })),
        }),
      );
      continue;
    }

    if ((m = line.match(/^#{3,6}\s+(.*)$/))) blocks.push(mkBlock("heading_3", { rich_text: rtext(m[1]) }));
    else if ((m = line.match(/^##\s+(.*)$/))) blocks.push(mkBlock("heading_2", { rich_text: rtext(m[1]) }));
    else if ((m = line.match(/^#\s+(.*)$/))) blocks.push(mkBlock("heading_1", { rich_text: rtext(m[1]) }));
    else if ((m = line.match(/^\s*[-*+]\s+\[([xX ])\]\s+(.*)$/)))
      blocks.push(mkBlock("to_do", { rich_text: rtext(m[2]), checked: m[1] !== " " }));
    else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) blocks.push(mkBlock("divider", {}));
    else if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) blocks.push(mkBlock("bulleted_list_item", { rich_text: rtext(m[1]) }));
    else if ((m = line.match(/^\s*[0-9]+\.\s+(.*)$/))) blocks.push(mkBlock("numbered_list_item", { rich_text: rtext(m[1]) }));
    else if ((m = line.match(/^>\s?(.*)$/))) blocks.push(mkBlock("quote", { rich_text: rtext(m[1]) }));
    else blocks.push(mkBlock("paragraph", { rich_text: rtext(line) }));
  }
  return blocks;
}

// Task 본문 블록 -> markdown (GitHub Issue 본문용)
export function blocksToMarkdown(blocks) {
  const out = [];
  for (const b of blocks) {
    const t = blockPlainText(b);
    switch (b.type) {
      case "heading_1": out.push("# " + t); break;
      case "heading_2": out.push("## " + t); break;
      case "heading_3": out.push("### " + t); break;
      case "paragraph": out.push(t); break;
      case "bulleted_list_item": out.push("- " + t); break;
      case "numbered_list_item": out.push("1. " + t); break;
      case "to_do": out.push(`- [${b.to_do?.checked ? "x" : " "}] ` + t); break;
      case "quote": out.push("> " + t); break;
      case "code": out.push("```" + (b.code?.language || "") + "\n" + t + "\n```"); break;
      default: break;
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}
