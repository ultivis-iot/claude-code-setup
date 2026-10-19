#!/usr/bin/env node
// Install or update the managed section of ~/.claude/CLAUDE.md without losing local edits.
// The section runs from MARKER to end of file. On --update, the installed section, the
// template it was installed from (base) and the new template are 3-way merged with
// `git merge-file`, so lines a person added or changed inside the section survive.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// setup.sh and setup.ps1 repeat this marker in their no-Node fallback; keep them in sync.
const MARKER = '# === Claude Code 개발 플로우 설정 ===';
const usage = 'Usage: install-claude-md.mjs <CLAUDE.md> <template> --state <dir> [--repo <dir>] [--update]';

const argv = process.argv.slice(2);
const option = name => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; };
const [target, templatePath] = argv;
const stateDir = option('--state');
const repo = option('--repo');
const update = argv.includes('--update');
if (!target || !templatePath || target.startsWith('--') || !stateDir) throw new Error(usage);

const basePath = path.join(stateDir, 'claude-md-base.md');
const template = readFileSync(templatePath, 'utf8');
const say = message => console.log(`   ${message}`);
const lf = text => text.replace(/\r\n/g, '\n');

const conflictPath = path.join(stateDir, 'CLAUDE.md.conflict');

// Record the template now in effect; a leftover conflict copy from an earlier run is stale.
function saveBase() {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(basePath, template);
  rmSync(conflictPath, { force: true });
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
    const result = spawnSync('git', ['merge-file', '-p', '--diff3', ...labels.flatMap(label => ['-L', label]),
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
function resolveAdditions(text, [ours, base, theirs]) {
  const out = [];
  let conflicts = 0;
  let hunk;
  for (const line of text.split(/(?<=\n)/)) {
    const bare = line.replace(/\r?\n$/, '');
    if (!hunk && bare === `<<<<<<< ${ours}`) hunk = { part: 'ours', ours: [], base: [], theirs: [] };
    else if (hunk && hunk.part === 'ours' && bare === `||||||| ${base}`) hunk.part = 'base';
    else if (hunk && hunk.part === 'base' && bare === '=======') hunk.part = 'theirs';
    else if (hunk && hunk.part === 'theirs' && bare === `>>>>>>> ${theirs}`) {
      if (hunk.base.every(l => !l.trim())) out.push(...hunk.base, ...hunk.theirs, ...hunk.ours);
      else {
        conflicts++;
        out.push(`<<<<<<< ${ours}\n`, ...hunk.ours, `||||||| ${base}\n`, ...hunk.base, '=======\n', ...hunk.theirs, `>>>>>>> ${theirs}\n`);
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
  const base = existsSync(basePath) ? readFileSync(basePath, 'utf8') : inferBase(section);
  if (base === undefined) return say('⚠ 이전 템플릿을 찾지 못해 CLAUDE.md 업데이트를 건너뜀 (git 저장소에서 setup을 실행하세요)');

  const { merged, conflicts, error } = merge(section, lf(base), theirs);
  if (error) return say(`⚠ CLAUDE.md 병합 실패, 파일은 그대로 둠: ${error}`);
  if (conflicts) {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(conflictPath, head + merged);
    say(`⚠ 직접 고친 줄과 템플릿 변경이 충돌(${conflicts}곳)해 CLAUDE.md는 그대로 둠`);
    say(`  충돌 표시가 든 병합본: ${conflictPath}`);
    return say(`  해결해서 ${target}에 반영한 뒤 다시 --update를 실행하세요`);
  }
  saveBase();
  if (merged === section) return say('✓ CLAUDE.md 이미 최신 (직접 고친 내용 유지)');
  const saved = backup(content);
  write(merged);
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
