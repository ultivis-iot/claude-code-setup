#!/usr/bin/env node
// install-settings.mjs (settings.json hook 설치·예전 .sh hook 마이그레이션) 테스트.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tool = path.join(path.dirname(fileURLToPath(import.meta.url)), 'install-settings.mjs');
const dir = mkdtempSync(path.join(os.tmpdir(), 'install-settings-'));
const NEW = 'node ~/.claude/hooks/copy-plan-on-accept.mjs';
const OLD = '~/.claude/hooks/copy-plan-on-accept.sh';
let count = 0;
const run = (file) => {
  const r = spawnSync(process.execPath, [tool, file, NEW], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  count++;
  return r.stdout.trim();
};
const load = (file) => JSON.parse(readFileSync(file, 'utf8'));
try {
  // 1. 파일 없음 → 생성
  const created = path.join(dir, 'new', 'settings.json');
  assert.equal(run(created), 'created');
  assert.equal(load(created).hooks.PostToolUse[0].hooks[0].command, NEW);
  assert.equal(load(created).enabledPlugins['security-guidance@claude-plugins-official'], true);
  assert.equal(run(created), 'unchanged');

  // 2. hooks 없음 → 추가, 다른 설정 보존
  const plain = path.join(dir, 'plain.json');
  writeFileSync(plain, JSON.stringify({ model: 'opus', permissions: { allow: ['Bash(git:*)'] } }));
  assert.equal(run(plain), 'added');
  const added = load(plain);
  assert.equal(added.model, 'opus');
  assert.deepEqual(added.permissions, { allow: ['Bash(git:*)'] });
  assert.equal(added.hooks.PostToolUse[0].hooks[0].command, NEW);

  // 3. 예전 .sh hook → 새 command 로 이전, 사용자 hook 은 보존
  const legacy = path.join(dir, 'legacy.json');
  writeFileSync(legacy, JSON.stringify({
    hooks: {
      PostToolUse: [
        { matcher: 'ExitPlanMode', hooks: [{ type: 'command', command: OLD, timeout: 10 }] },
        { matcher: 'Bash', hooks: [{ type: 'command', command: '~/my-own-hook.sh' }] },
      ],
      Stop: [{ hooks: [{ type: 'command', command: '/abs/.claude/hooks/copy-plan-on-accept.sh' }] }],
    },
  }));
  assert.equal(run(legacy), 'migrated:2');
  const migrated = load(legacy);
  assert.equal(migrated.hooks.PostToolUse[0].hooks[0].command, NEW);
  assert.equal(migrated.hooks.PostToolUse[0].hooks[0].timeout, 10);
  assert.equal(migrated.hooks.PostToolUse[1].hooks[0].command, '~/my-own-hook.sh');
  assert.equal(migrated.hooks.Stop[0].hooks[0].command, NEW);
  assert.equal(run(legacy), 'unchanged');

  // 4. 사용자 hook 만 있으면 그대로 둔다
  const custom = path.join(dir, 'custom.json');
  const customBody = JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] } });
  writeFileSync(custom, customBody);
  assert.equal(run(custom), 'unchanged');
  assert.equal(readFileSync(custom, 'utf8'), customBody);

  // 5. 깨진 JSON 은 건드리지 않고 종료 코드 0
  const broken = path.join(dir, 'broken.json');
  writeFileSync(broken, '{ "hooks": ');
  assert.equal(run(broken), 'unchanged-invalid');
  assert.equal(readFileSync(broken, 'utf8'), '{ "hooks": ');

  // 6. 인자 부족은 사용법과 함께 실패
  const usage = spawnSync(process.execPath, [tool], { encoding: 'utf8' });
  assert.equal(usage.status, 2);
  assert.ok(!existsSync(path.join(dir, 'undefined')));
  console.log(`OK: install-settings (${count} cases)`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
