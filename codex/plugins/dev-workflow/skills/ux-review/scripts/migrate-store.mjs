#!/usr/bin/env node

// 기존 <repository-root>/tmp/ux-review/** 산출물을 중앙 저장소로 옮기고
// 원래 자리에는 심볼릭 링크를 남긴다. 매니페스트 JSON은 수정하지 않는다.
//
//   node migrate-store.mjs                 # dry-run (기본)
//   node migrate-store.mjs --apply
//   node migrate-store.mjs --roots ~/Git --store ~/.local/share/ux-review

import { execFile } from 'node:child_process';
import { readdir, stat, lstat, rename, mkdir, rm, cp, symlink, rmdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const expand = (p) => {
  const substituted = p.replace(/\$\{?HOME\}?/g, os.homedir());
  return substituted.startsWith('~')
    ? path.join(os.homedir(), substituted.slice(1))
    : path.resolve(substituted);
};

const store = expand(option('--store', process.env.UX_REVIEW_STORE
  || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'ux-review')));
const roots = (option('--roots', null)?.split(',') ?? await defaultRoots()).map(expand);

async function defaultRoots() {
  // dev-tools/.env 의 WORKTREE_ROOT 를 재사용하고, 없으면 ~/Git
  for (const envFile of [path.join(os.homedir(), '.claude', 'dev-tools', '.env'),
                         path.join(os.homedir(), '.codex', 'dev-tools', '.env')]) {
    try {
      const text = await (await import('node:fs/promises')).readFile(envFile, 'utf8');
      const match = text.match(/^\s*WORKTREE_ROOT\s*=\s*"?([^"\n]+)"?/m);
      if (match) return [match[1].trim()];
    } catch { /* 없으면 다음 */ }
  }
  return [path.join(os.homedir(), 'Git')];
}

// worktree면 부모 저장소 디렉토리명을 돌려준다
async function parentRepositoryName(repositoryPath) {
  try {
    const { stdout } = await run('git', ['-C', repositoryPath, 'rev-parse',
      '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' });
    return path.basename(path.dirname(stdout.trim()));
  } catch {
    return path.basename(repositoryPath);
  }
}

async function directorySize(target) {
  let total = 0;
  const stack = [target];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) total += (await stat(full)).size;
    }
  }
  return total;
}

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

// 대상 날짜 디렉토리에서 이미 쓰인 NN 번호를 모은다
async function usedNumbers(parent) {
  const used = new Set();
  let entries = [];
  try { entries = await readdir(parent, { withFileTypes: true }); } catch { return used; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(/^(\d{2})\./);
    if (match) used.add(Number(match[1]));
  }
  return used;
}

// 원래 번호를 우선 쓰고, 이미 점유됐으면 다음 빈 번호로 밀어낸다
function pickNumber(used, preferred) {
  if (Number.isInteger(preferred) && preferred > 0 && !used.has(preferred)) return preferred;
  for (let n = 1; n <= 99; n += 1) if (!used.has(n)) return n;
  throw new Error('빈 번호가 없습니다');
}

const plan = [];
const claimedByDate = new Map();
const links = [];
const loose = [];
let skipped = 0;

