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
const check = (name, fn) => { fn(); count++; void name; };

const block = (fields) => `## 🤖 AI Code Review Report\n\n<details>\n\n<!-- ocr-review:v1 ${JSON.stringify({ version: 1, completeness: 'complete', round: 1, findings: [], ...fields })} -->\n\n</details>`;
const finding = (id, fields = {}) => ({
  id, aliases: [], locations: [{ file: 'a.mjs', line: 10, side: 'RIGHT' }], severity: 'medium',
  provenance: 'introduced', verification: 'confirmed', status: 'open', title: `t-${id}`, ...fields,
});
const bot = (id, at, body) => ({ id, created_at: at, login: 'isaac-notion-bot', body });

// Shape of a real production report (PR #20, bridge after A0–A5): <details> wraps the block.
const PRODUCTION = '## 🤖 AI Code Review Report\n\n### 📝 Summary\n리뷰 대상 1개 파일의 변경 (+38/-0)을 검토했고 보고할 문제 0건을 확인했습니다.\n\n<details>\n<summary><b>💡 Detailed Review (Click to expand)</b></summary>\n\n## Codex PR 코드 리뷰\n\n보고할 문제를 발견하지 못했습니다.\n\n<!-- ocr-review:v1 {"version":1,"head_sha":"4fec245267abbfc4526a4c69e9d84be46b77f42d","round":1,"completeness":"complete","findings":[]} -->\n\n</details>';
// Shape of a report from before the block existed (PR #7): summary list repeats the detailed one.
const LEGACY = '## 🤖 AI Code Review Report\n\n### ⚠️ Potential Risks\n- [HIGH] x.mjs:65 요약에만 있는 줄\n\n<details>\n\n## Codex PR 코드 리뷰\n\n### 높음\n\n- `x.mjs:65` **설정을 검증하지 않음**\n  - 근거\n\n### 보통\n\n- `x.mjs:376` **백업을 덮어씀**\n  - 근거\n\n### 요약\n\n총 2건의 문제를 발견했습니다.\n\n</details>';

check('parses the production block', () => {
  const b = parseBlock(PRODUCTION);
  assert.equal(b.head_sha, '4fec245267abbfc4526a4c69e9d84be46b77f42d');
  assert.equal(b.completeness, 'complete');
  assert.equal(parseBlock('no block'), null);
  assert.equal(parseBlock('<!-- ocr-review:v1 {broken -->'), null);
});

check('legacy reports are read from the detailed section only', () => {
  const found = parseLegacy(LEGACY);
  assert.deepEqual(found.map((f) => [f.severity, f.locations[0].line]), [['high', 65], ['medium', 376]]);
  assert.equal(found[0].id, parseLegacy(LEGACY)[0].id);  // stable across reads
});

check('no bot report yet', () => {
  assert.equal(assess({ headSha: HEAD, comments: [{ id: 1, login: 'someone', body: block({ head_sha: HEAD }) }] }).state, 'no_review');
});

check('a report of an earlier head means the current head is still being reviewed', () => {
  const r = assess({ headSha: HEAD, comments: [bot(1, '2026-10-27T01:00:00Z', block({ head_sha: OLD, findings: [finding('f1')] }))] });
  assert.equal(r.state, 'waiting');
  assert.deepEqual(r.to_fix, []);
  assert.equal(r.complete, false);
});

check('legacy report is reference only, never completion', () => {
  const r = assess({ headSha: HEAD, comments: [bot(1, '2026-10-27T01:00:00Z', LEGACY)] });
  assert.equal(r.state, 'legacy');
  assert.equal(r.needs_user.length, 2);
  assert.equal(r.complete, false);
});

check('findings are split by what review-cycle may do with them', () => {
  const r = assess({ headSha: HEAD, comments: [bot(1, '2026-10-27T01:00:00Z', block({ head_sha: HEAD, findings: [
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
  const r = assess({ headSha: HEAD, comments: [
    bot(2, '2026-10-27T02:00:00Z', block({ head_sha: HEAD, findings: [] })),
    bot(1, '2026-10-27T01:00:00Z', block({ head_sha: HEAD, findings: [finding('stale')] })),
  ] });
  assert.equal(r.report.comment_id, 2);
  assert.equal(r.state, 'clear');
  assert.equal(r.complete, true);
});

check('partial reports hand everything to the user and are not completion', () => {
  const r = assess({ headSha: HEAD, comments: [bot(1, 't', block({ head_sha: HEAD, completeness: 'partial', findings: [finding('f')] }))] });
  assert.equal(r.state, 'needs_user');
  assert.equal(r.complete, false);
  const empty = assess({ headSha: HEAD, comments: [bot(1, 't', block({ head_sha: HEAD, completeness: 'partial' }))] });
  assert.equal(empty.complete, false);
});

check('declined findings are skipped, by id or alias; fixed ones that come back are reopened', () => {
  const ledger = { decisions: {
    'old-id': { decision: 'intentional', reason: 'documented in PR body' },
    'fixed-id': { decision: 'fixed', reason: 'guard added', commit: 'c1' },
  } };
  const r = assess({ headSha: HEAD, ledger, comments: [bot(1, 't', block({ head_sha: HEAD, findings: [
    finding('new-id', { aliases: ['old-id'] }),
    finding('fixed-id'),
  ] }))] });
  assert.deepEqual(r.declined.map((f) => [f.id, f.decision.decision]), [['new-id', 'intentional']]);
  assert.deepEqual(r.to_fix.map((f) => [f.id, f.reopened?.decision]), [['fixed-id', 'fixed']]);
});

check('round cap and checks gate completion', () => {
  const capped = assess({ headSha: HEAD, comments: [bot(1, 't', block({ head_sha: HEAD, round: 3 }))] });
  assert.equal(capped.round_cap_reached, true);
  const pending = assess({ headSha: HEAD, checks: [{ name: 'ci', conclusion: '', state: 'PENDING' }], comments: [bot(1, 't', block({ head_sha: HEAD }))] });
  assert.equal(pending.state, 'clear');
  assert.equal(pending.complete, false);
  assert.deepEqual(pending.checks.not_passed, ['ci']);
});

// CLI: status reads --input instead of gh, record writes the ledger under the repo's tmp/.
const dir = mkdtempSync(path.join(os.tmpdir(), 'review-findings-'));
try {
  spawnSync('git', ['init', '-q'], { cwd: dir });
  const input = path.join(dir, 'input.json');
  writeFileSync(input, JSON.stringify({ head_sha: HEAD, comments: [bot(1, 't', block({ head_sha: HEAD, findings: [finding('f1')] }))] }));
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
  check('cli stop-loop removes the Ralph Loop state file only', () => {
    const state = path.join(dir, '.claude', 'ralph-loop.local.md');
    mkdirSync(path.dirname(state), { recursive: true });
    writeFileSync(state, '---\niteration: 2\n---\n');
    assert.deepEqual(JSON.parse(run('stop-loop').stdout), { stopped: true });
    assert.equal(existsSync(state), false);
    assert.deepEqual(JSON.parse(run('stop-loop').stdout), { stopped: false });
  });
  check('cli rejects bad input', () => {
    assert.equal(run('record', '--pr', '18', '--id', 'f1', '--decision', 'maybe', '--reason', 'x').status, 1);
    assert.equal(run('record', '--pr', '18', '--id', 'f1', '--decision', 'fixed').status, 1);
    assert.equal(run('status', '--pr', 'x', '--input', input).status, 1);
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`OK: review-findings (${count} cases)`);
