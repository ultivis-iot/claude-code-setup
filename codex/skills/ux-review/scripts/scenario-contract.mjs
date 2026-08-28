import { createHash } from 'node:crypto';

const experiences = new Set(['beginner', 'intermediate', 'advanced']);
const recordingPolicies = new Set(['disposable-write', 'preview-only', 'read-only']);
const stages = new Set(['orientation', 'action', 'verification', 'handoff', 'recovery']);
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
}

export function scenarioHash(scenario) {
  return createHash('sha256').update(JSON.stringify(canonicalize(scenario))).digest('hex');
}

export function validateScenario(scenario) {
  const failures = [];
  const requiredString = (value, field) => {
    if (typeof value !== 'string' || !value.trim()) failures.push(`${field} is required`);
  };
  const requiredStringArray = (value, field) => {
    if (!Array.isArray(value) || value.length === 0) {
      failures.push(`${field} must contain at least one item`);
      return;
    }
    value.forEach((item, index) => requiredString(item, `${field}[${index}]`));
  };

  if (scenario?.schemaVersion !== 1) failures.push('schemaVersion must be 1');
  requiredString(scenario?.id, 'id');
  if (scenario?.id && !slugPattern.test(scenario.id)) failures.push('id must be kebab-case');
  requiredString(scenario?.title, 'title');
  requiredString(scenario?.product, 'product');
  requiredString(scenario?.audience?.role, 'audience.role');
  if (!experiences.has(scenario?.audience?.experience)) {
    failures.push('audience.experience must be beginner, intermediate, or advanced');
  }
  requiredStringArray(scenario?.audience?.permissions, 'audience.permissions');
  requiredString(scenario?.job?.trigger, 'job.trigger');
  requiredString(scenario?.job?.outcome, 'job.outcome');
  requiredStringArray(scenario?.job?.successCriteria, 'job.successCriteria');
  requiredStringArray(scenario?.prerequisites, 'prerequisites');
  requiredStringArray(scenario?.dataSetup, 'dataSetup');
  requiredString(scenario?.environment?.baseUrlEnvironmentVariable, 'environment.baseUrlEnvironmentVariable');
  requiredString(scenario?.environment?.locale, 'environment.locale');
  if (!Number.isInteger(scenario?.environment?.viewport?.width) || scenario.environment.viewport.width < 240) {
    failures.push('environment.viewport.width must be an integer >= 240');
  }
  if (!Number.isInteger(scenario?.environment?.viewport?.height) || scenario.environment.viewport.height < 240) {
    failures.push('environment.viewport.height must be an integer >= 240');
  }
  if (!recordingPolicies.has(scenario?.recordingPolicy)) {
    failures.push('recordingPolicy is invalid');
  }

  if (!Array.isArray(scenario?.steps) || scenario.steps.length < 3) {
    failures.push('steps must contain orientation, action, and outcome verification');
  } else {
    const stepNumbers = new Set();
    const slugs = new Set();
    scenario.steps.forEach((step, index) => {
      const field = `steps[${index}]`;
      if (!Number.isInteger(step.step) || step.step < 1 || stepNumbers.has(step.step)) {
        failures.push(`${field}.step must be a unique positive integer`);
      }
      stepNumbers.add(step.step);
      if (!stages.has(step.stage)) failures.push(`${field}.stage is invalid`);
      for (const key of ['goal', 'startingState', 'action', 'expected', 'caption', 'evidenceSlug']) {
        requiredString(step[key], `${field}.${key}`);
      }
      if (step.evidenceSlug && !slugPattern.test(step.evidenceSlug)) {
        failures.push(`${field}.evidenceSlug must be kebab-case`);
      }
      if (slugs.has(step.evidenceSlug)) failures.push(`${field}.evidenceSlug must be unique`);
      slugs.add(step.evidenceSlug);
      if (step.caption?.length > 160) failures.push(`${field}.caption must be 160 characters or fewer`);
    });
    if (scenario.steps[0]?.stage !== 'orientation') failures.push('the first step must be orientation');
    if (!['verification', 'handoff'].includes(scenario.steps.at(-1)?.stage)) {
      failures.push('the last step must be verification or handoff');
    }
  }

  if (!Array.isArray(scenario?.recoveryPaths) || scenario.recoveryPaths.length === 0) {
    failures.push('recoveryPaths must contain at least one realistic recovery path');
  } else {
    const stepNumbers = new Set((scenario.steps || []).map(({ step }) => step));
    scenario.recoveryPaths.forEach((recovery, index) => {
      const field = `recoveryPaths[${index}]`;
      requiredString(recovery.id, `${field}.id`);
      requiredString(recovery.trigger, `${field}.trigger`);
      requiredString(recovery.expected, `${field}.expected`);
      if (!Array.isArray(recovery.stepIds) || recovery.stepIds.length === 0) {
        failures.push(`${field}.stepIds must contain at least one step`);
      } else if (recovery.stepIds.some((step) => !stepNumbers.has(step))) {
        failures.push(`${field}.stepIds contains an unknown step`);
      }
    });
  }

  if (!Array.isArray(scenario?.exclusions)) failures.push('exclusions must be an array');
  return failures;
}
