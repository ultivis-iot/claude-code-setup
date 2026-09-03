#!/usr/bin/env node

// ux-review 산출물 뷰어. 표준 라이브러리만 사용한다.
//
//   node viewer.mjs                 # 127.0.0.1:7830
//   node viewer.mjs --host 0.0.0.0  # LAN 공개
//   node viewer.mjs --ensure        # 이미 떠 있으면 주소만 출력하고 끝
//   node viewer.mjs --read-only     # 삭제 API 비활성

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const STORE = path.resolve(option('--store', process.env.UX_REVIEW_STORE
  || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'ux-review')));
const PORT = Number(option('--port', process.env.UX_REVIEW_PORT || 7830));
const HOST = option('--host', '0.0.0.0');
const READ_ONLY = flag('--read-only');
const SIGNATURE = 'ux-review-viewer';

const MIME = {
  '.webm': 'video/webm', '.mp4': 'video/mp4', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.mjs': 'text/plain; charset=utf-8', '.js': 'text/plain; charset=utf-8',
};

// ── 경로 안전 ────────────────────────────────────────────────────────
function resolveInStore(relative) {
  const resolved = path.resolve(STORE, relative);
  const rel = path.relative(STORE, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('저장 루트 밖 경로');
  return resolved;
}

// ── 인덱스 ───────────────────────────────────────────────────────────
async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
}

async function directorySize(target) {
  let total = 0;
  const stack = [target];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) { try { total += (await stat(full)).size; } catch {} }
    }
  }
  return total;
}

async function subdirectories(dir) {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch { return []; }
}

// SRT 큐를 읽어 영상 타임코드와 단계를 잇는다.
function parseSrtTime(text) {
  const m = /(\d\d):(\d\d):(\d\d)[,.](\d{1,3})/.exec(text);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

async function readSrt(file) {
  let text;
  try { text = await readFile(file, 'utf8'); } catch { return []; }
  const cues = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) continue;
    const timing = lines.find((l) => l.includes('-->'));
    if (!timing) continue;
    const [from, to] = timing.split('-->');
    cues.push({
      index: Number(lines[0]) || cues.length + 1,
      start: parseSrtTime(from),
      end: parseSrtTime(to),
      text: lines.slice(lines.indexOf(timing) + 1).join(' ').trim(),
    });
  }
  return cues;
}

// 목록: 가벼운 요약만. pass 상세와 용량은 계산하지 않는다.
async function buildIndex() {
  const repositories = [];
  for (const repositoryName of await subdirectories(STORE)) {
    const worktrees = [];
    for (const worktreeName of await subdirectories(path.join(STORE, repositoryName))) {
      const scenarios = [];
      const worktreeDirectory = path.join(STORE, repositoryName, worktreeName);
      for (const date of await subdirectories(worktreeDirectory)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        for (const scenarioDirectoryName of await subdirectories(path.join(worktreeDirectory, date))) {
          const absolute = path.join(worktreeDirectory, date, scenarioDirectoryName);
          let files = [];
          try { files = await readdir(absolute); } catch { continue; }

          const decision = await readJson(path.join(absolute,
            files.find((f) => f.endsWith('-review-decision.json')) || '\0'));
          const findings = { P0: 0, P1: 0, P2: 0 };
          for (const finding of decision?.findings ?? []) {
            if (findings[finding.severity] !== undefined) findings[finding.severity] += 1;
          }
          scenarios.push({
            path: path.relative(STORE, absolute),
            date,
            id: scenarioDirectoryName.replace(/^\d{2}\./, ''),
            readiness: decision?.readiness ?? null,
            findings,
            passCount: files.filter((f) => /^(review|guide)-\d\d$/.test(f)).length,
          });
        }
      }
      if (scenarios.length) worktrees.push({ name: worktreeName, scenarios });
    }
    if (worktrees.length) repositories.push({ name: repositoryName, worktrees });
  }
  return { store: STORE, generatedAt: new Date().toISOString(), repositories };
}

// 상세: 선택한 시나리오 하나만 읽는다.
async function buildScenario(relative) {
  const absolute = resolveInStore(relative);
  const files = await readdir(absolute);

  const decisionFile = files.find((f) => f.endsWith('-review-decision.json'));
  const scenarioFile = files.find((f) => f.endsWith('-scenario.json'));
  const decision = await readJson(path.join(absolute, decisionFile || '\0'));
  const scenario = await readJson(path.join(absolute, scenarioFile || '\0'));
  const origin = await readJson(path.join(absolute, 'origin.json'));

  const passes = [];
  for (const passName of files.filter((f) => /^(review|guide)-\d\d$/.test(f)).sort()) {
    const passDirectory = path.join(absolute, passName);
    let passFiles = [];
    try { passFiles = await readdir(passDirectory); } catch { continue; }
    // webm 하나가 여정 하나다. 같은 이름의 srt / execution.json 이 짝을 이룬다.
    const journeys = [];
    for (const video of passFiles.filter((f) => f.endsWith('.webm')).sort()) {
      const base = video.replace(/\.webm$/, '');
      const execution = await readJson(path.join(passDirectory, `${base}-execution.json`));
      const srtName = `${base}.srt`;
      journeys.push({
        base, video,
        srt: passFiles.includes(srtName) ? srtName : null,
        journeyId: execution?.journeyId ?? null,
        journeyKind: execution?.journeyKind ?? null,
        status: execution?.status ?? null,
        durationMs: execution?.durationMs ?? null,
        failure: execution?.failure ?? null,
        steps: execution?.steps ?? [],
        cues: passFiles.includes(srtName) ? await readSrt(path.join(passDirectory, srtName)) : [],
        screenshots: passFiles.filter((f) => f.startsWith(`${base}-`) && f.endsWith('.png')).sort(),
      });
    }
    const primary = journeys.find((j) => j.journeyKind === 'critical') ?? journeys[0] ?? null;

    passes.push({
      name: passName,
      kind: passName.startsWith('guide') ? 'guide' : 'review',
      status: primary?.status ?? null,
      durationMs: primary?.durationMs ?? null,
      failure: journeys.find((j) => j.failure)?.failure ?? null,
      journeys,
      screenshots: passFiles.filter((f) => f.endsWith('.png')).sort(),
      reviewDoc: passFiles.find((f) => f.endsWith('-ux-review.md')) ?? null,
      size: await directorySize(passDirectory),
      approved: decision?.reviewDirectory ? decision.reviewDirectory.endsWith(passName) : false,
    });
  }

  return {
    path: relative,
    id: scenario?.scenarioId ?? path.basename(absolute).replace(/^\d{2}\./, ''),
    date: path.basename(path.dirname(absolute)),
    readiness: decision?.readiness ?? null,
    findingList: decision?.findings ?? [],
    origin,
    scenarioFile: scenarioFile ?? null,
    journeyDefs: (scenario?.journeys ?? []).map((j) => ({
      id: j.id, kind: j.kind, steps: j.steps ?? [],
    })),
    hasPlan: files.includes('plan-snapshot.md'),
    hasBaseline: files.includes('consistency-baseline.md'),
    passes,
  };
}

