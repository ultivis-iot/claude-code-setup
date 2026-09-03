#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, open, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  directorySha256,
  fileSha256,
  findRepositoryRoot,
  resolveRepositoryRelativePath,
} from './repository-paths.mjs';
import { captionSegmentsMatch, scenarioHash, validateScenario } from './scenario-contract.mjs';

const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);
const outputDirectory = args[0] ? path.resolve(args[0]) : null;
const phaseOption = args.includes('--phase') ? args[args.indexOf('--phase') + 1] : 'all';

if (!outputDirectory || !['review', 'guide', 'all'].includes(phaseOption)) {
  console.error('Usage: validate-artifacts.mjs <output-directory> [--phase review|guide|all]');
  process.exitCode = 2;
} else {
  await validateDirectory(outputDirectory, phaseOption);
}

async function validateDirectory(directory, requestedPhase) {
  const repositoryRoot = await findRepositoryRoot(directory);
  const entries = await readdir(directory);
  const scenarios = entries.filter((entry) => entry.endsWith('-scenario.json')).sort();
  if (scenarios.length !== 1) {
    throw new Error(`Expected exactly one *-scenario.json in ${directory}, found ${scenarios.length}`);
  }
  const phaseFromDirectory = path.basename(directory).match(/^(review|guide)-\d{2}$/)?.[1];
  if (!phaseFromDirectory) throw new Error('Output directory must be named review-NN or guide-NN.');
  if (requestedPhase !== 'all' && requestedPhase !== phaseFromDirectory) {
    throw new Error(`Requested ${requestedPhase} validation for ${path.basename(directory)}.`);
  }
  const phase = phaseFromDirectory;

  const scenario = JSON.parse(await readFile(path.join(directory, scenarios[0]), 'utf8'));
  const failures = validateScenario(scenario);
  if (failures.length > 0) throw new Error(failures.join('\n'));
  const hash = scenarioHash(scenario);
  const scenarioApprovalName = `${scenario.id}-scenario-approval.json`;
  const guideApprovalName = `${scenario.id}-guide-approval.json`;
  const directRequestName = `${scenario.id}-direct-guide-request.json`;
  let authorizationMode = 'reviewed';
  let guideAuthorization = null;
  if (phase === 'review' || entries.includes(guideApprovalName)) {
    if (!entries.includes(scenarioApprovalName)) {
      throw new Error('Reviewed recording is missing its scenario approval.');
    }
    const scenarioApproval = JSON.parse(
      await readFile(path.join(directory, scenarioApprovalName), 'utf8')
    );
    await validateScenarioApproval(repositoryRoot, scenario, hash, scenarioApproval);
  }
  if (phase === 'guide') {
    const hasReviewedApproval = entries.includes(guideApprovalName);
    const hasDirectRequest = entries.includes(directRequestName);
    if (hasReviewedApproval === hasDirectRequest) {
      throw new Error(
        'Guide bundle must contain exactly one authorization: guide approval or direct guide request.'
      );
    }
    if (hasDirectRequest) {
      authorizationMode = 'direct-request';
      guideAuthorization = JSON.parse(
        await readFile(path.join(directory, directRequestName), 'utf8')
      );
      await validateDirectGuideRequest(repositoryRoot, scenario, hash, guideAuthorization);
    } else {
      guideAuthorization = JSON.parse(
        await readFile(path.join(directory, guideApprovalName), 'utf8')
      );
    }
  }

  const journeys =
    phase === 'review'
      ? scenario.journeys
      : scenario.journeys.filter(({ kind }) => kind === 'critical');
  const recordings = [];
  const coverageGaps = [];
  const sourceRevisions = new Set();
  const environmentFingerprints = new Set();
  for (const journey of journeys) {
    const prefix = prefixFor(scenario, phase, journey);
    if (!entries.includes(`${prefix}-execution.json`)) {
      coverageGaps.push({ journeyId: journey.id, reason: 'recording-missing' });
      continue;
    }
    const recording = await validateJourney(
      directory,
      entries,
      scenario,
      hash,
      phase,
      journey,
      authorizationMode
    );
    recordings.push(recording);
    sourceRevisions.add(recording.sourceRevision);
    environmentFingerprints.add(recording.environmentFingerprint);
  }
  if (!recordings.some(({ journeyKind }) => journeyKind === 'critical')) {
    throw new Error('A review bundle must contain the critical journey recording.');
  }
  if (phase === 'guide' && coverageGaps.length > 0) {
    throw new Error('Guide bundle is missing its critical journey recording.');
  }
  if (
    phase === 'review' &&
    coverageGaps.length > 0 &&
    recordings.every(({ status }) => status === 'completed')
  ) {
    throw new Error('A completed review pass must include every approved recovery journey.');
  }
  if (sourceRevisions.size !== 1) {
    throw new Error(`Recordings use different source revisions: ${[...sourceRevisions].join(', ')}`);
  }
  if (environmentFingerprints.size !== 1) {
    throw new Error('Recordings use different environment fingerprints.');
  }

  if (phase === 'review') {
    const uxReviewPath = path.join(directory, `${scenario.id}-ux-review.md`);
    await access(uxReviewPath).catch(() => {
      throw new Error(`Review evaluation is missing: ${uxReviewPath}`);
    });
  } else {
    if (authorizationMode === 'reviewed') {
      await validateGuideApproval(
        repositoryRoot,
        scenario,
        hash,
        guideAuthorization,
        [...sourceRevisions][0],
        [...environmentFingerprints][0]
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        directory,
        phase,
        authorizationMode,
        scenarioId: scenario.id,
        scenarioHash: hash,
        recordings,
        coverageGaps,
      },
      null,
      2
    )
  );
}

