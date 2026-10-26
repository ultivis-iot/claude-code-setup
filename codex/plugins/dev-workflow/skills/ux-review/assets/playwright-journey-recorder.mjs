import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findRepositoryRoot, resolveRepositoryRelativePath } from '../scripts/repository-paths.mjs';
import {
  CAPTION_FONT_SIZE,
  CAPTION_FULL_BLEED_MAX_VIEWPORT_WIDTH,
  CAPTION_LINE_HEIGHT_RATIO,
  CAPTION_MAX_LINES,
  normalizeCaption,
  scenarioHash,
  sha256,
  validateScenario,
} from '../scripts/scenario-contract.mjs';

function formatSrtTime(milliseconds) {
  const total = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1_000);
  const millis = total % 1_000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function renderSrt(cues) {
  return cues
    .map(
      ({ start, end, text }, index) =>
        `${index + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${text}\n`
    )
    .join('\n');
}

function sanitize(value) {
  return String(value ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, '$1[REDACTED]')
    .slice(0, 500);
}

/**
 * 스크린샷을 페이지 전체로 찍을지.
 *
 * 전체로 찍으면 Chromium 이 렌더 영역을 **페이지 높이만큼 늘렸다 되돌린다.** 녹화 중에는
 * 그 순간이 영상에 들어가 화면이 쪼그라들었다 돌아오는 것처럼 보인다 — 단계마다 한 번씩.
 * 리뷰 스크린샷은 캡션·강조 포함의 뷰포트 캡처가 기본(주요 산출물)이므로
 * `UX_REVIEW_SCROLL_FULL_PAGE=true` 로 명시적으로 켜야만 전체 페이지를 찍는다.
 * 가이드 phase 도 그대로 뷰포트 캡처를 쓴다.
 */
const SCREENSHOT_FULL_PAGE = process.env.UX_REVIEW_SCROLL_FULL_PAGE === 'true';

async function showCaption(page, text, placement) {
  await page.evaluate(
    ({
      caption,
      captionPlacement,
      fullBleedMaxViewportWidth,
      maxLines,
      maxFontSize,
      minFontSize,
      fontSize,
      lineHeightRatio,
    }) => {
      const fullBleed = window.innerWidth <= fullBleedMaxViewportWidth;
      const atTop = captionPlacement === 'top';
      let element = document.querySelector('[data-testid="ux-journey-caption"]');
      if (!element) {
        element = document.createElement('div');
        element.dataset.testid = 'ux-journey-caption';
        element.append(document.createElement('span'));
        document.body.append(element);
      }
      Object.assign(element.style, {
        position: 'fixed',
        zIndex: '2147483647',
        boxSizing: 'border-box',
        top: atTop ? (fullBleed ? '0' : '72px') : 'auto',
        bottom: atTop ? 'auto' : fullBleed ? '0' : '28px',
        left: fullBleed ? '0' : '50%',
        right: fullBleed ? '0' : 'auto',
        width: 'auto',
        maxWidth: fullBleed ? 'none' : 'calc(100vw - 32px)',
        transform: fullBleed ? 'none' : 'translateX(-50%)',
        padding: fullBleed ? '12px 16px' : '10px 16px',
        borderRadius: fullBleed ? '0' : '10px',
        border: fullBleed ? 'none' : '1px solid rgba(15, 23, 42, 0.18)',
        boxShadow: fullBleed
          ? `0 ${atTop ? '' : '-'}6px 20px rgba(0, 0, 0, 0.28)`
          : '0 8px 24px rgba(0, 0, 0, 0.34)',
        background: 'rgba(255, 255, 255, 0.96)',
        color: '#111827',
        fontFamily: 'sans-serif',
        fontWeight: '600',
        textAlign: 'center',
        pointerEvents: 'none',
      });
      element.style.fontSize = `${fontSize}px`;
      element.style.lineHeight = `${Math.round(fontSize * lineHeightRatio)}px`;
      const line = element.firstElementChild;
      line.style.display = 'block';
      line.textContent = caption;
    },
    {
      caption: text,
      captionPlacement: placement,
      fullBleedMaxViewportWidth: CAPTION_FULL_BLEED_MAX_VIEWPORT_WIDTH,
      fontSize: CAPTION_FONT_SIZE,
      lineHeightRatio: CAPTION_LINE_HEIGHT_RATIO,
    }
  );
}

