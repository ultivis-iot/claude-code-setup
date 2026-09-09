#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viewerPaths = [
  'codex/skills/ux-review/assets/viewer-page.html',
  'codex/plugins/dev-workflow/skills/ux-review/assets/viewer-page.html',
];
const viewers = await Promise.all(
  viewerPaths.map((viewerPath) => readFile(path.join(repositoryRoot, viewerPath), 'utf8'))
);

assert.equal(viewers[1], viewers[0], '직접 설치본과 플러그인 설치본의 뷰어가 같아야 합니다.');

const page = viewers[0];
assert.match(page, /class="repo-group'\+\(show\?'':' collapsed'\)\+'"/);
assert.match(page, /class="repo-children"><div class="repo-children-inner">/);
assert.match(
  page,
  /\.repo-children\{[\s\S]*?grid-template-rows:1fr[\s\S]*?opacity:1[\s\S]*?transition:/,
  '저장소 하위 메뉴는 HerdRabbit처럼 높이와 투명도를 전환해야 합니다.'
);
assert.match(
  page,
  /\.repo-group\.collapsed \.repo-children\{[\s\S]*?grid-template-rows:0fr[\s\S]*?opacity:0/,
  '접힌 저장소 메뉴는 DOM을 유지한 채 높이를 0으로 줄여야 합니다.'
);
assert.doesNotMatch(
  page,
  /if\(!show\)continue/,
  '접을 때 하위 메뉴 DOM을 제거하면 HerdRabbit의 접힘 전환을 재현할 수 없습니다.'
);

assert.match(page, /<button class="repo-collapse"[^>]*aria-expanded="'\+\(show\?'true':'false'\)\+'"[\s\S]*?<svg[^>]*viewBox="0 0 24 24"[\s\S]*?M9 18l6-6-6-6/);
assert.match(page, /\.repo\{[\s\S]*?min-height:36px[\s\S]*?gap:4px[\s\S]*?padding:4px 0/);
assert.match(page, /\.repo \.nm\{[\s\S]*?font-size:12px[\s\S]*?font-weight:650[\s\S]*?text-overflow:ellipsis/);
assert.doesNotMatch(page, /<span class="caret">/);
assert.match(page, /#app\{[^}]*grid-template-columns:310px minmax\(0,1fr\)/);
assert.match(page, /\.sidebar-toggle\{[^}]*width:34px[^}]*height:34px/);
assert.match(page, /id="railtoggle" class="sidebar-toggle"/);
assert.match(page, /class="sidebar-toggle-mark"[^>]*viewBox="0 0 64 64"/);
assert.match(page, /body\.rail #side\{[^}]*translateX\(-246px\)/);
assert.match(page, /body\.rail #main\{[^}]*width:calc\(100% \+ 246px\)[^}]*translateX\(-246px\)/);
assert.match(page, /body\.rail #tree\{padding:4px 10\.5px 12px 257\.5px\}/);
assert.doesNotMatch(page, /body\.rail #app\{grid-template-columns:0/);
assert.doesNotMatch(page, /#tree \.ui-nav-copy\{flex-wrap:wrap/);
assert.doesNotMatch(page, /#tree \.ui-nav-copy strong\{flex:1 1 100%/);
assert.doesNotMatch(page, /function scenarioRailStatus\(s,isNew\)/);
assert.match(page, /data-rail-icon="'\+\(cur===s\.path\?'●':'○'\)\+'"/);
assert.doesNotMatch(page, /class="ui-status state-/);
assert.match(page, /body\.rail \.ui-status::before\{content:attr\(data-rail-icon\)/);
assert.match(page, /body\.rail #tree \.ui-nav-item \.ui-status\{font-size:0;color:var\(--muted\)\}/);
assert.match(page, /body\.rail #tree \.ui-nav-item\[aria-pressed="true"\] \.ui-status\{color:var\(--accent\)\}/);
assert.match(page, /body\.rail \.repo-group\+\.repo-group\{margin-top:10px\}/);
assert.match(page, /body\.rail \.wtbox\+\.wtbox\{margin-top:6px\}/);
assert.doesNotMatch(page, /body\.rail #meta,body\.rail #th/);
assert.match(page, /title="'\+esc\(s\.id\+' · '\+stamp\(s\.activeAt,s\.date\)\)\+'"/);
assert.match(page, /#tree\{overflow-x:hidden;scrollbar-width:none/);
assert.match(page, /#tree::-webkit-scrollbar\{width:0;height:0\}/);
assert.match(page, /body\.rail \.ui-nav-copy\{display:none\}/);

console.log('OK: ux-review repository menus follow the HerdRabbit collapse contract');
