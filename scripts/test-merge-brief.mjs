#!/usr/bin/env node
// merge-brief.mjs (머지 전 이해 확인 질문 수를 정하는 도구) 테스트. 네트워크·gh 불필요.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  const r = classify([file('README.md', 40), file('CHANGELOG.md', 2), file('docs/workflow.md', 10), file('docs/notes.txt')]);
  assert.equal(r.tier, 'docs');
  assert.equal(r.questions, 0);
});

// 이 저장소에서는 agent 가 읽는 참조 문서·명령·스킬 Markdown 이 동작을 정한다.
check('reference docs, commands and skills count as code', () => {
  for (const p of ['docs/references/create-pr-contract.md', 'commands/review-cycle.md', 'codex/skills/ultivis-flow/SKILL.md']) {
    assert.equal(classify([file(p)]).tier, 'code', p);
  }
});

// 문서는 저장소 최상위의 README·CHANGELOG·LICENSE 와 docs/(docs/references/ 제외)뿐이다. agent 가 읽는 트리 안의 README·.txt 는 문서가 아니다.
check('docs are only top-level notes and docs/ outside references', () => {
  for (const p of ['commands/README.md', 'commands/CHANGELOG.md', 'codex/skills/ultivis-flow/references/prompt.txt', 'templates/notes.txt']) {
    assert.notEqual(classify([file(p)]).tier, 'docs', p);
  }
  assert.equal(classify([file('docs/notes.txt'), file('LICENSE'), file('docs/guide.rst')]).tier, 'docs');
  // 문서 자리라도 텍스트 문서가 아니면 문서가 아니다
  for (const p of ['docs/tools/run.mjs', 'README.sh', 'LICENSE.mjs', 'CHANGELOG.json']) assert.notEqual(classify([file(p)]).tier, 'docs', p);
});

check('a small code change asks one question, larger changes ask up to three', () => {
  assert.equal(classify([file('scripts/review-metrics.mjs', 20, 5)]).questions, 1);
  assert.equal(classify([file('scripts/a.mjs', 100, 51)]).questions, 2);
  assert.equal(classify(['a', 'b', 'c', 'd', 'e', 'f'].map((n) => file(`scripts/${n}.mjs`))).questions, 2);
  const big = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => file(`scripts/${n}.mjs`, 30));
  assert.equal(classify(big).questions, 3);
  assert.deepEqual(classify(big).reasons.slice(1), ['바뀐 줄 180', '파일 6개']);
  // 경계: 150줄·5개 파일은 더하지 않는다.
  assert.equal(classify([file('scripts/a.mjs', 150)]).questions, 1);
  assert.equal(classify(['a', 'b', 'c', 'd', 'e'].map((n) => file(`scripts/${n}.mjs`))).questions, 1);
});