// ── 최소 마크다운 렌더러 ─────────────────────────────────────────────
const escapeHtml = (text) => text.replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderInline(text, baseUrl) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, href) => {
    if (/^(https?:|mailto:|#)/.test(href)) {
      return `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`;
    }
    const target = baseUrl + '/' + href.replace(/^\.\//, '');
    if (/\.(webm|mp4)$/i.test(href)) return `<a href="#" data-video="${target}">${label}</a>`;
    if (/\.png$/i.test(href)) return `<a href="#" data-image="${target}">${label}</a>`;
    return `<a href="${target}" target="_blank" rel="noreferrer">${label}</a>`;
  });
  return html;
}

function renderMarkdown(source, baseUrl) {
  const lines = source.split(/\r?\n/);
  const out = [];
  let inCode = false, listType = null, inTable = false;
  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
  const closeTable = () => { if (inTable) { out.push('</tbody></table></div>'); inTable = false; } };

  for (const line of lines) {
    if (/^```/.test(line)) {
      closeList(); closeTable();
      out.push(inCode ? '</code></pre>' : '<pre><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) { out.push(escapeHtml(line)); continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList(); closeTable();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2], baseUrl)}</h${level}>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.trim().slice(1, -1).split('|').map((c) => c.trim());
      if (/^[\s|:-]+$/.test(line)) continue;
      if (!inTable) {
        closeList();
        out.push('<div class="tw"><table><thead><tr>' +
          cells.map((c) => `<th>${renderInline(c, baseUrl)}</th>`).join('') +
          '</tr></thead><tbody>');
        inTable = true;
      } else {
        out.push('<tr>' + cells.map((c) => `<td>${renderInline(c, baseUrl)}</td>`).join('') + '</tr>');
      }
      continue;
    }
    closeTable();
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+\.\s+(.*)$/);
    if (bullet || numbered) {
      const wanted = bullet ? 'ul' : 'ol';
      if (listType !== wanted) { closeList(); out.push(`<${wanted}>`); listType = wanted; }
      out.push(`<li>${renderInline((bullet || numbered)[1], baseUrl)}</li>`);
      continue;
    }
    closeList();
    if (!line.trim()) continue;
    if (/^---+$/.test(line.trim())) { out.push('<hr>'); continue; }
    out.push(`<p>${renderInline(line, baseUrl)}</p>`);
  }
  closeList(); closeTable();
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}

// ── 접근 가능한 주소 ─────────────────────────────────────────────────
async function reachableUrls() {
  const urls = [{ label: '로컬', url: `http://localhost:${PORT}` }];
  const hostname = os.hostname().toLowerCase();
  let mdns = false;
  try { await run('systemctl', ['is-active', '--quiet', 'avahi-daemon']); mdns = true; } catch {}
  if (mdns) urls.push({ label: '호스트명', url: `http://${hostname}.local:${PORT}` });

  if (HOST === '0.0.0.0' || HOST === '::') {
    for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
      if (/^(docker|br-|veth|virbr|tailscale)/.test(name)) continue;
      for (const address of addresses ?? []) {
        if (address.family !== 'IPv4' || address.internal) continue;
        urls.push({ label: 'LAN', url: `http://${address.address}:${PORT}`, note: name });
      }
    }
  }
  try {
    const { stdout } = await run('tailscale', ['status', '--json']);
    const dnsName = JSON.parse(stdout)?.Self?.DNSName?.replace(/\.$/, '');
    if (dnsName) urls.push({ label: 'Tailscale', url: `http://${dnsName}:${PORT}` });
  } catch {}
  return urls;
}

// ── 요청 처리 ────────────────────────────────────────────────────────
const json = (res, code, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store' });
  res.end(payload);
};

async function serveFile(req, res, absolute, { download = false } = {}) {
  let info;
  try { info = await stat(absolute); } catch { return json(res, 404, { error: '없는 파일' }); }
  if (!info.isFile()) return json(res, 404, { error: '파일이 아님' });

  const type = MIME[path.extname(absolute).toLowerCase()] || 'application/octet-stream';
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };
  if (download) {
    headers['content-disposition'] =
      `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(absolute))}`;
  }

  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (match) {
      let start = match[1] ? Number(match[1]) : null;
      let end = match[2] ? Number(match[2]) : null;
      if (start === null) { start = Math.max(0, info.size - (end ?? 0)); end = info.size - 1; }
      if (end === null || end >= info.size) end = info.size - 1;
      if (start > end || start >= info.size) {
        res.writeHead(416, { 'content-range': `bytes */${info.size}` });
        return res.end();
      }
      res.writeHead(206, { ...headers,
        'content-range': `bytes ${start}-${end}/${info.size}`,
        'content-length': end - start + 1 });
      return createReadStream(absolute, { start, end }).pipe(res);
    }
  }
  res.writeHead(200, { ...headers, 'content-length': info.size });
  createReadStream(absolute).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/api/health') {
      return json(res, 200, { signature: SIGNATURE, store: STORE, port: PORT, readOnly: READ_ONLY });
    }
    if (pathname === '/api/index') return json(res, 200, await buildIndex());

    if (pathname === '/api/scenario') {
      const target = url.searchParams.get('path');
      if (!target) return json(res, 400, { error: 'path 필요' });
      try { return json(res, 200, await buildScenario(target)); }
      catch { return json(res, 404, { error: '없는 시나리오' }); }
    }

    if (pathname === '/api/markdown') {
      const target = url.searchParams.get('path');
      if (!target) return json(res, 400, { error: 'path 필요' });
      const absolute = resolveInStore(target);
      let source;
      try { source = await readFile(absolute, 'utf8'); }
      catch { return json(res, 404, { error: '없는 문서' }); }
      const baseUrl = '/files/' + path.dirname(target).split(path.sep).map(encodeURIComponent).join('/');
      return json(res, 200, { html: renderMarkdown(source, baseUrl) });
    }

    if (pathname.startsWith('/files/')) {
      return serveFile(req, res, resolveInStore(pathname.slice('/files/'.length)));
    }
    if (pathname.startsWith('/download/')) {
      return serveFile(req, res, resolveInStore(pathname.slice('/download/'.length)), { download: true });
    }

    if (pathname === '/api/entry' && req.method === 'DELETE') {
      if (READ_ONLY) return json(res, 403, { error: '읽기 전용 모드' });
      const target = url.searchParams.get('path');
      if (!target) return json(res, 400, { error: 'path 필요' });
      const absolute = resolveInStore(target);
      if (absolute === STORE) return json(res, 400, { error: '저장 루트는 지울 수 없음' });
      let info;
      try { info = await stat(absolute); } catch { return json(res, 404, { error: '없는 경로' }); }
      if (!info.isDirectory()) return json(res, 400, { error: '디렉토리만 삭제 가능' });
      const freed = await directorySize(absolute);
      await rm(absolute, { recursive: true, force: true });
      return json(res, 200, { deleted: target, freed });
    }

    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(PAGE);
    }
    return json(res, 404, { error: '없는 경로' });
  } catch (error) {
    return json(res, 400, { error: String(error.message || error) });
  }
});

