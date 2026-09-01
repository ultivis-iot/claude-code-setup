#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  directorySha256,
  fileSha256,
  findRepositoryRoot,
  toRepositoryRelativePath,
} from './repository-paths.mjs';
import { scenarioHash, validateScenario } from './scenario-contract.mjs';

const execFileAsync = promisify(execFile);

const args = process.argv.slice(2);
const draftPath = args[0] ? path.resolve(args[0]) : null;
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const scenarioPath = option('--scenario') ? path.resolve(option('--scenario')) : null;
const reviewDirectory = option('--review-directory')
  ? path.resolve(option('--review-directory'))
  : null;
const uxReviewPath = option('--ux-review') ? path.resolve(option('--ux-review')) : null;
const baselinePath = option('--baseline') ? path.resolve(option('--baseline')) : null;
const approvedBy = option('--by');

if (!draftPath || !scenarioPath || !reviewDirectory || !uxReviewPath || !baselinePath || !approvedBy) {
  console.error(
    'Usage: approve-review-decision.mjs <decision-draft.json> --scenario <scenario.json> --review-directory <review-NN> --ux-review <review.md> --baseline <consistency-baseline.md> --by <approver>'
  );
  process.exitCode = 2;
} else {
  const repositoryRoot = await findRepositoryRoot(scenarioPath);
  const scenario = JSON.parse(await readFile(scenarioPath, 'utf8'));
  const failures = validateScenario(scenario);
  if (failures.length > 0) throw new Error(failures.join('\n'));
  const hash = scenarioHash(scenario);
  const scenarioFile = toRepositoryRelativePath(repositoryRoot, scenarioPath, 'scenario file');
  const scenarioApprovalPath = path.join(
    path.dirname(scenarioPath),
    `${scenario.id}-scenario-approval.json`
  );
  const scenarioApproval = JSON.parse(await readFile(scenarioApprovalPath, 'utf8'));
  if (
    scenarioApproval.schemaVersion !== 2 ||
    scenarioApproval.approvalType !== 'review-scenario' ||
    scenarioApproval.scenarioId !== scenario.id ||
    scenarioApproval.scenarioHash !== hash ||
    scenarioApproval.pathBase !== 'repository-root' ||
    scenarioApproval.scenarioFile !== scenarioFile
  ) {
    throw new Error('Scenario approval does not match the exact repository scenario.');
  }

  for (const [target, label] of [
    [draftPath, 'decision draft'],
    [reviewDirectory, 'review directory'],
    [uxReviewPath, 'UX review file'],
    [baselinePath, 'consistency baseline'],
  ]) {
    toRepositoryRelativePath(repositoryRoot, target, label);
  }
  if (!/^review-\d{2}$/.test(path.basename(reviewDirectory))) {
    throw new Error('review directory must be named review-NN');
  }

  const draft = JSON.parse(await readFile(draftPath, 'utf8'));
  const decisionFailures = validateDecisionDraft(draft);
  if (decisionFailures.length > 0) throw new Error(decisionFailures.join('\n'));

  await execFileAsync(process.execPath, [
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'validate-artifacts.mjs'),
    reviewDirectory,
    '--phase',
    'review',
  ]);

  const executionFiles = (await readdir(reviewDirectory)).filter((entry) =>
    entry.endsWith('-execution.json')
  );
  if (executionFiles.length === 0) throw new Error('Review directory has no execution files.');
  const executions = await Promise.all(
    executionFiles.map(async (entry) =>
      JSON.parse(await readFile(path.join(reviewDirectory, entry), 'utf8'))
    )
  );
  const reviewedJourneyIds = new Set(executions.map(({ journeyId }) => journeyId));
  if (
    executions.length !== scenario.journeys.length ||
    scenario.journeys.some(({ id }) => !reviewedJourneyIds.has(id)) ||
    executions.some(({ status }) => status !== 'completed')
  ) {
    throw new Error(
      'Guide readiness requires completed evidence for the critical journey and every recovery journey.'
    );
  }
  const sourceRevisions = new Set(executions.map(({ sourceRevision }) => sourceRevision).filter(Boolean));
  const environmentFingerprints = new Set(
    executions.map(({ environmentFingerprint }) => environmentFingerprint).filter(Boolean)
  );
  if (sourceRevisions.size !== 1) {
    throw new Error('Review executions must share one non-empty sourceRevision.');
  }
  if (environmentFingerprints.size !== 1) {
    throw new Error('Review executions must share one non-empty environmentFingerprint.');
  }

  const decision = {
    schemaVersion: 1,
    approvalType: 'review-decision',
    scenarioId: scenario.id,
    scenarioHash: hash,
    approvedAt: new Date().toISOString(),
    approvedBy,
    pathBase: 'repository-root',
    scenarioFile,
    scenarioApprovalFile: toRepositoryRelativePath(
      repositoryRoot,
      scenarioApprovalPath,
      'scenario approval file'
    ),
    baselineFile: toRepositoryRelativePath(repositoryRoot, baselinePath, 'consistency baseline'),
    baselineHash: await fileSha256(baselinePath),
    reviewDirectory: toRepositoryRelativePath(repositoryRoot, reviewDirectory, 'review directory'),
    reviewBundleHash: await directorySha256(reviewDirectory),
    uxReviewFile: toRepositoryRelativePath(repositoryRoot, uxReviewPath, 'UX review file'),
    uxReviewHash: await fileSha256(uxReviewPath),
    sourceRevision: [...sourceRevisions][0],
    environmentFingerprint: [...environmentFingerprints][0],
    readiness: draft.readiness,
    findings: draft.findings,
    hardGates: draft.hardGates,
  };
  const decisionPath = path.join(path.dirname(scenarioPath), `${scenario.id}-review-decision.json`);
  await writeFile(decisionPath, `${JSON.stringify(decision, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ decisionPath, ...decision }, null, 2));
}

function validateDecisionDraft(draft) {
  const failures = [];
  const readinessValues = new Set(['ready', 'ready-with-deferred-findings']);
  const severities = new Set(['P0', 'P1', 'P2']);
  const dispositions = new Set(['fixed', 'deferred', 'rejected', 'evidence-needed']);
  const hardGateIds = new Set([
    'task-completion',
    'data-safety',
    'accessibility',
    'state-visibility',
    'runtime-reliability',
    'product-consistency',
  ]);
  if (draft?.schemaVersion !== 1) failures.push('schemaVersion must be 1');
  if (!readinessValues.has(draft?.readiness)) failures.push('readiness is invalid');
  if (!Array.isArray(draft?.findings)) {
    failures.push('findings must be an array');
  } else {
    const ids = new Set();
    draft.findings.forEach((finding, index) => {
      const field = `findings[${index}]`;
      if (typeof finding.id !== 'string' || !finding.id.trim()) failures.push(`${field}.id is required`);
      if (ids.has(finding.id)) failures.push(`${field}.id must be unique`);
      ids.add(finding.id);
      if (!severities.has(finding.severity)) failures.push(`${field}.severity is invalid`);
      if (!dispositions.has(finding.disposition)) failures.push(`${field}.disposition is invalid`);
      if (['deferred', 'rejected'].includes(finding.disposition) && !finding.rationale?.trim()) {
        failures.push(`${field}.rationale is required for ${finding.disposition}`);
      }
      if (finding.disposition === 'evidence-needed') failures.push(`${field} still needs evidence`);
      if (['P0', 'P1'].includes(finding.severity) && finding.disposition === 'deferred') {
        failures.push(`${field} cannot defer a ${finding.severity} finding`);
      }
      if (draft.readiness === 'ready' && finding.disposition === 'deferred') {
        failures.push(`${field} is deferred but readiness is ready`);
      }
    });
  }
  if (!Array.isArray(draft?.hardGates)) {
    failures.push('hardGates must be an array');
  } else {
    const gateIds = new Set();
    draft.hardGates.forEach((gate, index) => {
      const field = `hardGates[${index}]`;
      if (!hardGateIds.has(gate.id)) failures.push(`${field}.id is invalid`);
      if (gateIds.has(gate.id)) failures.push(`${field}.id must be unique`);
      gateIds.add(gate.id);
      if (!['resolved', 'not-applicable'].includes(gate.status)) {
        failures.push(`${field}.status must be resolved or not-applicable`);
      }
      if (!gate.evidence?.trim()) {
        failures.push(`${field}.evidence is required for every hard-gate status`);
      }
    });
    for (const gateId of hardGateIds) {
      if (!gateIds.has(gateId)) failures.push(`hardGates must include ${gateId}`);
    }
  }
  return failures;
}
