#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJourneyRecorder } from '../codex/skills/ux-review/assets/playwright-journey-recorder.mjs';
import { scenarioHash, sha256, validateScenario } from '../codex/skills/ux-review/scripts/scenario-contract.mjs';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillRoot = path.join(repositoryRoot, 'codex', 'skills', 'ux-review');
const temporaryRepository = await mkdtemp(path.join(os.tmpdir(), 'ux-review-contract-'));

try {
  await run('git', ['init', '-q', temporaryRepository]);
  const scenarioDirectory = path.join(
    temporaryRepository,
    'tmp',
    'ux-review',
    '2026-09-01',
    '01.contract-test'
  );
  const reviewDirectory = path.join(scenarioDirectory, 'review-01');
  const guideDirectory = path.join(scenarioDirectory, 'guide-01');
  await mkdir(reviewDirectory, { recursive: true });
  await mkdir(guideDirectory);

  const scenario = JSON.parse(
    await readFile(path.join(skillRoot, 'assets', 'user-scenario.template.json'), 'utf8')
  );
  scenario.mutationPolicy = { mode: 'read-only', allowed: [], cleanup: [] };
  const scenarioPath = path.join(scenarioDirectory, `${scenario.id}-scenario.json`);
  const baselinePath = path.join(scenarioDirectory, 'consistency-baseline.md');
  const uxReviewPath = path.join(reviewDirectory, `${scenario.id}-ux-review.md`);
  await writeJson(scenarioPath, scenario);
  await writeFile(baselinePath, '# Test baseline\n', 'utf8');
  await writeFile(uxReviewPath, '# Test UX review\n', 'utf8');

  await nodeScript('approve-scenario.mjs', [scenarioPath, '--by', 'contract-test']);
  const scenarioApprovalPath = path.join(
    scenarioDirectory,
    `${scenario.id}-scenario-approval.json`
  );
  await copyFile(scenarioPath, path.join(reviewDirectory, path.basename(scenarioPath)));
  await copyFile(scenarioApprovalPath, path.join(reviewDirectory, path.basename(scenarioApprovalPath)));

  const sourceRevision = 'contract-test-revision';
  const environmentFingerprint = sha256(
    JSON.stringify({
      baseUrlOrigin: 'https://example.test',
      locale: scenario.environment.locale,
      viewport: scenario.environment.viewport,
      sourceRevision,
    })
  );
  const videoFixture = path.join(temporaryRepository, 'fixture.webm');
  await run('ffmpeg', [
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=320x240:rate=10:duration=2',
    '-c:v',
    'libvpx-vp9',
    '-an',
    videoFixture,
  ]);
  for (const journey of scenario.journeys) {
    await writeJourneyArtifacts({
      directory: reviewDirectory,
      phase: 'review',
      journey,
      scenario,
      sourceRevision,
      environmentFingerprint,
      videoFixture,
    });
  }
  await nodeScript('validate-artifacts.mjs', [reviewDirectory, '--phase', 'review']);

  const decisionDraftPath = path.join(scenarioDirectory, 'decision-draft.json');
  await writeJson(decisionDraftPath, {
    schemaVersion: 1,
    readiness: 'ready',
    findings: [],
    hardGates: [
      'task-completion',
      'data-safety',
      'accessibility',
      'state-visibility',
      'runtime-reliability',
      'product-consistency',
    ].map((id) => ({ id, status: 'resolved', evidence: 'contract test' })),
  });
  await nodeScript('approve-review-decision.mjs', [
    decisionDraftPath,
    '--scenario',
    scenarioPath,
    '--review-directory',
    reviewDirectory,
    '--ux-review',
    uxReviewPath,
    '--baseline',
    baselinePath,
    '--by',
    'contract-test',
  ]);
  const reviewDecisionPath = path.join(scenarioDirectory, `${scenario.id}-review-decision.json`);
  await nodeScript('approve-guide.mjs', [
    scenarioPath,
    '--by',
    'contract-test',
    '--review-decision',
    reviewDecisionPath,
  ]);
  const guideApprovalPath = path.join(scenarioDirectory, `${scenario.id}-guide-approval.json`);
  const scenarioApproval = JSON.parse(await readFile(scenarioApprovalPath, 'utf8'));
  const guideApproval = JSON.parse(await readFile(guideApprovalPath, 'utf8'));
  await nodeScript('record-guide-request.mjs', [
    scenarioPath,
    '--requested-by',
    'contract-test',
    '--request',
    'Create the guide video directly without a UX review gate.',
  ]);
  const directGuideRequest = JSON.parse(
    await readFile(path.join(scenarioDirectory, `${scenario.id}-direct-guide-request.json`), 'utf8')
  );
  process.env[scenario.environment.baseUrlEnvironmentVariable] = 'https://example.test';
  process.env[scenario.environment.sourceRevisionEnvironmentVariable] = sourceRevision;
  await verifyRecorderOrder({
    directory: path.join(scenarioDirectory, 'guide-02'),
    phase: 'guide',
    scenario,
    scenarioApproval,
    guideApproval,
    videoFixture,
  });
  const directGuideDirectory = path.join(scenarioDirectory, 'guide-03');
  await verifyRecorderOrder({
    directory: directGuideDirectory,
    phase: 'guide',
    scenario,
    scenarioApproval: null,
    guideApproval: null,
    directGuideRequest,
    videoFixture,
    useInteractionHelpers: true,
  });
  await nodeScript('validate-artifacts.mjs', [directGuideDirectory, '--phase', 'guide']);
  const directGuideExecution = JSON.parse(
    await readFile(path.join(directGuideDirectory, `${scenario.id}-guide-execution.json`), 'utf8')
  );
  const criticalStepCount = scenario.journeys.find(({ kind }) => kind === 'critical').steps.length;
  if (
    directGuideExecution.interactionCounts.clicks !== criticalStepCount ||
    directGuideExecution.interactionCounts.fills !== criticalStepCount ||
    directGuideExecution.interactionCounts.targetHighlights !== criticalStepCount * 2 ||
    directGuideExecution.interactionPacing.typeDelayMs < 80 ||
    directGuideExecution.interactionPacing.clickDelayMs < 200
  ) {
    throw new Error('Guide execution did not record slow highlighted interactions.');
  }
  await verifyRecorderOrder({
    directory: path.join(scenarioDirectory, 'review-02'),
    phase: 'review',
    scenario,
    scenarioApproval,
    guideApproval: null,
    videoFixture,
  });
  const failedReviewDirectory = path.join(scenarioDirectory, 'review-03');
  await verifyRecorderOrder({
    directory: failedReviewDirectory,
    phase: 'review',
    scenario,
    scenarioApproval,
    guideApproval: null,
    directGuideRequest: null,
    videoFixture,
    stopAfter: 1,
    terminal: {
      status: 'failed',
      failure: { category: 'product', message: 'Primary action did not complete.' },
    },
  });
  await writeFile(
    path.join(failedReviewDirectory, `${scenario.id}-ux-review.md`),
    '# Failed journey evidence\n',
    'utf8'
  );
  const failedValidation = JSON.parse(
    (await nodeScript('validate-artifacts.mjs', [failedReviewDirectory, '--phase', 'review'])).stdout
  );
  if (
    failedValidation.recordings[0].status !== 'failed' ||
    failedValidation.coverageGaps.length === 0
  ) {
    throw new Error('Failed review evidence was not preserved with explicit coverage gaps.');
  }
  await expectFailure(() =>
    nodeScript('approve-review-decision.mjs', [
      decisionDraftPath,
      '--scenario',
      scenarioPath,
      '--review-directory',
      failedReviewDirectory,
      '--ux-review',
      path.join(failedReviewDirectory, `${scenario.id}-ux-review.md`),
      '--baseline',
      baselinePath,
      '--by',
      'contract-test',
    ])
  );
  const directBundleRequestPath = path.join(
    directGuideDirectory,
    `${scenario.id}-direct-guide-request.json`
  );
  const tamperedDirectRequest = JSON.parse(await readFile(directBundleRequestPath, 'utf8'));
  tamperedDirectRequest.claimsUxReviewReadiness = true;
  await writeJson(directBundleRequestPath, tamperedDirectRequest);
  await expectFailure(() =>
    nodeScript('validate-artifacts.mjs', [directGuideDirectory, '--phase', 'guide'])
  );
  await copyFile(scenarioPath, path.join(guideDirectory, path.basename(scenarioPath)));
  await copyFile(scenarioApprovalPath, path.join(guideDirectory, path.basename(scenarioApprovalPath)));
  await copyFile(guideApprovalPath, path.join(guideDirectory, path.basename(guideApprovalPath)));
  await writeJourneyArtifacts({
    directory: guideDirectory,
    phase: 'guide',
    journey: scenario.journeys.find(({ kind }) => kind === 'critical'),
    scenario,
    sourceRevision,
    environmentFingerprint,
    videoFixture,
  });
  await nodeScript('validate-artifacts.mjs', [guideDirectory, '--phase', 'guide']);

  const guideCritical = scenario.journeys.find(({ kind }) => kind === 'critical');
  const splitStep = guideCritical.steps[0].step;
  const writeGuide = (captionSegmentsFor) =>
    writeJourneyArtifacts({
      directory: guideDirectory,
      phase: 'guide',
      journey: guideCritical,
      scenario,
      sourceRevision,
      environmentFingerprint,
      videoFixture,
      captionSegmentsFor,
    });
  await writeGuide((step) =>
    step.step === splitStep ? splitCaptionInHalf(step.caption) : [step.caption]
  );
  await nodeScript('validate-artifacts.mjs', [guideDirectory, '--phase', 'guide']);
  await writeGuide((step) =>
    step.step === splitStep ? ['승인되지 않은 다른 문장'] : [step.caption]
  );
  await expectFailure(() =>
    nodeScript('validate-artifacts.mjs', [guideDirectory, '--phase', 'guide'])
  );
  await writeGuide((step) => [step.caption]);
  await nodeScript('validate-artifacts.mjs', [guideDirectory, '--phase', 'guide']);

  await writeFile(uxReviewPath, '# Tampered review\n', 'utf8');
  await expectFailure(() =>
    nodeScript('validate-artifacts.mjs', [guideDirectory, '--phase', 'guide'])
  );

  const noAction = structuredClone(scenario);
  noAction.journeys.find(({ kind }) => kind === 'critical').steps[1].stage = 'recovery';
  if (!validateScenario(noAction).some((failure) => failure.includes('must contain an action'))) {
    throw new Error('Scenario validator accepted a critical journey without an action.');
  }
  const emptySetup = structuredClone(scenario);
  emptySetup.prerequisites = [];
  emptySetup.dataSetup = [];
  if (validateScenario(emptySetup).length > 0) {
    throw new Error('Scenario validator rejected valid empty prerequisites or dataSetup.');
  }

  const allocatedScenario = JSON.parse(
    (
      await nodeScript('allocate-output.mjs', [
        'scenario',
        temporaryRepository,
        'allocator-test',
        '--date',
        '2026-09-02',
      ])
    ).stdout
  );
  const firstPass = JSON.parse(
    (await nodeScript('allocate-output.mjs', ['pass', allocatedScenario.directory, 'review'])).stdout
  );
  const secondPass = JSON.parse(
    (await nodeScript('allocate-output.mjs', ['pass', allocatedScenario.directory, 'review'])).stdout
  );
  if (!firstPass.directory.endsWith('review-01') || !secondPass.directory.endsWith('review-02')) {
    throw new Error('Pass allocator did not increment atomically.');
  }

  console.log('OK: ux-review contract and approval chain passed');
} finally {
  await rm(temporaryRepository, { recursive: true, force: true });
}

