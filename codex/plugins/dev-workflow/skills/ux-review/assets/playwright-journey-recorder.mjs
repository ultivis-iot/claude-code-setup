import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { scenarioHash, validateScenario } from '../scripts/scenario-contract.mjs';

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

async function showCaption(page, text) {
  await page.evaluate((caption) => {
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
        background: 'rgba(15, 23, 42, 0.9)',
        color: '#fff',
        fontFamily: 'sans-serif',
        fontSize: '18px',
        fontWeight: '600',
        lineHeight: '1.45',
        textAlign: 'center',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.28)',
        pointerEvents: 'none',
      });
      document.body.append(element);
    }
    element.textContent = caption;
  }, text);
}

async function hideCaption(page) {
  await page
    .locator('[data-testid="ux-journey-caption"]')
    .evaluateAll((elements) => elements.forEach((element) => element.remove()));
}

async function collectPageMetrics(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0;
    };
    const buttons = [...document.querySelectorAll('button')].filter(visible);
    const semanticRoles = new Set(['checkbox', 'radio', 'switch']);
    const unnamedButtons = buttons.filter((button) => {
      if (semanticRoles.has(button.getAttribute('role'))) return false;
      return !(
        button.textContent?.trim() ||
        button.getAttribute('aria-label')?.trim() ||
        button.getAttribute('title')?.trim()
      );
    });
    return {
      url: window.location.href,
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      unnamedButtons: unnamedButtons.length,
    };
  });
}

export function createJourneyRecorder({
  page,
  context,
  scenario,
  phase = 'review',
  scenarioApproval = null,
  guideApproval = null,
  outputDirectory,
  getRuntimeEvidence = () => ({}),
}) {
  const failures = validateScenario(scenario);
  if (failures.length > 0) throw new Error(failures.join('\n'));
  if (!['review', 'guide'].includes(phase)) throw new Error(`Unsupported phase: ${phase}`);

  const hash = scenarioHash(scenario);
  if (
    !scenarioApproval ||
    scenarioApproval.approvalType !== 'review-scenario' ||
    scenarioApproval.scenarioId !== scenario.id ||
    scenarioApproval.scenarioHash !== hash
  ) {
    throw new Error('Recording requires user approval for the exact scenario hash.');
  }
  if (
    phase === 'guide' &&
    (!guideApproval ||
      guideApproval.approvalType !== 'guide-readiness' ||
      guideApproval.scenarioId !== scenario.id ||
      guideApproval.scenarioHash !== hash ||
      !['ready', 'ready-with-deferred-findings'].includes(guideApproval.guideReadiness))
  ) {
    throw new Error('Guide recording requires user readiness approval for the exact scenario hash.');
  }

  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  const cues = [];
  const observations = [];
  let sequence = 0;

  return {
    async step(stepNumber, action, dwell) {
      const expectedStep = scenario.steps[sequence];
      if (!expectedStep || expectedStep.step !== stepNumber) {
        throw new Error(
          `Scenario order mismatch: expected step ${expectedStep?.step ?? 'none'}, received ${stepNumber}.`
        );
      }
      if (typeof action !== 'function') throw new Error(`Step ${stepNumber} requires an action.`);

      await hideCaption(page);
      await action(expectedStep);
      sequence += 1;
      const start = Date.now() - startedAt;
      await mkdir(outputDirectory, { recursive: true });
      const metrics = await collectPageMetrics(page);
      observations.push({
        sequence,
        ...expectedStep,
        ...metrics,
        ...getRuntimeEvidence(expectedStep),
      });
      await page.screenshot({
        path: path.join(
          outputDirectory,
          `${scenario.id}-${phase}-${String(sequence).padStart(2, '0')}-${expectedStep.evidenceSlug}.png`
        ),
        fullPage: true,
      });
      await showCaption(page, expectedStep.caption);
      const readingTime = Math.min(5_000, Math.max(1_800, expectedStep.caption.length * 80));
      await page.waitForTimeout(dwell ?? (phase === 'guide' ? readingTime : 1_200));
      cues.push({
        step: expectedStep.step,
        title: expectedStep.goal,
        start,
        end: Date.now() - startedAt,
        text: expectedStep.caption,
      });
    },

    async finish() {
      if (sequence !== scenario.steps.length) {
        throw new Error(`Scenario incomplete: recorded ${sequence}/${scenario.steps.length} steps.`);
      }
      await hideCaption(page);
      await mkdir(outputDirectory, { recursive: true });
      const prefix = `${scenario.id}-${phase}`;
      await writeFile(path.join(outputDirectory, `${prefix}.srt`), renderSrt(cues), 'utf8');
      await writeFile(
        path.join(outputDirectory, `${scenario.id}-scenario.json`),
        `${JSON.stringify(scenario, null, 2)}\n`,
        'utf8'
      );
      await writeFile(
        path.join(outputDirectory, `${scenario.id}-scenario-approval.json`),
        `${JSON.stringify(scenarioApproval, null, 2)}\n`,
        'utf8'
      );
      if (phase === 'guide') {
        await writeFile(
          path.join(outputDirectory, `${scenario.id}-guide-approval.json`),
          `${JSON.stringify(guideApproval, null, 2)}\n`,
          'utf8'
        );
        await writeFile(
          path.join(outputDirectory, `${prefix}-chapters.json`),
          `${JSON.stringify(
            cues.map(({ step, title, start }) => ({ step, title, startMs: start })),
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
            schemaVersion: 1,
            scenarioId: scenario.id,
            scenarioHash: hash,
            phase,
            startedAt: startedAtIso,
            completedAt: new Date().toISOString(),
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
      const video = page.video();
      await page.close();
      await context.close();
      if (!video) throw new Error(`Playwright video is unavailable for ${scenario.id}.`);
      await video.saveAs(path.join(outputDirectory, `${prefix}.webm`));
      await video.delete();
    },
  };
}
