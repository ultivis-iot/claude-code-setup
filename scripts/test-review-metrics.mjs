#!/usr/bin/env node
// review-metrics.mjs (기계 리뷰 지표 집계) 테스트. 네트워크·gh 불필요.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregate, formatMarkdown, gitChangedNear, summarize } from './review-metrics.mjs';

const tool = path.join(path.dirname(fileURLToPath(import.meta.url)), 'review-metrics.mjs');
let count = 0;
const check = (name, fn) => {
  try { fn(); } catch (e) { console.error(`FAIL: ${name}`); throw e; }
  count++;
};

const H = (n) => String(n).repeat(40);
const report = (fields) => `## 🤖 AI Code Review Report\n\n<!-- ocr-review:v1 ${JSON.stringify({ version: 1, completeness: 'complete', findings: [], ...fields })} -->`;
const finding = (id, fields = {}) => ({
  id, aliases: [], locations: [{ file: 'a.mjs', line: 10 }], severity: 'medium', kind: 'defect',
  provenance: 'introduced', verification: 'confirmed', status: 'open', carried: false, ...fields,
});
const bot = (id, at, body) => ({ id, created_at: at, login: 'isaac-notion-bot', body });

// 3라운드 PR: 1라운드 지적 2건, 2라운드에 하나는 해결·하나는 이어짐·새 지적 2건(하나는 이전 코드), 3라운드는 바뀐 부분만.
const comments = [
  bot(1, '2026-10-27T01:00:00Z', report({ head_sha: H(1), round: 1, findings: [
    finding('f-a'), finding('f-b', { severity: 'high' }),
  ] })),
  bot(2, '2026-10-27T01:30:00Z', 'Notion Task 를 연결했습니다.'),
  bot(3, '2026-10-27T02:00:00Z', report({ head_sha: H(2), parent_head_sha: H(1), round: 2, findings: [
    finding('f-a', { status: 'resolved', carried: true }),
    finding('f-b2', { aliases: ['f-b'], carried: true, severity: 'high' }),
    finding('f-c', { locations: [{ file: 'a.mjs', line: 50 }] }),
    finding('f-d', { locations: [{ file: 'b.mjs', line: 5 }], verification: 'rejected' }),
    finding('f-e', { provenance: 'pre_existing', kind: 'test_gap', severity: 'low' }),
  ] })),
  // 같은 HEAD 를 다시 리뷰한 보고서는 같은 라운드다(마지막 것을 쓴다)
  bot(4, '2026-10-27T02:10:00Z', report({ head_sha: H(2), parent_head_sha: H(1), round: 2, findings: [
    finding('f-a', { status: 'resolved', carried: true }),
    finding('f-b2', { aliases: ['f-b'], carried: true, severity: 'high' }),
    finding('f-c', { locations: [{ file: 'a.mjs', line: 50 }] }),
    finding('f-d', { locations: [{ file: 'b.mjs', line: 5 }], verification: 'rejected' }),
    finding('f-e', { provenance: 'pre_existing', kind: 'test_gap', severity: 'low' }),
  ] })),
  bot(5, '2026-10-27T03:00:00Z', report({ head_sha: H(3), parent_head_sha: H(2), round: 3, review_mode: 'incremental', earlier_code_findings: 2, findings: [
    finding('f-b2', { aliases: ['f-b'], carried: true, status: 'resolved', severity: 'high' }),
    finding('f-f', { locations: [{ file: 'a.mjs', line: 70 }], kind: 'style', severity: 'low' }),
  ] })),
];
const ledger = { decisions: {
  'f-a': { decision: 'fixed' },
  'f-b': { decision: 'fixed' },          // 별칭으로 기록해도 같은 원인
  'f-c': { decision: 'wrong' },
  'f-f': { decision: 'intentional' },
} };
// 2라운드의 새 지적 중 f-c 는 직전 HEAD 이후 바뀐 줄 밖(이전 코드), f-d 는 바뀐 줄, f-e 는 알 수 없음.
const changedNear = (parent, head, location) => ({ 50: false, 5: true }[location.line] ?? null);

