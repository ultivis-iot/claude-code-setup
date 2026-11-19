#!/usr/bin/env node
// Install or update the managed section of ~/.claude/CLAUDE.md without losing local edits.
// The section runs from MARKER to end of file. On --update, the installed section, the
// template it was installed from (base) and the new template are 3-way merged with
// `git merge-file`, so lines a person added or changed inside the section survive.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// setup.sh and setup.ps1 repeat this marker in their no-Node fallback; keep them in sync.
const MARKER = '# === Claude Code 개발 플로우 설정 ===';
const usage = 'Usage: install-claude-md.mjs <CLAUDE.md> <template> --state <dir> [--repo <dir>] [--update [--resolved]]';

const argv = process.argv.slice(2);
const option = name => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; };
const [target, templatePath] = argv;
const stateDir = option('--state');
const repo = option('--repo');
const update = argv.includes('--update');
const resolved = argv.includes('--resolved');
if (!target || !templatePath || target.startsWith('--') || !stateDir) throw new Error(usage);

const basePath = path.join(stateDir, 'claude-md-base.md');
const template = readFileSync(templatePath, 'utf8');
const say = message => console.log(`   ${message}`);
const lf = text => text.replace(/\r\n/g, '\n');

const conflictPath = path.join(stateDir, 'CLAUDE.md.conflict');
// On a conflict, the template the person must resolve against. The installer never guesses
// whether the section was resolved: the person says so with --update --resolved, and that run
// uses this template as base, so the resolution (personal lines included) is kept as it is.
const pendingPath = path.join(stateDir, 'claude-md-pending.json');

// Record the template now in effect; a leftover conflict copy from an earlier run is stale.
function saveBase() {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(basePath, template);
  rmSync(conflictPath, { force: true });
  rmSync(pendingPath, { force: true });
}

const sha256 = text => createHash('sha256').update(text).digest('hex');
const PENDING_VERSION = 1;

// A record is valid only in the shape this version writes and with a base matching its hash;
// anything else (empty, edited, older shape) is treated as no record at all.
function readPending() {
  try {
    const pending = JSON.parse(readFileSync(pendingPath, 'utf8'));
    const ok = pending && pending.version === PENDING_VERSION && typeof pending.base === 'string'
      && pending.base.trim() && pending.sha256 === sha256(pending.base);
    return ok ? pending : undefined;
  } catch { return undefined; }
}