for (const root of roots) {
  let repositories = [];
  try { repositories = await readdir(root, { withFileTypes: true }); } catch { continue; }

  for (const repository of repositories) {
    if (!repository.isDirectory()) continue;
    const repositoryPath = path.join(root, repository.name);
    const uxReview = path.join(repositoryPath, 'tmp', 'ux-review');

    let info;
    try { info = await lstat(uxReview); } catch { continue; }
    if (info.isSymbolicLink()) { skipped += 1; continue; }   // 이미 이전됨
    if (!info.isDirectory()) continue;

    const parentName = await parentRepositoryName(repositoryPath);

    for (const date of (await readdir(uxReview, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!date.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(date.name)) continue;
      const dateDirectory = path.join(uxReview, date.name);

      for (const scenario of (await readdir(dateDirectory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!scenario.isDirectory()) continue;
        const source = path.join(dateDirectory, scenario.name);
        const scenarioId = scenario.name.replace(/^\d{2}\./, '');
        const targetDateDirectory = path.join(store, parentName, repository.name, date.name);

        // 디스크에 이미 있는 번호 + 앞선 계획이 점유한 번호를 함께 본다
        if (!claimedByDate.has(targetDateDirectory)) {
          claimedByDate.set(targetDateDirectory, await usedNumbers(targetDateDirectory));
        }
        const used = claimedByDate.get(targetDateDirectory);
        const number = pickNumber(used, Number(scenario.name.slice(0, 2)));
        used.add(number);
        const name = `${String(number).padStart(2, '0')}.${scenarioId}`;

        plan.push({
          source,
          target: path.join(targetDateDirectory, name),
          size: await directorySize(source),
          renamed: name !== scenario.name,
          origin: repository.name,
        });
      }
    }
    // 날짜 디렉토리 바로 아래 놓인 파일(리뷰 실행 스크립트 등)도 함께 옮긴다
    for (const date of await readdir(uxReview, { withFileTypes: true })) {
      if (!date.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(date.name)) continue;
      for (const entry of await readdir(path.join(uxReview, date.name), { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const source = path.join(uxReview, date.name, entry.name);
        loose.push({
          source,
          target: path.join(store, parentName, repository.name, date.name, entry.name),
          size: (await stat(source)).size,
        });
      }
    }
    links.push({ from: uxReview, to: path.join(store, parentName, repository.name) });
  }
}

// ── 출력 ────────────────────────────────────────────────────────────
console.log(`저장 루트 : ${store}`);
console.log(`스캔 대상 : ${roots.join(', ')}`);
console.log(`모드      : ${apply ? '실행 (--apply)' : 'dry-run  · 실제로 옮기려면 --apply'}\n`);

if (!plan.length) {
  console.log(skipped ? `옮길 것이 없습니다 (이미 이전된 저장소 ${skipped}개).` : '옮길 것이 없습니다.');
  process.exit(0);
}

let totalSize = 0;
let lastGroup = '';
for (const item of plan) {
  const group = path.relative(store, path.dirname(path.dirname(item.target)));
  if (group !== lastGroup) { console.log(`  ${group}/`); lastGroup = group; }
  const rel = path.relative(path.join(store, group), item.target);
  console.log(`    ${rel.padEnd(52)} ${mb(item.size).padStart(9)}   ← ${item.origin}${item.renamed ? '  [번호 재할당]' : ''}`);
  totalSize += item.size;
}
console.log(`\n  시나리오 ${plan.length}개 · ${mb(totalSize)}`);
if (loose.length) {
  console.log(`  날짜 디렉토리 직속 파일 ${loose.length}개도 함께 이동합니다`);
}
console.log('\n심볼릭 링크:');
for (const link of links) console.log(`    ${link.from}  ->  ${link.to}`);

if (!apply) {
  console.log('\n실제로 옮기려면: node migrate-store.mjs --apply');
  process.exit(0);
}

// ── 실행 ────────────────────────────────────────────────────────────
console.log('\n이동 중...');
for (const item of plan) {
  await mkdir(path.dirname(item.target), { recursive: true });
  try {
    await rename(item.source, item.target);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    await cp(item.source, item.target, { recursive: true, preserveTimestamps: true });
    await rm(item.source, { recursive: true, force: true });
  }
  console.log(`  ✓ ${path.relative(store, item.target)}`);
}

for (const item of loose) {
  await mkdir(path.dirname(item.target), { recursive: true });
  try {
    await rename(item.source, item.target);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    await cp(item.source, item.target, { preserveTimestamps: true });
    await rm(item.source, { force: true });
  }
  console.log(`  ✓ ${path.relative(store, item.target)}`);
}

for (const link of links) {
  // 남은 빈 디렉토리를 걷어내고, 비어 있을 때만 링크로 바꾼다
  const stack = [link.from];
  const directories = [];
  while (stack.length) {
    const current = stack.pop();
    directories.push(current);
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.isDirectory()) stack.push(path.join(current, entry.name));
    }
  }
  for (const directory of directories.reverse()) {
    try { await rmdir(directory); } catch { /* 남은 파일이 있으면 유지 */ }
  }
  try {
    await stat(link.from);
    console.log(`  ! ${link.from} 에 파일이 남아 링크를 만들지 않았습니다`);
    continue;
  } catch { /* 비었음 */ }
  await mkdir(link.to, { recursive: true });
  await symlink(link.to, link.from, 'dir');
  console.log(`  ✓ link ${path.relative(os.homedir(), link.from)}`);
}
console.log('\n완료.');
