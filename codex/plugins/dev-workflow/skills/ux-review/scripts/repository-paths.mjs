import { createHash } from 'node:crypto';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export async function findRepositoryRoot(startPath) {
  let current = path.resolve(startPath);
  if (!(await stat(current)).isDirectory()) current = path.dirname(current);

  while (true) {
    try {
      await access(path.join(current, '.git'));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error(`No Git repository found from ${startPath}`);
      }
      current = parent;
    }
  }
}

function assertInsideRepository(repositoryRoot, targetPath, label) {
  const relative = path.relative(path.resolve(repositoryRoot), path.resolve(targetPath));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} must remain inside the Git repository: ${targetPath}`);
  }
  return relative;
}

export function toRepositoryRelativePath(repositoryRoot, targetPath, label = 'path') {
  return assertInsideRepository(repositoryRoot, targetPath, label).split(path.sep).join('/');
}

export function resolveRepositoryRelativePath(repositoryRoot, relativePath, label = 'path') {
  if (typeof relativePath !== 'string' || !relativePath.trim() || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be a repository-relative path`);
  }
  const resolved = path.resolve(repositoryRoot, relativePath);
  assertInsideRepository(repositoryRoot, resolved, label);
  return resolved;
}

export async function fileSha256(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

export async function directorySha256(directory) {
  const files = [];
  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      if (entry.isFile()) files.push(fullPath);
    }
  }
  await visit(directory);
  files.sort((left, right) => left.localeCompare(right));
  const hash = createHash('sha256');
  for (const filePath of files) {
    hash.update(path.relative(directory, filePath).split(path.sep).join('/'));
    hash.update('\0');
    hash.update(await readFile(filePath));
    hash.update('\0');
  }
  return hash.digest('hex');
}