async function writeJourneyArtifacts({
  directory,
  phase,
  journey,
  scenario,
  sourceRevision,
  environmentFingerprint,
  videoFixture,
  captionSegmentsFor = (step) => [step.caption],
}) {
  const prefix =
    journey.kind === 'critical'
      ? `${scenario.id}-${phase}`
      : `${scenario.id}-${phase}-${journey.id}`;
  const steps = journey.steps.map(({ step, evidenceSlug }, index) => ({
    sequence: index + 1,
    step,
    evidenceSlug,
  }));
  await writeJson(path.join(directory, `${prefix}-execution.json`), {
    schemaVersion: 2,
    scenarioId: scenario.id,
    scenarioHash: scenarioHash(scenario),
    journeyId: journey.id,
    journeyKind: journey.kind,
    phase,
    status: 'completed',
    authorizationMode: 'reviewed',
    sourceRevision,
    environmentFingerprint,
    environment: scenario.environment,
    mutationMode: scenario.mutationPolicy.mode,
    startedAt: '2026-09-01T00:00:00.000Z',
    completedAt: '2026-09-01T00:00:03.000Z',
    durationMs: 3000,
    failure: null,
    steps,
  });
  const cueTexts = [];
  const stepCues = journey.steps.map((step) => {
    const segments = captionSegmentsFor(step);
    const startIndex = cueTexts.length;
    cueTexts.push(...segments);
    return { segments, startIndex };
  });
  await writeJson(
    path.join(directory, `${prefix}-observations.json`),
    journey.steps.map((step, index) => ({
      sequence: index + 1,
      journeyId: journey.id,
      journeyKind: journey.kind,
      ...step,
      url: 'https://example.test/work',
      locale: 'ko-KR',
      viewportWidth: scenario.environment.viewport.width,
      viewportHeight: scenario.environment.viewport.height,
      documentWidth: scenario.environment.viewport.width,
      horizontalOverflow: 0,
      unnamedControls: 0,
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
      responseErrors: [],
      graphqlErrors: [],
      cueStartMs: stepCues[index].startIndex * 1000,
      cueEndMs: (stepCues[index].startIndex + stepCues[index].segments.length) * 1000,
      captionSegments: stepCues[index].segments,
    }))
  );
  await writeJson(path.join(directory, `${prefix}-mutation-ledger.json`), {
    mutations: [],
    cleanupCompleted: true,
  });
  const srtTime = (seconds) => `00:00:${String(seconds).padStart(2, '0')},000`;
  const cues = cueTexts
    .map((text, index) => `${index + 1}\n${srtTime(index)} --> ${srtTime(index + 1)}\n${text}\n`)
    .join('\n');
  await writeFile(path.join(directory, `${prefix}.srt`), cues, 'utf8');
  if (phase === 'guide') {
    await writeJson(
      path.join(directory, `${prefix}-chapters.json`),
      journey.steps.map((step, index) => ({
        step: step.step,
        title: step.goal,
        startMs: stepCues[index].startIndex * 1000,
      }))
    );
  }
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2KXcAAAAASUVORK5CYII=',
    'base64'
  );
  for (let index = 0; index < journey.steps.length; index += 1) {
    await writeFile(
      path.join(
        directory,
        `${prefix}-${String(index + 1).padStart(2, '0')}-${journey.steps[index].evidenceSlug}.png`
      ),
      png
    );
  }
  await copyFile(videoFixture, path.join(directory, `${prefix}.webm`));
}

