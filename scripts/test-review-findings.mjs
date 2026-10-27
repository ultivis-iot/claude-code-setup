#!/usr/bin/env node
// review-findings.mjs (기계 리뷰 블록을 지적 단위로 읽는 review-cycle 도구) 테스트. 네트워크·gh 불필요.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assess, parseBlock, parseLegacy } from './review-findings.mjs';

const tool = path.join(path.dirname(fileURLToPath(import.meta.url)), 'review-findings.mjs');
const HEAD = 'b'.repeat(40), OLD = 'a'.repeat(40);
let count = 0;
const check = (name, fn) => {
  try { fn(); } catch (e) { console.error(`FAIL: ${name}`); throw e; }
  count++;
};

const block = (fields) => `## 🤖 AI Code Review Report\n\n<details>\n\n<!-- ocr-review:v1 ${JSON.stringify({ version: 1, completeness: 'complete', round: 1, findings: [], ...fields })} -->\n\n</details>`;
const finding = (id, fields = {}) => ({
  id, aliases: [], locations: [{ file: 'a.mjs', line: 10, side: 'RIGHT' }], severity: 'medium',
  provenance: 'introduced', verification: 'confirmed', status: 'open', title: `t-${id}`, ...fields,
});
const bot = (id, at, body) => ({ id, created_at: at, login: 'isaac-notion-bot', body });
// 저장소 구성원이 연 PR 이고 지적 위치가 모두 PR 파일 안인 기본 상황. 경계 검사는 아래 케이스가 따로 본다.
const PR_FILES = ['a.mjs', 'b.mjs', 'scripts/other.mjs'];
const judge = (o) => assess({ prFiles: PR_FILES, authorAssociation: 'MEMBER', ...o });

// 실제 운영 보고서의 모양(PR #20, A0–A5 적용 브리지): <details> 안에 블록이 있다.
const PRODUCTION = '## 🤖 AI Code Review Report\n\n### 📝 Summary\n리뷰 대상 1개 파일의 변경 (+38/-0)을 검토했고 보고할 문제 0건을 확인했습니다.\n\n<details>\n<summary><b>💡 Detailed Review (Click to expand)</b></summary>\n\n## Codex PR 코드 리뷰\n\n보고할 문제를 발견하지 못했습니다.\n\n<!-- ocr-review:v1 {"version":1,"head_sha":"4fec245267abbfc4526a4c69e9d84be46b77f42d","round":1,"completeness":"complete","findings":[]} -->\n\n</details>';
// 블록이 생기기 전 보고서의 모양(PR #7): 요약 목록이 상세 리뷰를 되풀이한다. 요약 쪽에도 상세와 같은 형식의
// 줄이 있어야 '상세 영역만 읽는다' 는 규칙을 실제로 검사한다.
const LEGACY = '## 🤖 AI Code Review Report\n\n### ⚠️ Potential Risks\n- [HIGH] x.mjs:65 요약에만 있는 줄\n\n### 높음\n\n- `x.mjs:1` **요약 영역의 같은 형식 줄**\n\n<details>\n\n## Codex PR 코드 리뷰\n\n### 높음\n\n- `x.mjs:65` **설정을 검증하지 않음**\n  - 근거\n\n### 보통\n\n- `x.mjs:376` **백업을 덮어씀**\n  - 근거\n\n### 요약\n\n총 2건의 문제를 발견했습니다.\n\n</details>';

check('parses the production block', () => {
  const b = parseBlock(PRODUCTION);
  assert.equal(b.head_sha, '4fec245267abbfc4526a4c69e9d84be46b77f42d');
  assert.equal(b.completeness, 'complete');
  assert.equal(parseBlock('no block'), null);
  assert.equal(parseBlock('<!-- ocr-review:v1 {broken -->'), null);
  assert.equal(parseBlock('<!-- ocr-review:v1 {"version":2,"head_sha":"x"} -->'), null);
});

check('legacy reports are read from the detailed section only', () => {
  const found = parseLegacy(LEGACY);
  assert.deepEqual(found.map((f) => [f.severity, f.locations[0].line]), [['high', 65], ['medium', 376]]);
  assert.equal(found[0].id, parseLegacy(LEGACY)[0].id);  // 읽을 때마다 같은 id
});

check('no bot report yet', () => {
  assert.equal(judge({ headSha: HEAD, comments: [{ id: 1, login: 'someone', body: block({ head_sha: HEAD }) }] }).state, 'no_review');
});