check('validation, install, hook and permission paths ask four, five when large', () => {
  for (const p of ['hooks/install-hooks.sh', 'scripts/validation-gate.mjs', 'setup.sh', 'setup.ps1', 'scripts/install-settings.mjs',
    'schemas/validation-status.schema.json', 'agents/security-validator.md', '.github/workflows/ci.yml',
    'src/auth/login.ts', 'config/secrets.yaml', 'src/permissions.ts', 'lib/token-store.js', 'db/migrations/001.sql',
    // 리뷰·검증 게이트와 그 도구, 자격 증명을 다루는 Notion 스크립트, 에이전트 설정도 민감 경로다(어느 깊이든)
    'scripts/review-findings.mjs', 'scripts/merge-brief.mjs', 'scripts/graft.mjs', 'scripts/verify-workflow.sh', 'scripts/sync-workflow.mjs',
    'scripts/ult-notion.mjs', 'scripts/lib/notion.mjs', '.claude/settings.json', '.codex/config.toml',
    'codex/plugins/dev-workflow/hooks/hooks.json', 'codex/plugins/dev-workflow/.codex-plugin/plugin.json', 'HOOKS/pre-push',
    // 디렉터리 이름으로 든 설치·설정·게이트·인증, 자격 증명·환경 파일, 패키지·hook 설정, 사용자 설정에 설치되는 지시문
    'scripts/install/run.mjs', 'scripts/installer/run.sh', 'scripts/setup/x.sh', 'scripts/gate/run.mjs', 'src/authentication/x.ts', 'src/oauth.ts', 'src/authn/x.ts', 'src/authz/x.ts',
    '.env', 'config/.env.production', 'src/credentials.json', 'src/apikey.ts', 'src/password.ts', 'src/keychain.ts',
    '.husky/pre-commit', 'package.json', '.npmrc', 'Makefile', 'scripts/ult-flow.mjs', 'scripts/review-cycle-ralph-loop.mjs', 'scripts/review_findings.mjs',
    'templates/global-claude.md', 'CLAUDE.md']) {
    const r = classify([file(p)]);
    assert.equal(r.tier, 'sensitive', p);
    assert.equal(r.questions, 4, p);
  }
  // 이름에 단어로 든 경우만 민감하다(author·tokenizer 는 아님)
  for (const p of ['docs/references/author-guide.md', 'scripts/tokenizer.mjs']) assert.equal(classify([file(p)]).tier, 'code', p);
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

// 생성본은 같은 PR 에서 원본도 바뀌었을 때만 원본과 같은 내용으로 보고 다시 세지 않는다.
check('a generated copy is skipped only when its source changed in the same PR', () => {
  const r = classify([file('commands/review-cycle.md', 10), file('codex/plugins/dev-workflow/commands/review-cycle.md', 10),
    file('codex/skills/ultivis-flow/SKILL.md', 3), file('codex/plugins/dev-workflow/skills/ultivis-flow/SKILL.md', 3)]);
  // 생성본 줄도 바뀐 줄로 센다(파일 수에서만 뺀다). 원본과 다른 내용을 생성본에 숨겨 줄 기준을 낮추지 못하게.
  assert.equal(r.lines, 26);
  assert.deepEqual(r.files.map((f) => f.path), ['commands/review-cycle.md', 'codex/skills/ultivis-flow/SKILL.md']);
  // 원본 없이 생성본 자리만 바뀌었으면 그대로 센다. 생성본 트리 밖(hooks·manifest)은 생성본이 아니다.
  assert.equal(classify([file('codex/plugins/dev-workflow/skills/x/SKILL.md', 500)]).questions, 2);
  const hidden = classify([file('hooks/x.sh', 1), file('codex/plugins/dev-workflow/hooks/x.sh', 5000)]);
  assert.equal(hidden.lines, 5001);
  assert.equal(hidden.questions, 5);
  const bigCopy = classify([file('codex/skills/x/SKILL.md', 1), file('codex/plugins/dev-workflow/skills/x/SKILL.md', 5000)]);
  assert.equal(bigCopy.questions, 2);
  assert.equal(classify([]).questions, 0);
});

// 이름을 바꾼 파일은 이전 경로도 분류에 쓴다(민감 파일을 docs/ 로 옮겨 질문을 줄이지 못하게).
check('a renamed file is classified by its old path as well', () => {
  const r = classify([{ path: 'docs/notes.md', previous_path: 'hooks/pre-push', additions: 0, deletions: 0 }]);
  assert.equal(r.tier, 'sensitive');
  // 새 경로만 민감하거나 코드여도 그 분류를 쓴다
  assert.equal(classify([{ path: 'hooks/a.sh', previous_path: 'docs/a.md', additions: 0, deletions: 0 }]).tier, 'sensitive');
  assert.equal(classify([{ path: 'scripts/a.mjs', previous_path: 'docs/a.md', additions: 0, deletions: 0 }]).tier, 'code');
  assert.equal(classify([{ path: 'docs/a.md', previous_path: 'scripts/a.mjs', additions: 0, deletions: 0 }]).tier, 'code');
  assert.equal(classify([{ path: 'docs/a.md', previous_path: null, additions: 1, deletions: 0 }]).tier, 'docs');
});

check('malformed file entries are rejected', () => {
  assert.throws(() => classify(undefined), /files 는/);
  assert.throws(() => classify([{ path: '', additions: 1, deletions: 0 }]), /files 는/);
  for (const bad of [null, {}, [{ path: '' }], [{ path: 'a', additions: -1, deletions: 0 }], [{ path: 'a', additions: 1.5, deletions: 0 }], [{ path: 'a', additions: '1', deletions: 0 }],
    [{ path: 'a', previous_path: '', additions: 1, deletions: 0 }], [{ path: 'a', previous_path: 3, additions: 1, deletions: 0 }]]) {
    assert.throws(() => classify(bad), /files 는 \{path/, JSON.stringify(bad));
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
    // 각 오류는 gh 를 부르기 전에 그 검사의 메시지로 멈춘다(gh 가 없어도 같은 결과).
    for (const [argv, message] of [[['tier'], /--pr <번호> 또는 --input/], [['tier', '--pr'], /--pr 에 값이/], [['tier', '--input'], /--input 에 값이/],
      [['tier', '--pr', 'x'], /--pr 은 PR 번호/], [['tier', '--pr', '1', '--repo'], /--repo 에 값이/], [['tier', '--pr', '1', '--repo', 'bad'], /--repo 는 owner\/name/],
      [['other', '--input', input], /사용법/]]) {
      const r = spawnSync(process.execPath, [tool, ...argv], { encoding: 'utf8', env: { ...process.env, PATH: '' } });
      assert.notEqual(r.status, 0, argv.join(' '));
      assert.match(r.stderr, /^ERROR: /, argv.join(' '));
      assert.match(r.stderr, message, argv.join(' '));
    }
    const broken = path.join(temporary, 'broken.json');
    writeFileSync(broken, JSON.stringify({ files: 'nope' }));
    const r = run('tier', '--input', broken);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /files/);
    // 읽을 수 없는 입력도 스택 트레이스가 아니라 ERROR 한 줄로 멈춘다
    writeFileSync(broken, '{not json');
    for (const argv of [['tier', '--input', broken], ['tier', '--input', path.join(temporary, 'missing.json')]]) {
      const bad = run(...argv);
      assert.notEqual(bad.status, 0);
      assert.match(bad.stderr, /^ERROR: /);
    }
  });

  // gh 를 거치는 실제 경로: REST 의 파일 목록(이전 경로 포함)과 PR 의 changed_files 를 대조한다. POSIX 에서만 PATH 의 gh 를 바꿀 수 있다.
  check('tier --pr reads REST files with old paths and stops when the list is truncated', () => {
    if (process.platform === 'win32') { console.log('  SKIP gh 경로는 PATH 의 gh 를 바꾸는 POSIX shim 이 필요하다'); return; }
    const bin = path.join(temporary, 'bin');
    mkdirSync(bin, { recursive: true });
    const files = [{ filename: 'docs/moved.md', previous_filename: 'hooks/pre-push', additions: 0, deletions: 0 }, { filename: 'README.md', additions: 3, deletions: 1 }];
    writeFileSync(path.join(bin, 'gh'), `#!${process.execPath}
const args = process.argv.slice(2);
const out = (s) => process.stdout.write(s + '\\n');
if (args[0] === 'api' && args.includes('repos/o/r/pulls/7') && args.includes('.changed_files')) out(process.env.FAKE_CHANGED || '2');
else if (args[0] === 'api' && args.includes('--paginate') && args.includes('repos/o/r/pulls/7/files?per_page=100')) {
  for (const f of ${JSON.stringify(files)}) out(JSON.stringify({ path: f.filename, previous_path: f.previous_filename ?? null, additions: f.additions, deletions: f.deletions }));
}
else { process.stderr.write('unexpected gh ' + args.join(' ')); process.exit(1); }
`, { mode: 0o755 });
    const tier = (env = {}) => spawnSync(process.execPath, [tool, 'tier', '--pr', '7', '--repo', 'o/r'], { encoding: 'utf8', env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, ...env } });
    const ok = tier();
    assert.equal(ok.status, 0, ok.stderr);
    const out = JSON.parse(ok.stdout);
    assert.equal(out.tier, 'sensitive');
    assert.equal(out.lines, 4);
    const truncated = tier({ FAKE_CHANGED: '3500' });
    assert.notEqual(truncated.status, 0);
    assert.match(truncated.stderr, /^ERROR: .*3500/);
  });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

console.log(`OK: merge-brief (${count} cases)`);