// 자막이 두 줄을 넘으면 어절 경계에서 나눈다. 추정이 아니라 그 페이지의 실제 렌더 폭으로 잰다.
// 측정에 실패하면 자막 하나를 그대로 쓴다.
async function splitCaption(page, text, placement) {
  const normalized = normalizeCaption(text);
  const segments = await page.evaluate(
    ({ captionText, captionPlacement, fullBleedMaxViewportWidth, fontSize, lineHeightRatio, maxLines }) => {
      const fullBleed = window.innerWidth <= fullBleedMaxViewportWidth;
      const lineHeight = Math.round(fontSize * lineHeightRatio);
      const probe = document.createElement('div');
      const line = document.createElement('span');
      probe.append(line);
      Object.assign(probe.style, {
        position: 'fixed',
        visibility: 'hidden',
        boxSizing: 'border-box',
        bottom: captionPlacement === 'top' ? 'auto' : '0',
        top: captionPlacement === 'top' ? '0' : 'auto',
        left: fullBleed ? '0' : '50%',
        right: fullBleed ? '0' : 'auto',
        width: 'auto',
        maxWidth: fullBleed ? 'none' : 'calc(100vw - 32px)',
        transform: fullBleed ? 'none' : 'translateX(-50%)',
        padding: fullBleed ? '12px 16px' : '10px 16px',
        border: fullBleed ? 'none' : '1px solid rgba(15, 23, 42, 0.18)',
        fontFamily: 'sans-serif',
        fontSize: `${fontSize}px`,
        fontWeight: '600',
        lineHeight: `${lineHeight}px`,
        textAlign: 'center',
        pointerEvents: 'none',
      });
      line.style.display = 'block';
      document.body.append(probe);
      const fits = (value) => {
        line.textContent = value;
        return Math.round(line.getBoundingClientRect().height / lineHeight) <= maxLines;
      };
      const packed = [];
      let current = '';
      for (const word of captionText.split(' ')) {
        const candidate = current ? `${current} ${word}` : word;
        if (!current || fits(candidate)) {
          current = candidate;
          continue;
        }
        packed.push(current);
        current = word;
      }
      if (current) packed.push(current);
      probe.remove();
      return packed;
    },
    {
      captionText: normalized,
      captionPlacement: placement,
      fullBleedMaxViewportWidth: CAPTION_FULL_BLEED_MAX_VIEWPORT_WIDTH,
      fontSize: CAPTION_FONT_SIZE,
      lineHeightRatio: CAPTION_LINE_HEIGHT_RATIO,
      maxLines: CAPTION_MAX_LINES,
    }
  );
  const usable =
    Array.isArray(segments) &&
    segments.length > 0 &&
    segments.every((segment) => typeof segment === 'string' && segment.trim()) &&
    segments.join(' ') === normalized;
  return usable ? segments : [normalized];
}

async function hideCaption(page) {
  await page
    .locator('[data-testid="ux-journey-caption"]')
    .evaluateAll((elements) => elements.forEach((element) => element.remove()));
}

const targetAttribute = 'data-ux-journey-target';

/**
 * 누를 대상을 얼마나 눈에 띄게 표시할지.
 *
 * 기본(`full`)은 가이드용이다 — 두꺼운 테두리와 계속 도는 펄스, 그리고 `z-index` 를 최대로
 * 올려 어디를 누르는지 분명히 보여 준다. 그런데 그 z-index 승격은 요소를 제 카드 밖으로
 * 끌어올려 **화면이 튀는 것처럼** 보이게 하고, 무한 펄스는 계속 반짝인다. 제품을 보여 주는
 * 시연 영상에서는 그 장식이 제품보다 눈에 띈다.
 *
 *   UX_REVIEW_HIGHLIGHT=soft  얇은 테두리 한 번만 — 튀지 않고 어디인지는 보인다
 *   UX_REVIEW_HIGHLIGHT=off   표시하지 않는다(설명은 말이나 자막으로 한다)
 */
const HIGHLIGHT_MODE = process.env.UX_REVIEW_HIGHLIGHT || 'full';

