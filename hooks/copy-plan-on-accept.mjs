#!/usr/bin/env node
// PostToolUse(ExitPlanMode): 승인된 Plan 을 tmp/current-plan.md 로 복사하고 다음 흐름을 안내한다.
// 호출 환경이 WORKFLOW_APPROVED_PLAN(절대 경로)을 제공한 경우에만 복사한다.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";

const approve = (reason) => { process.stdout.write(JSON.stringify({ decision: "approve", reason })); process.exit(0); };
const git = (cwd, args) => { const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true }); return r.status === 0 ? r.stdout.trim() : ""; };

let input = {};
try { input = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }
if ((input.tool_name || "") !== "ExitPlanMode") process.exit(0);
let cwd = input.cwd || "";
if (!cwd) process.exit(0);
cwd = git(cwd, ["rev-parse", "--show-toplevel"]) || cwd;

const planPath = process.env.WORKFLOW_APPROVED_PLAN || "";
if (planPath && !isAbsolute(planPath)) approve("WORKFLOW_APPROVED_PLAN에는 승인된 Plan의 절대 경로가 필요합니다. 자동 복사를 생략합니다.");
if (!planPath || !existsSync(planPath)) approve("현재 세션에 연결된 Plan 경로가 없습니다. 현재 대화에서 승인된 정확한 Plan을 tmp/current-plan.md로 저장하세요. 전역 최신 Plan을 추측해서 복사하지 마세요.");

const content = readFileSync(planPath, "utf8");
if (!content.trim()) approve("Plan 내용이 비어있습니다.");

const targetDir = join(cwd, "tmp");
mkdirSync(targetDir, { recursive: true });
const target = join(targetDir, "current-plan.md");
writeFileSync(target, content.endsWith("\n") ? content : content + "\n");

let ctx = "unknown", wtRoot = "";
wtRoot = git(cwd, ["rev-parse", "--show-toplevel"]);
if (wtRoot) {
  const first = (git(cwd, ["worktree", "list", "--porcelain"]).split(/\r?\n/).find((l) => l.startsWith("worktree ")) || "").slice(9);
  ctx = resolve(wtRoot) === resolve(first) ? "main" : "worktree";
}

const reason = ctx === "worktree"
  ? `Plan이 ${target}로 저장되었습니다.

현재 위치: **worktree \`${basename(wtRoot)}\`** (이미 작업 중)
→ 새 worktree/브랜치를 만들지 마세요. 현재 브랜치에서 작업 이어갑니다.

Plan 성격에 따라 추천:

  • **현재 Task의 보완/메모** → \`/ult-task-note '메모'\`
    → 현재 Task에 코멘트만 추가, 새 Task 안 만듦

  • **현재 Story에 관련 Task 추가** → \`/ult-task-create --here\`
    → Task + Issue만 생성, 브랜치/worktree는 현재 것 유지

  • **작은 변경** → 발행 없이 그대로 Build 시작

현재 worktree 컨텍스트에서 완전히 새로운 Story를 시작해야 한다면, 먼저 main으로 복귀하거나 사용자에게 확인하세요.`
  : `Plan이 ${target}로 저장되었습니다.

현재 위치: **메인 프로젝트** (또는 git 외부)
→ 새 worktree/브랜치 생성 옵션 사용 가능.

Plan 성격에 따라 추천:

  • **거대한 Plan (새 사용자 가치, 여러 단계)** → \`/ult-story-create\`
    → 새 Story + Task N개 + Github Issue N개 + 브랜치 N개 일괄 생성

  • **기존 Story의 추가 작업** → \`/ult-task-create <story>\`
    → 기존 Story에 Task 1개 + Issue + 브랜치 추가

  • **현재 Task의 보완/메모** → \`/ult-task-note '메모'\`
    → 현재 브랜치 Task에 코멘트 추가, 새 항목 안 만듦

  • **작은 일회성 변경** → 발행 없이 그대로 Build 시작

현재 브랜치/Task 컨텍스트 확인은 \`/issue\` 사용. 사용자가 명시적으로 거부하지 않으면 추천만 하고 사용자 선택 받기.`;
approve(reason);
