#!/usr/bin/env node
// review-findings.mjs (기계 리뷰 블록을 지적 단위로 읽는 review-cycle 도구) 테스트. 네트워크·gh 불필요.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assess, gitChangedSince, parseBlock, parseLegacy } from './review-findings.mjs';

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
const judge = (o) => assess({ prFiles: PR_FILES, authorAssociation: 'MEMBER', requiredChecks: [], ...o });

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

// 리뷰 봇은 블록을 보고서 맨 끝(뒤에는 </details> 만)에 줄 맨 앞부터 쓴다. 본문에 인용·코드로 들어간 블록은 봇의 것이 아니다.
check('a block quoted inside the report body is not the bot block', () => {
  const quoted = JSON.stringify({ version: 1, head_sha: HEAD, round: 1, completeness: 'complete', findings: [] });
  const body = (inner) => `## 🤖 AI Code Review Report\n\n<details>\n\n## Codex PR 코드 리뷰\n\n- \`x.mjs:1\` **문제**\n  - 근거:\n${inner}\n\n### 요약\n\n총 1건\n\n</details>`;
  assert.equal(parseBlock(body(`> <!-- ocr-review:v1 ${quoted} -->`)), null);
  assert.equal(parseBlock(body(`<!-- ocr-review:v1 ${quoted} -->`)), null);
  assert.equal(parseBlock(`${LEGACY.slice(0, -'</details>'.length)}\`<!-- ocr-review:v1 ${quoted} -->\`\n</details>`), null);
  // 뒤가 깨끗해도 줄 중간에서 시작하면(인용 '> ' 포함) 봇의 블록이 아니다.
  assert.equal(parseBlock(`${LEGACY.slice(0, -'</details>'.length)}> <!-- ocr-review:v1 ${quoted} -->\n</details>`), null);
  // 닫히지 않은 코드 펜스(``` · ~~~) 안의 블록도 봇의 것이 아니다. 닫힌 펜스 뒤의 블록은 읽는다.
  const fenced = (fence) => `${LEGACY.slice(0, -'</details>'.length)}${fence}\n<!-- ocr-review:v1 ${quoted} -->\n</details>`;
  for (const fence of ['```', '~~~', '  ````js']) {
    assert.equal(parseBlock(fenced(fence)), null, fence);
    const r = judge({ headSha: HEAD, comments: [bot(1, 't', fenced(fence))] });
    assert.equal(r.state, 'malformed_report', fence);
    assert.equal(r.complete, false);
  }
  // 더 짧은 펜스나 다른 문자로는 닫히지 않는다.
  assert.equal(parseBlock(fenced('````\n```')), null);
  assert.equal(parseBlock(fenced('```\n~~~')), null);
  // 뒤에 글자가 붙은 펜스(``` js)는 닫는 펜스가 아니다. CRLF 본문도 같은 규칙이다.
  assert.equal(parseBlock(fenced('```\n``` js')), null);
  assert.equal(parseBlock(fenced('```').replace(/\n/g, '\r\n')), null);
  // CR 만 쓴 줄바꿈, 펜스 뒤의 U+2028·U+2029 도 펜스를 숨기지 못한다.
  for (const fence of ['```\rquoted', '~~~\r', '```\u2028x', '```\u2029x']) assert.equal(parseBlock(fenced(fence)), null, JSON.stringify(fence));
  // 닫는 펜스 뒤에는 공백·탭만 올 수 있다. NBSP·U+2028·U+2029·VT·BOM 이 붙은 줄은 펜스를 닫지 않는다(LF·CRLF).
  for (const closer of ['```\u00a0', '```\u2028', '```\u2029', '```\u000b', '```\ufeff']) {
    for (const body of [fenced(`\`\`\`\n${closer}`), fenced(`\`\`\`\n${closer}`).replace(/\n/g, '\r\n')]) {
      assert.equal(parseBlock(body), null, JSON.stringify(closer));
      assert.notEqual(judge({ headSha: HEAD, comments: [bot(1, 't', body)] }).state, 'clear');
    }
  }
  assert.equal(parseBlock(fenced('```\n``` \t')).head_sha, HEAD);
  assert.equal(parseBlock(`${LEGACY.slice(0, -'</details>'.length)}\`\`\`\ncode\n\`\`\`\n<!-- ocr-review:v1 ${quoted} -->\n</details>`).head_sha, HEAD);
  const r = judge({ headSha: HEAD, comments: [bot(1, 't', body(`> <!-- ocr-review:v1 ${quoted} -->`))] });
  assert.equal(r.complete, false);
  assert.notEqual(r.state, 'clear');
  // 실제 보고서 모양(블록 뒤 </details>, CRLF 포함)은 그대로 읽는다.
  assert.equal(parseBlock(PRODUCTION.replace(/\n/g, '\r\n')).head_sha, '4fec245267abbfc4526a4c69e9d84be46b77f42d');
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

// PR #24 기계 리뷰 2라운드 지적(finding-3e0c0e2a5242c202, finding-c8753cb5b3f79974, finding-52b344ebb487bbca)의 회귀 테스트
check('a later non-report bot comment does not replace the report', () => {
  const r = judge({ headSha: HEAD, comments: [
    bot(1, '2026-10-27T01:00:00Z', block({ head_sha: HEAD })),
    bot(2, '2026-10-27T02:00:00Z', 'Notion Task 를 연결했습니다.'),
  ] });
  assert.equal(r.state, 'clear');
  assert.equal(r.report.comment_id, 1);
  assert.equal(judge({ headSha: HEAD, comments: [bot(1, 't', 'Notion Task 를 연결했습니다.')] }).state, 'no_review');
});

check('a location without a positive integer line is malformed', () => {
  const bad = [undefined, null, '10', 0, -1, 1.5, {}];
  const r = judge({ headSha: HEAD, comments: [bot(1, 't', block({ head_sha: HEAD, findings: bad.map((line, i) => finding(`l${i}`, { locations: [{ file: 'a.mjs', line }] })) }))] });
  assert.deepEqual(r.needs_user.map((f) => f.hold), bad.map(() => 'malformed finding'));
  assert.deepEqual(r.to_fix, []);
});

check('a PR head that is not available locally counts as changed', () => {
  const local = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  assert.equal(gitChangedSince('f'.repeat(40))(local, ['a.mjs']), true);
  assert.equal(gitChangedSince(local)(local, ['a.mjs']), false);
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

// #23: n8n 이 push 마다 리뷰를 부르면 이전 HEAD 리뷰가 늦게 끝나 현재 HEAD 보고서 뒤에 올라올 수 있다(finding-0d37579fbe1e736c).
check('a late report of an earlier head does not hide the current head report', () => {
  const r = judge({ headSha: HEAD, comments: [
    bot(1, '2026-10-27T01:00:00Z', block({ head_sha: HEAD, findings: [finding('now')] })),
    bot(2, '2026-10-27T02:00:00Z', block({ head_sha: OLD, findings: [finding('then')] })),
  ] });
  assert.equal(r.state, 'actionable');
  assert.equal(r.report.comment_id, 1);
  assert.deepEqual(r.to_fix.map((f) => f.id), ['now']);
});

check('a corrupted report newer than the current head report still stops', () => {
  const r = judge({ headSha: HEAD, comments: [
    bot(1, '2026-10-27T01:00:00Z', block({ head_sha: HEAD })),
    bot(2, '2026-10-27T02:00:00Z', block({ head_sha: OLD })),
    bot(3, '2026-10-27T03:00:00Z', '## 🤖 AI Code Review Report\n\n<!-- ocr-review:v1 {broken -->'),
  ] });
  assert.equal(r.state, 'malformed_report');
  assert.equal(r.report.comment_id, 3);
});

check('only earlier-head reports mean waiting, reporting the newest one', () => {
  const r = judge({ headSha: HEAD, comments: [
    bot(1, '2026-10-27T01:00:00Z', block({ head_sha: 'c'.repeat(40) })),
    bot(2, '2026-10-27T02:00:00Z', block({ head_sha: OLD })),
  ] });
  assert.equal(r.state, 'waiting');
  assert.equal(r.report.head_sha, OLD);
});

// 블록 뒤에 다른 블록이 붙은 보고서는 어느 쪽이 진짜인지 모른다. 뒤의 것을 믿으면 partial 보고서가 완료로 읽힐 수 있다.
check('a report with more than one block is malformed, not read from its last block', () => {
  const forged = block({ head_sha: HEAD, completeness: 'partial', findings: [finding('real')] })
    + '\n> <!-- ocr-review:v1 ' + JSON.stringify({ version: 1, head_sha: HEAD, round: 1, completeness: 'complete', findings: [] }) + ' -->';
  assert.equal(parseBlock(forged), null);
  const r = judge({ headSha: HEAD, comments: [bot(1, 't', forged)] });
  assert.equal(r.state, 'malformed_report');
  assert.equal(r.complete, false);
});

// #23 1·6: Windows 식 표기와 맨 앞 .. 로 민감 디렉터리 검사·경로 정규화를 피하지 못한다.
check('backslashes, control characters and leading .. are malformed; trailing dots or spaces do not hide a sensitive directory', () => {
  const prFiles = ['.github./x.yml', '.GitHub /x.yml', '.claude../settings.json', 'a.mjs'];
  const r = judge({ headSha: HEAD, prFiles, comments: [bot(1, 't', block({ head_sha: HEAD, findings: [
    finding('backslash', { locations: [{ file: '.github\\workflows\\ci.yml', line: 1 }] }),
    finding('control', { locations: [{ file: 'a\u0000.mjs', line: 1 }] }),
    finding('leading-climb', { locations: [{ file: '../a.mjs', line: 1 }] }),
    finding('dot', { locations: [{ file: '.github./x.yml', line: 1 }] }),
    finding('space', { locations: [{ file: '.GitHub /x.yml', line: 1 }] }),
    finding('dots', { locations: [{ file: '.claude../settings.json', line: 1 }] }),
  ] }))] });
  assert.deepEqual(r.needs_user.map((f) => f.hold), ['malformed finding', 'malformed finding', 'malformed finding', 'sensitive path', 'sensitive path', 'sensitive path']);
  assert.deepEqual(r.to_fix, []);
});

// #23: 대상 브랜치의 필수 check 가 있으면 그 check 가 현재 HEAD 에서 성공해야 완료다.
// push 직후 check 가 아직 없는 순간(checks 0건)을 완료로 보지 않고, 필수 check 를 모르면 완료로 보지 않는다.
check('required checks must be present and green; unknown requirements are never complete', () => {
  const clean = [bot(1, 't', block({ head_sha: HEAD }))];
  const none = judge({ headSha: HEAD, comments: clean, requiredChecks: [] });
  assert.equal(none.complete, true);  // CI 없는 저장소
  const notYet = judge({ headSha: HEAD, comments: clean, requiredChecks: ['ci'] });
  assert.equal(notYet.state, 'clear');
  assert.equal(notYet.complete, false);
  assert.deepEqual(notYet.checks.missing_required, ['ci']);
  const green = judge({ headSha: HEAD, comments: clean, requiredChecks: ['ci', 'lint'], checks: [{ name: 'ci', conclusion: 'SUCCESS' }, { name: 'lint', state: 'SUCCESS' }] });
  assert.equal(green.complete, true);
  assert.deepEqual(green.checks.required, ['ci', 'lint']);
  const red = judge({ headSha: HEAD, comments: clean, requiredChecks: ['ci'], checks: [{ name: 'ci', conclusion: 'FAILURE' }, { name: 'other', conclusion: 'SUCCESS' }] });
  assert.equal(red.complete, false);
  assert.deepEqual(red.checks.missing_required, ['ci']);
  const unknown = judge({ headSha: HEAD, comments: clean, requiredChecks: null });
  assert.equal(unknown.complete, false);
  assert.equal(unknown.checks.required_unknown, true);
  // 호출자가 필수 check 를 넘기지 않으면 모르는 것으로 본다
  assert.equal(assess({ headSha: HEAD, comments: clean, prFiles: PR_FILES, authorAssociation: 'MEMBER' }).complete, false);
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
  // PR HEAD 는 임시 저장소의 실제 커밋이어야 한다(로컬에 없는 PR HEAD 는 바뀐 것으로 본다).
  const writeInput = () => {
    const head = git('rev-parse', 'HEAD').stdout.trim();
    writeFileSync(input, JSON.stringify({ head_sha: head, files: ['a.mjs'], author_association: 'OWNER', comments: [bot(1, 't', block({ head_sha: head, findings: [finding('f1')] }))] }));
  };
  writeInput();
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
    writeInput();
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
  // #23 4: 객체의 특수 키도 다른 id 처럼 저장하고 다시 읽는다(finding-8965d6560f06c829).
  check('cli records reserved-looking ids instead of losing them', () => {
    const head = git('rev-parse', 'HEAD').stdout.trim();
    const special = ['__proto__', 'constructor', 'toString'];
    writeFileSync(input, JSON.stringify({ head_sha: head, files: ['a.mjs'], author_association: 'OWNER',
      comments: [bot(1, 't', block({ head_sha: head, findings: special.map((id) => finding(id)) }))] }));
    for (const id of special) assert.equal(run('record', '--pr', '19', '--id', id, '--decision', 'intentional', '--reason', 'r').status, 0);
    const ledger = readFileSync(path.join(dir, 'tmp', 'review-findings-19.json'), 'utf8');
    for (const id of special) assert.match(ledger, new RegExp(`"${id}": \\{`));
    const r = JSON.parse(run('status', '--pr', '19', '--input', input).stdout);
    assert.deepEqual(r.declined.map((f) => f.id).sort(), [...special].sort());
    writeInput();
  });
  // #23 2: 값을 빠뜨린 옵션이 기본값이나 "true" 로 통과하지 않는다.
  check('cli rejects options given without a value', () => {
    assert.equal(run('record', '--pr', '18', '--id', 'f1', '--decision', 'wrong', '--reason', 'r', '--commit').status, 1);
    for (const option of ['--round-cap', '--bot', '--repo', '--input']) {
      const argv = option === '--input' ? ['status', '--pr', '18', option] : ['status', '--pr', '18', '--input', input, option];
      const r = run(...argv);
      assert.equal(r.status, 1, option);
      assert.match(r.stderr, new RegExp(option), option);
    }
    assert.equal(run('status', '--pr', '18', '--input', input, '--round-cap', '2.0').status, 1);
    assert.equal(run('status', '--pr', '18', '--input', input, '--round-cap', '02').status, 1);
  });
  // #23 7: gh 를 거치는 실제 로딩 경로. POSIX 에서만 PATH 의 gh 를 가짜로 바꿀 수 있다.
  check('cli status reads head, files, checks, comments and author through gh', () => {
    if (process.platform === 'win32') { console.log('  SKIP gh 로딩 경로는 PATH 의 gh 를 바꾸는 POSIX shim 이 필요하다'); return; }
    const head = git('rev-parse', 'HEAD').stdout.trim();
    const bin = path.join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    const calls = path.join(dir, 'gh-calls.log');
    const view = { headRefOid: head, baseRefName: 'main', files: [{ path: 'a.mjs' }], statusCheckRollup: [{ name: 'ci', conclusion: 'FAILURE' }, { context: 'lint', state: 'SUCCESS' }] };
    const rules = [{ type: 'deletion' }, { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'lint' }] } }];
    const comments = [{ id: 7, created_at: 't', login: 'isaac-notion-bot', body: block({ head_sha: head, findings: [finding('via-gh')] }) }];
    writeFileSync(path.join(bin, 'gh'), `#!${process.execPath}
const args = process.argv.slice(2);
require('node:fs').appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');
const out = (s) => process.stdout.write(s + '\\n');
if (args[0] === 'pr' && args[1] === 'view') out(${JSON.stringify(JSON.stringify(view))});
else if (args[0] === 'api' && args[1].endsWith('/comments')) for (const c of ${JSON.stringify(comments)}) out(JSON.stringify(c));
else if (args[0] === 'api' && args[1].includes('/pulls/')) out('MEMBER');
else if (args[0] === 'api' && args[1] === 'repos/o/r/rules/branches/main?per_page=100') {
  if (process.env.FAKE_RULES === 'fail') { process.stderr.write('gh: Server Error (HTTP 500)'); process.exit(1); }
  out(process.env.FAKE_RULES || ${JSON.stringify(JSON.stringify(rules))});
}
else if (args[0] === 'api' && args[1] === 'repos/o/r/branches/main/protection/required_status_checks') {
  if (process.env.FAKE_PROTECTION === 'forbidden') { process.stderr.write('gh: Resource not accessible (HTTP 403)'); process.exit(1); }
  if (process.env.FAKE_PROTECTION) out(process.env.FAKE_PROTECTION);
  else { process.stderr.write('gh: Branch not protected (HTTP 404)'); process.exit(1); }
}
else { process.stderr.write('unexpected gh ' + args.join(' ')); process.exit(1); }
`, { mode: 0o755 });
    const status = (env = {}) => {
      const r = spawnSync(process.execPath, [tool, 'status', '--pr', '21', '--repo', 'o/r'], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, ...env } });
      assert.equal(r.status, 0, r.stderr);
      return JSON.parse(r.stdout);
    };
    const out = status();
    assert.equal(out.head_sha, head);
    assert.deepEqual(out.to_fix.map((f) => f.id), ['via-gh']);  // MEMBER 이고 PR 파일 안이라 자동 수정 대상
    // rulesets 의 필수 check(lint)와 브랜치 보호(404 = 없음)를 합친다
    assert.deepEqual(out.checks, { total: 2, not_passed: ['ci'], required: ['lint'], missing_required: [], required_unknown: false });
    // 브랜치 보호의 필수 check 도 더한다(contexts 와 checks 둘 다)
    const both = status({ FAKE_PROTECTION: JSON.stringify({ contexts: ['build'], checks: [{ context: 'e2e' }] }) });
    assert.deepEqual(both.checks.required, ['lint', 'build', 'e2e']);
    assert.deepEqual(both.checks.missing_required, ['build', 'e2e']);
    // 404 가 아닌 오류는 '모름' 이고 완료로 보지 않는다
    assert.equal(status({ FAKE_PROTECTION: 'forbidden' }).checks.required_unknown, true);
    // 조회 실패·깨진 응답·꽉 찬 페이지는 모두 '모름' 이고 완료가 아니다
    for (const env of [{ FAKE_RULES: 'fail' }, { FAKE_RULES: 'not json' }, { FAKE_RULES: JSON.stringify(Array.from({ length: 100 }, () => ({ type: 'deletion' }))) },
      { FAKE_PROTECTION: 'not json' }, { FAKE_PROTECTION: 'null' },
      // 안쪽 모양이 틀린 응답도 '필수 check 없음' 이 아니라 모름이다(finding-c5b8afbc59922ae2)
      { FAKE_RULES: JSON.stringify([{ type: 'required_status_checks', parameters: {} }]) },
      { FAKE_RULES: JSON.stringify([{ type: 'required_status_checks', parameters: { required_status_checks: 'ci' } }]) },
      { FAKE_RULES: JSON.stringify([{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: '' }] } }]) },
      { FAKE_PROTECTION: '{}' }, { FAKE_PROTECTION: JSON.stringify({ contexts: 'ci' }) },
      { FAKE_PROTECTION: JSON.stringify({ contexts: [], checks: [{ context: 5 }] }) }]) {
      const r = status(env);
      assert.equal(r.checks.required_unknown, true, JSON.stringify(env));
      assert.equal(r.complete, false, JSON.stringify(env));
    }
    // 필수 check 가 하나도 없으면(빈 rules, 보호 404) 보이는 checks 만으로 판정한다
    const noneRequired = status({ FAKE_RULES: '[]' });
    assert.deepEqual([noneRequired.checks.required, noneRequired.checks.required_unknown], [[], false]);
    const asked = readFileSync(calls, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(asked.some((a) => a[0] === 'pr' && a.includes('o/r')), 'pr view uses --repo');
    assert.ok(asked.some((a) => a[1] === 'repos/o/r/issues/21/comments'));
    assert.ok(asked.some((a) => a[1] === 'repos/o/r/pulls/21'));
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
