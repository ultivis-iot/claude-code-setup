#!/usr/bin/env node

import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { findRepositoryRoot, toRepositoryRelativePath } from './repository-paths.mjs';

const [mode, target, value, ...rest] = process.argv.slice(2);
const option = (name) => {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] : null;
};

if (mode === 'scenario') {
  if (!target || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value || '')) {
    fail('Usage: allocate-output.mjs scenario <path-inside-repository> <scenario-id> [--date YYYY-MM-DD]');
  }
  const repositoryRoot = await findRepositoryRoot(path.resolve(target));
  const date = option('--date') || localDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('--date must use YYYY-MM-DD');
  const dateDirectory = path.join(repositoryRoot, 'tmp', 'ux-review', date);
  await mkdir(dateDirectory, { recursive: true });
  const directory = await allocateNumberedDirectory(dateDirectory, /^([0-9]{2})\./, (number) =>
    `${number}.${value}`
  );
  result(repositoryRoot, directory, { mode, date, scenarioId: value });
} else if (mode === 'pass') {
  if (!target || !['review', 'guide'].includes(value)) {
    fail('Usage: allocate-output.mjs pass <scenario-directory> <review|guide>');
  }
  const scenarioDirectory = path.resolve(target);
  const repositoryRoot = await findRepositoryRoot(scenarioDirectory);
  toRepositoryRelativePath(repositoryRoot, scenarioDirectory, 'scenario directory');
  const directory = await allocateNumberedDirectory(
    scenarioDirectory,
    new RegExp(`^${value}-([0-9]{2})$`),
    (number) => `${value}-${number}`
  );
  result(repositoryRoot, directory, { mode, phase: value });
} else {
  fail('Usage: allocate-output.mjs <scenario|pass> ...');
}

async function allocateNumberedDirectory(parent, pattern, nameForNumber) {
  const entries = await readdir(parent, { withFileTypes: true });
  let greatest = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(pattern);
    if (match) greatest = Math.max(greatest, Number(match[1]));
  }
  for (let candidate = greatest + 1; candidate <= 99; candidate += 1) {
    const number = String(candidate).padStart(2, '0');
    const directory = path.join(parent, nameForNumber(number));
    try {
      await mkdir(directory);
      return directory;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error(`No available two-digit sequence under ${parent}`);
}

function localDate(now = new Date()) {
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0'))
    .join('-');
}

function result(repositoryRoot, directory, details) {
  console.log(
    JSON.stringify(
      {
        ...details,
        directory,
        repositoryRelativeDirectory: toRepositoryRelativePath(
          repositoryRoot,
          directory,
          'allocated directory'
        ),
      },
      null,
      2
    )
  );
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
