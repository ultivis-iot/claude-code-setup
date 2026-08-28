#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { scenarioHash, validateScenario } from './scenario-contract.mjs';

const scenarioPath = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!scenarioPath) {
  console.error('Usage: validate-scenario.mjs <scenario.json>');
  process.exitCode = 2;
} else {
  const scenario = JSON.parse(await readFile(scenarioPath, 'utf8'));
  const failures = validateScenario(scenario);
  if (failures.length > 0) throw new Error(failures.join('\n'));
  console.log(JSON.stringify({ scenarioPath, id: scenario.id, hash: scenarioHash(scenario) }, null, 2));
}
