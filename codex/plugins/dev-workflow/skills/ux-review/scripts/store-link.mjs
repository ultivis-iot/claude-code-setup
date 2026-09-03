// 저장소의 tmp/ux-review 를 중앙 저장소로 잇는다.
//
// 링크가 있으면 기존 코드가 경로를 바꾸지 않고도 중앙에 저장하게 되고,
// 매니페스트의 pathBase: "repository-root" 도 그대로 유효하다.

import { execFile } from 'node:child_process';
import { lstat, mkdir, readlink, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export function resolveStoreRoot() {
  if (process.env.UX_REVIEW_STORE) return path.resolve(process.env.UX_REVIEW_STORE);
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(dataHome, 'ux-review');
}

// worktree면 부모 저장소 디렉토리명을 돌려준다
export async function parentRepositoryName(repositoryRoot) {
  try {
    const { stdout } = await run('git', ['-C', repositoryRoot, 'rev-parse',
      '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' });
    return path.basename(path.dirname(stdout.trim()));
  } catch {
    return path.basename(repositoryRoot);
  }
}

// tmp/ux-review 가 중앙 저장소를 가리키도록 보장한다.
// 이미 실제 디렉토리가 있으면 건드리지 않는다 (migrate-store.mjs 의 몫).
export async function ensureStoreLink(repositoryRoot) {
  const uxReview = path.join(repositoryRoot, 'tmp', 'ux-review');
  try {
    const info = await lstat(uxReview);
    if (info.isSymbolicLink()) return { path: uxReview, target: await readlink(uxReview), created: false };
    return { path: uxReview, target: null, created: false, local: true };
  } catch { /* 없으면 아래에서 만든다 */ }

  const target = path.join(resolveStoreRoot(),
    await parentRepositoryName(repositoryRoot), path.basename(repositoryRoot));
  await mkdir(target, { recursive: true });
  await mkdir(path.dirname(uxReview), { recursive: true });
  try {
    await symlink(target, uxReview, 'dir');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return { path: uxReview, target, created: true };
}