function prefixFor(scenario, phase, journey) {
  return journey.kind === 'critical'
    ? `${scenario.id}-${phase}`
    : `${scenario.id}-${phase}-${journey.id}`;
}

async function validateScenarioApproval(repositoryRoot, scenario, hash, approval) {
  if (
    approval.schemaVersion !== 2 ||
    approval.approvalType !== 'review-scenario' ||
    approval.scenarioId !== scenario.id ||
    approval.scenarioHash !== hash ||
    approval.pathBase !== 'repository-root'
  ) {
    throw new Error('Scenario approval does not match the repository scenario.');
  }
  const scenarioPath = resolveRepositoryRelativePath(
    repositoryRoot,
    approval.scenarioFile,
    'approved scenario file'
  );
  const approvedScenario = JSON.parse(await readFile(scenarioPath, 'utf8'));
  if (scenarioHash(approvedScenario) !== hash) {
    throw new Error('Approved repository scenario changed after approval.');
  }
}

async function validateDirectGuideRequest(repositoryRoot, scenario, hash, authorization) {
  if (
    authorization.schemaVersion !== 1 ||
    authorization.authorizationType !== 'direct-guide-request' ||
    authorization.scenarioId !== scenario.id ||
    authorization.scenarioHash !== hash ||
    authorization.pathBase !== 'repository-root' ||
    !authorization.requestedBy?.trim() ||
    !authorization.request?.trim() ||
    authorization.claimsUxReviewReadiness !== false
  ) {
    throw new Error('Direct guide request does not authorize this exact scenario.');
  }
  const scenarioPath = resolveRepositoryRelativePath(
    repositoryRoot,
    authorization.scenarioFile,
    'direct-guide scenario file'
  );
  const boundScenario = JSON.parse(await readFile(scenarioPath, 'utf8'));
  if (scenarioHash(boundScenario) !== hash) {
    throw new Error('Direct-guide repository scenario changed after the request was recorded.');
  }
}

