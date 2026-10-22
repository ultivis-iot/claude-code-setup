#!/usr/bin/env node
// plugins/ultivis-delegate 의 UserPromptSubmit 훅(nudge.mjs) 테스트 — 붙일 요청과 안 붙일 요청, 설정 없을 때.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hook = path.join(root, 'plugins/ultivis-delegate/hooks/nudge.mjs');
const { shouldNudge } = await import(hook);

// 붙인다: 여러 파일을 읽어야 할 리뷰·탐색
for (const p of [
  'conversation_save.py 의 멱등 재시도 경로를 리뷰해줘',
  '인증 토큰 갱신 로직에 버그가 있는지 검토해줘',
  'ToolExecutor 가 어디서 호출되는지 흐름을 파악해줘',
  'Review the retry path in upload_key.py for race conditions',
  'where is derive_document_title used?',
  // 리뷰가 수정 방향을 함께 달라는 것은 구현 요청이 아니다
  'Review conversation_save.py for retry bugs. For each defect give file:line and a fix sketch. Do not modify files.',
  'upload_key.py 를 리뷰하고 결함마다 수정 방향도 알려줘',
]) assert.equal(shouldNudge(p), true, p);

// 안 붙인다: 직접 하라는 말, 구현, 짧은 질문, 슬래시 명령, 사람이 치지 않은 입력(위임 결과 보고 등)
for (const p of [
  '직접 해줘. conversation_save.py 리뷰',
  'upload_key.py 에 재시도 로직 구현해줘',
  '이 버그 고쳐줘',
  'fix the retry bug in upload_key.py',
  '리뷰해서 문제 있으면 수정해줘',
  '_TITLE_MAX_LEN 값이 얼마야?',
  '리뷰',
  '/ultivis-delegate 리뷰해줘',
  '<task-notification> 리뷰 결과: 결함 3건 </task-notification>',
  '[Subagent hand-back] 리뷰 결과입니다',
  'Commit 해줘',
]) assert.equal(shouldNudge(p), false, p);

// 프로세스로: 설정이 있으면 additionalContext JSON, 없으면 아무것도 내지 않는다(실패도 막지 않음)
const dir = mkdtempSync(path.join(os.tmpdir(), 'ultivis-nudge-'));
try {
  const bin = path.join(dir, 'bin');
  const piDir = path.join(dir, 'pi');
  mkdirSync(bin); mkdirSync(piDir);
  writeFileSync(path.join(bin, 'pi'), '#!/bin/sh\necho 1.4.0\n'); chmodSync(path.join(bin, 'pi'), 0o755);
  writeFileSync(path.join(piDir, 'models.json'), JSON.stringify({ providers: { ultivis: { models: [{ id: 'ultivis-vl' }] } } }));
  const run = (prompt, env) => spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt, cwd: dir }), encoding: 'utf8',
    env: { ...process.env, PATH: bin, PI_CODING_AGENT_DIR: piDir, ...env },
  });
  let r = run('conversation_save.py 를 리뷰해줘');
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(out.hookSpecificOutput.additionalContext, /ultivis-delegate:ultivis-delegate/);
  r = run('_TITLE_MAX_LEN 값이 얼마야?');
  assert.equal(r.status, 0); assert.equal(r.stdout, '');
  r = run('conversation_save.py 를 리뷰해줘', { PATH: path.join(dir, 'nopath') });
  assert.equal(r.status, 0); assert.equal(r.stdout, '', '설정이 없으면 안내하지 않는다');
  r = spawnSync(process.execPath, [hook], { input: 'not json', encoding: 'utf8' });
  assert.equal(r.status, 0); assert.equal(r.stdout, '');
  console.log('OK: ultivis-delegate nudge hook');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
