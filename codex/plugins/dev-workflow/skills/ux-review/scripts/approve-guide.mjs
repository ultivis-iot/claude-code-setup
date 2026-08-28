#!/usr/bin/env node

import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { scenarioHash, validateScenario } from './scenario-contract.mjs';

const args = process.argv.slice(2);
const scenarioPath = args[0] ? path.resolve(args[0]) : null;
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const approvedBy = option('--by');
const uxReviewPath = option('--ux-review') ? path.resolve(option('--ux-review')) : null;
const guideReadiness = option('--readiness');
const readinessValues = new Set(['ready', 'ready-with-deferred-findings']);

if (!scenarioPath || !approvedBy || !uxReviewPath || !readinessValues.has(guideReadiness)) {
  console.error(
    'Usage: approve-guide.mjs <scenario.json> --by <approver> --ux-review <review.md> --readiness <ready|ready-with-deferred-findings>'
  );
  process.exitCode = 2;
} else {
  await access(uxReviewPath);
  const scenario = JSON.parse(await readFile(scenarioPath, 'utf8'));
  const failures = validateScenario(scenario);
  if (failures.length > 0) throw new Error(failures.join('\n'));
  const hash = scenarioHash(scenario);
  const scenarioApprovalPath = path.join(
    path.dirname(scenarioPath),
    `${scenario.id}-scenario-approval.json`
  );
  const scenarioApproval = JSON.parse(await readFile(scenarioApprovalPath, 'utf8'));
  if (
    scenarioApproval.approvalType !== 'review-scenario' ||
    scenarioApproval.scenarioId !== scenario.id ||
    scenarioApproval.scenarioHash !== hash
  ) {
    throw new Error('Scenario approval does not match the exact scenario hash.');
  }

  const approval = {
    schemaVersion: 1,
    approvalType: 'guide-readiness',
    scenarioId: scenario.id,
    scenarioHash: hash,
    approvedAt: new Date().toISOString(),
    approvedBy,
    scenarioApprovalFile: path.basename(scenarioApprovalPath),
    uxReviewFile: path.relative(path.dirname(scenarioPath), uxReviewPath),
    guideReadiness,
  };
  const approvalPath = path.join(path.dirname(scenarioPath), `${scenario.id}-guide-approval.json`);
  await writeFile(approvalPath, `${JSON.stringify(approval, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ approvalPath, ...approval }, null, 2));
}
