#!/usr/bin/env node
// 사내 Qwen(Pi 하네스)에게 범위가 정해진 리뷰·구현 작업을 맡기고 결과를 JSON 한 줄로 돌려준다.
//
//   node delegate.mjs run   --cwd <dir> --mode review|implement --effort medium|xhigh --task-file <file>
//   node delegate.mjs check [--ping]     실행 준비 상태(pi·models.json·엔드포인트) 점검
//   node delegate.mjs setup              ~/.pi/agent/models.json 에 사내 provider 를 병합
//
// effort 는 호출자가 난이도로 고른다. low(instant)는 품질이 떨어져 받지 않는다.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

export const PROVIDER = "ultivis";
export const MODEL_ID = "ultivis-vl";
export const MODEL = `${PROVIDER}/${MODEL_ID}`;
export const EFFORTS = ["medium", "xhigh"];
// xhigh 구현은 한 응답에서 생각만 3만 토큰을 넘길 수 있다. 32768 에서는 답을 쓰기 전에 잘린다.
export const XHIGH_MIN_MAX_TOKENS = 65536;
// 한 응답 동안 서버 자리를 점유하는 시간의 실측(동시 4건): medium 구현 9분, xhigh 리뷰 5~11분.
const DEFAULT_TIMEOUT = { medium: 1200, xhigh: 2700 };
const REVIEW_TOOLS = "read,grep,find,ls";

const home = () => process.env.HOME || homedir();
const piModelsPath = () => join(process.env.PI_CODING_AGENT_DIR || join(home(), ".pi", "agent"), "models.json");
const stateRoot = () => join(process.env.XDG_STATE_HOME || join(home(), ".local", "state"), "qwen-delegate", "runs");

