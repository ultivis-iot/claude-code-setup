#!/usr/bin/env node

// 시나리오 디렉토리에 origin.json 과 plan-snapshot.md 를 남긴다.
// 저장소가 나중에 사라져도 어떤 프로젝트·브랜치·이슈의 리뷰였는지 남기기 위함이다.
//
//   node capture-origin.mjs <scenario-directory>
//
// GitHub / Notion 조회는 best-effort 다. 실패하면 해당 필드만 null 이 되고
// 캡처 자체는 성공한다 (gh 미설치, 오프라인, 이슈 미연결 모두 정상 경로).

import { execFile } from 'node:child_process';
import { copyFile, readdir, writeFile, stat } from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';
import { findRepositoryRoot } from './repository-paths.mjs';
import { parentRepositoryName } from './store-link.mjs';

const execFileAsync = promisify(execFile);
const NETWORK_TIMEOUT = 5000;

async function git(repositoryRoot, args) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repositoryRoot, ...args], { encoding: 'utf8' });
    return stdout.trim();
  } catch { return null; }
}

// bash 없이 실행 파일을 직접 호출한다 (Windows 지원). 실패하면 null.
async function run(file, args, options = {}) {
  try {
    const { stdout } = await execFileAsync(file, args,
      { encoding: 'utf8', timeout: NETWORK_TIMEOUT, windowsHide: true, ...options });
    return stdout.trim();
  } catch { return null; }
}

function issueNumberFromBranch(branch) {
  if (!branch) return null;
  const patterns = [/^(\d+)/, /^[a-zA-Z]+\/(\d+)/, /pm-(\d+)/];
  for (const pattern of patterns) {
    const match = branch.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

export async function captureOrigin(scenarioDirectory) {
  const repositoryRoot = await findRepositoryRoot(scenarioDirectory);
  const branch = await git(repositoryRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const origin = {
    repository: await parentRepositoryName(repositoryRoot),
    worktree: path.basename(repositoryRoot),
    branch: branch && branch !== 'HEAD' ? branch : null,
    revision: await git(repositoryRoot, ['rev-parse', 'HEAD']),
    remote: await git(repositoryRoot, ['remote', 'get-url', 'origin']),
    issue: null, issueUrl: null, issueTitle: null,
    notionTaskUrl: null, notionStoryUrl: null,
    capturedAt: new Date().toISOString(),
  };

  origin.issue = issueNumberFromBranch(origin.branch);
  if (origin.issue) {
    const raw = await run('gh', ['issue', 'view', String(origin.issue), '--json', 'url,title'], { cwd: repositoryRoot });
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        origin.issueUrl = parsed.url ?? null;
        origin.issueTitle = parsed.title ?? null;
      } catch { /* 조회 실패는 null 유지 */ }
    }
  }

  // Notion 조회는 best-effort: ult-notion.mjs 가 없거나 토큰이 없거나 실패하면 건너뛴다 (null 유지)
  if (origin.issueUrl) {
    // 설치본에서는 skills/ux-review/scripts/ 기준 ../../../scripts/ 가 ~/.claude(또는 ~/.codex)/scripts 와 같다
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(here, '..', '..', '..', 'scripts', 'ult-notion.mjs'),
      path.join(os.homedir(), '.claude', 'scripts', 'ult-notion.mjs'),
      path.join(os.homedir(), '.codex', 'scripts', 'ult-notion.mjs'),
    ];
    try {
      let notionCli = null;
      for (const candidate of candidates) {
        try { await stat(candidate); notionCli = candidate; break; } catch { /* 다음 후보 */ }
      }
      if (!notionCli) throw new Error('ult-notion.mjs not found');
      for (const [field, sub] of [['notionTaskUrl', 'find-task-by-issue-url'],
                                  ['notionStoryUrl', 'find-story-by-issue-url']]) {
        const raw = await run(process.execPath, [notionCli, sub, origin.issueUrl]);
        if (raw) origin[field] = raw.split(/\r?\n/)[0];
      }
    } catch { /* ult-notion.mjs 없으면 건너뛴다 */ }
  }

  await writeFile(path.join(scenarioDirectory, 'origin.json'),
    JSON.stringify(origin, null, 2) + '\n');
  return origin;
}

// Plan 은 GitHub Issue 본문에 올라가지 않으므로 로컬 파일을 스냅샷으로 남긴다.
export async function capturePlan(scenarioDirectory) {
  const repositoryRoot = await findRepositoryRoot(scenarioDirectory);
  const target = path.join(scenarioDirectory, 'plan-snapshot.md');

  const current = path.join(repositoryRoot, 'tmp', 'current-plan.md');
  try {
    await stat(current);
    await copyFile(current, target);
    return path.relative(repositoryRoot, current);
  } catch { /* 없으면 아카이브에서 최신 것을 찾는다 */ }

  const archive = path.join(repositoryRoot, 'tmp', 'archived-plans');
  try {
    const entries = (await readdir(archive)).filter((f) => f.endsWith('.md')).sort();
    if (!entries.length) return null;
    const latest = path.join(archive, entries[entries.length - 1]);
    await copyFile(latest, target);
    return path.relative(repositoryRoot, latest);
  } catch { return null; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const directory = path.resolve(process.argv[2] || '.');
  const origin = await captureOrigin(directory);
  const plan = await capturePlan(directory);
  console.log(JSON.stringify({ ...origin, planSource: plan }, null, 2));
}