check('a report of an earlier head means the current head is still being reviewed', () => {
  const r = judge({ headSha: HEAD, comments: [bot(1, '2026-10-27T01:00:00Z', block({ head_sha: OLD, findings: [finding('f1')] }))] });
  assert.equal(r.state, 'waiting');
  assert.deepEqual(r.to_fix, []);
  assert.equal(r.complete, false);
});

check('legacy report is reference only, never completion', () => {
  const r = judge({ headSha: HEAD, comments: [bot(1, '2026-10-27T01:00:00Z', LEGACY)] });
  assert.equal(r.state, 'legacy');
  assert.equal(r.needs_user.length, 2);
  assert.equal(r.complete, false);
});

// PR #24 기계 리뷰 지적(finding-9044a1a45687a68b, finding-0378897aba292916)의 회귀 테스트
check('a corrupted newest report does not fall back to an older one', () => {
  const r = judge({ headSha: HEAD, comments: [
    bot(1, '2026-10-27T01:00:00Z', block({ head_sha: HEAD })),
    bot(2, '2026-10-27T02:00:00Z', '## 🤖 AI Code Review Report\n\n<!-- ocr-review:v1 {"version":1,"head_sha":"' + HEAD + '","findi -->'),
  ] });
  assert.equal(r.state, 'malformed_report');
  assert.equal(r.complete, false);
  assert.equal(r.report.comment_id, 2);
});

check('a report whose top-level fields are wrong is never complete', () => {
  const broken = [
    { findings: null }, { findings: {} }, { findings: 'none' }, { findings: undefined },
    { round: undefined }, { round: '3' }, { round: -1 }, { round: 1.5 }, { round: 0 },
    { completeness: 'done' }, { completeness: undefined },
  ];
  for (const fields of broken) {
    const r = judge({ headSha: HEAD, comments: [bot(1, 't', block({ head_sha: HEAD, ...fields }))] });
    assert.equal(r.state, 'malformed_report', JSON.stringify(fields));
    assert.equal(r.complete, false, JSON.stringify(fields));
  }
});

check('findings are split by what review-cycle may do with them', () => {
  const r = judge({ headSha: HEAD, comments: [bot(1, '2026-10-27T01:00:00Z', block({ head_sha: HEAD, findings: [
    finding('fix'),
    finding('carried', { carried: true, provenance: 'ported' }),
    finding('unverified', { verification: 'unverified' }),
    finding('again', { status: 'unknown' }),
    finding('old-code', { provenance: 'pre_existing' }),
    finding('wrong', { verification: 'rejected' }),
    finding('done', { status: 'resolved' }),
  ] }))] });
  assert.equal(r.state, 'actionable');
  assert.deepEqual(r.to_fix.map((f) => f.id), ['fix', 'carried', 'again']);
  assert.deepEqual(r.needs_user.map((f) => f.id), ['unverified']);
  assert.deepEqual([r.pre_existing, r.rejected, r.resolved].map((l) => l.map((f) => f.id)), [['old-code'], ['wrong'], ['done']]);
  assert.equal(r.to_fix[0].file, 'a.mjs');
});

check('the newest report for the current head wins', () => {
  const r = judge({ headSha: HEAD, comments: [
    bot(2, '2026-10-27T02:00:00Z', block({ head_sha: HEAD, findings: [] })),
    bot(1, '2026-10-27T01:00:00Z', block({ head_sha: HEAD, findings: [finding('stale')] })),
  ] });
  assert.equal(r.report.comment_id, 2);
  assert.equal(r.state, 'clear');
  assert.equal(r.complete, true);
});

check('partial reports hand everything to the user and are not completion', () => {
  const r = judge({ headSha: HEAD, comments: [bot(1, 't', block({ head_sha: HEAD, completeness: 'partial', findings: [finding('f')] }))] });
  assert.equal(r.state, 'needs_user');
  assert.equal(r.complete, false);
  const empty = judge({ headSha: HEAD, comments: [bot(1, 't', block({ head_sha: HEAD, completeness: 'partial' }))] });
  assert.equal(empty.complete, false);
});

check('declined findings are skipped, by id or alias; fixed ones that come back are reopened', () => {
  const ledger = { decisions: {
    'old-id': { decision: 'intentional', reason: 'documented in PR body', head_sha: OLD },
    'fixed-id': { decision: 'fixed', reason: 'guard added', commit: 'c1' },
  } };
  const r = judge({ headSha: HEAD, ledger, comments: [bot(1, 't', block({ head_sha: HEAD, findings: [
    finding('new-id', { aliases: ['old-id'] }),
    finding('fixed-id'),
  ] }))] });
  assert.deepEqual(r.declined.map((f) => [f.id, f.decision.decision]), [['new-id', 'intentional']]);
  assert.deepEqual(r.to_fix.map((f) => [f.id, f.reopened?.decision]), [['fixed-id', 'fixed']]);
});

