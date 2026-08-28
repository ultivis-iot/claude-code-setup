#!/usr/bin/env node

import { access, open, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { scenarioHash, validateScenario } from './scenario-contract.mjs';

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
  const entries = await readdir(directory);
  const scenarios = entries.filter((entry) => entry.endsWith('-scenario.json')).sort();
  if (scenarios.length === 0) throw new Error(`No *-scenario.json files found in ${directory}`);

  const results = [];
  for (const scenarioFile of scenarios) {
    const scenario = JSON.parse(await readFile(path.join(directory, scenarioFile), 'utf8'));
    const failures = validateScenario(scenario);
    if (failures.length > 0) throw new Error(`${scenarioFile}: ${failures.join(', ')}`);
    const hash = scenarioHash(scenario);
    const scenarioApproval = JSON.parse(
      await readFile(path.join(directory, `${scenario.id}-scenario-approval.json`), 'utf8')
    );
    if (
      scenarioApproval.approvalType !== 'review-scenario' ||
      scenarioApproval.scenarioId !== scenario.id ||
      scenarioApproval.scenarioHash !== hash
    ) {
      throw new Error(`${scenario.id}: scenario approval does not match the scenario hash`);
    }
    const availablePhases = ['review', 'guide'].filter((phase) =>
      entries.includes(`${scenario.id}-${phase}.webm`)
    );
    const phases = requestedPhase === 'all' ? availablePhases : [requestedPhase];
    if (phases.length === 0) throw new Error(`${scenario.id}: no recorded WebM found`);

    for (const phase of phases) {
      const prefix = `${scenario.id}-${phase}`;
      const observations = JSON.parse(
        await readFile(path.join(directory, `${prefix}-observations.json`), 'utf8')
      );
      const execution = JSON.parse(
        await readFile(path.join(directory, `${prefix}-execution.json`), 'utf8')
      );
      const srt = await readFile(path.join(directory, `${prefix}.srt`), 'utf8');
      const videoPath = path.join(directory, `${prefix}.webm`);
      await access(videoPath);
      const video = await stat(videoPath);
      const header = Buffer.alloc(4);
      const file = await open(videoPath, 'r');
      try {
        await file.read(header, 0, 4, 0);
      } finally {
        await file.close();
      }

      const stepCount = scenario.steps.length;
      const cueCount = [...srt.matchAll(/^\d+$/gm)].length;
      const screenshotCount = entries.filter(
        (entry) => entry.startsWith(`${prefix}-`) && entry.endsWith('.png')
      ).length;
      const phaseFailures = [];
      if (execution.phase !== phase) phaseFailures.push(`execution phase=${execution.phase}`);
      if (execution.scenarioId !== scenario.id) phaseFailures.push('execution scenarioId mismatch');
      if (execution.scenarioHash !== hash) phaseFailures.push('execution scenario hash mismatch');
      if (execution.steps?.length !== stepCount) {
        phaseFailures.push(`execution steps ${execution.steps?.length || 0}/${stepCount}`);
      }
      if (observations.length !== stepCount) {
        phaseFailures.push(`observations ${observations.length}/${stepCount}`);
      }
      if (cueCount !== stepCount) phaseFailures.push(`SRT cues ${cueCount}/${stepCount}`);
      if (screenshotCount !== stepCount) {
        phaseFailures.push(`screenshots ${screenshotCount}/${stepCount}`);
      }
      if (video.size < 4_096) phaseFailures.push(`WebM too small (${video.size} bytes)`);
      if (!header.equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
        phaseFailures.push('invalid WebM header');
      }

      if (phase === 'guide') {
        const approval = JSON.parse(
          await readFile(path.join(directory, `${scenario.id}-guide-approval.json`), 'utf8')
        );
        if (
          approval.approvalType !== 'guide-readiness' ||
          approval.scenarioId !== scenario.id ||
          approval.scenarioHash !== hash
        ) {
          phaseFailures.push('guide approval does not match the scenario hash');
        }
        if (approval.scenarioApprovalFile !== `${scenario.id}-scenario-approval.json`) {
          phaseFailures.push('guide approval does not reference the scenario approval');
        }
        if (!['ready', 'ready-with-deferred-findings'].includes(approval.guideReadiness)) {
          phaseFailures.push('guide readiness is missing');
        }
        if (!approval.uxReviewFile) {
          phaseFailures.push('UX review reference is missing');
        } else {
          await access(path.resolve(directory, approval.uxReviewFile)).catch(() => {
            phaseFailures.push('UX review file does not exist');
          });
        }
        const chapters = JSON.parse(
          await readFile(path.join(directory, `${prefix}-chapters.json`), 'utf8')
        );
        if (chapters.length !== stepCount) {
          phaseFailures.push(`chapters ${chapters.length}/${stepCount}`);
        }
      }

      if (phaseFailures.length > 0) {
        throw new Error(`${prefix}: ${phaseFailures.join(', ')}`);
      }
      results.push({ id: scenario.id, phase, steps: stepCount, videoBytes: video.size, hash });
    }
  }

  console.log(JSON.stringify({ directory, recordings: results }, null, 2));
}
