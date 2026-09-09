#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gate = path.join(root, 'scripts/validation-gate.mjs');
const temporary = mkdtempSync(path.join(os.tmpdir(), 'workflow-validation-'));
let count = 0;
const run = (cmd, args, cwd, input) => spawnSync(cmd, args, { cwd, encoding: 'utf8', input });
function ok(result) { assert.equal(result.status, 0, result.stderr || result.stdout); return result.stdout.trim(); }
function rejected(result, pattern) { assert.notEqual(result.status, 0, result.stdout); assert.match(result.stderr + result.stdout, pattern); }
const git = (repo, ...args) => ok(run('git', args, repo));
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value));
function fixture() {
  const repo = path.join(temporary, `repo-${++count}`);
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 'Workflow Test');
  git(repo, 'config', 'user.email', 'workflow@example.invalid');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.hooksPath', path.join(repo, '.git/hooks'));
  writeFileSync(path.join(repo, '.gitignore'), 'tmp/\n');
  writeFileSync(path.join(repo, 'code.txt'), 'initial\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'test: initial');
  git(repo, 'switch', '-qc', 'feature');
  mkdirSync(path.join(repo, 'tmp'));
  writeFileSync(path.join(repo, 'tmp/current-plan.md'), '# Approved fixture plan\n');
  const results = Object.fromEntries(['intent-validator', 'doc-validator', 'security-validator', 'code-simplifier', 'test-validator'].map(name => [name, { status: 'PASS', evidence: ['Fixture review/test log'] }]));
  const invoke = (...args) => run(process.execPath, [gate, ...args, '--repo', repo], repo);
  const snapshot = () => ok(invoke('snapshot', '--base', 'main', '--out', 'tmp/snapshot.json'));
  const record = () => {
    writeJson(path.join(repo, 'tmp/results.json'), results);
    return invoke('record', '--snapshot', 'tmp/snapshot.json', '--results', 'tmp/results.json', '--out', 'tmp/validation-status.json');
  };
  const ready = () => invoke('ready', 'tmp/validation-status.json', '--base', 'main');
  const readStatus = () => JSON.parse(readFileSync(path.join(repo, 'tmp/validation-status.json')));
  return { repo, results, invoke, snapshot, record, ready, readStatus };
}

