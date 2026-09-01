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
const requestedBy = option('--requested-by');
const request = option('--request');

if (!scenarioPath || !requestedBy?.trim() || !request?.trim()) {
  console.error(
    'Usage: record-guide-request.mjs <scenario.json> --requested-by <requester> --request <request-summary>'
  );
  process.exitCode = 2;
} else {
  const repositoryRoot = await findRepositoryRoot(scenarioPath);
  const scenario = JSON.parse(await readFile(scenarioPath, 'utf8'));
  const failures = validateScenario(scenario);
  if (failures.length > 0) throw new Error(failures.join('\n'));

  const authorization = {
    schemaVersion: 1,
    authorizationType: 'direct-guide-request',
    scenarioId: scenario.id,
    scenarioHash: scenarioHash(scenario),
    recordedAt: new Date().toISOString(),
    requestedBy: requestedBy.trim(),
    request: request.trim(),
    pathBase: 'repository-root',
    scenarioFile: toRepositoryRelativePath(repositoryRoot, scenarioPath, 'scenario file'),
    claimsUxReviewReadiness: false,
  };
  const authorizationPath = path.join(
    path.dirname(scenarioPath),
    `${scenario.id}-direct-guide-request.json`
  );
  await writeFile(authorizationPath, `${JSON.stringify(authorization, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ authorizationPath, ...authorization }, null, 2));
}