check('a declined finding reopens when its files changed since the decision', () => {
  const ledger = { decisions: {
    same: { decision: 'wrong', reason: 'guarded', head_sha: OLD },
    touched: { decision: 'intentional', reason: 'by design', head_sha: OLD },
    unknown: { decision: 'irrelevant', reason: 'minor' },  // head_sha 를 저장하기 전의 기록
  } };
  const asked = [];
  const changedSince = (head, files) => { asked.push([head, files]); return files.includes('b.mjs'); };
  const r = judge({ headSha: HEAD, ledger, changedSince, comments: [bot(1, 't', block({ head_sha: HEAD, findings: [
    finding('same'),
    finding('touched', { locations: [{ file: 'a.mjs', line: 1 }, { file: 'b.mjs', line: 2 }] }),
    finding('unknown'),
  ] }))] });
  assert.deepEqual(r.declined.map((f) => f.id), ['same']);
  assert.deepEqual(r.to_fix.map((f) => [f.id, f.reopened?.reason]), [['touched', 'files changed since decision'], ['unknown', 'decision has no recorded head']]);
  assert.deepEqual(asked[0], [OLD, ['a.mjs']]);
});

check('only findings with a known provenance are fixed automatically', () => {
  const r = judge({ headSha: HEAD, comments: [bot(1, 't', block({ head_sha: HEAD, findings: [
    finding('uncertain', { provenance: 'uncertain' }),
    finding('unlabelled', { provenance: null }),
    finding('future', { provenance: 'something_new' }),
  ] }))] });
  assert.deepEqual(r.to_fix.map((f) => f.id), ['uncertain']);
  assert.deepEqual(r.needs_user.map((f) => f.id), ['unlabelled', 'future']);
});

check('findings the review bot may have been steered to are held for the user', () => {
  const r = judge({ headSha: HEAD, prFiles: ['a.mjs', '.github/workflows/ci.yml'], comments: [bot(1, 't', block({ head_sha: HEAD, findings: [
    finding('in-pr'),
    finding('elsewhere', { locations: [{ file: 'a.mjs', line: 1 }, { file: 'scripts/other.mjs', line: 2 }] }),
    finding('workflow', { locations: [{ file: '.github/workflows/ci.yml', line: 3 }] }),
    { id: 42, locations: [{ file: 'a.mjs' }] },
    finding('option', { locations: [{ file: '--output=/tmp/x', line: 1 }] }),
  ] }))] });
  assert.deepEqual(r.to_fix.map((f) => f.id), ['in-pr']);
  assert.deepEqual(r.needs_user.map((f) => f.hold), ['outside PR files', 'sensitive path', 'malformed finding', 'malformed finding']);
  // PR 파일 목록이나 작성자를 모르면 고치지 않는다(fail-closed)
  const one = [bot(1, 't', block({ head_sha: HEAD, findings: [finding('x')] }))];
  assert.equal(assess({ headSha: HEAD, comments: one, authorAssociation: 'MEMBER' }).needs_user[0].hold, 'PR files unknown');
  assert.equal(assess({ headSha: HEAD, comments: one, prFiles: PR_FILES }).needs_user[0].hold, 'untrusted author');
  assert.equal(judge({ headSha: HEAD, comments: one, authorAssociation: 'CONTRIBUTOR' }).needs_user[0].hold, 'untrusted author');
});

check('paths must be canonical and sensitive directories are matched case-insensitively', () => {
  const r = judge({ headSha: HEAD, prFiles: ['.GitHub/workflows/x.yml', '.codex/config.toml', 'a.mjs'], comments: [bot(1, 't', block({ head_sha: HEAD, findings: [
    finding('dot-slash', { locations: [{ file: './a.mjs', line: 1 }] }),
    finding('climb', { locations: [{ file: 'b/../.github/x', line: 1 }] }),
    finding('absolute', { locations: [{ file: '/repo/a.mjs', line: 1 }] }),
    finding('upper', { locations: [{ file: '.GitHub/workflows/x.yml', line: 1 }] }),
    finding('codex', { locations: [{ file: '.codex/config.toml', line: 1 }] }),
  ] }))] });
  assert.deepEqual(r.needs_user.map((f) => f.hold), ['malformed finding', 'malformed finding', 'malformed finding', 'sensitive path', 'sensitive path']);
  assert.deepEqual(r.to_fix, []);
});