check('findings are grouped by cause across rounds and aliases', () => {
  const s = summarize({ pr: 7, comments, ledger, changedNear });
  assert.equal(s.findings.total, 6);  // f-a, f-b(=f-b2), f-c, f-d, f-e, f-f
  assert.deepEqual(s.findings.by_severity, { medium: 3, high: 1, low: 2 });
  assert.deepEqual(s.findings.by_kind, { defect: 4, test_gap: 1, style: 1 });
});

check('rounds count reviewed heads; retries of a head are one round', () => {
  const s = summarize({ pr: 7, comments, ledger, changedNear });
  assert.equal(s.rounds, 3);
  assert.equal(s.round_cap_reached, true);
  assert.deepEqual(s.new_per_round, [2, 3, 1]);
  assert.equal(s.final.open, 1);  // f-f (해결·오탐·기존 코드 제외)
});

check('bot verdicts use the latest report each cause appears in', () => {
  const s = summarize({ pr: 7, comments, ledger, changedNear });
  assert.deepEqual(s.bot, { rejected: 1, pre_existing: 1, resolved: 2 });
});

check('human decisions come from the ledger, matched by id or alias', () => {
  const s = summarize({ pr: 7, comments, ledger, changedNear });
  assert.deepEqual(s.human, { fixed: 2, wrong: 1, intentional: 1, irrelevant: 0, undecided: 2 });
});

check('later-round findings are split into changed code, earlier code and unknown', () => {
  const s = summarize({ pr: 7, comments, ledger, changedNear });
  // 2라운드(전체 리뷰): f-c 이전 코드, f-d 바뀐 줄, f-e 모름. 3라운드(바뀐 부분만): f-f 바뀐 줄, 뺀 2건은 이전 코드.
  assert.deepEqual(s.later_rounds, { new: 4, changed_code: 2, earlier_code: 1, unknown: 1, dropped_as_earlier: 2 });
});

check('blocks pasted by other accounts are ignored', () => {
  const pasted = { id: 9, created_at: '2026-10-27T04:00:00Z', login: 'someone', body: report({ head_sha: H(4), round: 4, findings: [finding('fake')] }) };
  const s = summarize({ pr: 7, comments: [...comments, pasted], ledger, changedNear });
  assert.equal(s.rounds, 3);
  assert.equal(s.findings.total, 6);
});

check('a decision recorded only under an alias counts for its cause', () => {
  const s = summarize({ pr: 7, comments, ledger: { decisions: { 'f-b2': { decision: 'wrong' } } }, changedNear });
  assert.equal(s.human.wrong, 1);
  assert.equal(s.human.undecided, 5);
});

check('a PR without bot reports is counted as not reviewed', () => {
  const s = summarize({ pr: 8, comments: [bot(1, 't', 'hello')], ledger: { decisions: {} } });
  assert.equal(s.rounds, 0);
  assert.equal(s.findings.total, 0);
});

