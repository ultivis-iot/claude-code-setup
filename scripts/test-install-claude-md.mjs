#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installer = path.join(root, 'scripts/install-claude-md.mjs');
const temporary = mkdtempSync(path.join(os.tmpdir(), 'install-claude-md-'));
const MARKER = '# === Claude Code 개발 플로우 설정 ===';
const V1 = '# 설정\n\n- 규칙 A\n- 규칙 B\n\n## 절\n- 항목 1\n';
const V2 = '# 설정\n\n- 규칙 A\n- 규칙 B\n\n## 절\n- 항목 1\n- 항목 2\n';
let count = 0;

function ok(result) { assert.equal(result.status, 0, result.stderr || result.stdout); return result.stdout; }
function fixture(template, { git = false } = {}) {
  const dir = path.join(temporary, `case-${++count}`);
  mkdirSync(path.join(dir, 'repo/templates'), { recursive: true });
  const repo = path.join(dir, 'repo');
  const templatePath = path.join(repo, 'templates/global-claude.md');
  const commit = content => {
    writeFileSync(templatePath, content);
    ok(spawnSync('git', ['-C', repo, 'add', '.']));
    ok(spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'template']));
  };
  if (git) ok(spawnSync('git', ['init', '-q', repo]));
  writeFileSync(templatePath, template);
  const target = path.join(dir, 'CLAUDE.md');
  const state = path.join(dir, 'state');
  const install = (...extra) => ok(spawnSync('node', [installer, target, templatePath, '--state', state, '--repo', repo, ...extra], { encoding: 'utf8' }));
  return { target, state, templatePath, commit, install, read: () => readFileSync(target, 'utf8') };
}

try {
  // 새 파일: 마커와 템플릿을 쓰고 base를 남긴다.
  {
    const f = fixture(V1);
    f.install();
    assert.equal(f.read(), `${MARKER}\n${V1}`);
    assert.equal(readFileSync(path.join(f.state, 'claude-md-base.md'), 'utf8'), V1);
  }
  // 마커 없는 기존 파일: 기존 내용 뒤에 덧붙인다.
  {
    const f = fixture(V1);
    writeFileSync(f.target, '# 개인 설정\n');
    f.install();
    assert.equal(f.read(), `# 개인 설정\n\n${MARKER}\n${V1}`);
  }
  // --update 없이: 설치된 파일을 건드리지 않는다.
  {
    const f = fixture(V1);
    f.install();
    writeFileSync(f.templatePath, V2);
    f.install();
    assert.equal(f.read(), `${MARKER}\n${V1}`);
  }
  // 구역 안에서 직접 고친 줄과 템플릿 변경이 함께 남는다.
  {
    const f = fixture(V1);
    f.install();
    writeFileSync(f.target, `# 위\n${MARKER}\n${V1.replace('- 규칙 B\n', '- 규칙 B\n- 개인 규칙\n')}## 개인 절\n- 내 항목\n`);
    writeFileSync(f.templatePath, V2);
    assert.match(f.install('--update'), /직접 고친 내용 유지/);
    const merged = f.read();
    assert.ok(merged.startsWith(`# 위\n${MARKER}\n`));
    for (const line of ['- 개인 규칙', '## 개인 절', '- 내 항목', '- 항목 2']) assert.ok(merged.includes(line), line);
    assert.equal(readdirSync(path.join(f.state, 'backups')).length, 1);
    assert.equal(readFileSync(path.join(f.state, 'claude-md-base.md'), 'utf8'), V2);
  }
  // 같은 줄을 양쪽에서 고치면 파일은 그대로 두고 충돌본을 남긴다.
  {
    const f = fixture(V1);
    f.install();
    const edited = `${MARKER}\n${V1.replace('- 항목 1', '- 항목 1 (내 수정)')}`;
    writeFileSync(f.target, edited);
    writeFileSync(f.templatePath, V1.replace('- 항목 1', '- 항목 1 (템플릿 수정)'));
    assert.match(f.install('--update'), /충돌/);
    assert.equal(f.read(), edited);
    assert.match(readFileSync(path.join(f.state, 'CLAUDE.md.conflict'), 'utf8'), /<<<<<<<[\s\S]*>>>>>>>/);
    // 사람이 충돌을 해결하면 다음 --update가 남은 충돌본을 지운다.
    writeFileSync(f.target, `${MARKER}\n${V1.replace('- 항목 1', '- 항목 1 (템플릿 수정)')}`);
    f.install('--update');
    assert.ok(!existsSync(path.join(f.state, 'CLAUDE.md.conflict')));
  }
  // base 파일이 없는 기존 설치: git 이력에서 가장 가까운 템플릿을 base로 쓴다.
  {
    const f = fixture(V1, { git: true });
    f.commit(V1);
    f.commit(V2);
    writeFileSync(f.target, `${MARKER}\n${V1}- 개인 항목\n`);
    f.install('--update');
    const merged = f.read();
    assert.ok(merged.includes('- 항목 2') && merged.includes('- 개인 항목'), merged);
  }
  // base도 git 이력도 없으면 업데이트를 건너뛴다.
  {
    const f = fixture(V2);
    const legacy = `${MARKER}\n${V1}- 개인 항목\n`;
    writeFileSync(f.target, legacy);
    f.install('--update');
    assert.equal(f.read(), legacy);
  }
  // CRLF로 저장된 설치본도 병합하고 CRLF를 유지한다.
  {
    const f = fixture(V1);
    f.install();
    writeFileSync(f.target, `${MARKER}\n${V1}- 개인 항목\n`.replace(/\n/g, '\r\n'));
    writeFileSync(f.templatePath, V2);
    assert.match(f.install('--update'), /업데이트 완료/);
    const merged = f.read();
    assert.ok(merged.includes('- 항목 2\r\n') && merged.includes('- 개인 항목\r\n'), JSON.stringify(merged));
    assert.ok(!/[^\r]\n/.test(merged), 'LF만 있는 줄이 섞이지 않는다');
  }
  // 마커만 있고 구역이 비어 있으면(개행 없이 파일 끝 포함) 새 템플릿으로 채운다.
  {
    const f = fixture(V2);
    writeFileSync(f.target, `# 위\n${MARKER}`);
    f.install('--update');
    assert.equal(f.read(), `# 위\n${MARKER}\n${V2}`);
  }
  // 충돌 표시처럼 보이는 개인 줄이 있어도 줄을 잃지 않는다(병합되거나, 해석 불가면 파일 유지).
  {
    const f = fixture(V1);
    f.install();
    const odd = `${MARKER}\n<<<<<<< 현재 CLAUDE.md\n${V1}- 개인 항목\n`;
    writeFileSync(f.target, odd);
    writeFileSync(f.templatePath, V2);
    const output = f.install('--update');
    const result = f.read();
    if (/병합 실패/.test(output)) assert.equal(result, odd);
    else for (const line of ['<<<<<<< 현재 CLAUDE.md', '- 개인 항목', '- 항목 2']) assert.ok(result.includes(line), line);
  }
  console.log(`OK: install-claude-md (${count} cases)`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
