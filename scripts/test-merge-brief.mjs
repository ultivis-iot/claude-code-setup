#!/usr/bin/env node
// merge-brief.mjs (머지 전 이해 확인 질문 수를 정하는 도구) 테스트. 네트워크·gh 불필요.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify } from './merge-brief.mjs';

const tool = path.join(path.dirname(fileURLToPath(import.meta.url)), 'merge-brief.mjs');
let count = 0;
const check = (name, fn) => {
  try { fn(); } catch (e) { console.error(`FAIL: ${name}`); throw e; }
  count++;
};
const file = (p, additions = 1, deletions = 0) => ({ path: p, additions, deletions });

check('docs only needs a brief and no questions', () => {
  const r = classify([file('README.md', 40), file('CHANGELOG.md', 2), file('docs/workflow.md', 10), file('notes.txt')]);
  assert.equal(r.tier, 'docs');
  assert.equal(r.questions, 0);
});

// 이 저장소에서는 agent 가 읽는 참조 문서·명령·스킬 Markdown 이 동작을 정한다.
check('reference docs, commands and skills count as code', () => {
  for (const p of ['docs/references/create-pr-contract.md', 'commands/review-cycle.md', 'codex/skills/ultivis-flow/SKILL.md']) {
    assert.equal(classify([file(p)]).tier, 'code', p);
  }
});

check('a small code change asks one question, larger changes ask up to three', () => {
  assert.equal(classify([file('scripts/review-metrics.mjs', 20, 5)]).questions, 1);
  assert.equal(classify([file('scripts/a.mjs', 100, 51)]).questions, 2);
  assert.equal(classify(['a', 'b', 'c', 'd', 'e', 'f'].map((n) => file(`scripts/${n}.mjs`))).questions, 2);
  const big = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => file(`scripts/${n}.mjs`, 30));
  assert.equal(classify(big).questions, 3);
  // 경계: 150줄·5개 파일은 더하지 않는다.
  assert.equal(classify([file('scripts/a.mjs', 150)]).questions, 1);
  assert.equal(classify(['a', 'b', 'c', 'd', 'e'].map((n) => file(`scripts/${n}.mjs`))).questions, 1);
});

check('validation, install, hook and permission paths ask four, five when large', () => {
  for (const p of ['hooks/install-hooks.sh', 'scripts/validation-gate.mjs', 'setup.sh', 'setup.ps1', 'scripts/install-settings.mjs',
    'schemas/validation-status.schema.json', 'agents/security-validator.md', '.github/workflows/ci.yml',
    'src/auth/login.ts', 'config/secrets.yaml', 'src/permissions.ts', 'lib/token-store.js', 'db/migrations/001.sql']) {
    const r = classify([file(p)]);
    assert.equal(r.tier, 'sensitive', p);
    assert.equal(r.questions, 4, p);
  }
  assert.equal(classify([file('hooks/pre-push', 200, 101)]).questions, 5);
  assert.equal(classify([file('hooks/pre-push', 200, 100)]).questions, 4);
});

check('the highest category wins and the count never exceeds five', () => {
  const many = Array.from({ length: 20 }, (_, i) => file(`scripts/s${i}.mjs`, 100));
  const r = classify([file('README.md'), ...many, file('hooks/pre-push', 400)]);
  assert.equal(r.tier, 'sensitive');
  assert.equal(r.questions, 5);
  assert.ok(r.reasons.some((reason) => reason.includes('hooks/pre-push')));
});

// 생성본은 원본과 같은 내용이라 다시 세지 않는다. 생성본만 바뀌었으면 묻지 않는다.
check('generated distribution copies are not counted', () => {
  const r = classify([file('commands/review-cycle.md', 10), file('codex/plugins/dev-workflow/commands/review-cycle.md', 10)]);
  assert.equal(r.lines, 10);
  assert.deepEqual(r.files.map((f) => f.path), ['commands/review-cycle.md']);
  assert.equal(classify([file('codex/plugins/dev-workflow/skills/x/SKILL.md', 500)]).questions, 0);
  assert.equal(classify([]).questions, 0);
});

check('malformed file entries are rejected', () => {
  for (const bad of [null, {}, [{ path: '' }], [{ path: 'a', additions: -1, deletions: 0 }], [{ path: 'a', additions: 1.5, deletions: 0 }], [{ path: 'a', additions: '1', deletions: 0 }]]) {
    assert.throws(() => classify(bad), /files/, JSON.stringify(bad));
  }
});

const temporary = mkdtempSync(path.join(os.tmpdir(), 'merge-brief-'));
try {
  const run = (...args) => spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8' });
  const input = path.join(temporary, 'pr.json');
  writeFileSync(input, JSON.stringify({ files: [file('hooks/install-hooks.sh', 12, 3), file('README.md', 4)] }));
  check('tier --input prints the classification as JSON', () => {
    const r = run('tier', '--input', input);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.tier, 'sensitive');
    assert.equal(out.questions, 4);
    assert.equal(out.lines, 19);
  });
  check('the CLI rejects missing or valueless options and bad input', () => {
    for (const argv of [['tier'], ['tier', '--pr'], ['tier', '--input'], ['tier', '--pr', 'x'], ['tier', '--pr', '1', '--repo'], ['tier', '--pr', '1', '--repo', 'bad'], ['other', '--input', input]]) {
      const r = run(...argv);
      assert.notEqual(r.status, 0, argv.join(' '));
      assert.match(r.stderr, /^ERROR: /, argv.join(' '));
    }
    const broken = path.join(temporary, 'broken.json');
    writeFileSync(broken, JSON.stringify({ files: 'nope' }));
    const r = run('tier', '--input', broken);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /files/);
  });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

console.log(`OK: merge-brief (${count} cases)`);
