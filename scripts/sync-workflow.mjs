#!/usr/bin/env node
// Build/check distribution copies from canonical skills and Claude commands.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] || '--check';
if (!['--check', '--write'].includes(mode)) throw new Error('Usage: sync-workflow.mjs [--check|--write]');
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
let differences = 0;
const expected = new Set();
function copy(source, dest, transform = value => value) {
  expected.add(dest);
  const content = transform(readFileSync(source));
  if (existsSync(dest) && readFileSync(dest).equals(content)) return;
  differences++;
  if (mode === '--write') {
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, content);
  } else console.error(`Outdated distribution copy: ${path.relative(root, dest)}`);
}
for (const file of walk(path.join(root, 'codex/skills'))) {
  copy(file, path.join(root, 'codex/plugins/dev-workflow/skills', path.relative(path.join(root, 'codex/skills'), file)));
}
for (const file of walk(path.join(root, 'commands'))) {
  copy(file, path.join(root, 'codex/plugins/dev-workflow/commands', path.relative(path.join(root, 'commands'), file)), content => Buffer.from(content.toString().replaceAll('.claude/', '.codex/')));
}
for (const dir of ['skills', 'commands']) {
  for (const file of walk(path.join(root, 'codex/plugins/dev-workflow', dir))) {
    if (!expected.has(file)) {
      console.error(`Unexpected distribution file; inspect before removal: ${path.relative(root, file)}`);
      process.exitCode = 1;
    }
  }
}
if (mode === '--check' && differences) process.exitCode = 1;
if (!process.exitCode) console.log(`OK: workflow distribution ${mode} (${differences} updated copies)`);