check('aggregate sums PRs and computes the rates', () => {
  const one = summarize({ pr: 7, comments, ledger, changedNear });
  const clean = summarize({ pr: 9, comments: [bot(1, 't', report({ head_sha: H(9), round: 1 }))], ledger: { decisions: {} } });
  const all = aggregate([one, clean]);
  assert.equal(all.prs, 2);
  assert.equal(all.findings.total, 6);
  assert.equal(all.rates.false_positive, 1 / 4);   // wrong ÷ 판정한 것
  assert.equal(all.rates.bot_rejected, 1 / 6);
  assert.equal(all.rates.earlier_code_in_later_rounds, (1 + 2) / (2 + 1 + 2));  // 알 수 없음 제외
  assert.deepEqual(all.rounds, { max: 3, mean: 2, cap_reached: 1, clean_first_round: 1 });
  const md = formatMarkdown(all, [one, clean]);
  assert.match(md, /\| #7 \| 3 \|/);
  assert.match(md, /오탐률/);
});

const dir = mkdtempSync(path.join(os.tmpdir(), 'review-metrics-'));
try {
  check('cli reads --input and prints JSON', () => {
    const input = path.join(dir, 'input.json');
    writeFileSync(input, JSON.stringify({ prs: [{ pr: 7, comments, ledger }] }));
    const r = spawnSync(process.execPath, [tool, '--input', input, '--json'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.total.findings.total, 6);
    assert.equal(out.prs[0].later_rounds.unknown, 3);  // --input 에는 git 비교가 없어 전체 리뷰 라운드는 모름
  });
  // 블록의 SHA 는 리뷰 봇이 쓴 값이다. git 옵션처럼 보이는 값은 git 에 넘기지 않는다(--output 으로 파일을 쓰지 못하게).
  check('block SHAs that look like git options are never passed to git', () => {
    const victim = path.join(dir, 'victim.txt');
    writeFileSync(victim, 'keep\n');
    const near = gitChangedNear();
    assert.equal(near(`--output=${victim}`, 'a'.repeat(40), { file: 'x', line: 1 }), null);
    assert.equal(near('a'.repeat(40), `--output=${victim}`, { file: 'x', line: 1 }), null);
    assert.equal(readFileSync(victim, 'utf8'), 'keep\n');
  });
  // 실제 git 저장소로 바뀐 줄 ±3 경계를 확인한다(전체 리뷰 라운드의 이전 코드 판정이 여기서 나온다).
  check('git changed-line check uses a three-line margin around changed hunks', () => {
    const repo = path.join(dir, 'repo');
    const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
    mkdirSync(repo, { recursive: true });
    git('init', '-q');
    writeFileSync(path.join(repo, 'a.mjs'), Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
    git('add', '-A'); git('commit', '-qm', 'base');
    const parent = git('rev-parse', 'HEAD').stdout.trim();
    writeFileSync(path.join(repo, 'a.mjs'), Array.from({ length: 30 }, (_, i) => (i + 1 === 15 ? 'changed' : `line ${i + 1}`)).join('\n') + '\n');
    git('commit', '-qam', 'change line 15');
    const head = git('rev-parse', 'HEAD').stdout.trim();
    const cwd = process.cwd();
    process.chdir(repo);
    try {
      const near = gitChangedNear();
      assert.equal(near(parent, head, { file: 'a.mjs', line: 12 }), true);
      assert.equal(near(parent, head, { file: 'a.mjs', line: 18 }), true);
      assert.equal(near(parent, head, { file: 'a.mjs', line: 11 }), false);
      assert.equal(near(parent, head, { file: 'a.mjs', line: 19 }), false);
      assert.equal(near(parent, 'f'.repeat(40), { file: 'a.mjs', line: 15 }), null);  // 로컬에 없는 커밋
    } finally {
      process.chdir(cwd);
    }
  });
  check('cli rejects bad arguments', () => {
    const bad = path.join(dir, 'bad.json');
    writeFileSync(bad, '{');
    const r = spawnSync(process.execPath, [tool, '--input', bad], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /읽을 수 없습니다/);
    const badBot = spawnSync(process.execPath, [tool, '--input', bad, '--bot', 'a;b'], { encoding: 'utf8' });
    assert.equal(badBot.status, 1);
    assert.match(badBot.stderr, /--bot 은 GitHub 로그인/);
    assert.equal(spawnSync(process.execPath, [tool], { encoding: 'utf8' }).status, 1);
    assert.equal(spawnSync(process.execPath, [tool, '--pr', '7;rm'], { encoding: 'utf8' }).status, 1);
    const badRepo = spawnSync(process.execPath, [tool, '--pr', '7', '--repo', '../x'], { encoding: 'utf8' });
    assert.equal(badRepo.status, 1);
    assert.match(badRepo.stderr, /--repo 는 owner\/name/);
    assert.match(spawnSync(process.execPath, [tool, '--pr', '7;rm'], { encoding: 'utf8' }).stderr, /--pr/);
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`OK: review-metrics (${count} cases)`);