// ── --ensure: 이미 떠 있으면 주소만 출력 ─────────────────────────────
async function alreadyRunning() {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(1200) });
    const body = await response.json();
    return body?.signature === SIGNATURE;
  } catch { return false; }
}

async function printBanner() {
  const index = await buildIndex();
  const scenarioCount = index.repositories
    .flatMap((r) => r.worktrees).flatMap((w) => w.scenarios).length;
  console.log(`\nux-review viewer  ·  ${STORE}`);
  console.log(`포트 ${PORT} · 시나리오 ${scenarioCount}개${READ_ONLY ? ' · 읽기 전용' : ''}\n`);
  for (const entry of await reachableUrls()) {
    console.log(`  ${entry.label.padEnd(10)} ${entry.url}${entry.note ? `   (${entry.note})` : ''}`);
  }
  console.log('');
}

if (flag('--ensure')) {
  if (await alreadyRunning()) {
    await printBanner();
    process.exit(0);
  }
  const self = fileURLToPath(import.meta.url);
  const forwarded = argv.filter((a) => a !== '--ensure');
  const child = spawn(process.execPath, [self, ...forwarded], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (await alreadyRunning()) break;
  }
  await printBanner();
  process.exit(0);
}

server.listen(PORT, HOST, async () => { await printBanner(); });
server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE'
    ? `포트 ${PORT}가 이미 사용 중입니다. --port 로 다른 포트를 지정하세요.`
    : String(error.message || error));
  process.exit(1);
});