function fail(message) {
  process.stderr.write(`qwen-delegate: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const key = a.slice(2);
    if (["ping", "help"].includes(key)) { out[key] = true; continue; }
    if (i + 1 >= argv.length) fail(`--${key} 에 값이 필요합니다`);
    out[key] = argv[++i];
  }
  return out;
}

function which(name) {
  for (const dir of (process.env.PATH || "").split(delimiter)) {
    const p = join(dir, name);
    try { if (statSync(p).isFile()) return p; } catch { /* PATH 의 다음 항목 */ }
  }
  return null;
}

export function readPiModel(path = piModelsPath()) {
  if (!existsSync(path)) return { path, error: "models.json 이 없습니다" };
  let doc;
  try { doc = JSON.parse(readFileSync(path, "utf8")); } catch (e) { return { path, error: `models.json 을 읽을 수 없습니다: ${e.message}` }; }
  const provider = doc?.providers?.[PROVIDER];
  const model = provider?.models?.find((m) => m.id === MODEL_ID);
  if (!model) return { path, error: `${MODEL} 정의가 없습니다` };
  return { path, baseUrl: provider.baseUrl, apiKey: provider.apiKey, maxTokens: model.maxTokens ?? null };
}

export function buildPiArgs({ mode, effort, prompt }) {
  const args = ["--offline", "--no-session", "--no-extensions", "--no-mcp", "--no-skills",
    "--no-prompt-templates", "--mode", "json", "--model", MODEL, "--thinking", effort];
  if (mode === "review") args.push("--tools", REVIEW_TOOLS);
  return [...args, "-p", "--", prompt];
}

export function buildPrompt({ cwd, mode, task }) {
  return [
    `You are a delegated local Qwen coding worker. Workspace: ${cwd}`,
    `Mode: ${mode}. Stay within the supplied task and workspace. Do not launch another agent or delegate this task again. ` +
      "Report blockers instead of expanding the assignment. " +
      (mode === "review" ? "Use only read/search tools; leave files unchanged. "
        : "Make only authorized changes and run the task's relevant checks. ") +
      "Write the report and any code comments only in the language the task asks for; do not mix in other scripts " +
      "(for example Japanese or Chinese characters when Korean is requested). " +
      "Finish with a concise report: outcome, files/evidence, checks actually run, and remaining issues. " +
      "Distinguish completed work from suggestions.",
    "",
    task,
  ].join("\n");
}

// Pi 의 JSON 이벤트 스트림에서 마지막 답, 도구 사용, 멈춘 이유, 토큰을 모은다.
export function summarizeEvents(text) {
  const tools = {};
  const errors = [];
  const models = new Set();
  let report = "", lastStop = null, outputTokens = 0, peakInput = 0, reasoningBlocks = 0;
  for (const line of text.split("\n")) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === "tool_execution_start") tools[ev.toolName || "unknown"] = (tools[ev.toolName || "unknown"] || 0) + 1;
    if (ev.type === "tool_execution_end" && ev.isError) errors.push(`Tool failed: ${ev.toolName || "unknown"}`);
    if (ev.type === "error") errors.push(String(ev.error ?? ev.message ?? "Harness error"));
    const m = ev.message || {};
    if (ev.type !== "message_end" || m.role !== "assistant") continue;
    if (m.provider && m.model) models.add(`${m.provider}/${m.model}`);
    const blocks = Array.isArray(m.content) ? m.content : [];
    reasoningBlocks += blocks.filter((b) => b.type === "thinking").length;
    report = blocks.filter((b) => b.type === "text").map((b) => b.text || "").join("\n").trim();
    lastStop = m.stopReason ?? null;
    outputTokens += m.usage?.output || 0;
    peakInput = Math.max(peakInput, m.usage?.input || 0);
    if (m.errorMessage) errors.push(String(m.errorMessage));
  }
  return { report, tools, errors: errors.slice(-10), models: [...models].sort(), lastStop,
    outputTokens, peakInput, reasoningBlocks };
}

export function classify({ exitCode, timedOut, cancelled, spawnError, summary }) {
  if (spawnError) return "failed";
  if (timedOut) return "timed_out";
  if (cancelled) return "cancelled";
  if (summary.models.some((m) => m !== MODEL)) return "unexpected_model";
  // 응답 한도에서 잘리면 빈 답이거나 끊긴 답이다 — 어느 쪽이든 완료로 읽으면 안 된다.
  if (summary.lastStop === "length") return "output_limit";
  if (exitCode !== 0) return "failed";
  return summary.report ? "completed" : "empty_response";
}

function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch { return; }
  setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch { /* 이미 끝남 */ } }, 5000).unref();
}

async function run(opts) {
  if (process.platform === "win32") fail("Linux/macOS 전용입니다");
  const mode = opts.mode || "review";
  if (!["review", "implement"].includes(mode)) fail("--mode 는 review 또는 implement 입니다");
  if (!EFFORTS.includes(opts.effort)) fail(`--effort 는 ${EFFORTS.join(" 또는 ")} 중 하나를 난이도로 골라 넘깁니다`);
  if (!opts.cwd) fail("--cwd 가 필요합니다");
  const cwd = resolve(opts.cwd);
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) fail("--cwd 는 존재하는 디렉토리여야 합니다");
  let task = opts.task;
  if (opts["task-file"]) task = readFileSync(opts["task-file"] === "-" ? 0 : opts["task-file"], "utf8");
  if (!task || !task.trim()) fail("--task-file 또는 --task 로 비어 있지 않은 작업을 넘깁니다");
  const timeout = Number(opts.timeout ?? DEFAULT_TIMEOUT[opts.effort]);
  const maxReport = Number(opts["max-report-chars"] ?? 12000);
  if (!(timeout > 0) || !(maxReport > 0)) fail("--timeout 과 --max-report-chars 는 양수입니다");

  const pi = which("pi");
  if (!pi) fail("pi 가 PATH 에 없습니다. `node delegate.mjs check` 로 설치 상태를 확인하세요");
  const warnings = [];
  const cfg = readPiModel();
  if (cfg.error) warnings.push(`${cfg.path}: ${cfg.error}`);
  else if (opts.effort === "xhigh" && (cfg.maxTokens ?? 0) < XHIGH_MIN_MAX_TOKENS) {
    warnings.push(`maxTokens=${cfg.maxTokens} — xhigh 는 ${XHIGH_MIN_MAX_TOKENS} 이상이 아니면 생각 도중 잘릴 수 있습니다 (node delegate.mjs setup)`);
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const runDir = join(stateRoot(), `${stamp}-${randomBytes(4).toString("hex")}`);
  mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const prompt = buildPrompt({ cwd, mode, task });
  writeFileSync(join(runDir, "task.txt"), prompt);
  const eventsPath = join(runDir, "events.jsonl");
  const stderrPath = join(runDir, "stderr.log");
  const result = { harness: "pi", model: MODEL, effort: opts.effort, mode, cwd, run_dir: runDir };
  process.stderr.write(JSON.stringify({ event: "delegation_started", ...result, warnings }) + "\n");

  const started = Date.now();
  const outcome = await new Promise((done) => {
    const out = createWriteStream(eventsPath);
    const err = createWriteStream(stderrPath);
    const child = spawn(pi, buildPiArgs({ mode, effort: opts.effort, prompt }), {
      cwd, env: { ...process.env, PWD: cwd }, stdio: ["ignore", "pipe", "pipe"], detached: true,
    });
    child.stdout.pipe(out);
    child.stderr.pipe(err);
    let timedOut = false, cancelled = false;
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeout * 1000);
    const onSignal = () => { cancelled = true; killTree(child); };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    const finish = (extra) => {
      clearTimeout(timer);
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      Promise.all([new Promise((r) => out.end(r)), new Promise((r) => err.end(r))]).then(() => done({ timedOut, cancelled, ...extra }));
    };
    child.on("error", (e) => finish({ exitCode: null, spawnError: e.message }));
    child.on("close", (code) => finish({ exitCode: code }));
  });

  const summary = summarizeEvents(existsSync(eventsPath) ? readFileSync(eventsPath, "utf8") : "");
  const status = classify({ ...outcome, summary });
  if (outcome.spawnError) summary.errors.push(outcome.spawnError);
  if (status === "unexpected_model") summary.errors.push(`Unexpected model(s): ${summary.models.join(", ")}`);
  const reportPath = join(runDir, "report.txt");
  writeFileSync(reportPath, summary.report);
  Object.assign(result, {
    status, exit_code: outcome.exitCode, elapsed_seconds: Math.round((Date.now() - started) / 10) / 100,
    report: summary.report.slice(0, maxReport), report_truncated: summary.report.length > maxReport,
    stop_reason: summary.lastStop, output_tokens: summary.outputTokens, peak_input_tokens: summary.peakInput,
    reasoning_blocks: summary.reasoningBlocks, tool_calls: summary.tools, tool_errors: summary.errors,
    observed_models: summary.models, warnings, report_file: reportPath, events_file: eventsPath, stderr_file: stderrPath,
  });
  if (status === "output_limit") {
    result.hint = opts.effort === "xhigh"
      ? `응답 한도에서 잘렸습니다. models.json maxTokens 를 ${XHIGH_MIN_MAX_TOKENS} 이상으로 올리거나(setup) 작업을 더 잘게 나누세요`
      : "응답 한도에서 잘렸습니다. 작업을 더 잘게 나누세요";
  }
  if (status !== "completed" && existsSync(stderrPath)) result.stderr_tail = readFileSync(stderrPath, "utf8").slice(-2000);
  writeFileSync(join(runDir, "result.json"), JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(JSON.stringify(result) + "\n");
  return status === "completed" ? 0 : status === "timed_out" ? 124 : status === "cancelled" ? 130 : 1;
}

async function ping(cfg) {
  const key = (cfg.apiKey || "").replace(/^\$\{?([A-Z0-9_]+)\}?$/, (_, n) => process.env[n] || "");
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model: MODEL_ID, messages: [{ role: "user", content: "hi" }], max_tokens: 4,
        chat_template_kwargs: { enable_thinking: false } }),
    });
    return res.status === 200 ? "ok" : `HTTP ${res.status}`;
  } catch (e) {
    return `연결 실패: ${e.message}`;
  }
}

async function check(opts) {
  const pi = which("pi");
  const cfg = readPiModel();
  const problems = [];
  if (process.platform === "win32") problems.push("Linux/macOS 전용입니다");
  if (!pi) problems.push("pi 가 PATH 에 없습니다 (README 설치 절)");
  if (cfg.error) problems.push(`${cfg.path}: ${cfg.error} (node delegate.mjs setup)`);
  const report = { pi, models_json: cfg.path, base_url: cfg.baseUrl ?? null, max_tokens: cfg.maxTokens ?? null };
  if (!cfg.error && (cfg.maxTokens ?? 0) < XHIGH_MIN_MAX_TOKENS) {
    problems.push(`maxTokens=${cfg.maxTokens}: xhigh 는 ${XHIGH_MIN_MAX_TOKENS} 이상이 필요합니다 (node delegate.mjs setup)`);
  }
  if (!cfg.error && /^\$\{?ULTIVIS_API_KEY\}?$/.test(cfg.apiKey || "") && !process.env.ULTIVIS_API_KEY) {
    problems.push("ULTIVIS_API_KEY 환경변수가 비어 있습니다");
  }
  if (opts.ping && !cfg.error) {
    report.ping = await ping(cfg);
    if (report.ping !== "ok") problems.push(`엔드포인트 응답: ${report.ping}`);
  }
  report.ready = problems.length === 0;
  report.problems = problems;
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  return report.ready ? 0 : 1;
}

export function mergeProvider(doc, endpoint) {
  const next = doc && typeof doc === "object" ? structuredClone(doc) : {};
  next.providers ||= {};
  const existing = next.providers[PROVIDER] || {};
  const others = (existing.models || []).filter((m) => m.id !== MODEL_ID);
  const model = JSON.parse(readFileSync(new URL("../pi-model.json", import.meta.url), "utf8"));
  next.providers[PROVIDER] = {
    ...existing, name: existing.name || "Ultivis vLLM", baseUrl: endpoint, api: "openai-completions",
    apiKey: existing.apiKey || "${ULTIVIS_API_KEY}", models: [...others, model],
  };
  return next;
}

function setup() {
  const endpoint = process.env.ULTIVIS_ENDPOINT;
  if (!endpoint) fail("ULTIVIS_ENDPOINT 환경변수가 필요합니다 (예: http://<사내 vLLM 주소>:8000/v1)");
  const path = piModelsPath();
  let doc = {};
  if (existsSync(path)) {
    try { doc = JSON.parse(readFileSync(path, "utf8")); } catch (e) { fail(`${path} 를 읽을 수 없어 건드리지 않았습니다: ${e.message}`); }
    const backup = `${path}.bak.${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
    copyFileSync(path, backup);
    process.stderr.write(`백업: ${backup}\n`);
  } else {
    mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  }
  writeFileSync(path, JSON.stringify(mergeProvider(doc, endpoint), null, 2) + "\n");
  chmodSync(path, 0o600);
  process.stdout.write(`${path} 에 ${MODEL} 를 설정했습니다. 키는 ULTIVIS_API_KEY 환경변수에서 읽습니다.\n`);
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  const cmd = opts._[0];
  const handlers = { run, check, setup };
  if (opts.help || !handlers[cmd]) {
    process.stdout.write(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 8).map((l) => l.replace(/^\/\/ ?/, "")).join("\n") + "\n");
    process.exit(opts.help ? 0 : 2);
  }
  process.exit(await handlers[cmd](opts));
}
