#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  directorySha256,
  fileSha256,
  findRepositoryRoot,
  resolveRepositoryRelativePath,
  toRepositoryRelativePath,
} from './repository-paths.mjs';
import { scenarioHash, validateScenario } from './scenario-contract.mjs';

const args = process.argv.slice(2);
const scenarioPath = args[0] ? path.resolve(args[0]) : null;
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const approvedBy = option('--by');
const reviewDecisionPath = option('--review-decision')
  ? path.resolve(option('--review-decision'))
  : null;

if (!scenarioPath || !approvedBy || !reviewDecisionPath) {
  console.error(
    'Usage: approve-guide.mjs <scenario.json> --by <approver> --review-decision <approved-review-decision.json>'
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

  toRepositoryRelativePath(repositoryRoot, reviewDecisionPath, 'review decision file');
  const reviewDecision = JSON.parse(await readFile(reviewDecisionPath, 'utf8'));
  if (
    reviewDecision.schemaVersion !== 1 ||
    reviewDecision.approvalType !== 'review-decision' ||
    reviewDecision.scenarioId !== scenario.id ||
    reviewDecision.scenarioHash !== hash ||
    reviewDecision.pathBase !== 'repository-root' ||
    !reviewDecision.sourceRevision?.trim() ||
    !reviewDecision.environmentFingerprint?.trim() ||
    !['ready', 'ready-with-deferred-findings'].includes(reviewDecision.readiness)
  ) {
    throw new Error('Review decision is not guide-ready for this scenario.');
  }
  if (
    !Array.isArray(reviewDecision.hardGates) ||
    reviewDecision.hardGates.length !== 6 ||
    new Set(reviewDecision.hardGates.map(({ id }) => id)).size !== 6 ||
    reviewDecision.hardGates.some(
      ({ id }) =>
        ![
          'task-completion',
          'data-safety',
          'accessibility',
          'state-visibility',
          'runtime-reliability',
          'product-consistency',
        ].includes(id)
    ) ||
    reviewDecision.hardGates.some(({ status }) => !['resolved', 'not-applicable'].includes(status)) ||
    reviewDecision.hardGates.some(({ evidence }) => !evidence?.trim()) ||
    !Array.isArray(reviewDecision.findings) ||
    reviewDecision.findings.some(
      ({ severity, disposition }) =>
        disposition === 'evidence-needed' ||
        (['P0', 'P1'].includes(severity) && disposition === 'deferred') ||
        (reviewDecision.readiness === 'ready' && disposition === 'deferred')
    )
  ) {
    throw new Error('Review decision contains an unresolved guide-readiness blocker.');
  }

  const baselinePath = resolveRepositoryRelativePath(
    repositoryRoot,
    reviewDecision.baselineFile,
    'consistency baseline'
  );
  const uxReviewPath = resolveRepositoryRelativePath(
    repositoryRoot,
    reviewDecision.uxReviewFile,
    'UX review file'
  );
  const reviewDirectory = resolveRepositoryRelativePath(
    repositoryRoot,
    reviewDecision.reviewDirectory,
    'review directory'
  );
  if ((await fileSha256(baselinePath)) !== reviewDecision.baselineHash) {
    throw new Error('Consistency baseline changed after the review decision.');
  }
  if ((await fileSha256(uxReviewPath)) !== reviewDecision.uxReviewHash) {
    throw new Error('UX review changed after the review decision.');
  }
  if ((await directorySha256(reviewDirectory)) !== reviewDecision.reviewBundleHash) {
    throw new Error('Review bundle changed after the review decision.');
  }

  const approval = {
    schemaVersion: 2,
    approvalType: 'guide-readiness',
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
    reviewDecisionFile: toRepositoryRelativePath(
      repositoryRoot,
      reviewDecisionPath,
      'review decision file'
    ),
    reviewDecisionHash: await fileSha256(reviewDecisionPath),
    reviewDirectory: reviewDecision.reviewDirectory,
    reviewBundleHash: reviewDecision.reviewBundleHash,
    baselineFile: reviewDecision.baselineFile,
    baselineHash: reviewDecision.baselineHash,
    uxReviewFile: reviewDecision.uxReviewFile,
    uxReviewHash: reviewDecision.uxReviewHash,
    sourceRevision: reviewDecision.sourceRevision,
    environmentFingerprint: reviewDecision.environmentFingerprint,
    guideReadiness: reviewDecision.readiness,
  };
  const approvalPath = path.join(path.dirname(scenarioPath), `${scenario.id}-guide-approval.json`);
  await writeFile(approvalPath, `${JSON.stringify(approval, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ approvalPath, ...approval }, null, 2));
}
