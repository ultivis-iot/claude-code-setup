#!/usr/bin/env node
// Shared local validation contract; does not push or create PRs.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, realpathSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const required = ['intent-validator', 'doc-validator', 'security-validator', 'code-simplifier', 'test-validator'];
const known = [...required, 'cli-validator', 'visual-qa'];
const statuses = ['PASS', 'WARN', 'FAIL', 'SKIP'];
const schema = JSON.parse(readFileSync(new URL('../schemas/validation-status.schema.json', import.meta.url)));
const fail = message => { throw new Error(message); };
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const hashFile = file => existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : null;

// The schema is the structural source of truth; unsupported keywords fail closed.
function validate(value, rule, at = '$') {
  if (rule.$ref) return validate(value, schema.$defs[rule.$ref.split('/').at(-1)], at);
  for (const key of Object.keys(rule)) {
    if (!['$schema', '$id', '$defs', 'title', 'description', 'type', 'required', 'properties', 'additionalProperties', 'items', 'enum', 'const', 'pattern', 'minLength', 'minItems', 'format'].includes(key)) fail(`Unsupported schema keyword: ${key}`);
  }
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (rule.type && !(Array.isArray(rule.type) ? rule.type : [rule.type]).includes(type)) fail(`${at}: expected ${rule.type}`);
  if (rule.const !== undefined && value !== rule.const) fail(`${at}: expected ${rule.const}`);
  if (rule.enum && !rule.enum.includes(value)) fail(`${at}: invalid value`);
  if (type === 'string') {
    if (rule.minLength && value.trim().length < rule.minLength) fail(`${at}: empty string`);
    if (rule.pattern && !new RegExp(rule.pattern).test(value)) fail(`${at}: invalid format`);
    if (rule.format === 'date-time' && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19))) fail(`${at}: invalid UTC timestamp`);
  }
  if (type === 'array') {
    if (rule.minItems && value.length < rule.minItems) fail(`${at}: missing items`);
    value.forEach((item, i) => validate(item, rule.items, `${at}[${i}]`));
  }
  if (type === 'object') {
    for (const key of rule.required || []) if (!(key in value)) fail(`${at}.${key}: required`);
    for (const [key, item] of Object.entries(value)) {
      if (rule.properties?.[key]) validate(item, rule.properties[key], `${at}.${key}`);
      else if (rule.additionalProperties === false) fail(`${at}.${key}: unknown field`);
      else if (typeof rule.additionalProperties === 'object') validate(item, rule.additionalProperties, `${at}.${key}`);
    }
  }
}

