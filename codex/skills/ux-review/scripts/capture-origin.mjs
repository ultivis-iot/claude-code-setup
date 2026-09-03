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

async function shell(script) {
  try {
    const { stdout } = await execFileAsync('bash', ['-lc', script],
      { encoding: 'utf8', timeout: NETWORK_TIMEOUT });
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
    const raw = await shell(
      `cd ${JSON.stringify(repositoryRoot)} && gh issue view ${origin.issue} --json url,title 2>/dev/null`);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        origin.issueUrl = parsed.url ?? null;
        origin.issueTitle = parsed.title ?? null;
      } catch { /* 조회 실패는 null 유지 */ }
    }
  }

  // Notion 은 워크플로 스크립트가 있을 때만 조회한다
  if (origin.issueUrl) {
    const notionApi = path.join(os.homedir(), '.claude', 'scripts', 'notion-api.sh');
    try {
      await stat(notionApi);
      for (const [field, fn] of [['notionTaskUrl', 'find_task_by_issue_url'],
                                 ['notionStoryUrl', 'find_story_by_issue_url']]) {
        const raw = await shell(
          `source ${JSON.stringify(notionApi)} >/dev/null 2>&1 && ` +
          `${fn} ${JSON.stringify(origin.issueUrl)} 2>/dev/null | jq -r '.url // empty'`);
        if (raw) origin[field] = raw;
      }
    } catch { /* notion-api.sh 없으면 건너뛴다 */ }
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const directory = path.resolve(process.argv[2] || '.');
  const origin = await captureOrigin(directory);
  const plan = await capturePlan(directory);
  console.log(JSON.stringify({ ...origin, planSource: plan }, null, 2));
}
