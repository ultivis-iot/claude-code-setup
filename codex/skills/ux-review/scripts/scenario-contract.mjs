import { createHash } from 'node:crypto';

const experiences = new Set(['beginner', 'intermediate', 'advanced']);
const mutationModes = new Set(['disposable-write', 'preview-only', 'read-only']);
const journeyKinds = new Set(['critical', 'recovery']);
const stages = new Set(['orientation', 'action', 'verification', 'handoff', 'recovery']);
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const environmentVariablePattern = /^[A-Z_][A-Z0-9_]*$/;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
}

export function sha256(value) {
  const content = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return createHash('sha256').update(content).digest('hex');
}

export function scenarioHash(scenario) {
  return sha256(JSON.stringify(canonicalize(scenario)));
}

// 자막은 한 번에 두 줄까지만 보여 준다. 두 줄을 넘는 자막은 글꼴을 줄이는 대신
// 어절 경계에서 여러 큐로 나눠 순차 재생한다. 좁은 뷰포트에서는 좌우 폭을 다 쓰는 밴드로 그린다.
export const CAPTION_FULL_BLEED_MAX_VIEWPORT_WIDTH = 768;
export const CAPTION_MAX_LINES = 2;
export const CAPTION_FONT_SIZE = 18;
export const CAPTION_LINE_HEIGHT_RATIO = 1.45;