const HIGHLIGHT_CSS = {
  full: `
      @keyframes ux-journey-target-pulse {
        0%, 100% { outline-offset: 3px; box-shadow: 0 0 0 6px rgba(245, 158, 11, 0.28), 0 0 24px rgba(245, 158, 11, 0.42); }
        50% { outline-offset: 6px; box-shadow: 0 0 0 11px rgba(245, 158, 11, 0.14), 0 0 34px rgba(245, 158, 11, 0.56); }
      }
      [ATTR="active"] {
        z-index: 2147483646 !important;
        outline: 4px solid #f59e0b !important;
        animation: ux-journey-target-pulse 850ms ease-in-out infinite !important;
      }
  `,
  // z-index 를 건드리지 않는다 — 요소가 제자리에 머물러야 튀지 않는다. 펄스도 한 번만 돈다.
  soft: `
      @keyframes ux-journey-target-pulse {
        0% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.45); }
        100% { box-shadow: 0 0 0 8px rgba(245, 158, 11, 0); }
      }
      [ATTR="active"] {
        outline: 2px solid rgba(245, 158, 11, 0.9) !important;
        outline-offset: 2px !important;
        animation: ux-journey-target-pulse 600ms ease-out 1 !important;
      }
  `,
  off: '',
};

async function installTargetHighlightStyle(page) {
  const css = HIGHLIGHT_CSS[HIGHLIGHT_MODE] ?? HIGHLIGHT_CSS.full;
  if (!css) return;
  await page.evaluate(
    ({ styleId, attribute, styleText }) => {
      if (document.getElementById(styleId)) return;
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = styleText.split('ATTR').join(attribute);
      document.head.append(style);
    },
    { styleId: 'ux-journey-target-style', attribute: targetAttribute, styleText: css }
  );
}

async function clearTargetHighlight(page) {
  await page
    .locator(`[${targetAttribute}]`)
    .evaluateAll((elements, attribute) => {
      elements.forEach((element) => element.removeAttribute(attribute));
    }, targetAttribute)
    .catch(() => {});
}

async function markTarget(page, locator) {
  if (!locator || typeof locator.evaluate !== 'function') {
    throw new Error('Interaction helpers require a Playwright Locator target.');
  }
  await installTargetHighlightStyle(page);
  await clearTargetHighlight(page);
  if (typeof locator.scrollIntoViewIfNeeded === 'function') {
    await locator.scrollIntoViewIfNeeded();
  }
  await locator.evaluate((element, attribute) => {
    const control =
      element.closest(
        'button, a[href], input, select, textarea, [role="button"], [role="checkbox"], [role="radio"], [role="option"]'
      ) || element;
    control.setAttribute(attribute, 'active');
  }, targetAttribute);
}

async function collectPageMetrics(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0;
    };
    const controls = [
      ...document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]'),
    ].filter(visible);
    const unnamedControls = controls.filter((control) => {
      if (control.matches('input[type="hidden"]')) return false;
      return !(
        control.textContent?.trim() ||
        control.getAttribute('aria-label')?.trim() ||
        control.getAttribute('title')?.trim() ||
        control.getAttribute('alt')?.trim() ||
        (control.id && document.querySelector(`label[for="${CSS.escape(control.id)}"]`)?.textContent?.trim())
      );
    });
    return {
      url: window.location.href,
      locale: navigator.language,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      unnamedControls: unnamedControls.length,
    };
  });
}

function prefixFor(scenario, phase, journey) {
  return journey.kind === 'critical'
    ? `${scenario.id}-${phase}`
    : `${scenario.id}-${phase}-${journey.id}`;
}