async function validateJourney(
  directory,
  entries,
  scenario,
  hash,
  phase,
  journey,
  authorizationMode
) {
  const prefix = prefixFor(scenario, phase, journey);
  const execution = JSON.parse(
    await readFile(path.join(directory, `${prefix}-execution.json`), 'utf8')
  );
  const observations = JSON.parse(
    await readFile(path.join(directory, `${prefix}-observations.json`), 'utf8')
  );
  const ledger = JSON.parse(
    await readFile(path.join(directory, `${prefix}-mutation-ledger.json`), 'utf8')
  );
  const srt = parseSrt(await readFile(path.join(directory, `${prefix}.srt`), 'utf8'));
  const expectedSteps = journey.steps;

  if (
    execution.schemaVersion !== 2 ||
    execution.phase !== phase ||
    execution.scenarioId !== scenario.id ||
    execution.scenarioHash !== hash ||
    execution.journeyId !== journey.id ||
    execution.journeyKind !== journey.kind ||
    !['completed', 'failed', 'blocked'].includes(execution.status) ||
    execution.authorizationMode !== authorizationMode ||
    !execution.sourceRevision?.trim() ||
    !execution.environmentFingerprint?.trim()
  ) {
    throw new Error(`${prefix}: execution contract mismatch`);
  }
  if (phase === 'guide' && execution.status !== 'completed') {
    throw new Error(`${prefix}: guide execution must be completed`);
  }
  if (JSON.stringify(execution.environment) !== JSON.stringify(scenario.environment)) {
    throw new Error(`${prefix}: execution environment differs from the approved scenario`);
  }
  const recordedStepCount = observations.length;
  if (execution.status === 'completed' && recordedStepCount !== expectedSteps.length) {
    throw new Error(`${prefix}: completed execution has incomplete observations`);
  }
  if (execution.status !== 'completed' && recordedStepCount >= expectedSteps.length) {
    throw new Error(`${prefix}: non-completed execution has no remaining terminal step`);
  }
  const recordedSteps = expectedSteps.slice(0, recordedStepCount);
  compareSteps(`${prefix}: execution`, execution.steps, recordedSteps, false);
  compareSteps(`${prefix}: observations`, observations, recordedSteps, true);
  // 자막이 두 줄을 넘으면 스텝 하나가 큐 여러 개를 갖는다. 큐를 이어 붙이면 승인된 자막과 같아야 한다.
  const expectedCues = [];
  const firstCueIndexByStep = [];
  // 분할 도입 전 번들은 captionSegments 가 없다. 그 경우 예전 규칙(큐 하나 = 자막 전체)으로 본다.
  recordedSteps.forEach((step, index) => {
    const segments = observations[index]?.captionSegments ?? [step.caption];
    if (!captionSegmentsMatch(segments, step.caption)) {
      throw new Error(
        `${prefix}: step ${step.step} caption segments do not reconstruct the approved caption`
      );
    }
    firstCueIndexByStep.push(expectedCues.length);
    expectedCues.push(...segments);
  });
  if (srt.length !== expectedCues.length) {
    throw new Error(`${prefix}: SRT cues ${srt.length}/${expectedCues.length}`);
  }
  srt.forEach((cue, index) => {
    if (cue.index !== index + 1 || cue.text !== expectedCues[index] || cue.endMs <= cue.startMs) {
      throw new Error(`${prefix}: SRT cue ${index + 1} does not match the scenario caption or timing`);
    }
  });
  observations.forEach((observation, index) => {
    for (const field of [
      'consoleErrors',
      'pageErrors',
      'failedRequests',
      'responseErrors',
      'graphqlErrors',
    ]) {
      if (!Array.isArray(observation[field])) {
        throw new Error(`${prefix}: observation ${index + 1} lacks ${field}[]`);
      }
    }
    if (
      observation.viewportWidth !== scenario.environment.viewport.width ||
      observation.viewportHeight !== scenario.environment.viewport.height ||
      !observation.locale?.toLowerCase().startsWith(scenario.environment.locale.toLowerCase())
    ) {
      throw new Error(`${prefix}: observation ${index + 1} environment mismatch`);
    }
  });
  const mutationPolicyViolations = validateMutationLedger(
    prefix,
    scenario.mutationPolicy,
    ledger,
    execution.status
  );

  for (let index = 0; index < recordedSteps.length; index += 1) {
    const screenshot = `${prefix}-${String(index + 1).padStart(2, '0')}-${recordedSteps[index].evidenceSlug}.png`;
    if (!entries.includes(screenshot)) throw new Error(`${prefix}: missing ${screenshot}`);
    await validatePng(path.join(directory, screenshot));
  }
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const screenshotPattern = new RegExp(`^${escapedPrefix}-\\d{2}-.+\\.png$`);
  const unexpectedScreenshots = entries.filter((entry) => screenshotPattern.test(entry));
  if (unexpectedScreenshots.length !== recordedSteps.length) {
    throw new Error(`${prefix}: unexpected screenshot count ${unexpectedScreenshots.length}`);
  }

  let terminal = null;
  if (execution.status === 'completed') {
    if (execution.failure !== null) throw new Error(`${prefix}: completed execution has a failure`);
  } else {
    if (
      execution.failure?.step !== recordedStepCount + 1 ||
      !execution.failure?.category?.trim() ||
      !execution.failure?.message?.trim()
    ) {
      throw new Error(`${prefix}: non-completed execution lacks a valid failure`);
    }
    terminal = JSON.parse(
      await readFile(path.join(directory, `${prefix}-terminal.json`), 'utf8')
    );
    const expectedTerminalStep = expectedSteps[recordedStepCount];
    if (
      terminal.schemaVersion !== 1 ||
      terminal.status !== execution.status ||
      terminal.sequence !== recordedStepCount + 1 ||
      terminal.attemptedStep?.step !== expectedTerminalStep.step ||
      terminal.attemptedStep?.evidenceSlug !== expectedTerminalStep.evidenceSlug ||
      JSON.stringify(terminal.failure) !== JSON.stringify(execution.failure) ||
      !Array.isArray(terminal.captureErrors)
    ) {
      throw new Error(`${prefix}: terminal evidence does not match the failed step`);
    }
    if (terminal.screenshotFile) {
      if (!entries.includes(terminal.screenshotFile)) {
        throw new Error(`${prefix}: terminal screenshot is missing`);
      }
      await validatePng(path.join(directory, terminal.screenshotFile));
    } else if (terminal.captureErrors.length === 0) {
      throw new Error(`${prefix}: missing terminal screenshot must have a capture error`);
    }
  }

  const videoPath = path.join(directory, `${prefix}.webm`);
  const media = await validateWebm(videoPath);
  if (phase === 'guide') {
    const chapters = JSON.parse(
      await readFile(path.join(directory, `${prefix}-chapters.json`), 'utf8')
    );
    if (chapters.length !== recordedSteps.length) throw new Error(`${prefix}: chapter count mismatch`);
    chapters.forEach((chapter, index) => {
      if (
        chapter.step !== expectedSteps[index].step ||
        chapter.title !== expectedSteps[index].goal ||
        chapter.startMs !== srt[firstCueIndexByStep[index]].startMs
      ) {
        throw new Error(`${prefix}: chapter ${index + 1} does not match its cue`);
      }
    });
  }
  return {
    journeyId: journey.id,
    journeyKind: journey.kind,
    status: execution.status,
    steps: recordedSteps.length,
    terminalStep: terminal?.attemptedStep?.step || null,
    mutationPolicyViolations,
    sourceRevision: execution.sourceRevision,
    environmentFingerprint: execution.environmentFingerprint,
    videoBytes: media.bytes,
    durationSeconds: media.durationSeconds,
    dimensions: `${media.width}x${media.height}`,
  };
}

