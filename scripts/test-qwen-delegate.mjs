#!/usr/bin/env node
// plugins/qwen-delegate 실행기(delegate.mjs) 테스트 — 가짜 pi 로 상태 판정·인자·설정 병합을 검사한다.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tool = path.join(root, 'plugins/qwen-delegate/skills/qwen-delegate/scripts/delegate.mjs');
const dir = mkdtempSync(path.join(os.tmpdir(), 'qwen-delegate-'));
const bin = path.join(dir, 'bin');
const work = path.join(dir, 'work');
const piDir = path.join(dir, 'pi');
const argvLog = path.join(dir, 'argv.json');
mkdirSync(bin); mkdirSync(work); mkdirSync(piDir);

// 시나리오별로 Pi 의 JSON 이벤트를 흉내 낸다. 받은 인자는 argv.json 에 남긴다.
writeFileSync(path.join(bin, 'pi'), `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(argvLog)}, JSON.stringify(process.argv.slice(2)));
const s = process.env.FAKE_PI;
const say = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const msg = (extra) => say({ type: 'message_end', message: { role: 'assistant', provider: 'ultivis', model: 'ultivis-vl',
  usage: { input: 1000, output: 200 }, ...extra } });
if (s === 'hang') { setTimeout(() => {}, 60000); return; }
say({ type: 'tool_execution_start', toolName: 'read' });
say({ type: 'tool_execution_end', toolName: 'grep', isError: true });
if (s === 'ok') { msg({ stopReason: 'toolUse', content: [{ type: 'thinking', thinking: 'x' }] });
  msg({ stopReason: 'stop', usage: { input: 3000, output: 500 }, content: [{ type: 'text', text: '보고서 본문' }] }); }
if (s === 'length') msg({ stopReason: 'length', content: [{ type: 'thinking', thinking: 'long' }] });
if (s === 'empty') msg({ stopReason: 'stop', content: [] });
if (s === 'other-model') msg({ stopReason: 'stop', model: 'gpt-x', provider: 'cloud', content: [{ type: 'text', text: 'r' }] });
if (s === 'crash') { process.stderr.write('boom'); process.exit(3); }
`);
chmodSync(path.join(bin, 'pi'), 0o755);

const env = (extra = {}) => ({ ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOME: dir,
  XDG_STATE_HOME: path.join(dir, 'state'), PI_CODING_AGENT_DIR: piDir, ...extra });
const call = (args, extra) => spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8', env: env(extra) });
const run = (scenario, args = []) => {
  const r = call(['run', '--cwd', work, '--effort', 'xhigh', '--task', '검토해줘', ...args], { FAKE_PI: scenario });
  return { code: r.status, res: r.stdout.trim() ? JSON.parse(r.stdout) : null, stderr: r.stderr };
};
const writeModels = (maxTokens) => writeFileSync(path.join(piDir, 'models.json'), JSON.stringify({ providers: {
  ultivis: { baseUrl: 'http://x/v1', apiKey: '${ULTIVIS_API_KEY}', models: [{ id: 'ultivis-vl', maxTokens }] } } }));
let count = 0;
const ok = () => count++;

