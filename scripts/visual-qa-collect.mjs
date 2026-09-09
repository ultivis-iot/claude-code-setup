#!/usr/bin/env node

// /visual-qa 의 수집 계층. 라우트를 열고 판정에 필요한 사실만 모아 JSON 으로 남긴다.
// 판정은 하지 않는다 — 그건 visual-qa-analyzer 가 한다.
//
//   node visual-qa-collect.mjs --url http://localhost:5173 --routes /,/orders
//   node visual-qa-collect.mjs --url ... --routes / --viewports 1440x900,390x844
//   node visual-qa-collect.mjs --url ... --routes / --storage-state .auth/state.json
//
// Playwright 는 이 저장소에 의존성으로 들이지 않고 대상 저장소의 것을 쓴다.
// 프론트엔드 저장소는 대부분 이미 갖고 있고, 없으면 그때 설치를 안내한다.
//
// 페이지를 바꾸지 않는다: 이동과 읽기만 하고 클릭·입력·제출을 하지 않는다.
// 로그인이 필요하면 사람이 만들어 둔 storageState 파일을 받는다.

import { mkdir, writeFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const list = (value) => (value ? value.split(',').map((s) => s.trim()).filter(Boolean) : []);

const BASE_URL = option('--url', process.env.VISUAL_QA_URL);
const ROUTES = list(option('--routes', '/'));
const OUT_DIR = path.resolve(option('--out', 'tmp/visual-qa'));
const STORAGE_STATE = option('--storage-state', process.env.VISUAL_QA_STORAGE_STATE);
const TIMEOUT = Number(option('--timeout', 20000));
const REPO = path.resolve(option('--repo', process.cwd()));
const VIEWPORTS = (list(option('--viewports', '1440x900,390x844'))).map((spec) => {
  const [width, height] = spec.toLowerCase().split('x').map(Number);
  if (!width || !height) throw new Error(`뷰포트 형식이 잘못됨: ${spec} (예: 1440x900)`);
  return { name: spec, width, height };
});

if (!BASE_URL) {
  console.error('--url 이 필요합니다 (개발 서버 주소). 예: --url http://localhost:5173');
  process.exit(2);
}

// ── Playwright 찾기 ──────────────────────────────────────────────────
// 대상 저장소의 node_modules 를 기준으로 찾는다. 설치 위치를 추측하지 않는다.
async function loadChromium() {
  const explicit = option('--playwright', process.env.VISUAL_QA_PLAYWRIGHT);
  const candidates = explicit ? [explicit] : [
    path.join(REPO, 'node_modules/@playwright/test/index.mjs'),
    path.join(REPO, 'node_modules/playwright/index.mjs'),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return (await import(candidate)).chromium;
    } catch {}
  }
  // 워크스페이스 저장소는 호이스팅된 위치에 있을 수 있으므로 해석기에도 물어본다.
  try {
    const require = createRequire(path.join(REPO, 'package.json'));
    return (await import(require.resolve('playwright'))).chromium;
  } catch {}
  throw new Error(
    `Playwright 를 찾지 못했습니다 (기준 저장소: ${REPO}).\n`
    + '  대상 저장소에서 설치하세요:  npm i -D @playwright/test && npx playwright install chromium\n'
    + '  다른 위치의 것을 쓰려면:      --playwright <경로/index.mjs>',
  );
}

// 같은 항목이 여러 번 잡히면 건수만 센다. 목록이 길어지면 판정이 흐려진다.
function dedupe(items) {
  const seen = new Map();
  for (const item of items) {
    const key = JSON.stringify(item);
    const hit = seen.get(key);
    if (hit) hit.count += 1;
    else seen.set(key, { ...(typeof item === 'string' ? { message: item } : item), count: 1 });
  }
  return [...seen.values()];
}

