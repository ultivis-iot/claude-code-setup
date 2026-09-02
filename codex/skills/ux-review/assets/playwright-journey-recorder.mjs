import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findRepositoryRoot, resolveRepositoryRelativePath } from '../scripts/repository-paths.mjs';
import { scenarioHash, sha256, validateScenario } from '../scripts/scenario-contract.mjs';

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

async function showCaption(page, text, placement) {
  await page.evaluate(({ caption, captionPlacement }) => {
    let element = document.querySelector('[data-testid="ux-journey-caption"]');
    if (!element) {
      element = document.createElement('div');
      element.dataset.testid = 'ux-journey-caption';
      Object.assign(element.style, {
        position: 'fixed',
        left: '50%',
        bottom: '28px',
        zIndex: '2147483647',
        maxWidth: 'calc(100vw - 32px)',
        transform: 'translateX(-50%)',
        padding: '10px 16px',
        borderRadius: '10px',
        border: '1px solid rgba(15, 23, 42, 0.18)',
        background: 'rgba(255, 255, 255, 0.96)',
        color: '#111827',
        fontFamily: 'sans-serif',
        fontSize: '18px',
        fontWeight: '600',
        lineHeight: '1.45',
        textAlign: 'center',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.34)',
        pointerEvents: 'none',
      });
      document.body.append(element);
    }
    element.style.top = captionPlacement === 'top' ? '72px' : 'auto';
    element.style.bottom = captionPlacement === 'top' ? 'auto' : '28px';
    element.textContent = caption;
  }, { caption: text, captionPlacement: placement });
}

async function hideCaption(page) {
  await page
    .locator('[data-testid="ux-journey-caption"]')
    .evaluateAll((elements) => elements.forEach((element) => element.remove()));
}

const targetAttribute = 'data-ux-journey-target';

async function installTargetHighlightStyle(page) {
  await page.evaluate(({ styleId, attribute }) => {
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes ux-journey-target-pulse {
        0%, 100% { outline-offset: 3px; box-shadow: 0 0 0 6px rgba(245, 158, 11, 0.28), 0 0 24px rgba(245, 158, 11, 0.42); }
        50% { outline-offset: 6px; box-shadow: 0 0 0 11px rgba(245, 158, 11, 0.14), 0 0 34px rgba(245, 158, 11, 0.56); }
      }
      [${attribute}="active"] {
        z-index: 2147483646 !important;
        outline: 4px solid #f59e0b !important;
        animation: ux-journey-target-pulse 850ms ease-in-out infinite !important;
      }
    `;
    document.head.append(style);
  }, { styleId: 'ux-journey-target-style', attribute: targetAttribute });
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
    const screenshotPattern = new RegExp(
      `^${escapedPrefix}-(?:\\d{2}|terminal-\\d{2})-`
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

  async function observe(expectedStep, cueStart, cueEnd) {
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
    });
    await page.screenshot({
      path: path.join(
        outputDirectory,
        `${prefix}-${String(sequence).padStart(2, '0')}-${expectedStep.evidenceSlug}.png`
      ),
      fullPage: true,
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
    const screenshotFile = `${prefix}-terminal-${String(terminalSequence).padStart(2, '0')}-${expectedStep?.evidenceSlug || 'unknown-step'}.png`;
    try {
      await page.screenshot({ path: path.join(outputDirectory, screenshotFile), fullPage: true });
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

      if (phase === 'guide') {
        await page.waitForTimeout(pacing.beforeActionMs);
        const cueStart = Date.now() - startedAt;
        await showCaption(page, expectedStep.caption, resolvedCaptionPlacement);
        await page.waitForTimeout(Math.min(pacing.captionLeadMs, readingTime));
        await action(expectedStep, ui);
        await clearTargetHighlight(page);
        await page.waitForTimeout(pacing.afterActionMs);
        const elapsed = Date.now() - startedAt - cueStart;
        await page.waitForTimeout(Math.max(0, (dwell ?? readingTime) - elapsed));
        const cueEnd = Date.now() - startedAt;
        cues.push({ step: expectedStep.step, title: expectedStep.goal, start: cueStart, end: cueEnd, text: expectedStep.caption });
        await hideCaption(page);
        sequence += 1;
        await observe(expectedStep, cueStart, cueEnd);
      } else {
        await action(expectedStep, ui);
        await clearTargetHighlight(page);
        sequence += 1;
        await observe(expectedStep, null, null);
        const cueStart = Date.now() - startedAt;
        await showCaption(page, expectedStep.caption, resolvedCaptionPlacement);
        await page.waitForTimeout(dwell ?? 1_200);
        const cueEnd = Date.now() - startedAt;
        observations.at(-1).cueStartMs = cueStart;
        observations.at(-1).cueEndMs = cueEnd;
        cues.push({ step: expectedStep.step, title: expectedStep.goal, start: cueStart, end: cueEnd, text: expectedStep.caption });
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
          `${JSON.stringify(cues.map(({ step, title, start }) => ({ step, title, startMs: start })), null, 2)}\n`,
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
