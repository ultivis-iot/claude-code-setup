#!/usr/bin/env node

// ux-review 산출물 뷰어. 표준 라이브러리만 사용한다.
//
//   node viewer.mjs                   # 0.0.0.0:7830 — 기본이 LAN 공개다
//   node viewer.mjs --host 127.0.0.1  # 이 기기에서만
//   node viewer.mjs --ensure          # 이미 떠 있으면 주소만 출력하고 끝
//   node viewer.mjs --restart         # 떠 있으면 끄고 다시 띄운다 (서버 코드 수정 반영)
//   node viewer.mjs --read-only       # 삭제 API 비활성
//
// 기본이 0.0.0.0 인 것은 휴대폰에서 열어 보기 위해서다(PWA·모바일 레이아웃).
// 인증이 없으므로 같은 망의 누구나 DELETE /api/entry·/api/passes 로 산출물을 지울 수 있다.
// 믿을 수 없는 망에서는 --host 127.0.0.1 이나 --read-only 를 쓴다.

import { createServer } from 'node:http';
import { createReadStream, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
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
// --restart 가 끌 대상을 정확히 집기 위한 PID 파일. 포트마다 따로 둔다.
const PID_FILE = path.join(os.tmpdir(), `ux-review-viewer-${PORT}.pid`);

const MIME = {
  '.webm': 'video/webm', '.mp4': 'video/mp4', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.mjs': 'text/plain; charset=utf-8', '.js': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ico': 'image/x-icon',
};

// ── 경로 안전 ────────────────────────────────────────────────────────
function resolveInStore(relative) {
  const resolved = path.resolve(STORE, relative);
  const rel = path.relative(STORE, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('저장 루트 밖 경로');
  return resolved;
}

// 공통 UI 킷(assets/ui)은 저장소가 아니라 스킬 폴더에 있으므로 따로 연다.
const ASSETS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const UI_DIR = path.join(ASSETS_DIR, 'ui');
const ICONS_DIR = path.join(ASSETS_DIR, 'icons');
// 페이지는 상수가 아니라 파일이다. 고친 뒤 새로고침만 하면 되고 재기동이 필요 없다.
const PAGE_FILE = path.join(ASSETS_DIR, 'viewer-page.html');
function resolveInUi(relative) {
  const resolved = path.resolve(UI_DIR, relative);
  const rel = path.relative(UI_DIR, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('UI 폴더 밖 경로');
  return resolved;
}
function resolveInIcons(relative) {
  const resolved = path.resolve(ICONS_DIR, relative);
  const rel = path.relative(ICONS_DIR, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('아이콘 폴더 밖 경로');
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
          // 마지막으로 손댄 시각. 날짜 폴더 이름만으로는 같은 날 안에서 순서를 가릴 수 없고,
          // 사흘 전 시나리오에 오늘 pass 를 하나 더 얹은 경우도 잡지 못한다. 항목의 mtime 중
          // 가장 나중 것을 쓴다 — pass 디렉토리의 mtime 은 그 안의 마지막 파일이 쓰인 시각이다.
          let activeAt = 0;
          for (const name of files) {
            try {
              const info = await stat(path.join(absolute, name));
              if (info.mtimeMs > activeAt) activeAt = info.mtimeMs;
            } catch {}
          }
          scenarios.push({
            path: path.relative(STORE, absolute),
            date,
            activeAt: activeAt || null,
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
    const recording = [];
    for (const video of passFiles.filter((f) => f.endsWith('.webm')).sort()) {
      // 녹화가 끝나기 전 파일은 크기가 0이다. 재생하면 416 이 되므로 목록에서 빼둔다.
      try {
        if ((await stat(path.join(passDirectory, video))).size === 0) { recording.push(video); continue; }
      } catch { continue; }
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
      journeys, recording,
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

    if (pathname === '/manifest.webmanifest') {
      return serveFile(req, res, path.join(ASSETS_DIR, 'manifest.webmanifest'));
    }
    if (pathname === '/sw.js') {
      // 스코프는 내려준 경로가 정한다. 루트여야 앱 전체를 덮는다.
      // MIME 표의 .js 는 산출물을 소스로 보여주려고 text/plain 이라 여기서 직접 지정한다.
      // 서비스 워커는 자바스크립트 MIME 이 아니면 등록이 거부된다.
      let code;
      try { code = await readFile(path.join(ASSETS_DIR, 'sw.js'), 'utf8'); }
      catch { return json(res, 404, { error: '없는 파일' }); }
      res.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-cache',
        'service-worker-allowed': '/',
      });
      return res.end(code);
    }
    if (pathname.startsWith('/icons/')) {
      return serveFile(req, res, resolveInIcons(pathname.slice('/icons/'.length)));
    }
    if (pathname.startsWith('/ui/')) {
      return serveFile(req, res, resolveInUi(pathname.slice('/ui/'.length)));
    }
    if (pathname.startsWith('/files/')) {
      return serveFile(req, res, resolveInStore(pathname.slice('/files/'.length)));
    }
    if (pathname.startsWith('/download/')) {
      return serveFile(req, res, resolveInStore(pathname.slice('/download/'.length)), { download: true });
    }

    // 시나리오의 pass 중 keep 에 없는 것만 지운다. 남길 대상을 호출자가 명시한다.
    if (pathname === '/api/passes' && req.method === 'DELETE') {
      if (READ_ONLY) return json(res, 403, { error: '읽기 전용 모드' });
      const target = url.searchParams.get('path');
      const keep = new Set((url.searchParams.get('keep') || '').split(',').map((s) => s.trim()).filter(Boolean));
      if (!target) return json(res, 400, { error: 'path 필요' });
      if (!keep.size) return json(res, 400, { error: '남길 pass 를 지정해야 합니다' });
      const absolute = resolveInStore(target);
      let entries;
      try { entries = await readdir(absolute, { withFileTypes: true }); }
      catch { return json(res, 404, { error: '없는 시나리오' }); }

      const removed = [];
      let freed = 0;
      for (const entry of entries) {
        if (!entry.isDirectory() || !/^(review|guide)-\d\d$/.test(entry.name)) continue;
        if (keep.has(entry.name)) continue;
        const passDirectory = path.join(absolute, entry.name);
        freed += await directorySize(passDirectory);
        await rm(passDirectory, { recursive: true, force: true });
        removed.push(entry.name);
      }
      return json(res, 200, { removed, kept: [...keep], freed });
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
      let page;
      try { page = await readFile(PAGE_FILE, 'utf8'); }
      catch { return json(res, 500, { error: '페이지 파일을 읽지 못했습니다: ' + PAGE_FILE }); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(page);
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

// 자기 PID 를 남기고, 어떻게 끝나든 자기 것일 때만 지운다.
function claimPidFile() {
  try { writeFileSync(PID_FILE, String(process.pid)); } catch { /* 못 남겨도 서빙은 계속한다 */ }
  const release = () => {
    try {
      if (readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) unlinkSync(PID_FILE);
    } catch { /* 이미 없거나 남의 것 */ }
  };
  process.on('exit', release);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => { release(); process.exit(0); });
  }
}

// 페이지는 프로세스 메모리에 상주하므로 파일을 고쳐도 재기동해야 반영된다.
// PID 파일로 특정한 프로세스만 끈다. 패턴으로 찾으면 다른 포트의 뷰어까지 죽는다.
async function stopRunning() {
  if (!(await alreadyRunning())) return true;
  let pid = 0;
  try { pid = Number(readFileSync(PID_FILE, 'utf8').trim()); } catch { /* 아래에서 처리 */ }
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 'SIGTERM'); } catch { return false; }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (!(await alreadyRunning())) return true;
  }
  return false;
}

if (flag('--ensure') || flag('--restart')) {
  if (flag('--restart') && !(await stopRunning())) {
    console.error(`포트 ${PORT} 의 뷰어를 멈추지 못했습니다.`);
    console.error(`PID 파일(${PID_FILE})이 없는 예전 인스턴스일 수 있습니다. 직접 종료한 뒤 다시 실행하세요.`);
    process.exit(1);
  }
  if (await alreadyRunning()) {
    await printBanner();
    process.exit(0);
  }
  const self = fileURLToPath(import.meta.url);
  const forwarded = argv.filter((a) => a !== '--ensure' && a !== '--restart');
  const child = spawn(process.execPath, [self, ...forwarded], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (await alreadyRunning()) break;
  }
  await printBanner();
  process.exit(0);
}

server.listen(PORT, HOST, async () => { claimPidFile(); await printBanner(); });
server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE'
    ? `포트 ${PORT}가 이미 사용 중입니다. --port 로 다른 포트를 지정하세요.`
    : String(error.message || error));
  process.exit(1);
});

