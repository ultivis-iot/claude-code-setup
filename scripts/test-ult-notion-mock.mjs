// 최소 Notion REST mock (테스트 전용). node:http 만 사용.
import http from "node:http";
import { randomUUID } from "node:crypto";

const E = (s) => s; // 이모지 속성 이름은 lib 의 P 와 동일하게 쓰기 위해 테스트에서 import 해서 사용
export const T = (t) => ({ type: "title", title: [{ type: "text", text: { content: t }, plain_text: t }] });
export const RT = (t) => ({ type: "rich_text", rich_text: t ? [{ type: "text", text: { content: t }, plain_text: t }] : [] });
export const SEL = (n) => ({ type: "select", select: n ? { name: n } : null });
export const STA = (n) => ({ type: "status", status: { name: n } });
export const URLP = (u) => ({ type: "url", url: u || null });
export const REL = (ids) => ({ type: "relation", relation: ids.map((id) => ({ id })) });
export const PEO = (users) => ({ type: "people", people: users.map((u) => ({ object: "user", id: u.id, name: u.name })) });
export const DATE = (start, end) => ({ type: "date", date: start ? { start, end: end || null } : null });
export const NUM = (n) => ({ type: "number", number: n });
export const FNUM = (n) => ({ type: "formula", formula: { type: "number", number: n } });
export const FDATE = (s) => ({ type: "formula", formula: { type: "date", date: s ? { start: s, end: null } : null } });

const plain = (rt) => (rt || []).map((x) => x.plain_text ?? x.text?.content ?? "").join("");