function backup(content) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(stateDir, 'backups', `CLAUDE.md.${stamp}`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

// Line-level edit distance, used to pick the historical template closest to the installed section.
function distance(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  let previous = new Array(y.length + 1).fill(0);
  for (const line of x) {
    const current = [0];
    for (let j = 0; j < y.length; j++) current.push(line === y[j] ? previous[j] + 1 : Math.max(previous[j + 1], current[j]));
    previous = current;
  }
  return x.length + y.length - 2 * previous[y.length];
}

// Installs made before the base file existed: recover the base from the template's git history.
function inferBase(section) {
  if (!repo) return undefined;
  // A shallow clone lacks the older templates, so the closest match would wrongly be the current one.
  const shallow = spawnSync('git', ['-C', repo, 'rev-parse', '--is-shallow-repository'], { encoding: 'utf8' });
  if (shallow.status !== 0 || shallow.stdout.trim() !== 'false') return undefined;
  const log = spawnSync('git', ['-C', repo, 'log', '--format=%H', '--', 'templates/global-claude.md'], { encoding: 'utf8' });
  if (log.status !== 0) return undefined;
  const candidates = [template];
  for (const sha of log.stdout.split('\n').filter(Boolean)) {
    const show = spawnSync('git', ['-C', repo, 'show', `${sha}:templates/global-claude.md`], { encoding: 'utf8' });
    if (show.status === 0) candidates.push(show.stdout);
  }
  return candidates.reduce((best, candidate) => distance(candidate, section) < distance(best, section) ? candidate : best);
}

function merge(ours, base, theirs) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'claude-md-merge-'));
  try {
    const files = { ours, base, theirs };
    for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), content);
    const labels = ['현재 CLAUDE.md', '이전 템플릿', '새 템플릿'];
    const result = spawnSync('git', ['merge-file', '-p', '--diff3', `--marker-size=${MARKER_SIZE}`, ...labels.flatMap(label => ['-L', label]),
      path.join(dir, 'ours'), path.join(dir, 'base'), path.join(dir, 'theirs')], { encoding: 'utf8' });
    // merge-file exits with the conflict count (0-127); negative or null (killed by a signal) is a failure.
    if (result.error || typeof result.status !== 'number' || result.status < 0 || result.status > 127) {
      return { error: result.error?.message || result.stderr.trim() || `git merge-file exit ${result.status ?? result.signal}` };
    }
    return resolveAdditions(result.stdout, labels);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Both sides adding lines at the same spot (e.g. a personal section and a template line
// appended at the end) is not a real conflict: keep the template lines, then the local ones.
// Long markers so a Markdown line such as a setext '=======' is never read as a separator.
const MARKER_SIZE = 32;
const [OPEN, BASE, SPLIT, CLOSE] = ['<', '|', '=', '>'].map(c => c.repeat(MARKER_SIZE));

function resolveAdditions(text, [ours, base, theirs]) {
  const out = [];
  let conflicts = 0;
  let hunk;
  for (const line of text.split(/(?<=\n)/)) {
    const bare = line.replace(/\r?\n$/, '');
    if (!hunk && bare === `${OPEN} ${ours}`) hunk = { part: 'ours', ours: [], base: [], theirs: [] };
    else if (hunk && hunk.part === 'ours' && bare === `${BASE} ${base}`) hunk.part = 'base';
    else if (hunk && hunk.part === 'base' && bare === SPLIT) hunk.part = 'theirs';
    else if (hunk && hunk.part === 'theirs' && bare === `${CLOSE} ${theirs}`) {
      if (hunk.base.every(l => !l.trim())) out.push(...hunk.base, ...hunk.theirs, ...hunk.ours);
      else {
        conflicts++;
        out.push(`${OPEN} ${ours}\n`, ...hunk.ours, `${BASE} ${base}\n`, ...hunk.base, `${SPLIT}\n`, ...hunk.theirs, `${CLOSE} ${theirs}\n`);
      }
      hunk = undefined;
    } else if (hunk) hunk[hunk.part].push(line);
    else out.push(line);
  }
  // An unterminated hunk means a section line looked like a conflict marker; refuse rather than drop lines.
  if (hunk) return { error: '충돌 표시처럼 보이는 줄 때문에 병합 결과를 해석하지 못함' };
  return { merged: out.join(''), conflicts };
}

function updateSection(content, index) {
  const markerEnd = index + MARKER.length;
  const eol = content.slice(markerEnd).match(/^\r?\n/)?.[0] ?? '';
  const crlf = eol === '\r\n';
  const head = content.slice(0, markerEnd) + (eol || '\n');
  const section = lf(content.slice(markerEnd + eol.length));
  const write = text => writeFileSync(target, head + (crlf ? text.replace(/\n/g, '\r\n') : text));
  const theirs = lf(template);

  // A conflict reported earlier stays open until the person says it is settled with --resolved,
  // even when the section now equals the template or is empty: no path accepts it silently.
  if (!resolved && existsSync(pendingPath)) {
    say('⚠ 이전 --update가 알린 CLAUDE.md 충돌이 아직 열려 있어 그대로 둠');
    say(`  충돌본: ${conflictPath}`);
    return say(`  정리해서 ${target}에 반영했으면 --update --resolved로 다시 실행하세요`);
  }
  if (section === theirs) {
    saveBase();
    return say('✓ CLAUDE.md 이미 최신');
  }
  if (!section.trim()) {
    const saved = backup(content);
    write(theirs);
    saveBase();
    return say(`✓ 비어 있던 설정 구역을 새 템플릿으로 채움 (백업: ${saved})`);
  }
  // --resolved: the person says the conflict reported last time is settled in the section.
  // Refuse while markers remain; otherwise merge from the template they resolved against.
  const pending = resolved ? readPending() : undefined;
  if (resolved && !pending) say('⚠ --resolved: 정리할 충돌 기록이 없어 평소처럼 병합함');
  if (pending && section.split('\n').some(line => [OPEN, BASE, SPLIT, CLOSE].some(marker => line.startsWith(marker)))) {
    return say('⚠ CLAUDE.md에 충돌 표시가 남아 있어 그대로 둠. 표시를 지우고 다시 --update --resolved를 실행하세요');
  }
  const base = pending ? pending.base : existsSync(basePath) ? readFileSync(basePath, 'utf8') : inferBase(section);
  if (base === undefined) return say('⚠ 이전 템플릿을 찾지 못해 CLAUDE.md 업데이트를 건너뜀 (전체 이력이 있는 git clone에서 setup을 실행하세요)');

  const { merged, conflicts, error } = merge(section, lf(base), theirs);
  if (error) return say(`⚠ CLAUDE.md 병합 실패, 파일은 그대로 둠: ${error}`);
  if (conflicts) {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(conflictPath, head + merged);
    writeFileSync(pendingPath, JSON.stringify({ version: PENDING_VERSION, base: theirs, sha256: sha256(theirs) }));
    say(`⚠ 직접 고친 줄과 템플릿 변경이 충돌(${conflicts}곳)해 CLAUDE.md는 그대로 둠`);
    say(`  충돌 표시가 든 병합본: ${conflictPath}`);
    return say(`  해결해서 ${target}에 반영한 뒤 --update --resolved로 다시 실행하세요`);
  }
  if (merged === section) {
    saveBase();
    return say('✓ CLAUDE.md 이미 최신 (직접 고친 내용 유지)');
  }
  const saved = backup(content);
  write(merged);
  saveBase();
  say('✓ CLAUDE.md 업데이트 완료 (직접 고친 내용 유지)');
  say(`  이전 파일 백업: ${saved}`);
}

if (!existsSync(target)) {
  writeFileSync(target, `${MARKER}\n${template}`);
  saveBase();
  say('✓ CLAUDE.md 생성 완료');
} else {
  const content = readFileSync(target, 'utf8');
  const index = content.indexOf(MARKER);
  if (index === -1) {
    writeFileSync(target, `${content}\n${MARKER}\n${template}`);
    saveBase();
    say('✓ CLAUDE.md에 설정 추가 완료');
  } else if (!update) {
    say('이미 설치된 설정 발견. 건너뜀 (업데이트: --update)');
  } else {
    updateSection(content, index);
  }
}