function compareSteps(label, actual, expected, full) {
  if (!Array.isArray(actual) || actual.length !== expected.length) {
    throw new Error(`${label}: step count mismatch`);
  }
  actual.forEach((step, index) => {
    const expectedStep = expected[index];
    if (
      step.sequence !== index + 1 ||
      step.step !== expectedStep.step ||
      step.evidenceSlug !== expectedStep.evidenceSlug ||
      (full &&
        (step.stage !== expectedStep.stage ||
          step.goal !== expectedStep.goal ||
          step.action !== expectedStep.action ||
          step.expected !== expectedStep.expected ||
          step.caption !== expectedStep.caption))
    ) {
      throw new Error(`${label}: step ${index + 1} differs from the approved journey`);
    }
  });
}

function validateMutationLedger(prefix, policy, ledger, status) {
  if (!ledger || !Array.isArray(ledger.mutations) || typeof ledger.cleanupCompleted !== 'boolean') {
    throw new Error(`${prefix}: invalid mutation ledger`);
  }
  const violations = [];
  if (['read-only', 'preview-only'].includes(policy.mode) && ledger.mutations.length > 0) {
    violations.push(`${policy.mode} journey reported mutations`);
  }
  if (policy.mode === 'disposable-write') {
    if (ledger.mutations.some(({ allowed }) => allowed !== true)) {
      violations.push('unapproved mutation');
    }
    if (!ledger.cleanupCompleted) violations.push('cleanup is incomplete');
  }
  if (status === 'completed' && violations.length > 0) {
    throw new Error(`${prefix}: ${violations.join('; ')}`);
  }
  return violations;
}