export function createMock() {
  const s = {
    pages: new Map(), ds: new Map(), blocks: new Map(), comments: [], log: [], faults: [], users: new Map(),
    expectedToken: null, templateDelayMs: 150, templateNever: false, created: 0,
  };
  const url = (id) => `https://www.notion.so/${id.replace(/-/g, "")}`;

  s.addPage = (dsId, properties, { id = randomUUID(), children = [] } = {}) => {
    const page = { object: "page", id, url: url(id), ds: dsId, created: ++s.created, properties };
    s.pages.set(id, page);
    s.blocks.set(id, children.map((c) => s.mkBlock(c)));
    return page;
  };
  s.mkBlock = (b) => {
    const id = randomUUID();
    const block = { object: "block", id, type: b.type, [b.type]: JSON.parse(JSON.stringify(b[b.type] ?? {})), has_children: false };
    const kids = block[b.type].children;
    if (Array.isArray(kids)) { delete block[b.type].children; s.blocks.set(id, kids.map((k) => s.mkBlock(k))); block.has_children = true; }
    for (const key of ["rich_text"]) if (block[b.type][key]) block[b.type][key] = block[b.type][key].map((x) => ({ ...x, plain_text: x.text?.content ?? "" }));
    return block;
  };

  const decorate = (page) => {
    const out = { ...page, properties: { ...page.properties } };
    delete out.ds; delete out.created;
    if (page.ds === "b89060b1-037c-480d-8671-f206aec117b6") {
      const u = page.properties["Issue URL"]?.url;
      out.properties["Issue Number"] = { type: "formula", formula: { type: "string", string: u ? (u.match(/(\d+)$/) || [])[1] : null } };
    }
    return out;
  };

  const conv = (v) => {
    if (v.title) return { type: "title", title: v.title.map((x) => ({ ...x, plain_text: x.text.content })) };
    if (v.rich_text) return { type: "rich_text", rich_text: v.rich_text.map((x) => ({ ...x, plain_text: x.text.content })) };
    if ("select" in v) return { type: "select", select: v.select };
    if ("status" in v) return { type: "status", status: v.status };
    if ("url" in v) return { type: "url", url: v.url };
    if ("relation" in v) return { type: "relation", relation: v.relation };
    if ("people" in v) return { type: "people", people: v.people.map((p) => ({ object: "user", id: p.id, name: s.users.get(p.id) || "?" })) };
    if ("date" in v) return { type: "date", date: v.date ? { start: v.date.start, end: v.date.end ?? null } : null };
    if ("number" in v) return { type: "number", number: v.number };
    return v;
  };

  const val = (page, prop) => {
    const p = page.properties[prop];
    if (!p) return "";
    if (p.title) return plain(p.title);
    if (p.date !== undefined) return p.date?.start || "";
    if (p.formula?.date) return p.formula.date.start;
    if (prop === "Created") return String(page.created).padStart(8, "0");
    return "";
  };
  const matches = (page, f) => {
    if (!f || !Object.keys(f).length) return true;
    if (f.and) return f.and.every((x) => matches(page, x));
    if (f.or) return f.or.some((x) => matches(page, x));
    const p = page.properties[f.property];
    if (f.people) return !!p?.people?.some((u) => u.id === f.people.contains);
    if (f.status) return p?.status?.name === f.status.equals;
    if (f.select) return p?.select?.name === f.select.equals;
    if (f.url) return f.url.is_empty ? !p?.url : p?.url === f.url.equals;
    if (f.title) return plain(p?.title).toLowerCase().includes(f.title.contains.toLowerCase());
    if (f.relation) return !!p?.relation?.some((r) => r.id === f.relation.contains);
    if (f.date) return !!p?.date?.start && p.date.start.slice(0, 10) <= f.date.on_or_before;
    throw new Error("mock: unsupported filter " + JSON.stringify(f));
  };

  const send = (res, code, obj, headers = {}) => {
    res.writeHead(code, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(obj));
  };
  const err = (res, code, c, message) => send(res, code, { object: "error", status: code, code: c, message });

  function checkRichText(rt) {
    for (const x of rt || []) if ((x.text?.content || "").length > 2000) return "rich_text content too long";
    return "";
  }

  s.server = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    let body = "";
    for await (const c of req) body += c;
    const json = body ? JSON.parse(body) : {};
    const path = u.pathname.replace(/^\/v1/, "");
    if (path.startsWith("/__")) {
      if (path === "/__faults") { s.faults.push(...Array.from({ length: json.count }, () => ({ status: json.status, retryAfter: json.retryAfter }))); return send(res, 200, {}); }
      return send(res, 404, {});
    }
    s.log.push({ method: req.method, path, auth: req.headers.authorization, version: req.headers["notion-version"], body: json });
    if (s.faults.length) {
      const f = s.faults.shift();
      return send(res, f.status, { object: "error", status: f.status, code: "fault", message: "injected" }, f.retryAfter !== undefined ? { "retry-after": String(f.retryAfter) } : {});
    }
    if (s.expectedToken && req.headers.authorization !== `Bearer ${s.expectedToken}`) return err(res, 401, "unauthorized", "API token is invalid.");
    if (req.headers["notion-version"] !== "2025-09-03") return err(res, 400, "validation_error", "bad version");

    let m;
    if ((m = path.match(/^\/data_sources\/([^/]+)\/query$/)) && req.method === "POST") {
      const dsId = s.ds.get(m[1]) || m[1];
      let rows = [...s.pages.values()].filter((p) => p.ds === dsId && matches(p, json.filter));
      for (const so of [...(json.sorts || [])].reverse()) {
        rows.sort((a, b) => (val(a, so.property) < val(b, so.property) ? -1 : val(a, so.property) > val(b, so.property) ? 1 : 0) * (so.direction === "descending" ? -1 : 1));
      }
      const size = Math.min(json.page_size || 100, 100);
      const off = Number(json.start_cursor || 0);
      const slice = rows.slice(off, off + size);
      const more = off + size < rows.length;
      return send(res, 200, { object: "list", results: slice.map(decorate), has_more: more, next_cursor: more ? String(off + size) : null });
    }
    if ((m = path.match(/^\/data_sources\/([^/]+)$/)) && req.method === "GET") {
      return send(res, 200, { object: "data_source", id: m[1], properties: { Topic: { select: { options: [{ name: "Feature" }, { name: "Fix" }] } } } });
    }
    if ((m = path.match(/^\/pages\/([^/]+)$/))) {
      const page = s.pages.get(m[1]);
      if (!page) return err(res, 404, "object_not_found", `Could not find page with ID: ${m[1]}.`);
      if (req.method === "GET") return send(res, 200, decorate(page));
      if (req.method === "PATCH") {
        for (const [k, v] of Object.entries(json.properties || {})) page.properties[k] = conv(v);
        return send(res, 200, decorate(page));
      }
    }
    if (path === "/pages" && req.method === "POST") {
      const dsId = json.parent?.data_source_id;
      if (!dsId) return err(res, 400, "validation_error", "parent.data_source_id required");
      const props = {};
      for (const [k, v] of Object.entries(json.properties || {})) props[k] = conv(v);
      const page = s.addPage(s.ds.get(dsId) || dsId, props);
      for (const c of json.children || []) s.blocks.get(page.id).push(s.mkBlock(c));
      if (json.template) {
        if (json.template.type !== "template_id" || !json.template.timezone) return err(res, 400, "validation_error", "bad template");
        const tpl = s.blocks.get(json.template.template_id);
        if (!tpl) return err(res, 400, "validation_error", "unknown template");
        if (!s.templateNever) setTimeout(() => { s.blocks.get(page.id).unshift(...tpl.map((b) => s.mkBlock(b))); }, s.templateDelayMs);
      }
      return send(res, 200, decorate(page));
    }
    if ((m = path.match(/^\/blocks\/([^/]+)\/children$/))) {
      const list = s.blocks.get(m[1]);
      if (!list) return err(res, 404, "object_not_found", `Could not find block with ID: ${m[1]}.`);
      if (req.method === "GET") {
        const size = Math.min(Number(u.searchParams.get("page_size") || 100), 100);
        const off = Number(u.searchParams.get("start_cursor") || 0);
        const more = off + size < list.length;
        return send(res, 200, { object: "list", results: list.slice(off, off + size), has_more: more, next_cursor: more ? String(off + size) : null });
      }
      if (req.method === "PATCH") {
        if (!Array.isArray(json.children) || json.children.length > 100) return err(res, 400, "validation_error", "children must be <= 100");
        for (const c of json.children) { const bad = checkRichText(c[c.type]?.rich_text); if (bad) return err(res, 400, "validation_error", bad); }
        const blocks = json.children.map((c) => s.mkBlock(c));
        let at = list.length;
        if (json.position?.type === "after_block") {
          const i = list.findIndex((b) => b.id === json.position.after_block.id);
          if (i < 0) return err(res, 400, "validation_error", "after_block not found");
          at = i + 1;
        }
        list.splice(at, 0, ...blocks);
        return send(res, 200, { object: "list", results: blocks, has_more: false });
      }
    }
    if ((m = path.match(/^\/blocks\/([^/]+)$/)) && req.method === "PATCH") {
      for (const list of s.blocks.values()) { const i = list.findIndex((b) => b.id === m[1]); if (i >= 0) { list.splice(i, 1); return send(res, 200, { id: m[1], archived: true }); } }
      return err(res, 404, "object_not_found", "block not found");
    }
    if (path === "/comments" && req.method === "POST") {
      const pid = json.parent?.page_id;
      if (!pid || !s.pages.has(pid)) return err(res, 404, "object_not_found", "page not found for comment");
      const bad = checkRichText(json.rich_text);
      if (bad || !json.rich_text?.length) return err(res, 400, "validation_error", bad || "rich_text required");
      const c = { object: "comment", id: randomUUID(), page_id: pid, text: plain(json.rich_text.map((x) => ({ plain_text: x.text.content }))) };
      s.comments.push(c);
      return send(res, 200, c);
    }
    return err(res, 404, "invalid_request_url", `mock: no route ${req.method} ${path}`);
  });

  s.start = () => new Promise((r) => s.server.listen(0, "127.0.0.1", () => { s.base = `http://127.0.0.1:${s.server.address().port}/v1`; r(s); }));
  s.stop = () => new Promise((r) => { s.server.closeAllConnections?.(); s.server.close(r); });
  return s;
}