function capture(repo, base) {
  const root = realpathSync(git(repo, 'rev-parse', '--show-toplevel'));
  if (git(root, 'status', '--porcelain', '--untracked-files=normal')) fail('Worktree is dirty. Commit code changes and ignore workflow tmp artifacts before validation.');
  const branch = git(root, 'symbolic-ref', '--short', 'HEAD');
  const common = realpathSync(git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
  if (!base || base.startsWith('-')) fail('An explicit base ref is required.');
  return {
    repository: common, branch, base_branch: base,
    head_sha: git(root, 'rev-parse', '--verify', 'HEAD^{commit}'),
    base_sha: git(root, 'rev-parse', '--verify', `${base}^{commit}`),
    plan_sha256: hashFile(path.join(root, 'tmp/current-plan.md')),
    cli_config_sha256: hashFile(path.join(root, '.cli-sync.json')),
    cli_required: existsSync(path.join(root, '.cli-sync.json')) && json(path.join(root, '.cli-sync.json')).enabled === true,
  };
}

function same(actual, expected) {
  for (const key of Object.keys(actual)) if (actual[key] !== expected[key]) fail(`Validation is stale: ${key} changed; rerun commit-and-verify.`);
}

function aggregate(results, errors) {
  if (errors.length || Object.values(results).includes('FAIL')) return 'FAIL';
  return Object.values(results).includes('WARN') ? 'WARN' : 'PASS';
}

function check(data) {
  validate(data, schema);
  if (Date.parse(data.timestamp) < Date.parse(data.snapshot.started_at)) fail('Validation completed before its snapshot.');
  if (data.overall !== aggregate(data.results, data.errors)) fail('overall disagrees with validator results/errors.');
  for (const name of Object.keys(data.results)) {
    if (!data.evidence[name]?.length) fail(`Missing execution/review evidence: ${name}`);
  }
}

function ready(data, repo, base) {
  check(data);
  same(capture(repo, base || data.snapshot.base_branch), data.snapshot);
  if (data.overall === 'FAIL' || data.results['intent-validator'] !== 'PASS') fail('Intent or overall validation failed.');
  for (const name of [...required, ...(data.snapshot.cli_required ? ['cli-validator'] : [])]) {
    if (!['PASS', 'WARN'].includes(data.results[name])) fail(`Required validation did not execute: ${name}`);
  }
}

function save(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  renameSync(temp, file);
}

export function main(args) {
  const mode = args.shift();
  const options = {};
  const positionals = [];
  while (args.length) {
    const arg = args.shift();
    if (arg.startsWith('--')) {
      if (!['--repo', '--base', '--out', '--snapshot', '--results'].includes(arg) || !args.length || args[0].startsWith('--')) fail(`Invalid option: ${arg}`);
      options[arg.slice(2)] = args.shift();
    } else positionals.push(arg);
  }
  const repo = path.resolve(options.repo || '.');
  if (mode === 'snapshot') {
    if (!options.base || !options.out) fail('snapshot --repo <repo> --base <ref> --out <snapshot.json>');
    save(options.out, { schema_version: 2, started_at: new Date().toISOString(), ...capture(repo, options.base) });
  } else if (mode === 'record') {
    if (!options.snapshot || !options.results || !options.out) fail('record --snapshot <file> --results <reviews.json> --out <status.json> --repo <repo>');
    const snapshot = json(options.snapshot);
    validate(snapshot, schema.$defs.snapshot);
    same(capture(repo, snapshot.base_branch), snapshot);
    const input = json(options.results);
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Expected validator result object.');
    const results = {}, evidence = {};
    for (const [name, result] of Object.entries(input)) {
      if (!known.includes(name)) fail(`Unknown validator: ${name}`);
      const allowed = name === 'visual-qa' ? [...statuses, 'PENDING'] : statuses;
      if (!result || !allowed.includes(result.status) || !Array.isArray(result.evidence) || !result.evidence.length || result.evidence.some(x => typeof x !== 'string' || !x.trim())) fail(`Invalid result/evidence: ${name}`);
      results[name] = result.status;
      evidence[name] = result.evidence;
    }
    const data = { schema_version: 2, timestamp: new Date().toISOString(), snapshot, results, evidence, overall: aggregate(results, []), warnings: [], errors: [] };
    check(data);
    save(options.out, data);
  } else if (mode === 'check' || mode === 'ready' || mode === 'pre-push') {
    if (positionals.length !== 1) fail(`${mode} <status.json> [--repo <repo>] [--base <ref>]`);
    const data = json(positionals[0]);
    if (mode === 'check') check(data);
    else {
      ready(data, repo, options.base);
      if (mode === 'pre-push') {
        const updates = readFileSync(0, 'utf8').trim().split('\n').filter(Boolean);
        for (const update of updates) {
          const fields = update.trim().split(/\s+/);
          if (fields.length !== 4) fail('Invalid pre-push update.');
          const [localRef, localSha, remoteRef] = fields;
          const currentBranch = localRef === `refs/heads/${data.snapshot.branch}` && remoteRef === localRef && localSha === data.snapshot.head_sha;
          const validatedTag = localRef.startsWith('refs/tags/') && remoteRef === localRef && git(repo, 'rev-parse', '--verify', `${localSha}^{commit}`) === data.snapshot.head_sha;
          if (!currentBranch && !validatedTag) fail('Push contains an unvalidated ref or deletion. Validate that branch separately.');
        }
      }
    }
  } else fail('Usage: validation-gate.mjs snapshot|record|check|ready|pre-push ...');
  console.log(`OK: validation ${mode}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`ERROR: ${error.message}`); process.exitCode = 1; }
}