// ── 라우트 하나 수집 ─────────────────────────────────────────────────
// 판정 기준이 될 사실만 모은다. 해석은 하지 않는다.
async function collectRoute(context, route, viewport, index) {
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const networkErrors = [];
  // 페이지를 닫을 때 끊기는 미디어 preload 같은 정상 취소는 결함이 아니다.
  // 버리지는 않고 따로 담아 판정에서 오탐이 되지 않게 한다.
  const abortedRequests = [];

  page.on('console', (message) => {
    const type = message.type();
    if (type !== 'error' && type !== 'warning') return;
    consoleErrors.push({ type, text: message.text().slice(0, 500) });
  });
  page.on('pageerror', (error) => pageErrors.push(String(error.message).slice(0, 500)));
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? null;
    const entry = {
      url: request.url().slice(0, 300),
      method: request.method(),
      failure,
      status: null,
    };
    (failure === 'net::ERR_ABORTED' ? abortedRequests : networkErrors).push(entry);
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    networkErrors.push({
      url: response.url().slice(0, 300),
      method: response.request().method(),
      failure: null,
      status: response.status(),
    });
  });

  const target = new URL(route, BASE_URL).toString();
  const started = Date.now();
  let navigation = 'ok';
  try {
    await page.goto(target, { waitUntil: 'networkidle', timeout: TIMEOUT });
  } catch (error) {
    navigation = String(error.message).split('\n')[0].slice(0, 200);
  }
  const loadMs = Date.now() - started;

  // 페이지를 바꾸지 않는 읽기만 한다.
  const dom = await page.evaluate(() => {
    const visible = (el) => {
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
    };
    const named = (el) => (el.getAttribute('aria-label') || el.getAttribute('title')
      || el.textContent || '').trim().length > 0;
    const controls = [...document.querySelectorAll('button,a[href],[role="button"]')];
    const images = [...document.querySelectorAll('img')];
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    return {
      title: document.title,
      textLength: (document.body?.innerText || '').trim().length,
      headings: headings.slice(0, 40).map((h) => ({ level: Number(h.tagName[1]), text: h.textContent.trim().slice(0, 120) })),
      h1Count: document.querySelectorAll('h1').length,
      controlCount: controls.length,
      unnamedControls: controls.filter((el) => visible(el) && !named(el)).length,
      imageCount: images.length,
      imagesWithoutAlt: images.filter((el) => !el.hasAttribute('alt')).length,
      formCount: document.querySelectorAll('form').length,
      // 가로 스크롤은 반응형이 깨졌다는 가장 분명한 신호다
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      // 라우트가 비어 있는지(빈 셸만 뜬 경우) 판정할 근거
      rootChildren: (document.querySelector('#root,#app,main') || document.body)?.children.length ?? 0,
    };
  }).catch((error) => ({ error: String(error.message).slice(0, 200) }));

  // 화면 간 통일성을 재기 위한 스타일 지문. 값마다 몇 번 쓰였는지만 센다.
  // 어떤 값이 이 화면에만 있는지는 라우트를 다 모은 뒤에 판단한다.
  const style = await page.evaluate(() => {
    const PROPS = ['color', 'backgroundColor', 'fontFamily', 'fontSize', 'fontWeight',
      'borderRadius', 'boxShadow'];
    // 뜻이 없는 기본값은 세지 않는다. 안 그러면 상위 목록이 전부 이것들로 찬다.
    const EMPTY = new Set(['none', 'normal', 'auto', '0px', 'rgba(0, 0, 0, 0)', 'transparent']);
    // SVG 내부는 도형마다 스타일이 잡혀 표본을 왜곡한다.
    const SKIP = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'BR', 'HR']);
    const bag = Object.fromEntries(PROPS.map((prop) => [prop, new Map()]));
    const controls = { height: new Map(), padding: new Map(), borderRadius: new Map(), fontSize: new Map() };
    // Tailwind 계열은 box-shadow 앞에 완전 투명한 ring 자리표시자를 여러 개 붙인다.
    // 그대로 세면 값이 길어 읽히지 않고, 자리표시자 개수만 달라도 다른 값이 된다.
    const normalizeShadow = (value) => value
      .replace(/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)(?:\s+-?[\d.]+px){2,4}(?:\s*,\s*|$)/g, '')
      .replace(/^\s*,\s*|\s*,\s*$/g, '')
      .trim();
    const bump = (map, value) => { if (value && !EMPTY.has(value)) map.set(value, (map.get(value) ?? 0) + 1); };
    let sampled = 0;

    for (const el of document.querySelectorAll('*')) {
      if (SKIP.has(el.tagName.toUpperCase()) || el.closest('svg')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden') continue;
      sampled += 1;
      for (const prop of PROPS) {
        bump(bag[prop], prop === 'boxShadow' ? normalizeShadow(cs[prop]) : cs[prop]);
      }
      if (el.matches('button,[role="button"],a[href],input,select,textarea')) {
        bump(controls.height, `${Math.round(rect.height)}px`);
        bump(controls.padding, `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`);
        bump(controls.borderRadius, cs.borderRadius);
        bump(controls.fontSize, cs.fontSize);
      }
    }
    // 값이 많으면 자주 쓰인 순으로 자른다. 몇 종류였는지는 distinct 로 남긴다.
    const fold = (map, limit = 40) => ({
      distinct: map.size,
      top: Object.fromEntries([...map].sort((a, b) => b[1] - a[1]).slice(0, limit)),
    });
    return {
      sampled,
      props: Object.fromEntries(PROPS.map((prop) => [prop, fold(bag[prop])])),
      controls: Object.fromEntries(Object.entries(controls).map(([k, v]) => [k, fold(v, 20)])),
    };
  }).catch((error) => ({ error: String(error.message).slice(0, 200) }));

  // 파일명 충돌 방지. 라우트를 그대로 쓰면 한글·기호가 같은 슬러그로 뭉개져
  // 뒤 라우트가 앞 라우트의 스크린샷을 덮는다. 순번을 앞에 붙여 반드시 갈라 둔다.
  const slug = route.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'root';
  const shot = path.join(OUT_DIR, `${String(index + 1).padStart(2, '0')}-${slug}-${viewport.name}.png`);
  try {
    await page.screenshot({ path: shot, fullPage: true });
  } catch {}

  await page.close();
  return {
    route,
    url: target,
    viewport: viewport.name,
    navigation,
    loadMs,
    screenshot: path.relative(process.cwd(), shot),
    consoleErrors: dedupe(consoleErrors),
    pageErrors: dedupe(pageErrors),
    networkErrors: dedupe(networkErrors),
    abortedRequests: dedupe(abortedRequests),
    dom,
    style,
  };
}