export function createJourneyRecorder({
  page,
  context,
  scenario,
  journeyId = 'critical',
  phase = 'review',
  scenarioApproval = null,
  guideApproval = null,
  directGuideRequest = null,
  outputDirectory,
  getRuntimeEvidence = async () => ({}),
  getMutationLedger = async () => null,
  guidePacing = {},
  interactionPacing = {},
  captionPlacement = null,
}) {
  const failures = validateScenario(scenario);
  if (failures.length > 0) throw new Error(failures.join('\n'));
  if (!['review', 'guide'].includes(phase)) throw new Error(`Unsupported phase: ${phase}`);
  const journey = scenario.journeys.find(({ id }) => id === journeyId);
  if (!journey) throw new Error(`Unknown journey: ${journeyId}`);
  if (phase === 'guide' && journey.kind !== 'critical') {
    throw new Error('Guide recording only accepts the critical journey.');
  }

  const hash = scenarioHash(scenario);
  const hasScenarioApproval = Boolean(
    scenarioApproval &&
      scenarioApproval.schemaVersion === 2 &&
      scenarioApproval.approvalType === 'review-scenario' &&
      scenarioApproval.scenarioId === scenario.id &&
      scenarioApproval.scenarioHash === hash &&
      scenarioApproval.pathBase === 'repository-root'
  );
  const hasDirectGuideRequest = Boolean(
    directGuideRequest &&
      directGuideRequest.schemaVersion === 1 &&
      directGuideRequest.authorizationType === 'direct-guide-request' &&
      directGuideRequest.scenarioId === scenario.id &&
      directGuideRequest.scenarioHash === hash &&
      directGuideRequest.pathBase === 'repository-root' &&
      directGuideRequest.requestedBy?.trim() &&
      directGuideRequest.request?.trim() &&
      directGuideRequest.claimsUxReviewReadiness === false
  );
  const directGuide = phase === 'guide' && hasDirectGuideRequest;
  if (phase === 'review' && !hasScenarioApproval) {
    throw new Error('Recording requires repository-bound user approval for the exact scenario hash.');
  }
  if (
    phase === 'guide' &&
    !directGuide &&
    (!hasScenarioApproval ||
      !guideApproval ||
      guideApproval.schemaVersion !== 2 ||
      guideApproval.approvalType !== 'guide-readiness' ||
      guideApproval.scenarioId !== scenario.id ||
      guideApproval.scenarioHash !== hash ||
      guideApproval.pathBase !== 'repository-root' ||
      !['ready', 'ready-with-deferred-findings'].includes(guideApproval.guideReadiness))
  ) {
    throw new Error(
      'Guide recording requires either reviewed readiness approval or an explicit direct guide request.'
    );
  }
  if (phase === 'guide' && hasDirectGuideRequest && (scenarioApproval || guideApproval)) {
    throw new Error(
      'Pass only directGuideRequest for the direct route; do not mix reviewed approvals.'
    );
  }

  const sourceRevision = process.env[scenario.environment.sourceRevisionEnvironmentVariable];
  const baseUrl = process.env[scenario.environment.baseUrlEnvironmentVariable];
  if (!sourceRevision?.trim()) {
    throw new Error(`${scenario.environment.sourceRevisionEnvironmentVariable} is required.`);
  }
  if (!baseUrl?.trim()) throw new Error(`${scenario.environment.baseUrlEnvironmentVariable} is required.`);
  const environmentFingerprint = sha256(
    JSON.stringify({
      baseUrlOrigin: new URL(baseUrl).origin,
      locale: scenario.environment.locale,
      viewport: scenario.environment.viewport,
      sourceRevision,
    })
  );
  if (phase === 'guide' && !directGuide && guideApproval.sourceRevision !== sourceRevision) {
    throw new Error('Guide source revision differs from the reviewed and approved revision.');
  }
  if (
    phase === 'guide' &&
    !directGuide &&
    guideApproval.environmentFingerprint !== environmentFingerprint
  ) {
    throw new Error('Guide environment differs from the reviewed and approved environment.');
  }

  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  const cues = [];
  const observations = [];
  const runtime = { consoleErrors: [], pageErrors: [], failedRequests: [], responseErrors: [] };
  let runtimeCursor = { consoleErrors: 0, pageErrors: 0, failedRequests: 0, responseErrors: 0 };
  let sequence = 0;
  let initialized = false;
  const prefix = prefixFor(scenario, phase, journey);
  const authorizationMode = directGuide ? 'direct-request' : 'reviewed';
  const scenarioBinding = directGuide ? directGuideRequest : scenarioApproval;
  const resolvedCaptionPlacement = captionPlacement || 'bottom';
  const pacing = {
    beforeActionMs: 1_200,
    captionLeadMs: 1_800,
    afterActionMs: 2_000,
    minCaptionMs: 4_500,
    maxCaptionMs: 8_000,
    minCaptionSegmentMs: 900,
    captionMsPerCharacter: 135,
    ...guidePacing,
  };
  const interaction = {
    targetLeadMs: phase === 'guide' ? 900 : 350,
    targetHoldMs: phase === 'guide' ? 700 : 300,
    clickDelayMs: phase === 'guide' ? 220 : 120,
    typeDelayMs: phase === 'guide' ? 90 : 45,
    fieldSettleMs: phase === 'guide' ? 650 : 300,
    selectionSettleMs: phase === 'guide' ? 750 : 350,
    ...interactionPacing,
  };
  const interactionCounts = {
    targetHighlights: 0,
    clicks: 0,
    fills: 0,
    selections: 0,
    checks: 0,
  };

  async function waitFor(milliseconds) {
    if (Number.isFinite(milliseconds) && milliseconds > 0) {
      await page.waitForTimeout(milliseconds);
    }
  }

  async function withHighlightedTarget(locator, operation, settleMs) {
    await markTarget(page, locator);
    interactionCounts.targetHighlights += 1;
    try {
      await waitFor(interaction.targetLeadMs);
      const result = await operation();
      await waitFor(settleMs);
      return result;
    } finally {
      await clearTargetHighlight(page);
      await waitFor(interaction.targetHoldMs);
    }
  }

  const ui = {
    async highlight(locator, holdMs = interaction.targetLeadMs + interaction.targetHoldMs) {
      await markTarget(page, locator);
      interactionCounts.targetHighlights += 1;
      try {
        await waitFor(holdMs);
      } finally {
        await clearTargetHighlight(page);
      }
    },
    async click(locator, options = {}) {
      interactionCounts.clicks += 1;
      return withHighlightedTarget(
        locator,
        () =>
          locator.click({
            ...options,
            delay: options.delay ?? interaction.clickDelayMs,
          }),
        interaction.selectionSettleMs
      );
    },
    async fill(locator, value, options = {}) {
      interactionCounts.fills += 1;
      return withHighlightedTarget(
        locator,
        async () => {
          await locator.click({ delay: interaction.clickDelayMs });
          await locator.fill('');
          return locator.pressSequentially(String(value), {
            ...options,
            delay: options.delay ?? interaction.typeDelayMs,
          });
        },
        interaction.fieldSettleMs
      );
    },
    async selectOption(locator, values, options = {}) {
      interactionCounts.selections += 1;
      return withHighlightedTarget(
        locator,
        () => locator.selectOption(values, options),
        interaction.selectionSettleMs
      );
    },
    async check(locator, options = {}) {
      interactionCounts.checks += 1;
      return withHighlightedTarget(
        locator,
        () => locator.check(options),
        interaction.selectionSettleMs
      );
    },
    async uncheck(locator, options = {}) {
      interactionCounts.checks += 1;
      return withHighlightedTarget(
        locator,
        () => locator.uncheck(options),
        interaction.selectionSettleMs
      );
    },
  };

  page.on('console', (message) => {
    if (message.type() === 'error') runtime.consoleErrors.push(sanitize(message.text()));
  });
  page.on('pageerror', (error) => runtime.pageErrors.push(sanitize(error.message)));
  page.on('requestfailed', (request) =>
    runtime.failedRequests.push({
      method: request.method(),
      url: sanitize(request.url()),
      failure: sanitize(request.failure()?.errorText),
    })
  );
  page.on('response', (response) => {
    if (response.status() >= 400) {
      runtime.responseErrors.push({
        status: response.status(),
        method: response.request().method(),
        url: sanitize(response.url()),
      });
    }
  });

  async function initialize() {
    if (initialized) return;
    await mkdir(outputDirectory, { recursive: true });
    const repositoryRoot = await findRepositoryRoot(outputDirectory);
    const boundScenarioPath = resolveRepositoryRelativePath(
      repositoryRoot,
      scenarioBinding.scenarioFile,
      'bound scenario file'
    );
    if (scenarioHash(JSON.parse(await readFile(boundScenarioPath, 'utf8'))) !== hash) {
      throw new Error('Repository scenario no longer matches its recording authorization.');
    }
    const exactOutputs = new Set([
      `${prefix}.webm`,
      `${prefix}.srt`,
      `${prefix}-execution.json`,
      `${prefix}-observations.json`,
      `${prefix}-mutation-ledger.json`,
      `${prefix}-chapters.json`,
      `${prefix}-terminal.json`,
    ]);
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // review 스크린샷(-review-NN-), clean screenshot(review: -video-NN-, guide: -NN-),
    // terminal 스크린샷(-terminal-NN-)
    const screenshotPattern = new RegExp(
      `^${escapedPrefix}-(?:review-\\d{2}|video-\\d{2}|video-terminal-\\d{2}|\\d{2}|terminal-\\d{2})-`
    );
    const collisions = (await readdir(outputDirectory)).filter(
      (entry) => exactOutputs.has(entry) || screenshotPattern.test(entry)
    );
    if (collisions.length > 0) {
      throw new Error(`Recording output already exists for ${prefix}: ${collisions.join(', ')}`);
    }
    initialized = true;
  }

  function runtimeDelta() {
    const delta = {};
    for (const key of Object.keys(runtime)) {
      delta[key] = runtime[key].slice(runtimeCursor[key]);
      runtimeCursor[key] = runtime[key].length;
    }
    return delta;
  }

  /**
   * 리뷰 스크린샷: action 직후에 캡션·강조 포함으로 찍는다(주요 산출물).
   * action 완료 시점의 화면 + 캡션으로 그 단계를 한눈에 보여 준다.
   * 파일명: <prefix>-review-NN-<slug>.png
   */
  async function captureReviewScreenshot(expectedStep) {
    await showCaption(page, expectedStep.caption, resolvedCaptionPlacement);
    const seq = String(sequence).padStart(2, '0');
    const name = `${prefix}-review-${seq}-${expectedStep.evidenceSlug}.png`;
    await page.screenshot({
      path: path.join(outputDirectory, name),
      fullPage: SCREENSHOT_FULL_PAGE,
    });
    await hideCaption(page);
  }

  async function observe(expectedStep, cueStart, cueEnd, captionSegments) {
    const metrics = await collectPageMetrics(page);
    const expectedLocale = scenario.environment.locale.toLowerCase();
    if (!metrics.locale.toLowerCase().startsWith(expectedLocale)) {
      throw new Error(`Locale mismatch: expected ${scenario.environment.locale}, got ${metrics.locale}`);
    }
    if (
      metrics.viewportWidth !== scenario.environment.viewport.width ||
      metrics.viewportHeight !== scenario.environment.viewport.height
    ) {
      throw new Error(
        `Viewport mismatch: expected ${scenario.environment.viewport.width}x${scenario.environment.viewport.height}, got ${metrics.viewportWidth}x${metrics.viewportHeight}`
      );
    }
    if (new URL(metrics.url).origin !== new URL(baseUrl).origin) {
      throw new Error(`Base URL mismatch: expected ${new URL(baseUrl).origin}, got ${new URL(metrics.url).origin}`);
    }
    const suppliedEvidence = (await getRuntimeEvidence(expectedStep)) || {};
    const builtInEvidence = runtimeDelta();
    observations.push({
      sequence,
      journeyId: journey.id,
      journeyKind: journey.kind,
      ...expectedStep,
      ...metrics,
      ...builtInEvidence,
      ...suppliedEvidence,
      graphqlErrors: Array.isArray(suppliedEvidence.graphqlErrors)
        ? suppliedEvidence.graphqlErrors
        : [],
      cueStartMs: cueStart,
      cueEndMs: cueEnd,
      captionSegments,
    });
    // review phase: clean screenshot 은 WebM 증거 용도. 파일명 -video- 접두사로
    // 리뷰 스크린샷(-review-)과 구분한다. guide phase: 그대로.
    const shotPrefix = phase === 'review' ? `${prefix}-video` : prefix;
    await page.screenshot({
      path: path.join(
        outputDirectory,
        `${shotPrefix}-${String(sequence).padStart(2, '0')}-${expectedStep.evidenceSlug}.png`
      ),
      fullPage: SCREENSHOT_FULL_PAGE,
    });
  }

  async function captureTerminal(status, failure) {
    const expectedStep = journey.steps[sequence];
    const terminalSequence = sequence + 1;
    const terminal = {
      schemaVersion: 1,
      status,
      sequence: terminalSequence,
      journeyId: journey.id,
      journeyKind: journey.kind,
      attemptedStep: expectedStep
        ? {
            step: expectedStep.step,
            stage: expectedStep.stage,
            goal: expectedStep.goal,
            action: expectedStep.action,
            expected: expectedStep.expected,
            evidenceSlug: expectedStep.evidenceSlug,
          }
        : null,
      failure,
      capturedAt: new Date().toISOString(),
      captureErrors: [],
    };
    try {
      Object.assign(terminal, await collectPageMetrics(page));
    } catch (error) {
      terminal.captureErrors.push(`metrics: ${sanitize(error.message)}`);
    }
    try {
      const suppliedEvidence = (await getRuntimeEvidence(expectedStep)) || {};
      Object.assign(terminal, runtimeDelta(), suppliedEvidence, {
        graphqlErrors: Array.isArray(suppliedEvidence.graphqlErrors)
          ? suppliedEvidence.graphqlErrors
          : [],
      });
    } catch (error) {
      Object.assign(terminal, runtimeDelta(), { graphqlErrors: [] });
      terminal.captureErrors.push(`runtime-evidence: ${sanitize(error.message)}`);
    }
    const terminalShotPrefix = phase === 'review' ? `${prefix}-video` : prefix;
    const screenshotFile = `${terminalShotPrefix}-terminal-${String(terminalSequence).padStart(2, '0')}-${expectedStep?.evidenceSlug || 'unknown-step'}.png`;
    try {
      await page.screenshot({ path: path.join(outputDirectory, screenshotFile), fullPage: SCREENSHOT_FULL_PAGE });
      terminal.screenshotFile = screenshotFile;
    } catch (error) {
      terminal.screenshotFile = null;
      terminal.captureErrors.push(`screenshot: ${sanitize(error.message)}`);
    }
    return terminal;
  }

  return {
    async step(stepNumber, action, dwell) {
      await initialize();
      const expectedStep = journey.steps[sequence];
      if (!expectedStep || expectedStep.step !== stepNumber) {
        throw new Error(
          `Journey order mismatch: expected step ${expectedStep?.step ?? 'none'}, received ${stepNumber}.`
        );
      }
      if (typeof action !== 'function') throw new Error(`Step ${stepNumber} requires an action.`);
      await hideCaption(page);
      const readingTime = Math.min(
        pacing.maxCaptionMs,
        Math.max(pacing.minCaptionMs, expectedStep.caption.length * pacing.captionMsPerCharacter)
      );

      // 두 줄을 넘는 자막은 큐 여러 개로 나눠 순차 재생한다. 스텝의 자막 시간은 그대로 두고 나눠 쓴다.
      const segments = await splitCaption(page, expectedStep.caption, resolvedCaptionPlacement);
      const captionCharacters = segments.reduce((total, segment) => total + segment.length, 0) || 1;
      const pushCue = (start, text) => {
        cues.push({
          step: expectedStep.step,
          title: expectedStep.goal,
          start,
          end: Date.now() - startedAt,
          text,
        });
      };

      if (phase === 'guide') {
        await page.waitForTimeout(pacing.beforeActionMs);
        const captionWindow = dwell ?? readingTime;
        for (const [index, segment] of segments.entries()) {
          const cueStart = Date.now() - startedAt;
          await showCaption(page, segment, resolvedCaptionPlacement);
          if (index === 0) {
            await page.waitForTimeout(Math.min(pacing.captionLeadMs, readingTime));
            await action(expectedStep, ui);
            await clearTargetHighlight(page);
            await page.waitForTimeout(pacing.afterActionMs);
          }
          const share = Math.max(
            pacing.minCaptionSegmentMs,
            Math.round((captionWindow * segment.length) / captionCharacters)
          );
          await page.waitForTimeout(Math.max(0, share - (Date.now() - startedAt - cueStart)));
          pushCue(cueStart, segment);
        }
        await hideCaption(page);
        sequence += 1;
        await observe(expectedStep, cues.at(-segments.length).start, cues.at(-1).end, segments);
      } else {
        await action(expectedStep, ui);
        await clearTargetHighlight(page);
        // 리뷰 스크린샷은 action 직후에 캡션·강조 포함으로 찍는다(주요 산출물).
        // WebM 은 증빙: caption 표시 후 clean result screenshot 이 영상에 담긴다.
        sequence += 1;
        await captureReviewScreenshot(expectedStep);
        for (const segment of segments) {
          const cueStart = Date.now() - startedAt;
          await showCaption(page, segment, resolvedCaptionPlacement);
          await page.waitForTimeout(dwell ?? 1_200);
          pushCue(cueStart, segment);
        }
        await observe(expectedStep, cues.at(-segments.length).start, cues.at(-1).end, segments);
      }
    },

    async finish({ status = 'completed', failure = null } = {}) {
      await initialize();
      if (!['completed', 'failed', 'blocked'].includes(status)) {
        throw new Error(`Unsupported recording status: ${status}`);
      }
      if (phase === 'guide' && status !== 'completed') {
        throw new Error('Guide recordings are only finalized after every step completes.');
      }
      if (status === 'completed' && sequence !== journey.steps.length) {
        throw new Error(`Journey incomplete: recorded ${sequence}/${journey.steps.length} steps.`);
      }
      if (status !== 'completed' && sequence >= journey.steps.length) {
        throw new Error('A completed journey cannot be finalized as failed or blocked.');
      }
      await hideCaption(page);
      await clearTargetHighlight(page);
      let normalizedFailure = null;
      let terminal = null;
      if (status !== 'completed') {
        const failureValue = failure instanceof Error ? { message: failure.message } : failure || {};
        normalizedFailure = {
          step: sequence + 1,
          category: sanitize(failureValue.category || 'unknown'),
          message: sanitize(failureValue.message),
        };
        if (!normalizedFailure.message) {
          throw new Error(`${status} review recording requires a failure message.`);
        }
        terminal = await captureTerminal(status, normalizedFailure);
      }
      let mutationLedger;
      try {
        mutationLedger = await getMutationLedger();
      } catch (error) {
        if (status === 'completed') throw error;
        mutationLedger = {
          mutations: [],
          cleanupCompleted: false,
          captureError: sanitize(error.message),
        };
      }
      validateMutationLedger(scenario.mutationPolicy, mutationLedger, {
        preserveFailedReview: phase === 'review' && status !== 'completed',
      });
      await writeFile(path.join(outputDirectory, `${prefix}.srt`), renderSrt(cues), 'utf8');
      await writeFile(
        path.join(outputDirectory, `${scenario.id}-scenario.json`),
        `${JSON.stringify(scenario, null, 2)}\n`,
        'utf8'
      );
      if (scenarioApproval) {
        await writeFile(
          path.join(outputDirectory, `${scenario.id}-scenario-approval.json`),
          `${JSON.stringify(scenarioApproval, null, 2)}\n`,
          'utf8'
        );
      }
      if (phase === 'guide') {
        if (directGuide) {
          await writeFile(
            path.join(outputDirectory, `${scenario.id}-direct-guide-request.json`),
            `${JSON.stringify(directGuideRequest, null, 2)}\n`,
            'utf8'
          );
        } else {
          await writeFile(
            path.join(outputDirectory, `${scenario.id}-guide-approval.json`),
            `${JSON.stringify(guideApproval, null, 2)}\n`,
            'utf8'
          );
        }
        await writeFile(
          path.join(outputDirectory, `${prefix}-chapters.json`),
          `${JSON.stringify(
            cues.reduce((chapters, { step, title, start }) => {
              if (chapters.at(-1)?.step !== step) chapters.push({ step, title, startMs: start });
              return chapters;
            }, []),
            null,
            2
          )}\n`,
          'utf8'
        );
      }
      await writeFile(
        path.join(outputDirectory, `${prefix}-execution.json`),
        `${JSON.stringify(
          {
            schemaVersion: 2,
            scenarioId: scenario.id,
            scenarioHash: hash,
            journeyId: journey.id,
            journeyKind: journey.kind,
            phase,
            status,
            authorizationMode,
            sourceRevision,
            environmentFingerprint,
            environment: scenario.environment,
            mutationMode: scenario.mutationPolicy.mode,
            interactionPacing: interaction,
            interactionCounts,
            startedAt: startedAtIso,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - startedAt,
            failure: normalizedFailure,
            steps: observations.map(({ sequence: recordedSequence, step, evidenceSlug }) => ({
              sequence: recordedSequence,
              step,
              evidenceSlug,
            })),
          },
          null,
          2
        )}\n`,
        'utf8'
      );
      await writeFile(
        path.join(outputDirectory, `${prefix}-observations.json`),
        `${JSON.stringify(observations, null, 2)}\n`,
        'utf8'
      );
      await writeFile(
        path.join(outputDirectory, `${prefix}-mutation-ledger.json`),
        `${JSON.stringify(mutationLedger, null, 2)}\n`,
        'utf8'
      );
      if (terminal) {
        await writeFile(
          path.join(outputDirectory, `${prefix}-terminal.json`),
          `${JSON.stringify(terminal, null, 2)}\n`,
          'utf8'
        );
      }
      const video = page.video();
      await page.close().catch(() => {});
      await context.close().catch(() => {});
      if (!video) throw new Error(`Playwright video is unavailable for ${scenario.id}/${journey.id}.`);
      const videoPath = path.join(outputDirectory, `${prefix}.webm`);
      await video.saveAs(videoPath);
      await video.delete();
      return { status, videoPath, terminalFile: terminal ? `${prefix}-terminal.json` : null };
    },
  };
}

function validateMutationLedger(policy, ledger, { preserveFailedReview = false } = {}) {
  if (!ledger || !Array.isArray(ledger.mutations) || typeof ledger.cleanupCompleted !== 'boolean') {
    throw new Error('Mutation ledger must contain mutations[] and cleanupCompleted.');
  }
  if (['read-only', 'preview-only'].includes(policy.mode) && ledger.mutations.length > 0) {
    if (preserveFailedReview) return;
    throw new Error(`${policy.mode} recording reported mutations.`);
  }
  if (policy.mode === 'disposable-write') {
    if (ledger.mutations.some(({ allowed }) => allowed !== true)) {
      if (preserveFailedReview) return;
      throw new Error('Disposable-write recording contains an unapproved mutation.');
    }
    if (!ledger.cleanupCompleted) {
      if (preserveFailedReview) return;
      throw new Error('Disposable-write recording did not complete cleanup.');
    }
  }
}