check('ledger lookups ignore inherited object keys', () => {
  const r = judge({ headSha: HEAD, comments: [bot(1, 't', block({ head_sha: HEAD, findings: [finding('constructor')] }))] });
  assert.equal(r.to_fix[0].reopened, undefined);
});

check('round cap stops fixing while findings remain; a clean report at the cap still completes', () => {
  const capped = judge({ headSha: HEAD, comments: [bot(1, 't', block({ head_sha: HEAD, round: 3, findings: [finding('left')] }))] });
  assert.equal(capped.round_cap_reached, true);
  assert.equal(capped.state, 'round_cap');
  assert.equal(capped.complete, false);
  assert.deepEqual(capped.to_fix.map((f) => f.id), ['left']);  // 보고용 목록이고 고치지 않는다
  const clean = judge({ headSha: HEAD, comments: [bot(1, 't', block({ head_sha: HEAD, round: 3 }))] });
  assert.equal(clean.state, 'clear');
  assert.equal(clean.complete, true);
  const pending = judge({ headSha: HEAD, checks: [{ name: 'ci', conclusion: '', state: 'PENDING' }], comments: [bot(1, 't', block({ head_sha: HEAD }))] });
  assert.equal(pending.state, 'clear');
  assert.equal(pending.complete, false);
  assert.deepEqual(pending.checks.not_passed, ['ci']);
});

// CLI: status 는 gh 대신 --input 을 읽고, record 는 저장소의 tmp/ 에 처리 이력을 쓴다.
const dir = mkdtempSync(path.join(os.tmpdir(), 'review-findings-'));
try {
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  writeFileSync(path.join(dir, 'a.mjs'), 'one\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
  const input = path.join(dir, 'input.json');
  writeFileSync(input, JSON.stringify({ head_sha: HEAD, files: ['a.mjs'], author_association: 'OWNER', comments: [bot(1, 't', block({ head_sha: HEAD, findings: [finding('f1')] }))] }));
  const run = (...argv) => spawnSync(process.execPath, [tool, ...argv], { cwd: dir, encoding: 'utf8' });

  check('cli status', () => {
    const r = run('status', '--pr', '18', '--input', input);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).to_fix[0].id, 'f1');
  });
  check('cli record then status declines the finding', () => {
    const rec = run('record', '--pr', '18', '--id', 'f1', '--decision', 'wrong', '--reason', 'guarded at a.mjs:9');
    assert.equal(rec.status, 0, rec.stderr);
    const ledger = JSON.parse(readFileSync(path.join(dir, 'tmp', 'review-findings-18.json'), 'utf8'));
    assert.equal(ledger.decisions.f1.decision, 'wrong');
    assert.equal(JSON.parse(run('status', '--pr', '18', '--input', input).stdout).state, 'clear');
  });
  check('cli reopens the declined finding once its file changes', () => {
    writeFileSync(path.join(dir, 'a.mjs'), 'two\n');
    git('commit', '-qam', 'touch a.mjs');
    const r = JSON.parse(run('status', '--pr', '18', '--input', input).stdout);
    assert.equal(r.state, 'actionable');
    assert.equal(r.to_fix[0].reopened.reason, 'files changed since decision');
  });
  check('cli stop-loop removes the Ralph Loop state file only', () => {
    const state = path.join(dir, '.claude', 'ralph-loop.local.md');
    mkdirSync(path.dirname(state), { recursive: true });
    writeFileSync(state, '---\niteration: 2\n---\n');
    assert.deepEqual(JSON.parse(run('stop-loop').stdout), { stopped: true });
    assert.equal(existsSync(state), false);
    assert.deepEqual(JSON.parse(run('stop-loop').stdout), { stopped: false });
  });
  check('cli rejects bad input', () => {
    assert.equal(run('status', '--pr', '18', '--input', input, '--repo', 'a/b;rm').status, 1);
    assert.equal(run('status', '--pr', '18', '--input', input, '--repo', '../..').status, 1);
    assert.equal(run('status', '--pr', '18', '--input', input, '--round-cap', 'abc').status, 1);
    assert.equal(run('status', '--pr', '18', '--input', input, '--round-cap', '0').status, 1);
    assert.equal(run('record', '--pr', '18', '--id', 'f1', '--decision', 'maybe', '--reason', 'x').status, 1);
    assert.equal(run('record', '--pr', '18', '--id', 'f1', '--decision', 'fixed').status, 1);
    assert.equal(run('status', '--pr', 'x', '--input', input).status, 1);
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`OK: review-findings (${count} cases)`);
