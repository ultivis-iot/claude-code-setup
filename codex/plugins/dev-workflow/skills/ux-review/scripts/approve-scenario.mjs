#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { findRepositoryRoot, toRepositoryRelativePath } from './repository-paths.mjs';
import { scenarioHash, validateScenario } from './scenario-contract.mjs';

const args = process.argv.slice(2);
const scenarioPath = args[0] ? path.resolve(args[0]) : null;
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const approvedBy = option('--by');

if (!scenarioPath || !approvedBy) {
  console.error('Usage: approve-scenario.mjs <scenario.json> --by <approver>');
  process.exitCode = 2;
} else {
  const repositoryRoot = await findRepositoryRoot(scenarioPath);
  const scenario = JSON.parse(await readFile(scenarioPath, 'utf8'));
  const failures = validateScenario(scenario);
  if (failures.length > 0) throw new Error(failures.join('\n'));
  const approval = {
    schemaVersion: 2,
    approvalType: 'review-scenario',
    scenarioId: scenario.id,
    scenarioHash: scenarioHash(scenario),
    approvedAt: new Date().toISOString(),
    approvedBy,
    pathBase: 'repository-root',
    scenarioFile: toRepositoryRelativePath(repositoryRoot, scenarioPath, 'scenario file'),
  };
  const approvalPath = path.join(
    path.dirname(scenarioPath),
    `${scenario.id}-scenario-approval.json`
  );
  await writeFile(approvalPath, `${JSON.stringify(approval, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ approvalPath, ...approval }, null, 2));
}