// ── 실행 ─────────────────────────────────────────────────────────────
let chromium;
try {
  chromium = await loadChromium();
} catch (error) {
  // 설치 안내는 스택 트레이스 없이 그대로 읽히는 편이 낫다
  console.error(error.message);
  process.exit(2);
}
await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const results = [];
for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    ...(STORAGE_STATE ? { storageState: STORAGE_STATE } : {}),
  });
  // 순차 수행. 개발 서버를 동시 요청으로 흔들면 수집값이 그 탓인지 구분되지 않는다.
  for (const [index, route] of ROUTES.entries()) {
    results.push(await collectRoute(context, route, viewport, index));
  }
  await context.close();
}
await browser.close();

// 한 라우트에만 나타난 값을 모은다. 그 자체로 결함은 아니고 '왜 여기만 다른가' 를 묻는 후보다.
// 뷰포트가 다르면 값이 갈리는 게 정상이므로 같은 뷰포트끼리만 비교한다.
function crossRouteOutliers(all) {
  const byViewport = new Map();
  for (const item of all) {
    if (!item.style || item.style.error) continue;
    if (!byViewport.has(item.viewport)) byViewport.set(item.viewport, []);
    byViewport.get(item.viewport).push(item);
  }
  const out = {};
  for (const [viewport, group] of byViewport) {
    if (group.length < 2) continue; // 비교 대상이 없으면 판단하지 않는다
    const perProp = {};
    for (const prop of Object.keys(group[0].style.props)) {
      const owners = new Map();
      for (const item of group) {
        for (const value of Object.keys(item.style.props[prop].top)) {
          if (!owners.has(value)) owners.set(value, []);
          owners.get(value).push(item.route);
        }
      }
      const only = [...owners]
        .filter(([, routes]) => routes.length === 1)
        .map(([value, routes]) => ({ value, route: routes[0] }));
      if (only.length) perProp[prop] = { count: only.length, values: only.slice(0, 30) };
    }
    // 한 화면 안에서 컨트롤 규격이 몇 갈래인지도 통일성 신호다
    const controlSpread = Object.fromEntries(group.map((item) => [item.route,
      Object.fromEntries(Object.entries(item.style.controls).map(([k, v]) => [k, v.distinct]))]));
    out[viewport] = { onlyOnOneRoute: perProp, controlSpread };
  }
  return out;
}

const report = {
  baseUrl: BASE_URL,
  repository: REPO,
  collectedAt: new Date().toISOString(),
  viewports: VIEWPORTS.map((v) => v.name),
  authenticated: Boolean(STORAGE_STATE),
  routes: results,
  consistency: ROUTES.length > 1 ? crossRouteOutliers(results) : null,
};
const file = path.join(OUT_DIR, 'collected.json');
await writeFile(file, JSON.stringify(report, null, 2));

// 사람이 읽을 한 줄 요약. 판정이 아니라 수집 결과의 목록이다.
console.log(`수집 완료 · ${results.length}건 → ${path.relative(process.cwd(), file)}`);
for (const r of results) {
  const problems = [
    r.navigation !== 'ok' ? `이동실패(${r.navigation})` : null,
    r.pageErrors.length ? `JS오류 ${r.pageErrors.length}` : null,
    r.consoleErrors.filter((c) => c.type === 'error').length
      ? `콘솔오류 ${r.consoleErrors.filter((c) => c.type === 'error').length}` : null,
    r.networkErrors.length ? `네트워크 ${r.networkErrors.length}` : null,
    r.dom?.horizontalOverflow ? '가로넘침' : null,
    r.dom?.textLength === 0 ? '빈화면' : null,
  ].filter(Boolean);
  console.log(`  ${r.route} @${r.viewport}  ${r.loadMs}ms  ${problems.length ? problems.join(', ') : '수집값 이상 없음'}`);
}
if (flag('--print')) console.log(JSON.stringify(report, null, 2));