async function validateGuideApproval(
  repositoryRoot,
  scenario,
  hash,
  approval,
  sourceRevision,
  environmentFingerprint
) {
  if (
    approval.schemaVersion !== 2 ||
    approval.approvalType !== 'guide-readiness' ||
    approval.scenarioId !== scenario.id ||
    approval.scenarioHash !== hash ||
    approval.pathBase !== 'repository-root' ||
    approval.sourceRevision !== sourceRevision ||
    approval.environmentFingerprint !== environmentFingerprint ||
    !['ready', 'ready-with-deferred-findings'].includes(approval.guideReadiness)
  ) {
    throw new Error('Guide approval does not match the guide execution.');
  }
  const checks = [
    ['reviewDecisionFile', 'reviewDecisionHash', fileSha256],
    ['baselineFile', 'baselineHash', fileSha256],
    ['uxReviewFile', 'uxReviewHash', fileSha256],
    ['reviewDirectory', 'reviewBundleHash', directorySha256],
  ];
  for (const [pathField, hashField, hashFunction] of checks) {
    const target = resolveRepositoryRelativePath(repositoryRoot, approval[pathField], pathField);
    if ((await hashFunction(target)) !== approval[hashField]) {
      throw new Error(`${pathField} changed after guide approval.`);
    }
  }
}

function parseSrt(content) {
  return content
    .trim()
    .split(/\r?\n\r?\n/)
    .filter(Boolean)
    .map((block) => {
      const [indexLine, timingLine, ...textLines] = block.split(/\r?\n/);
      const timing = timingLine?.match(/^(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})$/);
      if (!timing) throw new Error(`Invalid SRT timing: ${timingLine}`);
      return {
        index: Number(indexLine),
        startMs: parseSrtTime(timing[1]),
        endMs: parseSrtTime(timing[2]),
        text: textLines.join('\n'),
      };
    });
}

function parseSrtTime(value) {
  const [hours, minutes, rest] = value.split(':');
  const [seconds, millis] = rest.split(',');
  return Number(hours) * 3_600_000 + Number(minutes) * 60_000 + Number(seconds) * 1_000 + Number(millis);
}

async function validatePng(filePath) {
  const header = Buffer.alloc(8);
  const file = await open(filePath, 'r');
  try {
    await file.read(header, 0, 8, 0);
  } finally {
    await file.close();
  }
  if (!header.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error(`Invalid PNG: ${filePath}`);
  }
}

async function validateWebm(filePath) {
  const fileStat = await stat(filePath);
  if (fileStat.size < 4_096) throw new Error(`WebM too small: ${filePath}`);
  const header = Buffer.alloc(4);
  const file = await open(filePath, 'r');
  try {
    await file.read(header, 0, 4, 0);
  } finally {
    await file.close();
  }
  if (!header.equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    throw new Error(`Invalid WebM header: ${filePath}`);
  }
  let width;
  let height;
  let durationSeconds;
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height:format=duration',
      '-of',
      'json',
      filePath,
    ]);
    const probe = JSON.parse(stdout);
    width = Number(probe.streams?.[0]?.width);
    height = Number(probe.streams?.[0]?.height);
    durationSeconds = Number(probe.format?.duration);
  } catch (probeError) {
    try {
      const { stderr } = await execFileAsync('ffmpeg', [
        '-hide_banner',
        '-i',
        filePath,
        '-map',
        '0:v:0',
        '-f',
        'null',
        '-',
      ]);
      const duration = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
      const dimensions = stderr.match(/Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/);
      if (duration) {
        durationSeconds =
          Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
      }
      if (dimensions) {
        width = Number(dimensions[1]);
        height = Number(dimensions[2]);
      }
    } catch (ffmpegError) {
      throw new Error(
        `Neither ffprobe nor ffmpeg could inspect ${filePath}: ${probeError.message}; ${ffmpegError.message}`
      );
    }
  }
  if (!(width > 0 && height > 0 && durationSeconds > 0)) {
    throw new Error(`WebM media metadata is invalid: ${filePath}`);
  }
  return { bytes: fileStat.size, width, height, durationSeconds };
}
