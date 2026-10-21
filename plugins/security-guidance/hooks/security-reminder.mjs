#!/usr/bin/env node
// PreToolUse(Edit|Write|MultiEdit): 위험 패턴이 보이면 한 번만 경고한다(차단하지 않음).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PATTERNS = [
  ["github_actions", { path: /\.github\/workflows\/.*\.ya?ml$/ }, "GitHub Actions 워크플로우 파일입니다. 신뢰할 수 없는 입력을 직접 사용하면 명령 주입 위험이 있습니다."],
  ["child_process_exec", { content: /child_process\.exec\s*\(/i }, "child_process.exec() 사용이 감지되었습니다. 셸 명령 주입 취약점 방지를 위해 execFile() 사용을 권장합니다."],
  ["eval_function", { content: /\beval\s*\(/i }, "eval() 사용이 감지되었습니다. 임의 코드 실행 위험이 있으므로 사용을 피하세요."],
  ["new_function", { content: /new\s+Function\s*\(/i }, "new Function() 사용이 감지되었습니다. eval()과 유사한 보안 위험이 있습니다."],
  ["dangerous_inner_html", { content: /dangerouslySetInnerHTML/i }, "dangerouslySetInnerHTML 사용이 감지되었습니다. XSS 방지를 위해 입력값 새니타이제이션이 필요합니다."],
  ["inner_html", { content: /\.innerHTML\s*=/i }, "innerHTML 직접 할당이 감지되었습니다. XSS 방지를 위해 textContent 또는 새니타이제이션을 사용하세요."],
  ["document_write", { content: /document\.write\s*\(/i }, "document.write() 사용이 감지되었습니다. XSS 취약점 위험이 있습니다."],
  ["pickle_python", { content: /\bpickle\.(load|loads|dump|dumps)\s*\(/i }, "pickle 사용이 감지되었습니다. 신뢰할 수 없는 데이터 역직렬화는 위험합니다. JSON 사용을 권장합니다."],
  ["os_system", { content: /\bos\.system\s*\(/i }, "os.system() 사용이 감지되었습니다. subprocess 모듈 사용을 권장합니다."],
  ["sql_string_format", { content: /(SELECT|INSERT|UPDATE|DELETE).*(%s|\{.*\}|' ?\+)/i }, "SQL 문자열 조합이 감지되었습니다. SQL Injection 방지를 위해 파라미터화된 쿼리를 사용하세요."],
];

let input;
try { input = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }
const ti = input.tool_input || {};
const filePath = ti.file_path || "";
let content = "";
if ("content" in ti) content = ti.content;
else if ("new_string" in ti) content = ti.new_string;
else if (Array.isArray(ti.edits)) content = ti.edits.map((e) => e.new_string || "").join(" ");
if (!filePath || !content) process.exit(0);

const hits = [];
for (const [name, p, warning] of PATTERNS) {
  if (p.path && p.path.test(filePath)) { hits.push({ name, warning }); continue; }
  if (p.content && p.content.test(content)) hits.push({ name, warning });
}
if (!hits.length) process.exit(0);

let stateFile = null, state = { shown_warnings: [] };
try {
  const dir = join(homedir(), ".claude", "security-guidance-state");
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) {
    const fp = join(dir, f);
    if (f.endsWith(".json") && Date.now() - statSync(fp).mtimeMs > 30 * 864e5) unlinkSync(fp);
  }
  stateFile = join(dir, `${process.env.CLAUDE_SESSION_ID || "default"}.json`);
  if (existsSync(stateFile)) state = JSON.parse(readFileSync(stateFile, "utf8"));
} catch {}

const fresh = [];
for (const h of hits) {
  const key = createHash("md5").update(`${filePath}:${h.name}`).digest("hex");
  if (!state.shown_warnings.includes(key)) { fresh.push(h); state.shown_warnings.push(key); }
}
if (!fresh.length) process.exit(0);
try { if (stateFile) writeFileSync(stateFile, JSON.stringify(state)); } catch {}

process.stderr.write(`\n⚠️  보안 경고:\n파일: ${filePath}\n${"-".repeat(50)}\n${fresh.map((w) => `• ${w.warning}`).join("\n")}\n${"-".repeat(50)}\n\n`);
process.stdout.write(JSON.stringify({ decision: "approve", reason: "Security warnings have been shown to the user" }));