try {
  writeModels(65536);

  // 1. 정상 완료 — 마지막 답·도구·토큰을 모으고, 리뷰 모드는 읽기 도구만 넘긴다
  let { code, res } = run('ok');
  assert.equal(code, 0); assert.equal(res.status, 'completed'); assert.equal(res.report, '보고서 본문');
  assert.deepEqual(res.tool_calls, { read: 1 }); assert.deepEqual(res.tool_errors, ['Tool failed: grep']);
  assert.equal(res.output_tokens, 700); assert.equal(res.peak_input_tokens, 3000); assert.equal(res.reasoning_blocks, 1);
  assert.deepEqual(res.warnings, []);
  let argv = JSON.parse(readFileSync(argvLog, 'utf8'));
  assert.deepEqual(argv.slice(argv.indexOf('--thinking'), argv.indexOf('--thinking') + 2), ['--thinking', 'xhigh']);
  assert.deepEqual(argv.slice(argv.indexOf('--tools'), argv.indexOf('--tools') + 2), ['--tools', 'read,grep,find,ls']);
  assert.ok(argv.at(-1).includes('검토해줘') && argv.at(-2) === '--');
  assert.ok(existsSync(path.join(res.run_dir, 'result.json')));
  assert.equal(statSync(res.run_dir).mode & 0o777, 0o700);
  ok();

  // 2. 구현 모드는 도구를 제한하지 않는다
  ({ res } = run('ok', ['--mode', 'implement']));
  argv = JSON.parse(readFileSync(argvLog, 'utf8'));
  assert.equal(res.mode, 'implement'); assert.ok(!argv.includes('--tools'));
  ok();

  // 3. 응답 한도에서 잘림 → output_limit (빈 답을 완료로 읽지 않는다)
  ({ code, res } = run('length'));
  assert.equal(code, 1); assert.equal(res.status, 'output_limit'); assert.equal(res.stop_reason, 'length');
  assert.match(res.hint, /maxTokens/);
  ok();

  // 4. 빈 답·비정상 종료·다른 모델
  assert.equal(run('empty').res.status, 'empty_response');
  ({ code, res } = run('crash'));
  assert.equal(code, 1); assert.equal(res.status, 'failed'); assert.match(res.stderr_tail, /boom/);
  ({ res } = run('other-model'));
  assert.equal(res.status, 'unexpected_model'); assert.match(res.tool_errors.at(-1), /cloud\/gpt-x/);
  ok();

  // 5. 시간 초과 — 프로세스 묶음을 끊고 124
  const started = Date.now();
  ({ code, res } = run('hang', ['--timeout', '1']));
  assert.equal(code, 124); assert.equal(res.status, 'timed_out'); assert.ok(Date.now() - started < 15000);
  ok();

  // 6. effort 는 필수이고 low 는 받지 않는다
  for (const args of [['--effort', 'low'], []]) {
    const r = spawnSync(process.execPath, [tool, 'run', '--cwd', work, '--task', 't', ...args], { encoding: 'utf8', env: env({ FAKE_PI: 'ok' }) });
    assert.equal(r.status, 2); assert.match(r.stderr, /medium 또는 xhigh/);
  }
  ok();

  // 7. xhigh 인데 maxTokens 가 작으면 막지 않고 경고만 남긴다 (medium 은 경고 없음)
  writeModels(32768);
  ({ res } = run('ok'));
  assert.equal(res.status, 'completed'); assert.match(res.warnings[0], /65536/);
  const medium = JSON.parse(call(['run', '--cwd', work, '--effort', 'medium', '--task', 't'], { FAKE_PI: 'ok' }).stdout);
  assert.deepEqual(medium.warnings, []);
  ok();

  // 8. check — maxTokens 부족과 키 누락을 문제로 보고
  let r = call(['check'], { ULTIVIS_API_KEY: '' });
  assert.equal(r.status, 1);
  const report = JSON.parse(r.stdout);
  assert.equal(report.ready, false);
  assert.ok(report.problems.some((p) => p.includes('maxTokens')) && report.problems.some((p) => p.includes('ULTIVIS_API_KEY')));
  ok();

  // 9. setup — 다른 provider·모델은 유지, 키는 참조만, 기존 파일 백업, 다시 돌려도 같은 결과
  const models = path.join(piDir, 'models.json');
  writeFileSync(models, JSON.stringify({ providers: {
    other: { baseUrl: 'http://o', models: [{ id: 'm' }] },
    ultivis: { baseUrl: 'http://old', apiKey: 'KEEP', models: [{ id: 'small' }, { id: 'ultivis-vl', maxTokens: 32768 }] },
  } }));
  assert.equal(call(['setup'], { ULTIVIS_ENDPOINT: '' }).status, 2);
  r = call(['setup'], { ULTIVIS_ENDPOINT: 'http://new/v1' });
  assert.equal(r.status, 0, r.stderr);
  let doc = JSON.parse(readFileSync(models, 'utf8'));
  assert.deepEqual(doc.providers.other, { baseUrl: 'http://o', models: [{ id: 'm' }] });
  assert.equal(doc.providers.ultivis.baseUrl, 'http://new/v1'); assert.equal(doc.providers.ultivis.apiKey, 'KEEP');
  assert.deepEqual(doc.providers.ultivis.models.map((m) => m.id), ['small', 'ultivis-vl']);
  assert.equal(doc.providers.ultivis.models[1].maxTokens, 65536);
  assert.equal(statSync(models).mode & 0o777, 0o600);
  assert.ok(readdirSync(piDir).some((f) => f.startsWith('models.json.bak.')));
  const once = readFileSync(models, 'utf8');
  call(['setup'], { ULTIVIS_ENDPOINT: 'http://new/v1' });
  assert.equal(readFileSync(models, 'utf8'), once);
  rmSync(models);
  call(['setup'], { ULTIVIS_ENDPOINT: 'http://new/v1' });
  doc = JSON.parse(readFileSync(models, 'utf8'));
  assert.equal(doc.providers.ultivis.apiKey, '${ULTIVIS_API_KEY}');
  ok();

  // 10. 깨진 models.json 은 건드리지 않는다
  writeFileSync(models, '{ broken');
  r = call(['setup'], { ULTIVIS_ENDPOINT: 'http://new/v1' });
  assert.equal(r.status, 2); assert.equal(readFileSync(models, 'utf8'), '{ broken');
  ok();

  console.log(`OK: qwen-delegate ${count} groups passed`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