try {
  const valid = fixture();
  valid.snapshot();
  ok(valid.record());
  ok(valid.ready());
  valid.results['doc-validator'].status = 'WARN';
  ok(valid.record());
  assert.equal(valid.readStatus().overall, 'WARN');
  ok(valid.ready());

  for (const name of ['doc-validator', 'security-validator', 'code-simplifier', 'test-validator']) {
    const f = fixture();
    f.snapshot();
    f.results[name].status = 'SKIP';
    ok(f.record());
    rejected(f.ready(), /did not execute/);
  }
  const failed = fixture();
  failed.snapshot();
  failed.results['security-validator'].status = 'FAIL';
  ok(failed.record());
  assert.equal(failed.readStatus().overall, 'FAIL');
  rejected(failed.ready(), /failed/);
  const tampered = failed.readStatus();
  tampered.overall = 'PASS';
  writeJson(path.join(failed.repo, 'tmp/tampered.json'), tampered);
  rejected(failed.invoke('check', 'tmp/tampered.json'), /disagrees/);
  tampered.overall = 'FAIL';
  tampered.timestamp = 'not-a-date';
  writeJson(path.join(failed.repo, 'tmp/tampered.json'), tampered);
  rejected(failed.invoke('check', 'tmp/tampered.json'), /timestamp/);

  for (const mutation of ['missing-result', 'missing-evidence', 'unknown-validator']) {
    const f = fixture();
    f.snapshot();
    if (mutation === 'missing-result') delete f.results['security-validator'];
    if (mutation === 'missing-evidence') f.results['security-validator'].evidence = [];
    if (mutation === 'unknown-validator') f.results.typo = { status: 'PASS', evidence: ['x'] };
    rejected(f.record(), /required|evidence|Unknown/);
  }
  for (const change of ['head', 'base', 'plan', 'branch', 'dirty', 'untracked']) {
    const f = fixture();
    f.snapshot();
    ok(f.record());
    if (change === 'head') git(f.repo, 'commit', '--allow-empty', '-qm', 'test: new commit');
    if (change === 'base') {
      git(f.repo, 'switch', '-q', 'main');
      git(f.repo, 'commit', '--allow-empty', '-qm', 'test: base changed');
      git(f.repo, 'switch', '-q', 'feature');
    }
    if (change === 'plan') writeFileSync(path.join(f.repo, 'tmp/current-plan.md'), '# Different plan\n');
    if (change === 'branch') git(f.repo, 'switch', '-qc', 'other');
    if (change === 'dirty') writeFileSync(path.join(f.repo, 'code.txt'), 'changed\n');
    if (change === 'untracked') writeFileSync(path.join(f.repo, 'new-code.txt'), 'untracked\n');
    rejected(f.ready(), /stale|dirty/);
    rejected(f.record(), /stale|dirty/);
  }
  const cli = fixture();
  writeJson(path.join(cli.repo, '.cli-sync.json'), { enabled: true });
  git(cli.repo, 'add', '.cli-sync.json');
  git(cli.repo, 'commit', '-qm', 'test: cli enabled');
  cli.snapshot();
  ok(cli.record());
  rejected(cli.ready(), /cli-validator/);
  cli.results['cli-validator'] = { status: 'PASS', evidence: ['CLI review log'] };
  ok(cli.record());
  ok(cli.ready());

  const legacy = fixture();
  writeJson(path.join(legacy.repo, 'tmp/old.json'), { ready_for_pr: true, intent_validation: { status: 'FAIL' } });
  rejected(legacy.invoke('ready', 'tmp/old.json'), /schema_version/);
  // Actual installed hooks and local bare remote, with no network or user repo writes.
  const publication = fixture();
  ok(run('bash', [path.join(root, 'hooks/install-hooks.sh')], publication.repo));
  git(publication.repo, 'commit', '--allow-empty', '-qm', 'test: commit before validation');
  const remote = path.join(temporary, 'remote.git');
  git(temporary, 'init', '--bare', '-q', remote);
  git(publication.repo, 'remote', 'add', 'origin', remote);
  rejected(run('git', ['push', 'origin', 'feature'], publication.repo), /ENOENT/);
  publication.snapshot();
  ok(publication.record());
  ok(run('git', ['push', 'origin', 'feature'], publication.repo));
  git(publication.repo, 'commit', '--allow-empty', '-qm', 'test: unvalidated commit');
  rejected(run('git', ['push', 'origin', 'feature'], publication.repo), /stale/);
  publication.snapshot();
  ok(publication.record());
  git(publication.repo, 'tag', '-a', 'v-test', '-m', 'fixture tag');
  ok(run('git', ['push', 'origin', 'feature', '--tags'], publication.repo));
  rejected(run('git', ['push', 'origin', 'feature:other'], publication.repo), /unvalidated ref/);

  const custom = fixture();
  writeFileSync(path.join(custom.repo, '.git/hooks/pre-push'), '# custom user hook\n');
  rejected(run('bash', [path.join(root, 'hooks/install-hooks.sh')], custom.repo), /existing custom hook/);
  assert.equal(readFileSync(path.join(custom.repo, '.git/hooks/pre-push'), 'utf8'), '# custom user hook\n');
  const another = fixture();
  writeJson(path.join(another.repo, 'tmp/borrowed.json'), valid.readStatus());
  rejected(another.invoke('ready', 'tmp/borrowed.json'), /repository changed/);
  const linked = path.join(temporary, 'linked-worktree');
  git(publication.repo, 'worktree', 'add', '-qb', 'linked', linked, 'main');
  git(linked, 'config', 'core.hooksPath', path.join(temporary, 'custom-hooks'));
  ok(run('bash', [path.join(root, 'hooks/install-hooks.sh')], linked));
  mkdirSync(path.join(linked, 'tmp'), { recursive: true });
  writeJson(path.join(linked, 'tmp/results.json'), valid.results);
  ok(run(process.execPath, [gate, 'snapshot', '--repo', linked, '--base', 'main', '--out', 'tmp/snapshot.json'], linked));
  ok(run(process.execPath, [gate, 'record', '--repo', linked, '--snapshot', 'tmp/snapshot.json', '--results', 'tmp/results.json', '--out', 'tmp/validation-status.json'], linked));
  ok(run('git', ['push', 'origin', 'linked'], linked));
  const plan = fixture();
  const planHook = path.join(root, 'hooks/copy-plan-on-accept.sh');
  const hookInput = JSON.stringify({ tool_name: 'ExitPlanMode', cwd: plan.repo, session_id: 'fixture-session' });
  const planEnv = { ...process.env, WORKFLOW_APPROVED_PLAN: '' };
  ok(spawnSync('bash', [planHook], { cwd: plan.repo, encoding: 'utf8', input: hookInput, env: planEnv }));
  assert.equal(readFileSync(path.join(plan.repo, 'tmp/current-plan.md'), 'utf8'), '# Approved fixture plan\n');
  const approved = path.join(temporary, 'explicit-plan.md');
  writeFileSync(approved, '# Explicit approved plan\n');
  ok(spawnSync('bash', [planHook], { cwd: plan.repo, encoding: 'utf8', input: hookInput, env: { ...planEnv, WORKFLOW_APPROVED_PLAN: approved } }));
  assert.equal(readFileSync(path.join(plan.repo, 'tmp/current-plan.md'), 'utf8'), '# Explicit approved plan\n');
  console.log(`OK: validation gate, stale-state rejection and real push hooks (${count} isolated repositories)`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