export function normalizeCaption(caption) {
  return String(caption ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

// 큐를 순서대로 이어 붙이면 승인된 자막과 같아야 한다. recorder 와 validator 가 같은 규칙을 쓴다.
export function captionSegmentsMatch(segments, caption) {
  return (
    Array.isArray(segments) &&
    segments.length > 0 &&
    segments.every((segment) => typeof segment === 'string' && segment.trim()) &&
    segments.map((segment) => normalizeCaption(segment)).join(' ') === normalizeCaption(caption)
  );
}

export function validateScenario(scenario) {
  const failures = [];
  const requiredString = (value, field) => {
    if (typeof value !== 'string' || !value.trim()) failures.push(`${field} is required`);
  };
  const stringArray = (value, field, { nonEmpty = false } = {}) => {
    if (!Array.isArray(value)) {
      failures.push(`${field} must be an array`);
      return;
    }
    if (nonEmpty && value.length === 0) failures.push(`${field} must contain at least one item`);
    value.forEach((item, index) => requiredString(item, `${field}[${index}]`));
  };
  const environmentVariable = (value, field) => {
    requiredString(value, field);
    if (value && !environmentVariablePattern.test(value)) {
      failures.push(`${field} must be an uppercase environment-variable name`);
    }
  };

  if (scenario?.schemaVersion !== 2) failures.push('schemaVersion must be 2');
  requiredString(scenario?.id, 'id');
  if (scenario?.id && !slugPattern.test(scenario.id)) failures.push('id must be kebab-case');
  requiredString(scenario?.title, 'title');
  requiredString(scenario?.product, 'product');
  requiredString(scenario?.audience?.role, 'audience.role');
  if (!experiences.has(scenario?.audience?.experience)) {
    failures.push('audience.experience must be beginner, intermediate, or advanced');
  }
  stringArray(scenario?.audience?.permissions, 'audience.permissions');
  requiredString(scenario?.job?.trigger, 'job.trigger');
  requiredString(scenario?.job?.outcome, 'job.outcome');
  stringArray(scenario?.job?.successCriteria, 'job.successCriteria', { nonEmpty: true });
  stringArray(scenario?.prerequisites, 'prerequisites');
  stringArray(scenario?.dataSetup, 'dataSetup');
  stringArray(scenario?.exclusions, 'exclusions');

  environmentVariable(
    scenario?.environment?.baseUrlEnvironmentVariable,
    'environment.baseUrlEnvironmentVariable'
  );
  environmentVariable(
    scenario?.environment?.sourceRevisionEnvironmentVariable,
    'environment.sourceRevisionEnvironmentVariable'
  );
  requiredString(scenario?.environment?.locale, 'environment.locale');
  if (!Number.isInteger(scenario?.environment?.viewport?.width) || scenario.environment.viewport.width < 240) {
    failures.push('environment.viewport.width must be an integer >= 240');
  }
  if (!Number.isInteger(scenario?.environment?.viewport?.height) || scenario.environment.viewport.height < 240) {
    failures.push('environment.viewport.height must be an integer >= 240');
  }

  const mutationMode = scenario?.mutationPolicy?.mode;
  if (!mutationModes.has(mutationMode)) failures.push('mutationPolicy.mode is invalid');
  stringArray(scenario?.mutationPolicy?.allowed, 'mutationPolicy.allowed');
  stringArray(scenario?.mutationPolicy?.cleanup, 'mutationPolicy.cleanup');
  if (['read-only', 'preview-only'].includes(mutationMode) && scenario?.mutationPolicy?.allowed?.length) {
    failures.push(`${mutationMode} mutationPolicy.allowed must be empty`);
  }
  if (mutationMode === 'disposable-write') {
    if (!scenario?.mutationPolicy?.allowed?.length) {
      failures.push('disposable-write mutationPolicy.allowed must describe permitted writes');
    }
    if (!scenario?.mutationPolicy?.cleanup?.length) {
      failures.push('disposable-write mutationPolicy.cleanup must describe cleanup');
    }
  }

  if (!Array.isArray(scenario?.journeys) || scenario.journeys.length < 2) {
    failures.push('journeys must contain one critical journey and at least one recovery journey');
    return failures;
  }

  const journeyIds = new Set();
  let criticalCount = 0;
  let recoveryCount = 0;
  scenario.journeys.forEach((journey, journeyIndex) => {
    const journeyField = `journeys[${journeyIndex}]`;
    requiredString(journey.id, `${journeyField}.id`);
    if (journey.id && !slugPattern.test(journey.id)) {
      failures.push(`${journeyField}.id must be kebab-case`);
    }
    if (journeyIds.has(journey.id)) failures.push(`${journeyField}.id must be unique`);
    journeyIds.add(journey.id);
    if (!journeyKinds.has(journey.kind)) failures.push(`${journeyField}.kind is invalid`);
    if (journey.kind === 'critical') criticalCount += 1;
    if (journey.kind === 'recovery') {
      recoveryCount += 1;
      requiredString(journey.trigger, `${journeyField}.trigger`);
    }

    if (!Array.isArray(journey.steps) || journey.steps.length === 0) {
      failures.push(`${journeyField}.steps must contain at least one step`);
      return;
    }
    if (journey.kind === 'critical' && journey.steps.length < 3) {
      failures.push(`${journeyField}.steps must contain orientation, action, and verification`);
    }

    const evidenceSlugs = new Set();
    journey.steps.forEach((step, stepIndex) => {
      const field = `${journeyField}.steps[${stepIndex}]`;
      if (step.step !== stepIndex + 1) failures.push(`${field}.step must equal ${stepIndex + 1}`);
      if (!stages.has(step.stage)) failures.push(`${field}.stage is invalid`);
      for (const key of ['goal', 'startingState', 'action', 'expected', 'caption', 'evidenceSlug']) {
        requiredString(step[key], `${field}.${key}`);
      }
      if (step.evidenceSlug && !slugPattern.test(step.evidenceSlug)) {
        failures.push(`${field}.evidenceSlug must be kebab-case`);
      }
      if (evidenceSlugs.has(step.evidenceSlug)) failures.push(`${field}.evidenceSlug must be unique`);
      evidenceSlugs.add(step.evidenceSlug);
      if (step.caption?.length > 160) failures.push(`${field}.caption must be 160 characters or fewer`);
      if (step.narration !== undefined && typeof step.narration !== 'string') {
        failures.push(`${field}.narration must be a string`);
      }
    });

    const journeyStages = journey.steps.map(({ stage }) => stage);
    if (journey.kind === 'critical') {
      if (journey.steps[0]?.stage !== 'orientation') {
        failures.push(`${journeyField} must start with orientation`);
      }
      if (!journeyStages.includes('action')) failures.push(`${journeyField} must contain an action`);
      if (!['verification', 'handoff'].includes(journey.steps.at(-1)?.stage)) {
        failures.push(`${journeyField} must end with verification or handoff`);
      }
    }
    if (journey.kind === 'recovery') {
      if (!journeyStages.includes('recovery')) failures.push(`${journeyField} must contain recovery`);
      if (journey.steps.at(-1)?.stage !== 'verification') {
        failures.push(`${journeyField} must end with verification`);
      }
    }
  });

  if (criticalCount !== 1) failures.push('journeys must contain exactly one critical journey');
  if (recoveryCount < 1) failures.push('journeys must contain at least one recovery journey');
  return failures;
}
