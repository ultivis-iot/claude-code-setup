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
    assert.match(readFileSync(path.join(f.state, 'CLAUDE.md.conflict'), 'utf8'), /<{32}[\s\S]*>{32}/);
    // 사람이 충돌을 해결하면 다음 --update가 남은 충돌본을 지운다.
    writeFileSync(f.target, `${MARKER}\n${V1.replace('- 항목 1', '- 항목 1 (템플릿 수정)')}`);
    f.install('--update');
    assert.ok(!existsSync(path.join(f.state, 'CLAUDE.md.conflict')));
  }
  // 개인 줄을 남긴 채 충돌을 해결하면 다음 --update가 그 결과를 받아들이고 base를 새 템플릿으로 바꾼다.
  // 해결하지 않고 다시 돌리면 여전히 충돌로 남는다(미해결본을 최신으로 받아들이지 않는다).
  {
    const OLD = '# 설정\n\n## 긴 절\n- 옛 규칙 1\n- 옛 규칙 2\n';
    const NEW = '# 설정\n\n## 짧은 절\n- 새 규칙\n';
    const f = fixture(OLD);
    f.install();
    const personal = `${MARKER}\n${OLD}## 개인 절\n- 내 항목\n`;
    writeFileSync(f.target, personal);
    writeFileSync(f.templatePath, NEW);
    assert.match(f.install('--update'), /충돌/);
    assert.match(f.install('--update'), /충돌/, '해결하지 않으면 계속 충돌');
    assert.equal(f.read(), personal);
    const resolved = `${MARKER}\n${NEW}\n## 개인 절\n- 내 항목\n`;
    writeFileSync(f.target, resolved);
    assert.doesNotMatch(f.install('--update'), /충돌/);
    assert.equal(f.read(), resolved);
    assert.equal(readFileSync(path.join(f.state, 'claude-md-base.md'), 'utf8'), NEW);
    assert.ok(!existsSync(path.join(f.state, 'CLAUDE.md.conflict')));
    assert.ok(!existsSync(path.join(f.state, 'claude-md-pending.json')));
    // 이후 템플릿 변경은 평소처럼 병합된다.
    writeFileSync(f.templatePath, `${NEW}- 새 규칙 2\n`);
    assert.match(f.install('--update'), /업데이트 완료/);
    assert.ok(f.read().includes('- 새 규칙 2') && f.read().includes('- 내 항목'), f.read());
  }
  // 충돌 뒤 정리본을 반영하지 않고 관계없는 줄만 고치면 정리로 보지 않는다(템플릿 변경을 조용히 버리지 않는다).
  {
    const OLD = '# 설정\n\n## 긴 절\n- 옛 규칙 1\n- 옛 규칙 2\n';
    const NEW = '# 설정\n\n## 짧은 절\n- 새 규칙\n';
    const f = fixture(OLD);
    f.install();
    writeFileSync(f.target, `${MARKER}\n${OLD}## 개인 절\n- 내 항목\n`);
    writeFileSync(f.templatePath, NEW);
    assert.match(f.install('--update'), /충돌/);
    const unrelated = `${MARKER}\n${OLD}## 개인 절\n- 내 항목\n- 관계없는 새 줄\n`;
    writeFileSync(f.target, unrelated);
    assert.match(f.install('--update'), /충돌/);
    assert.equal(f.read(), unrelated);
    assert.equal(readFileSync(path.join(f.state, 'claude-md-base.md'), 'utf8'), OLD);
  }
  // 템플릿이 사용자가 고친 줄을 지운 충돌(템플릿 쪽이 빔): 관계없는 편집은 정리가 아니고, 옛 줄을 지우면 정리다.
  {
    const OLD = '# 설정\n\n- 유지\n- 지울 규칙\n- 끝\n';
    const NEW = '# 설정\n\n- 유지\n- 끝\n';
    const f = fixture(OLD);
    f.install();
    writeFileSync(f.target, `${MARKER}\n${OLD.replace('- 지울 규칙', '- 지울 규칙 (내 수정)')}`);
    writeFileSync(f.templatePath, NEW);
    assert.match(f.install('--update'), /충돌/);
    const unrelated = `${MARKER}\n${OLD.replace('- 지울 규칙', '- 지울 규칙 (내 수정)')}- 관계없는 줄\n`;
    writeFileSync(f.target, unrelated);
    assert.match(f.install('--update'), /충돌/);
    assert.equal(f.read(), unrelated);
    const resolved = `${MARKER}\n${NEW}- 관계없는 줄\n`;
    writeFileSync(f.target, resolved);
    assert.doesNotMatch(f.install('--update'), /충돌/);
    assert.equal(f.read(), resolved);
    assert.equal(readFileSync(path.join(f.state, 'claude-md-base.md'), 'utf8'), NEW);
  }
  // 필수 줄이 충돌 구간 밖 다른 절에도 있을 때, 충돌 구간에 새 줄을 반영하지 않고 옛 줄만 지우면 정리로 보지 않는다.
  {
    const OLD = '# 설정\n\n## 가\n- 새 규칙\n\n## 나\n- 옛 규칙\n';
    const NEW = '# 설정\n\n## 가\n- 새 규칙\n\n## 나\n- 옛 규칙 (템플릿 수정)\n- 새 규칙\n';
    const f = fixture(OLD);
    f.install();
    writeFileSync(f.target, `${MARKER}\n${OLD.replace('- 옛 규칙', '- 옛 규칙 (내 수정)')}`);
    writeFileSync(f.templatePath, NEW);
    assert.match(f.install('--update'), /충돌/);
    const dropped = `${MARKER}\n# 설정\n\n## 가\n- 새 규칙\n\n## 나\n- 내 줄\n`;
    writeFileSync(f.target, dropped);
    assert.match(f.install('--update'), /충돌/);
    assert.equal(f.read(), dropped);
    assert.equal(readFileSync(path.join(f.state, 'claude-md-base.md'), 'utf8'), OLD);
  }
  // 해결본에 충돌 표시가 남아 있으면 받아들이지 않는다.
  {
    const OLD = '# 설정\n\n- 항목 1\n';
    const f = fixture(OLD);
    f.install();
    writeFileSync(f.target, `${MARKER}\n${OLD.replace('- 항목 1', '- 항목 1 (내 수정)')}`);
    writeFileSync(f.templatePath, OLD.replace('- 항목 1', '- 항목 1 (템플릿 수정)'));
    assert.match(f.install('--update'), /충돌/);
    writeFileSync(f.target, readFileSync(path.join(f.state, 'CLAUDE.md.conflict'), 'utf8'));
    assert.match(f.install('--update'), /충돌 표시/);
    assert.equal(readFileSync(path.join(f.state, 'claude-md-base.md'), 'utf8'), OLD);
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
  // 얕은 clone이면 과거 템플릿이 없으므로 추정하지 않고 건너뛴다.
  {
    const f = fixture(V1, { git: true });
    f.commit(V1);
    f.commit(V2);
    const shallowRepo = path.join(path.dirname(f.target), 'shallow');
    ok(spawnSync('git', ['clone', '-q', '--depth', '1', `file://${path.dirname(f.templatePath)}/..`, shallowRepo]));
    const legacy = `${MARKER}\n${V1}- 개인 항목\n`;
    writeFileSync(f.target, legacy);
    const out = ok(spawnSync('node', [installer, f.target, path.join(shallowRepo, 'templates/global-claude.md'), '--state', f.state, '--repo', shallowRepo, '--update'], { encoding: 'utf8' }));
    assert.match(out, /건너뜀/);
    assert.equal(f.read(), legacy);
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
  // 마크다운 setext 밑줄(=======)이 있어도 구분자로 오인하지 않는다.
  {
    const S1 = '# 설정\n\n제목\n=======\n- 항목 1\n';
    const f = fixture(S1);
    f.install();
    writeFileSync(f.target, `${MARKER}\n${S1.replace('- 항목 1', '- 항목 1 (내 수정)')}`);
    writeFileSync(f.templatePath, S1.replace('- 항목 1', '- 항목 1 (템플릿 수정)'));
    assert.match(f.install('--update'), /충돌\(1곳\)/);
  }
  console.log(`OK: install-claude-md (${count} cases)`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