async function verifyRecorderOrder({
  directory,
  phase,
  scenario,
  scenarioApproval,
  guideApproval,
  directGuideRequest = null,
  videoFixture,
  stopAfter = null,
  terminal = null,
  useInteractionHelpers = false,
}) {
  await mkdir(directory);
  const events = [];
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2KXcAAAAASUVORK5CYII=',
    'base64'
  );
  const page = {
    on() {},
    async evaluate(_callback, payload) {
      if (payload?.caption) {
        events.push('caption');
        return undefined;
      }
      if (payload?.styleId === 'ux-journey-target-style') {
        events.push('highlight-style');
        return undefined;
      }
      return {
        url: 'https://example.test/work',
        locale: 'ko-KR',
        viewportWidth: scenario.environment.viewport.width,
        viewportHeight: scenario.environment.viewport.height,
        documentWidth: scenario.environment.viewport.width,
        horizontalOverflow: 0,
        unnamedControls: 0,
      };
    },
    locator(selector) {
      return {
        async evaluateAll() {
          if (selector.includes('data-ux-journey-target')) events.push('highlight-clear');
        },
      };
    },
    async waitForTimeout(milliseconds) {
      events.push(`wait:${milliseconds}`);
      await new Promise((resolve) => setTimeout(resolve, 2));
    },
    async screenshot({ path: screenshotPath }) {
      events.push('screenshot');
      await writeFile(screenshotPath, png);
    },
    video() {
      return {
        async saveAs(target) {
          await copyFile(videoFixture, target);
        },
        async delete() {},
      };
    },
    async close() {},
  };
  const target = {
    async scrollIntoViewIfNeeded() {
      events.push('target-scroll');
    },
    async evaluate() {
      events.push('target-highlight');
    },
    async click({ delay } = {}) {
      events.push(`target-click:${delay}`);
    },
    async fill(value) {
      events.push(`target-fill:${value}`);
    },
    async pressSequentially(value, { delay } = {}) {
      events.push(`target-type:${value}:${delay}`);
    },
    async selectOption() {
      events.push('target-select');
    },
    async check() {
      events.push('target-check');
    },
    async uncheck() {
      events.push('target-uncheck');
    },
  };
  const context = { async close() {} };
  const recorder = createJourneyRecorder({
    page,
    context,
    scenario,
    journeyId: 'critical',
    phase,
    scenarioApproval,
    guideApproval,
    directGuideRequest,
    outputDirectory: directory,
    getMutationLedger: async () => ({ mutations: [], cleanupCompleted: true }),
  });
  const criticalSteps = scenario.journeys.find(({ kind }) => kind === 'critical').steps;
  const stepsToRecord = stopAfter === null ? criticalSteps : criticalSteps.slice(0, stopAfter);
  for (const step of stepsToRecord) {
    await recorder.step(step.step, async (_expectedStep, ui) => {
      if (useInteractionHelpers) {
        await ui.fill(target, 'demo');
        await ui.click(target);
      }
      events.push('action');
    });
  }
  await recorder.finish(terminal || undefined);
  const captionIndex = events.indexOf('caption');
  const actionIndex = events.indexOf('action');
  const screenshotIndex = events.indexOf('screenshot');
  if (phase === 'guide' && !(captionIndex < actionIndex && actionIndex < screenshotIndex)) {
    throw new Error('Guide recorder order must be caption, action, then clean screenshot.');
  }
  if (
    phase === 'review' &&
    stepsToRecord.length > 0 &&
    !(actionIndex < screenshotIndex && screenshotIndex < captionIndex)
  ) {
    throw new Error('Review recorder order must be action, clean screenshot, then result caption.');
  }
  if (useInteractionHelpers) {
    const highlightIndex = events.indexOf('target-highlight');
    const clickEvent = events.find((event) => event.startsWith('target-click:'));
    const typeEvent = events.find((event) => event.startsWith('target-type:'));
    const clickIndex = events.indexOf(clickEvent);
    const clearAfterClickIndex = events.findIndex(
      (event, index) => index > clickIndex && event === 'highlight-clear'
    );
    if (
      !(highlightIndex >= 0 && highlightIndex < clickIndex && clearAfterClickIndex < screenshotIndex)
    ) {
      throw new Error('Interaction helper did not highlight before action and clear before screenshot.');
    }
    if (Number(clickEvent.split(':').at(-1)) < 200) {
      throw new Error('Guide click delay is too short.');
    }
    if (Number(typeEvent.split(':').at(-1)) < 80) {
      throw new Error('Guide typing delay is too short.');
    }
    if (!events.some((event) => event === 'wait:900')) {
      throw new Error('Guide target highlight lead time is missing.');
    }
  }
}

function splitCaptionInHalf(caption) {
  const words = caption.split(' ');
  const middle = Math.ceil(words.length / 2);
  return [words.slice(0, middle).join(' '), words.slice(middle).join(' ')];
}

async function nodeScript(name, args) {
  return run(process.execPath, [path.join(skillRoot, 'scripts', name), ...args]);
}

async function run(command, args) {
  return execFileAsync(command, args, { maxBuffer: 10 * 1024 * 1024 });
}

async function expectFailure(operation) {
  try {
    await operation();
  } catch {
    return;
  }
  throw new Error('Expected operation to fail.');
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