// ── 단일 페이지 ──────────────────────────────────────────────────────
const PAGE = String.raw`<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ux-review</title>
<style>
/* 색상 토큰은 @ultivis-iot/react (ultivis-react-library) 의 dark 테마 값을 그대로 옮겼다.
 * 라이브러리를 의존성으로 들이지 않고 스타일만 맞춘다. */
:root{
  --background:240 10% 3.9%; --foreground:0 0% 98%;
  --card:240 10% 3.9%; --card-foreground:0 0% 98%;
  --popover:240 10% 3.9%; --popover-foreground:0 0% 98%;
  --primary:0 0% 98%; --primary-foreground:240 5.9% 10%;
  --secondary:240 3.7% 15.9%; --secondary-foreground:0 0% 98%;
  --muted:240 3.7% 15.9%; --muted-foreground:240 5% 64.9%;
  --accent:240 3.7% 15.9%; --accent-foreground:0 0% 98%;
  --destructive:0 62.8% 30.6%; --destructive-foreground:0 0% 98%;
  --border:240 3.7% 15.9%; --input:240 3.7% 15.9%; --ring:240 4.9% 83.9%;
  --sidebar-background:240 5.9% 10%; --sidebar-foreground:240 4.8% 95.9%;
  --sidebar-primary:224.3 76.3% 48%; --sidebar-primary-foreground:0 0% 100%;
  --sidebar-accent:240 3.7% 15.9%; --sidebar-accent-foreground:240 4.8% 95.9%;
  --sidebar-border:240 3.7% 15.9%;
  --chart-1:220 70% 50%; --chart-2:160 60% 45%; --chart-3:30 80% 55%;
  --chart-4:280 65% 60%; --chart-5:340 75% 55%;
  --radius:0.5rem;
  --radius-sm:calc(var(--radius) - 4px); --radius-md:calc(var(--radius) - 2px); --radius-lg:var(--radius);
  --shadow-xs:0 1px 2px 0 rgb(0 0 0 / .05);
  --shadow-sm:0 1px 3px 0 rgb(0 0 0 / .1), 0 1px 2px -1px rgb(0 0 0 / .1);
  --app-font-family:'SUIT-Regular',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans KR',sans-serif;
  --p0:hsl(var(--chart-5)); --p1:hsl(var(--chart-3)); --p2:hsl(var(--chart-1)); --ok:hsl(var(--chart-2));
}
*{box-sizing:border-box}
body{margin:0;background:hsl(var(--background));color:hsl(var(--foreground));
  font:14px/1.6 var(--app-font-family)}
#app{display:grid;grid-template-columns:340px 1fr;height:100vh}
#side{display:flex;flex-direction:column;min-height:0;
  border-right:1px solid hsl(var(--sidebar-border));
  background:hsl(var(--sidebar-background));color:hsl(var(--sidebar-foreground))}
#tree{flex:1;min-height:0;overflow-y:auto}
#main{overflow-y:auto;padding:20px 24px;container-type:inline-size}
.sh{flex-shrink:0;padding:14px 16px;border-bottom:1px solid hsl(var(--sidebar-border))}
.sh b{font-size:13px;letter-spacing:.02em}
.sf{flex-shrink:0;padding:9px 16px;border-top:1px solid hsl(var(--sidebar-border));
  color:hsl(var(--muted-foreground));font-size:11.5px;line-height:1.5;word-break:break-all}
a{color:inherit;text-decoration:none}

/* 저장소 — 접이식 헤더 */
.repo{display:flex;align-items:center;gap:7px;padding:9px 14px;margin-top:6px;cursor:pointer;
  background:hsl(var(--sidebar-accent));border-top:1px solid hsl(var(--sidebar-border));
  border-bottom:1px solid hsl(var(--sidebar-border));user-select:none}
.repo:hover{background:hsl(var(--accent))}
.repo .caret{width:10px;font-size:10px;color:hsl(var(--muted-foreground));transition:transform .12s}
.repo.collapsed .caret{transform:rotate(-90deg)}
.repo .nm{font-size:12px;font-weight:600;letter-spacing:.03em;color:hsl(var(--sidebar-accent-foreground));
  flex:1;word-break:break-all}
.repo .ct{font-size:10.5px;color:hsl(var(--muted-foreground));background:hsl(var(--background));
  padding:1px 7px;border-radius:999px}

/* worktree — 저장소 안의 갈래 */
.wtbox{border-left:2px solid hsl(var(--sidebar-border));margin-left:14px}
.wt{display:flex;align-items:center;gap:6px;padding:7px 12px 5px;color:hsl(var(--muted-foreground));
  font-size:11.5px}
.wt::before{content:"⑂";font-size:11px;opacity:.75}
.wt .nm{word-break:break-all}

.sc{display:block;padding:8px 14px 8px 22px;border-left:2px solid transparent;margin-left:-2px}
.sc:hover{background:hsl(var(--accent))}
.sc.on{background:hsl(var(--accent));border-left-color:hsl(var(--sidebar-primary))}
.sc .t{font-size:13px;word-break:break-all}
.sc .s{color:hsl(var(--muted-foreground));font-size:11px;margin-top:2px;display:flex;gap:7px;flex-wrap:wrap;align-items:center}
.pill{display:inline-flex;align-items:center;padding:1px 8px;border-radius:999px;
  font-size:10.5px;font-weight:600;line-height:1.5}
.p0{background:hsl(var(--chart-5)/.18);color:var(--p0)}
.p1{background:hsl(var(--chart-3)/.18);color:var(--p1)}
.p2{background:hsl(var(--chart-1)/.2);color:var(--p2)}
.ready{background:hsl(var(--chart-2)/.16);color:var(--ok)}

h1{font-size:19px;margin:0;word-break:break-all}
.hd{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:8px;flex-wrap:wrap}
.hdact{display:flex;gap:8px;flex-shrink:0}
.badges{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.badge{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:500;
  line-height:1.4;padding:2px 10px;border-radius:var(--radius-md);
  color:hsl(var(--muted-foreground));background:hsl(var(--card));
  border:1px solid hsl(var(--border));transition:color .15s,background-color .15s,border-color .15s}
a.badge:hover{color:hsl(var(--foreground));background:hsl(var(--accent))}
.tabs{display:flex;gap:2px;border-bottom:1px solid hsl(var(--border));margin-bottom:16px;flex-wrap:wrap}
.tab{padding:8px 14px;color:hsl(var(--muted-foreground));border-bottom:2px solid transparent;font-size:13px}
.tab.on{color:hsl(var(--foreground));border-bottom-color:hsl(var(--sidebar-primary))}
.tab:hover{color:hsl(var(--foreground))}
.passes{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.pass{display:inline-flex;align-items:center;height:32px;padding:0 12px;
  border:1px solid hsl(var(--border));border-radius:var(--radius-md);font-size:12px;font-weight:500;
  background:hsl(var(--secondary));box-shadow:var(--shadow-xs);
  transition:background-color .15s,border-color .15s}
.pass:hover{background:hsl(var(--accent))}
.pass.on{border-color:hsl(var(--sidebar-primary));background:hsl(var(--sidebar-primary)/.16)}
.pass .k{color:hsl(var(--muted-foreground));font-size:10px;margin-left:5px}
.pass.approved::after{content:"✓";color:var(--ok);margin-left:5px}
.pass.failed{border-color:hsl(var(--destructive))}
video{width:100%;max-height:min(70vh,560px);background:#000;border-radius:var(--radius-lg);object-fit:contain;box-shadow:var(--shadow-sm)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.grid img{width:100%;border:1px solid hsl(var(--border));border-radius:var(--radius-md);
  cursor:zoom-in;background:#000}
.doc{max-width:900px}
/* 여정 선택 */
.jsel{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.jbtn{display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 12px;
  border:1px solid hsl(var(--border));border-radius:var(--radius-md);font-size:12px;font-weight:500;
  background:hsl(var(--secondary));box-shadow:var(--shadow-xs);
  transition:background-color .15s,border-color .15s}
.jbtn:hover{background:hsl(var(--accent))}
.jbtn.on{border-color:hsl(var(--sidebar-primary));background:hsl(var(--sidebar-primary)/.16)}
.jbtn .k{color:hsl(var(--muted-foreground));font-size:10.5px}
/* 영상 + 단계 좌우 배치 */
.vsplit{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(260px,1fr);gap:16px;align-items:start}
.vleft{position:sticky;top:0}
.vright{max-height:calc(100vh - 190px);overflow-y:auto;padding-right:4px}
.vstep{border:1px solid transparent;border-left:2px solid hsl(var(--border));
  padding:9px 11px;margin-bottom:6px;border-radius:var(--radius-md);background:hsl(var(--card))}
.vstep.seekable{cursor:pointer}
.vstep.seekable:hover{background:hsl(var(--accent));border-left-color:hsl(var(--muted-foreground))}
.vstep.now{border-left-color:hsl(var(--sidebar-primary));background:hsl(var(--sidebar-primary)/.12)}
.vstep-h{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.vn{flex-shrink:0;width:20px;height:20px;border-radius:999px;background:hsl(var(--secondary));
  color:hsl(var(--muted-foreground));font-size:10.5px;display:flex;align-items:center;justify-content:center}
.ts{margin-left:auto;font-size:11px;color:hsl(var(--chart-1));font-variant-numeric:tabular-nums}
.vright .goal{font-size:13px;font-weight:500;margin:2px 0 4px}
.vright .line{font-size:12px}
.vright .cap{font-size:11.5px}
/* 사이드바를 뺀 실제 본문 폭 기준으로 접는다 */
@container (max-width:700px){.vsplit{grid-template-columns:1fr}
.vleft{position:static}.vright{max-height:none}}
.scen{max-width:900px}
.scen-hd{margin-bottom:16px}
.scen-title{font-size:16px;font-weight:600;margin-bottom:8px}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{display:inline-flex;align-items:center;font-size:12px;font-weight:500;line-height:1.4;
  padding:2px 10px;border-radius:var(--radius-md);
  background:hsl(var(--secondary));color:hsl(var(--secondary-foreground));
  border:1px solid transparent}
.sec{margin-bottom:20px}
.sec-t{font-size:12px;font-weight:600;letter-spacing:.04em;color:hsl(var(--muted-foreground));
  text-transform:uppercase;margin-bottom:8px;display:flex;align-items:center;gap:8px}
.jk{font-size:10px;padding:1px 7px;border-radius:999px;text-transform:none;letter-spacing:0}
.jk.crit{background:hsl(var(--chart-5)/.18);color:var(--p0)}
.jk.rec{background:hsl(var(--chart-2)/.16);color:var(--ok)}
.kv{display:grid;grid-template-columns:74px 1fr;gap:6px 12px;font-size:13px}
.kv .k{color:hsl(var(--muted-foreground));font-size:12px}
.sec ul{margin:0;padding-left:20px;font-size:13px}
.sec ul li{margin:3px 0}
.sec ul.ck{list-style:none;padding-left:0}
.sec ul.ck li{position:relative;padding-left:20px}
.sec ul.ck li::before{content:"✓";position:absolute;left:2px;color:var(--ok)}
.step{display:flex;gap:12px;padding:10px 0;border-top:1px solid hsl(var(--border))}
.step-n{flex-shrink:0;width:24px;height:24px;border-radius:999px;background:hsl(var(--secondary));
  color:hsl(var(--muted-foreground));font-size:11px;display:flex;align-items:center;justify-content:center}
.step-b{flex:1;min-width:0}
.stage{font-size:10px;color:hsl(var(--muted-foreground));background:hsl(var(--muted));
  padding:1px 7px;border-radius:var(--radius-sm)}
.goal{font-size:13.5px;font-weight:500;margin:3px 0 5px}
.line{font-size:12.5px;color:hsl(var(--muted-foreground));margin:2px 0;display:flex;gap:8px}
.line .lb{flex-shrink:0;width:26px;font-size:11px;opacity:.8}
.cap{font-size:12px;color:hsl(var(--chart-1));margin-top:4px}
.raw{margin:0 0 18px;padding-bottom:12px;border-bottom:1px solid hsl(var(--border))}
.raw summary{cursor:pointer;font-size:12px;color:hsl(var(--muted-foreground));user-select:none}
.raw summary:hover{color:hsl(var(--foreground))}
.raw pre{background:hsl(var(--muted));padding:12px;border-radius:var(--radius-md);overflow-x:auto;
  font-size:12px;margin-top:10px}
.doc h1{font-size:20px;margin:22px 0 10px} .doc h2{font-size:17px;margin:20px 0 8px}
.doc h3{font-size:15px;margin:18px 0 6px;color:hsl(var(--muted-foreground))}
.doc code{background:hsl(var(--muted));padding:1px 5px;border-radius:var(--radius-sm);font-size:12.5px}
.doc pre{background:hsl(var(--muted));padding:12px;border-radius:var(--radius-md);overflow-x:auto}
.doc pre code{background:none;padding:0}
.doc a{color:hsl(var(--chart-1))} .doc hr{border:0;border-top:1px solid hsl(var(--border));margin:18px 0}
.doc li{margin:3px 0}
.tw{overflow-x:auto} .doc table{border-collapse:collapse;width:100%;font-size:13px}
.doc th,.doc td{border:1px solid hsl(var(--border));padding:6px 9px;text-align:left}
.doc th{background:hsl(var(--muted))}
.actions{display:flex;gap:8px;margin:16px 0;flex-wrap:wrap;align-items:center}
button{display:inline-flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap;
  height:32px;padding:0 12px;border-radius:var(--radius-md);font-size:12px;font-weight:500;
  font-family:inherit;cursor:pointer;
  background:hsl(var(--secondary));color:hsl(var(--secondary-foreground));
  border:1px solid hsl(var(--border));box-shadow:var(--shadow-xs);
  transition:color .15s,background-color .15s,box-shadow .15s,border-color .15s}
button:hover{background:hsl(var(--secondary)/.8)}
button:focus-visible{outline:none;border-color:hsl(var(--ring));box-shadow:0 0 0 3px hsl(var(--ring)/.5)}
button.danger:hover{background:hsl(var(--destructive)/.9);color:hsl(var(--destructive-foreground));
  border-color:hsl(var(--destructive))}
.dim{color:hsl(var(--muted-foreground))}
.empty{color:hsl(var(--muted-foreground));padding:40px 0;text-align:center}
.find{border:1px solid hsl(var(--border));border-radius:var(--radius-lg);padding:12px 14px;
  margin-bottom:8px;background:hsl(var(--card));box-shadow:var(--shadow-xs)}
.find .h{display:flex;gap:8px;align-items:center;margin-bottom:4px;flex-wrap:wrap}
.find .id{font-weight:600;font-size:13px}
.find .r{color:hsl(var(--muted-foreground));font-size:12.5px}
#lb{position:fixed;inset:0;background:hsl(var(--background)/.94);display:none;align-items:center;
  justify-content:center;z-index:9;padding:20px;cursor:zoom-out}
#lb img{max-width:100%;max-height:100%;border-radius:var(--radius-lg);box-shadow:var(--shadow-sm)}
@media(max-width:860px){#app{grid-template-columns:1fr;height:auto}
#side{max-height:52vh;border-right:0;border-bottom:1px solid hsl(var(--sidebar-border))}}
</style></head><body>
<div id="app">
  <div id="side"><div class="sh"><b>ux-review</b></div><div id="tree"></div><div class="sf" id="meta">불러오는 중…</div></div>
  <div id="main"><div class="empty">왼쪽에서 시나리오를 선택하세요</div></div>
</div>
<div id="lb" onclick="this.style.display='none'"><img id="lbi"></div>
<script>
// 라우팅:  #/<repo>/<worktree>/<date>/<scenario>[/<pass>[/<tab>]]
let INDEX=null, SC=null, CACHE={}, LOADING=false;
const TABS=[['video','영상'],['plan','Plan'],['review','리뷰 결과'],['scenario','시나리오'],['shots','스크린샷'],['findings','발견사항']];
const $=s=>document.querySelector(s);
const mb=b=>b==null?'':b>=1048576?(b/1048576).toFixed(1)+'MB':(b/1024).toFixed(0)+'KB';
const dur=ms=>ms==null?'':(ms/1000).toFixed(1)+'초';
const fmt=sec=>{const m=Math.floor(sec/60),x=sec-m*60;return m+':'+(x<10?'0':'')+x.toFixed(1);};
const enc=p=>p.split('/').map(encodeURIComponent).join('/');
const esc=t=>String(t==null?'':t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function parseRoute(){
  const raw=decodeURIComponent(location.hash.replace(/^#\/?/,''));
  if(!raw) return {};
  const seg=raw.split('/').filter(Boolean);
  if(seg.length<4) return {};
  return {path:seg.slice(0,4).join('/'), pass:seg[4]||null, tab:seg[5]||null, jn:seg[6]||null};
}
function go(path,pass,tab,jn){
  const parts=[path]; if(pass)parts.push(pass); if(pass&&tab)parts.push(tab);
  if(pass&&tab&&jn)parts.push(jn);
  const next='#/'+parts.join('/');
  if(location.hash===next) route(); else location.hash=next;
}

async function loadIndex(){
  const r=await fetch('/api/index'); INDEX=await r.json();
  const n=INDEX.repositories.flatMap(x=>x.worktrees).flatMap(w=>w.scenarios).length;
  $('#meta').textContent=INDEX.store.replace(/^\/home\/[^/]+/,'~')+' · 시나리오 '+n+'개';
  renderTree();
}
// 저장소 접기 상태는 이 브라우저에만 남는 편의값이다.
function collapsedSet(){
  try{ return new Set(JSON.parse(localStorage.getItem('ux-collapsed')||'[]')); }
  catch{ return new Set(); }
}
function saveCollapsed(set){
  try{ localStorage.setItem('ux-collapsed',JSON.stringify([...set])); }catch{}
}
function toggleRepo(name){
  const set=collapsedSet();
  if(set.has(name))set.delete(name); else set.add(name);
  saveCollapsed(set); renderTree();
}
function renderTree(){
  const cur=parseRoute().path, collapsed=collapsedSet();
  let h='';
  for(const repo of INDEX.repositories){
    const count=repo.worktrees.reduce((n,w)=>n+w.scenarios.length,0);
    const show=!collapsed.has(repo.name);
    h+='<div class="repo'+(show?'':' collapsed')+'" data-repo="'+esc(repo.name)+'">'
      +'<span class="caret">▼</span><span class="nm">'+esc(repo.name)+'</span>'
      +'<span class="ct">'+count+'</span></div>';
    if(!show)continue;
    for(const wt of repo.worktrees){
      let inner='';
      const byDate={};
      for(const s of wt.scenarios)(byDate[s.date]=byDate[s.date]||[]).push(s);
      for(const d of Object.keys(byDate).sort().reverse())for(const s of byDate[d]){
        const f=s.findings,pills=[];
        if(f.P0)pills.push('<span class="pill p0">P0 '+f.P0+'</span>');
        if(f.P1)pills.push('<span class="pill p1">P1 '+f.P1+'</span>');
        if(f.P2)pills.push('<span class="pill p2">P2 '+f.P2+'</span>');
        if(s.readiness==='ready'&&!pills.length)pills.push('<span class="pill ready">ready</span>');
        inner+='<a class="sc'+(cur===s.path?' on':'')+'" href="#/'+enc(s.path)+'">'
          +'<div class="t">'+esc(s.id)+'</div><div class="s"><span>'+s.date+'</span>'
          +'<span>'+s.passCount+' pass</span>'+pills.join('')+'</div></a>';
      }
      // worktree 이름이 저장소와 같으면(일반 저장소) 갈래 표시를 생략한다
      h+= wt.name===repo.name ? '<div class="wtbox">'+inner+'</div>'
        : '<div class="wtbox"><div class="wt"><span class="nm">'+esc(wt.name)+'</span></div>'+inner+'</div>';
    }
  }
  $('#tree').innerHTML=h;
}

async function route(){
  const r=parseRoute();
  renderTree();
  if(!r.path){
    SC=null;
    $('#main').innerHTML='<div class="empty">왼쪽에서 시나리오를 선택하세요</div>';
    return;
  }
  if(!SC||SC.path!==r.path){
    if(LOADING)return;
    LOADING=true;
    $('#main').innerHTML='<div class="empty">불러오는 중…</div>';
    try{
      if(!CACHE[r.path]){
        const res=await fetch('/api/scenario?path='+encodeURIComponent(r.path));
        if(!res.ok){$('#main').innerHTML='<div class="empty">시나리오를 찾을 수 없습니다</div>';LOADING=false;return;}
        CACHE[r.path]=await res.json();
      }
      SC=CACHE[r.path];
    } finally { LOADING=false; }
  }
  renderDetail(r);
}

function defaultPass(){
  if(!SC.passes.length)return null;
  return (SC.passes.slice().reverse().find(p=>p.approved)||SC.passes[SC.passes.length-1]).name;
}
function renderDetail(r){
  const passName=r.pass&&SC.passes.some(p=>p.name===r.pass)?r.pass:defaultPass();
  const tab=r.tab&&TABS.some(t=>t[0]===r.tab)?r.tab:'video';
  const pass=SC.passes.find(p=>p.name===passName)||null;
  const o=SC.origin||{},b=[];
  b.push('<span class="badge">'+esc(SC.path.split('/').slice(0,2).join(' / '))+'</span>');
  b.push('<span class="badge">'+esc(SC.date)+'</span>');
  if(o.branch)b.push('<span class="badge">🌿 '+esc(o.branch)+'</span>');
  if(o.issueUrl)b.push('<a class="badge" href="'+esc(o.issueUrl)+'" target="_blank" rel="noreferrer">🔗 Issue'+(o.issue?' #'+esc(o.issue):'')+'</a>');
  if(o.notionTaskUrl)b.push('<a class="badge" href="'+esc(o.notionTaskUrl)+'" target="_blank" rel="noreferrer">🔗 Notion Task</a>');
  if(o.notionStoryUrl)b.push('<a class="badge" href="'+esc(o.notionStoryUrl)+'" target="_blank" rel="noreferrer">🔗 Notion Story</a>');
  if(SC.readiness)b.push('<span class="badge">'+esc(SC.readiness)+'</span>');

  let h='<div class="hd"><h1>'+esc(SC.id)+'</h1><div class="hdact">'
    +(pass?'<button class="danger" data-del="'+SC.path+'/'+pass.name+'" data-label="'+esc(pass.name)+'">'+esc(pass.name)+' 삭제</button>':'')
    +'<button class="danger" data-del="'+SC.path+'" data-label="'+esc(SC.id)+' 전체">시나리오 삭제</button>'
    +'</div></div><div class="badges">'+b.join('')+'</div>';
  h+='<div class="passes">'+SC.passes.map(p=>'<a class="pass'+(p.name===passName?' on':'')
    +(p.approved?' approved':'')+(p.status&&p.status!=='completed'?' failed':'')
    +'" href="#/'+enc(SC.path)+'/'+p.name+'/'+tab+'">'+p.name
    +'<span class="k">'+mb(p.size)+(p.durationMs?' · '+dur(p.durationMs):'')+'</span></a>').join('')
    +(SC.passes.length?'':'<span class="dim">pass 없음</span>')+'</div>';
  h+='<div class="tabs">'+TABS.map(t=>'<a class="tab'+(tab===t[0]?' on':'')+'" href="#/'
    +enc(SC.path)+'/'+(passName||'-')+'/'+t[0]+'">'+t[1]+'</a>').join('')+'</div><div id="body"></div>';
  $('#main').innerHTML=h;
  renderBody(tab,pass);
}

function list(items,cls){
  if(!items||!items.length)return '';
  return '<ul class="'+(cls||'')+'">'+items.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>';
}
function section(title,body){
  return body ? '<div class="sec"><div class="sec-t">'+esc(title)+'</div>'+body+'</div>' : '';
}
function renderScenario(d){
  const a=d.audience||{}, job=d.job||{}, env=d.environment||{}, vp=env.viewport||{}, mp=d.mutationPolicy||{};
  let h='<div class="scen">';

  h+='<div class="scen-hd"><div class="scen-title">'+esc(d.title||d.id||'')+'</div><div class="chips">';
  if(d.product)h+='<span class="chip">'+esc(d.product)+'</span>';
  if(a.role)h+='<span class="chip">'+esc(a.role)+'</span>';
  if(a.experience)h+='<span class="chip">'+esc(a.experience)+'</span>';
  h+='</div></div>';

  if(job.trigger||job.outcome){
    h+='<div class="sec"><div class="kv">';
    if(job.trigger)h+='<div class="k">상황</div><div class="v">'+esc(job.trigger)+'</div>';
    if(job.outcome)h+='<div class="k">목표</div><div class="v">'+esc(job.outcome)+'</div>';
    h+='</div></div>';
  }

  h+=section('성공 기준',list(job.successCriteria,'ck'));

  const envRows=[];
  if(vp.width)envRows.push(['뷰포트',vp.width+' × '+vp.height]);
  if(env.locale)envRows.push(['로케일',env.locale]);
  if(mp.mode)envRows.push(['변경 정책',mp.mode]);
  if(env.baseUrlEnvironmentVariable)envRows.push(['base URL','$'+env.baseUrlEnvironmentVariable]);
  if(envRows.length){
    h+=section('환경','<div class="kv">'+envRows.map(r=>'<div class="k">'+esc(r[0])
      +'</div><div class="v"><code>'+esc(r[1])+'</code></div>').join('')+'</div>');
  }

  h+=section('전제 조건',list(d.prerequisites));
  h+=section('데이터 준비',list(d.dataSetup));
  h+=section('변경 허용',list(mp.allowed));
  h+=section('정리 절차',list(mp.cleanup));

  for(const jn of (d.journeys||[])){
    const steps=jn.steps||[];
    h+='<div class="sec"><div class="sec-t">여정 · '+esc(jn.id||'')
      +'<span class="jk '+(jn.kind==='critical'?'crit':'rec')+'">'+esc(jn.kind||'')+'</span>'
      +'<span class="dim" style="font-weight:400"> '+steps.length+'단계</span></div>';
    for(const st of steps){
      h+='<div class="step"><div class="step-n">'+esc(st.step)+'</div><div class="step-b">'
        +(st.stage?'<span class="stage">'+esc(st.stage)+'</span>':'')
        +'<div class="goal">'+esc(st.goal||'')+'</div>'
        +(st.startingState?'<div class="line"><span class="lb">시작</span>'+esc(st.startingState)+'</div>':'')
        +(st.action?'<div class="line"><span class="lb">행동</span>'+esc(st.action)+'</div>':'')
        +(st.expected?'<div class="line"><span class="lb">기대</span>'+esc(st.expected)+'</div>':'')
        +(st.caption?'<div class="cap">“'+esc(st.caption)+'”</div>':'')
        +'</div></div>';
    }
    h+='</div>';
  }

  h+=section('제외 범위',list(d.exclusions));
  return h+'</div>';
}

async function renderBody(tab,pass){
  const el=$('#body'); if(!el)return;
  const base=SC.path+(pass?'/'+pass.name:'');

  if(tab==='video'){
    if(!pass||!pass.journeys.length){el.innerHTML='<div class="empty">이 pass에 영상이 없습니다</div>';return;}
    const r=parseRoute();
    const jn=pass.journeys.find(x=>x.journeyId===r.jn)
      ||pass.journeys.find(x=>x.journeyKind==='critical')||pass.journeys[0];
    const base=SC.path+'/'+pass.name;
    const def=(SC.journeyDefs||[]).find(d=>d.id===jn.journeyId);

    // 여정 선택
    let h='<div class="jsel">'+pass.journeys.map(x=>'<a class="jbtn'+(x===jn?' on':'')
      +'" href="#/'+enc(SC.path)+'/'+pass.name+'/video/'+encodeURIComponent(x.journeyId||x.base)+'">'
      +esc(x.journeyId||x.base)
      +'<span class="jk '+(x.journeyKind==='critical'?'crit':'rec')+'">'+esc(x.journeyKind||'')+'</span>'
      +'<span class="k">'+(x.durationMs?dur(x.durationMs):'')+'</span></a>').join('')+'</div>';

    // 좌: 영상 / 우: 단계
    h+='<div class="vsplit"><div class="vleft">'
      +'<video id="vp" controls preload="metadata" src="/files/'+enc(base+'/'+jn.video)+'"'
      +(jn.srt?' crossorigin="anonymous"':'')+'></video>'
      +'<div class="actions"><a class="badge" href="/download/'+enc(base+'/'+jn.video)+'">다운로드</a>'
      +(jn.srt?'<a class="badge" href="/files/'+enc(base+'/'+jn.srt)+'" target="_blank">자막(srt)</a>':'')
      +'<span class="dim" style="font-size:12px">'+esc(jn.video)+'</span></div>'
      +(jn.failure?'<div class="find"><div class="h"><span class="pill p0">실패</span></div><div class="r">'+esc(jn.failure)+'</div></div>':'')
      +'</div><div class="vright">';

    const rows=jn.steps.length?jn.steps:jn.cues.map((c,i)=>({step:i+1,sequence:i+1}));
    if(!rows.length){
      h+='<div class="dim" style="font-size:12.5px">단계 정보가 없습니다</div>';
    } else {
      h+=rows.map((st,i)=>{
        const spec=(def&&def.steps||[]).find(x=>x.step===st.step)||{};
        const cue=jn.cues[i];
        const t=cue&&cue.start!=null?cue.start:null;
        return '<div class="vstep'+(t!=null?' seekable':'')+'"'+(t!=null?' data-seek="'+t+'"':'')+'>'
          +'<div class="vstep-h"><span class="vn">'+esc(st.step??i+1)+'</span>'
          +(spec.stage?'<span class="stage">'+esc(spec.stage)+'</span>':'')
          +(t!=null?'<span class="ts">'+fmt(t)+'</span>':'')+'</div>'
          +(spec.goal?'<div class="goal">'+esc(spec.goal)+'</div>':'')
          +(spec.action?'<div class="line"><span class="lb">행동</span>'+esc(spec.action)+'</div>':'')
          +(spec.expected?'<div class="line"><span class="lb">기대</span>'+esc(spec.expected)+'</div>':'')
          +(cue&&cue.text?'<div class="cap">“'+esc(cue.text)+'”</div>':'')
          +'</div>';
      }).join('');
    }
    h+='</div></div>';
    el.innerHTML=h;

    // 단계 클릭 → 해당 시점으로 이동
    const video=el.querySelector('#vp');
    el.querySelectorAll('[data-seek]').forEach(node=>node.onclick=()=>{
      if(!video)return;
      video.currentTime=Number(node.dataset.seek);
      video.play().catch(()=>{});
      el.querySelectorAll('.vstep').forEach(n=>n.classList.remove('now'));
      node.classList.add('now');
    });
    // 재생 위치에 맞춰 현재 단계를 표시
    if(video&&jn.cues.length){
      video.ontimeupdate=()=>{
        let idx=-1;
        for(let i=0;i<jn.cues.length;i++){ if(video.currentTime>=(jn.cues[i].start??0)) idx=i; }
        const nodes=el.querySelectorAll('.vstep');
        nodes.forEach((n,i)=>n.classList.toggle('now',i===idx));
      };
    }
    return;
  }
  if(tab==='shots'){
    if(!pass||!pass.screenshots.length){el.innerHTML='<div class="empty">스크린샷이 없습니다</div>';return;}
    el.innerHTML='<div class="dim" style="margin-bottom:10px">'+pass.screenshots.length+'장</div><div class="grid">'
      +pass.screenshots.map(f=>'<figure style="margin:0"><img loading="lazy" src="/files/'+enc(base+'/'+f)
      +'" data-image="/files/'+enc(base+'/'+f)+'"><figcaption class="dim" style="font-size:11px;margin-top:4px;word-break:break-all">'
      +esc(f.replace(/^.*?-(\d\d-)/,'$1'))+'</figcaption></figure>').join('')+'</div>';
    return;
  }
  if(tab==='findings'){
    if(!SC.findingList.length){el.innerHTML='<div class="empty">기록된 발견사항이 없습니다</div>';return;}
    el.innerHTML=SC.findingList.map(f=>'<div class="find"><div class="h"><span class="id">'+esc(f.id)+'</span>'
      +'<span class="pill '+esc((f.severity||'').toLowerCase())+'">'+esc(f.severity)+'</span>'
      +'<span class="dim">'+esc(f.disposition||'')+'</span></div><div class="r">'+esc(f.rationale||'')+'</div></div>').join('');
    return;
  }

  let target=null;
  if(tab==='plan')     target=SC.hasPlan?SC.path+'/plan-snapshot.md':null;
  if(tab==='review')   target=pass&&pass.reviewDoc?base+'/'+pass.reviewDoc:null;
  if(tab==='scenario') target=SC.scenarioFile?SC.path+'/'+SC.scenarioFile:null;
  if(!target){
    el.innerHTML='<div class="empty">'+(tab==='plan'
      ?'Plan 스냅샷이 없습니다 · 저장 시점에 캡처된 시나리오에만 표시됩니다'
      :'문서가 없습니다')+'</div>';
    return;
  }
  if(target.endsWith('.json')){
    const j=await (await fetch('/files/'+enc(target))).json();
    const raw='<details class="raw"><summary>원본 JSON</summary><pre><code>'
      +esc(JSON.stringify(j,null,2))+'</code></pre></details>';
    el.innerHTML=tab==='scenario' ? raw+renderScenario(j) : raw;
    return;
  }
  const j=await (await fetch('/api/markdown?path='+encodeURIComponent(target))).json();
  el.innerHTML='<div class="doc">'+(j.html||'<div class="empty">문서를 읽지 못했습니다</div>')+'</div>';
}

async function del(p,label){
  if(!confirm(label+' 을(를) 삭제합니다. 되돌릴 수 없습니다.\n\n'+p))return;
  const j=await (await fetch('/api/entry?path='+encodeURIComponent(p),{method:'DELETE'})).json();
  if(j.error){alert('삭제 실패: '+j.error);return;}
  alert('삭제됨 · '+mb(j.freed)+' 확보');
  delete CACHE[SC.path];
  if(p===SC.path){SC=null;location.hash='#/';}
  else{SC=null;}
  await loadIndex(); route();
}

document.addEventListener('click',e=>{
  const d=e.target.closest('[data-del]');
  if(d){e.preventDefault();del(d.dataset.del,d.dataset.label);return;}
  const repo=e.target.closest('.repo');
  if(repo){e.preventDefault();toggleRepo(repo.dataset.repo);return;}
  const img=e.target.closest('[data-image]');
  if(img){e.preventDefault();$('#lbi').src=img.dataset.image;$('#lb').style.display='flex';return;}
  const v=e.target.closest('[data-video]');
  if(v){e.preventDefault();const r=parseRoute();go(r.path,r.pass||defaultPass(),'video');}
});
window.addEventListener('hashchange',route);
(async()=>{ await loadIndex();
  if(!parseRoute().path){
    const all=INDEX.repositories.flatMap(x=>x.worktrees).flatMap(w=>w.scenarios)
      .filter(s=>s.passCount>0)
      .sort((a,b)=>b.date.localeCompare(a.date));
    if(all.length){location.hash='#/'+enc(all[0].path);return;}
  }
  route();
})();
// 자동 갱신 없음. 목록을 다시 읽으려면 브라우저 새로고침(F5).
</script></body></html>`;
