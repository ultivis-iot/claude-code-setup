#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
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
  // The review policy is read from the remote default branch (origin/HEAD); here it follows the local main.
  git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/heads/main');
  git(repo, 'switch', '-qc', 'feature');
  mkdirSync(path.join(repo, 'tmp'));
  writeFileSync(path.join(repo, 'tmp/current-plan.md'), '# Approved fixture plan\n');
  const results = Object.fromEntries(['intent-validator', 'doc-validator', 'security-validator', 'code-simplifier', 'test-validator'].map(name => [name, { status: 'PASS', evidence: ['Fixture review/test log'] }]));
  const invoke = (...args) => run(process.execPath, [gate, ...args, '--repo', repo], repo);
  const snapshot = () => ok(invoke('snapshot', '--base', 'main', '--out', 'tmp/snapshot.json'));
  const record = () => {
    writeJson(path.join(repo, 'tmp/results.json'), results);
    const policy = invoke('policy', '--snapshot', 'tmp/snapshot.json', '--out', 'tmp/review-policy.json');
    if (policy.status !== 0) return policy;
    return invoke('record', '--snapshot', 'tmp/snapshot.json', '--policy', 'tmp/review-policy.json', '--results', 'tmp/results.json', '--out', 'tmp/validation-status.json');
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
  ok(run(process.execPath, [gate, 'policy', '--repo', linked, '--snapshot', 'tmp/snapshot.json', '--out', 'tmp/review-policy.json'], linked));
  ok(run(process.execPath, [gate, 'record', '--repo', linked, '--snapshot', 'tmp/snapshot.json', '--policy', 'tmp/review-policy.json', '--results', 'tmp/results.json', '--out', 'tmp/validation-status.json'], linked));
  ok(run('git', ['push', 'origin', 'linked'], linked));
  // post-merge 는 sh 래퍼가 Node 의 graft.mjs 를 호출한다(Graft CLI 가 없어도 종료 코드 0). 예전 bash 갱신 스크립트는 정리된다.
  const customHooks = path.join(temporary, 'custom-hooks');
  assert.ok(existsSync(path.join(customHooks, 'workflow/scripts/graft.mjs')));
  assert.ok(!existsSync(path.join(customHooks, 'workflow/scripts/graft-refresh.sh')));
  ok(spawnSync('sh', [path.join(customHooks, 'post-merge')], { cwd: linked, encoding: 'utf8', env: { ...process.env, GRAFT_PACKAGE: '@nanonets/graft@0.0.0' } }));
  // 리뷰 정책은 스냅샷 base 의 REVIEW.md 만 쓴다. 브랜치가 바꾼 REVIEW.md·심볼릭 링크는 정책이 아니다.
  const policyFixture = setup => {
    const f = fixture();
    git(f.repo, 'switch', '-q', 'main');
    setup(f.repo);
    git(f.repo, 'add', '-A');
    git(f.repo, 'commit', '-qm', 'test: policy base', '--allow-empty');
    git(f.repo, 'switch', '-q', 'feature');
    git(f.repo, 'reset', '-q', '--hard', 'main');
    return { ...f, policy: () => f.invoke('policy', '--snapshot', 'tmp/snapshot.json', '--out', 'tmp/review-policy.json'), readPolicy: () => JSON.parse(readFileSync(path.join(f.repo, 'tmp/review-policy.json'))) };
  };
  const based = policyFixture(repo => writeFileSync(path.join(repo, 'REVIEW.md'), '# base policy\n'));
  writeFileSync(path.join(based.repo, 'REVIEW.md'), '# head policy\n');
  git(based.repo, 'commit', '-qam', 'test: branch rewrites policy');
  based.snapshot();
  assert.match(ok(based.policy()), /Review policy: REVIEW\.md@/);
  const basePolicy = based.readPolicy();
  assert.equal(basePolicy.text, '# base policy');
  assert.equal(basePolicy.base_sha, git(based.repo, 'rev-parse', 'main'));
  assert.equal(basePolicy.truncated, false);
  writeFileSync(path.join(based.repo, 'code.txt'), 'after snapshot\n');
  git(based.repo, 'commit', '-qam', 'test: after snapshot');
  rejected(based.policy(), /stale/);
  const absent = policyFixture(() => {});
  writeFileSync(path.join(absent.repo, 'REVIEW.md'), '# only on the branch\n');
  git(absent.repo, 'add', 'REVIEW.md');
  git(absent.repo, 'commit', '-qm', 'test: branch adds policy');
  absent.snapshot();
  assert.match(ok(absent.policy()), /Review policy: none/);
  assert.deepEqual(absent.readPolicy(), { base_sha: git(absent.repo, 'rev-parse', 'main'), source: null, truncated: false, text: null });
  const empty = policyFixture(repo => writeFileSync(path.join(repo, 'REVIEW.md'), '  \n\n'));
  empty.snapshot();
  assert.match(ok(empty.policy()), /Review policy: none/);
  assert.equal(empty.readPolicy().text, null);
  const linkedPolicy = policyFixture(repo => { writeFileSync(path.join(repo, 'target.md'), '# via link\n'); symlinkSync('target.md', path.join(repo, 'REVIEW.md')); });
  linkedPolicy.snapshot();
  ok(linkedPolicy.policy());
  assert.equal(linkedPolicy.readPolicy().text, null);
  const long = policyFixture(repo => writeFileSync(path.join(repo, 'REVIEW.md'), 'x'.repeat(9000)));
  long.snapshot();
  assert.match(ok(long.policy()), /\(truncated\)/);
  assert.ok(long.readPolicy().text.endsWith('[policy truncated at 8000 characters]'));
  assert.equal(long.readPolicy().text.length, 8000 + '\n[policy truncated at 8000 characters]'.length);
  const huge = policyFixture(repo => writeFileSync(path.join(repo, 'REVIEW.md'), 'x'.repeat(1024 * 1024 + 1)));
  huge.snapshot();
  rejected(huge.policy(), /larger than/);
  const broken = policyFixture(repo => writeFileSync(path.join(repo, 'REVIEW.md'), '# base policy\n'));
  broken.snapshot();
  const snapshotFile = path.join(broken.repo, 'tmp/snapshot.json');
  writeJson(snapshotFile, { ...JSON.parse(readFileSync(snapshotFile)), base_sha: '0'.repeat(40) });
  rejected(broken.policy(), /stale/);
  // 정책 단계를 건너뛰거나 정책 결과·상태를 고치면 record·ready 가 막는다.
  const bound = policyFixture(repo => writeFileSync(path.join(repo, 'REVIEW.md'), '# bound policy\n'));
  bound.snapshot();
  writeJson(path.join(bound.repo, 'tmp/results.json'), bound.results);
  const recordWith = (...extra) => bound.invoke('record', '--snapshot', 'tmp/snapshot.json', ...extra, '--results', 'tmp/results.json', '--out', 'tmp/validation-status.json');
  rejected(recordWith(), /--policy/);
  ok(bound.policy());
  const policyFile = path.join(bound.repo, 'tmp/review-policy.json');
  const realPolicy = bound.readPolicy();
  writeJson(policyFile, { ...realPolicy, text: null, source: null });
  rejected(recordWith('--policy', 'tmp/review-policy.json'), /does not match/);
  writeJson(policyFile, { ...realPolicy, text: '# weaker policy' });
  rejected(recordWith('--policy', 'tmp/review-policy.json'), /does not match/);
  writeJson(policyFile, { ...realPolicy, base_sha: '0'.repeat(40) });
  rejected(recordWith('--policy', 'tmp/review-policy.json'), /another default branch/);
  writeJson(policyFile, { ...realPolicy, text: ['# bound policy'] });
  rejected(recordWith('--policy', 'tmp/review-policy.json'), /string or null/);
  writeJson(policyFile, realPolicy);
  ok(recordWith('--policy', 'tmp/review-policy.json'));
  assert.equal(bound.readStatus().review_policy.source, realPolicy.source);
  ok(bound.ready());
  const statusFile = path.join(bound.repo, 'tmp/validation-status.json');
  const realStatus = bound.readStatus();
  writeJson(statusFile, { ...realStatus, review_policy: { ...realStatus.review_policy, source: null, sha256: null } });
  rejected(bound.ready(), /does not match/);
  const { review_policy: _dropped, ...withoutPolicy } = realStatus;
  writeJson(statusFile, withoutPolicy);
  rejected(bound.ready(), /review_policy: required/);
  // 정책은 대상 브랜치가 아닌 기본 브랜치(origin/HEAD)에서 읽는다. 대상 브랜치는 PR 을 여는 사람이 고른다.
  const targeted = policyFixture(repo => writeFileSync(path.join(repo, 'REVIEW.md'), '# default policy\n'));
  git(targeted.repo, 'switch', '-qc', 'weak', 'main');
  writeFileSync(path.join(targeted.repo, 'REVIEW.md'), '# weak policy\n');
  git(targeted.repo, 'commit', '-qam', 'test: weaker policy on another branch');
  git(targeted.repo, 'switch', '-q', 'feature');
  git(targeted.repo, 'reset', '-q', '--hard', 'weak');
  ok(targeted.invoke('snapshot', '--base', 'weak', '--out', 'tmp/snapshot.json'));
  assert.match(ok(targeted.policy()), /REVIEW\.md@/);
  assert.equal(targeted.readPolicy().text, '# default policy');
  assert.equal(targeted.readPolicy().base_sha, git(targeted.repo, 'rev-parse', 'main'));
  writeJson(path.join(targeted.repo, 'tmp/results.json'), targeted.results);
  const recordTargeted = () => targeted.invoke('record', '--snapshot', 'tmp/snapshot.json', '--policy', 'tmp/review-policy.json', '--results', 'tmp/results.json', '--out', 'tmp/validation-status.json');
  ok(recordTargeted());
  assert.equal(targeted.readStatus().review_policy.base_sha, git(targeted.repo, 'rev-parse', 'main'));
  ok(targeted.invoke('ready', 'tmp/validation-status.json', '--base', 'weak'));
  // 기본 브랜치가 움직이면 정책을 다시 읽어야 한다.
  git(targeted.repo, 'switch', '-q', 'main');
  writeFileSync(path.join(targeted.repo, 'REVIEW.md'), '# stricter default policy\n');
  git(targeted.repo, 'commit', '-qam', 'test: default policy moves');
  git(targeted.repo, 'switch', '-q', 'feature');
  rejected(targeted.invoke('ready', 'tmp/validation-status.json', '--base', 'weak'), /default branch/);
  rejected(recordTargeted(), /default branch/);
  // 기본 브랜치를 모르면 대상 브랜치로 대신하지 않고 멈춘다.
  const headless = policyFixture(() => {});
  git(headless.repo, 'symbolic-ref', '--delete', 'refs/remotes/origin/HEAD');
  headless.snapshot();
  rejected(headless.policy(), /origin\/HEAD/);
  const plan = fixture();
  const planHook = path.join(root, 'hooks/copy-plan-on-accept.mjs');
  const hookInput = JSON.stringify({ tool_name: 'ExitPlanMode', cwd: plan.repo, session_id: 'fixture-session' });
  const planEnv = { ...process.env, WORKFLOW_APPROVED_PLAN: '' };
  ok(spawnSync(process.execPath, [planHook], { cwd: plan.repo, encoding: 'utf8', input: hookInput, env: planEnv }));
  assert.equal(readFileSync(path.join(plan.repo, 'tmp/current-plan.md'), 'utf8'), '# Approved fixture plan\n');
  const approved = path.join(temporary, 'explicit-plan.md');
  writeFileSync(approved, '# Explicit approved plan\n');
  ok(spawnSync(process.execPath, [planHook], { cwd: plan.repo, encoding: 'utf8', input: hookInput, env: { ...planEnv, WORKFLOW_APPROVED_PLAN: approved } }));
  assert.equal(readFileSync(path.join(plan.repo, 'tmp/current-plan.md'), 'utf8'), '# Explicit approved plan\n');
  console.log(`OK: validation gate, stale-state rejection and real push hooks (${count} isolated repositories)`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
