# Ultivis / Notion Flow

Use this reference when the user asks for issue lookup, Task/Story handling, or weekly Ultivis workflow that originally lived in Claude slash commands.

## Scope

- issue lookup from branch name or issue number
- Ultivis task creation and status updates
- Story/task note publishing
- weekly report collection and publishing

## Working rule

Use the globally installed workflow scripts, not repository-local `scripts/`.

- Resolve the scripts directory as `${WORKFLOW_SCRIPTS_DIR:-${CODEX_HOME:-$HOME/.codex}/scripts}`.
- Do not try `./scripts/...` or `scripts/...` in the target repository unless the user explicitly points at this setup repository.
- The Notion cache is global per install under `${WORKFLOW_CACHE_DIR:-${CODEX_HOME:-$HOME/.codex}/notion-cache}`. Do not create repository-local Notion caches.

Global scripts:

- `issue.sh`
- `ult-my-tasks.sh`
- `ult-story-create-exec.sh`
- `ult-sync-task.sh`
- `ult-task-create.sh`
- `ult-task-link-issue.sh`
- `ult-task-note.sh`
- `ult-task-status.sh`
- `ult-weekly-collect.sh`
- `ult-weekly-publish.sh`

If Notion integration is required, verify credentials and the available MCP/tooling in the current environment before promising automation.

## Story and Project Rules

Story is not a loose label. A Story belongs under a specific Notion Project, and that Project relation is the primary boundary for selecting or creating the Story.

Before selecting or creating a Story:

1. Confirm the target repository and its Notion Repository entry.
2. Resolve the Notion Project(s) connected to that Repository.
3. Consider only Story candidates connected to those Project(s).
4. If no candidate is clearly correct, ask the user before selecting or creating a Story.
5. If creating a Story, confirm Project, Story title, Tag, and Priority before creation.

Never pick a Story from an unrelated Project just because the title, topic, or broad category seems close. If Project mapping is unavailable or ambiguous, pause and ask the user rather than guessing.

Do not attach new work to old closed context by inference. Completed, canceled, or failed Story/Task records are not valid candidates unless the user explicitly reopens that record first. Current local handoff and current GitHub issue are stronger evidence than title similarity. Stale branch base config, old worktree names, and old PR targets are not valid Story/Task selection evidence.

## Story-Based Agent Worktree Flow

Use this model for multi-task Story work. These rules are the operating checklist:

- Story is the orchestration unit. Task is the execution unit.
- Main agent owns the Story: Notion Story, dependency map, handoff, integration, and final review.
- Each subagent owns exactly one Task: Notion Task, GitHub Issue, Task branch, Task worktree, implementation, verification, and Task PR.
- Task branches are created from the latest remote base. Task PRs target `dev` or the repository default branch. Do not create Story GitHub Issues or Story PRs.
- `Parent Task` means prerequisite/dependency, not hierarchy. Only dependency-ready Tasks may run in parallel.
- Task `Repository` relation is the source of truth for repo ownership. Cross-repo references must use `repo#issue` or Issue URL, never bare issue numbers.
- Maintain `tmp/story-handoff.md` and `tmp/story-handoff.json` in each Task worktree. Publish the initial handoff to the Notion Story, then record execution updates in the local handoff and Notion Story comments.
- Run review-cycle for each Task PR. After all Task PRs are merged, run Story-level integration validation without creating a Story PR.
- Story/Task Notion pages must use configured templates; appended markdown must render as Notion blocks, not raw markdown.
- Before assigning Task work, run the global `ult-story-run.sh` to classify Ready/Blocked Tasks and generate subagent prompts.
- During Task execution, do not create additional Notion Tasks, GitHub Issues, branches, or worktrees unless the user explicitly approves that new Task creation. Record out-of-scope follow-up work as Story carryover instead.

Branch flow:

```text
dev
├── Task branch -> PR to dev
├── Task branch -> PR to dev
└── Task branch -> PR to dev
```

Additional rules:

- Do not create a GitHub Story Issue or Story PR. Notion Story `Issue URL` and `PR URL` are not authoritative for Story flow.
- Store Task PR URLs on the Notion Task `PR URL`.
- Preserve branch ancestry with git `branch.<name>.gh-merge-base`, Notion Story comments, and Task worktree handoff.
- Branch names do not need `story/` or `task/` prefixes. Story/Task identity is determined by Notion relation, GitHub issue relation, branch base, and PR target.
- Agents must not edit another agent's worktree.

## Story Handoff Rules

For Story-based work, maintain `tmp/story-handoff.md` and `tmp/story-handoff.json` in each Task worktree. Publish the initial content to the Notion Story.

The handoff should include:

- Story title, Notion Story URL, and base branch.
- Task issue, branch, base branch, worktree, status, and owner.
- Cross-repo dependencies and review carryover.

After creation, the local handoff files and Notion Story comments are the mutable handoff sources.

Use the global `ult-story-run.sh` to generate a current run summary and Ready Task prompts. It reads local handoff first and falls back to Notion when no handoff is available. This script does not spawn subagents by itself; the main agent may spawn subagents only when the user has explicitly allowed subagent/parallel work.

When adding a Task to an existing Story, prefer passing the Notion Story URL or running from a Task worktree with local handoff. The global `ult-task-create.sh` resolves Story context from local handoff, the current GitHub Task Issue, and then active Notion title search. It must not resolve Story context from stale branch base config or old worktrees. New Task branches should base on the latest remote base, and new Tasks should be appended to Story handoff when available.

## Task Dependency Rules

In this workflow, Notion `Parent Task` means prerequisite/dependency, not ownership hierarchy.

- A Task with no Parent Task is ready to start.
- A Task with Parent Task is blocked until every parent is complete or merged into the target base branch.
- Only ready Tasks may be started in parallel.
- Do not parallelize Tasks that are likely to modify the same files.
- Cross-repo dependencies must also be represented with `Parent Task`.

## Cross-Repo Story Rules

A Story may span multiple repositories.

- Do not require a direct Repository relation on Story.
- Task `Repository` relation is the source of truth for repository ownership.
- Derive Story repositories from the Story's Tasks.
- Do not create Story GitHub Issues or Story PRs. Track cross-repo status through the Notion Story and Task-level Issue/PR URLs.
- Bare GitHub issue numbers are not valid cross-repo identifiers. Use `repo#issue` or Issue URL.
- A consuming repo Task may start only after the producer Task is complete, merged into its target base branch, or otherwise available for consumption.
- The Story is complete only when every Task PR is merged and cross-repo validation is done.

## Notion Template Rules

When creating Notion Story or Task pages:

- Always create pages with the configured Notion template ID.
- Do not create blank pages with properties only.
- If the template ID is missing or template application cannot be confirmed, stop instead of silently creating a blank page.
- Insert markdown body after the template's `설명` block when present; fall back to appending at the end.
- Convert appended markdown body to real Notion blocks; raw markdown headings, bullets, or checkboxes should not remain as plain text.

## Story Review Cycle Rules

Story-based work runs review-cycle at the Task PR layer.

- Run review-cycle on each Task PR until AI review and CI are clear, then merge the Task PR into `dev` or the repository default branch.
- After all Task PRs are merged, run Story-level integration validation without opening a Story PR.
- If Task PR feedback belongs to Story-wide design or another Task scope, do not expand the Task PR. Record it in `tmp/story-handoff.md` and the Notion Story.
- Do not mark the Story complete until every Task PR is merged, review-cycle is clear, and cross-repo validation is done.

## Repository Project Relation Gaps

If `ult-task-create.sh` fails with `Repository에서 Project relation을 찾을 수 없습니다`, do not continue with an unscoped Story guess.

Use this recovery order:

1. Confirm the GitHub repository slug reported by the script is the intended repo.
2. If the correct Project is known from the current Story/plan, rerun with `--project <Project name|Notion page id|URL>`.
3. If the Project is not clear, ask the user to choose the Project before creating issues/tasks.
4. After creating the Task, mention that the Notion Repository DB still needs its Project relation fixed so future automation works without `--project`.

When using `--project`, the script narrows Story selection to that Project and still validates the selected Story's Project relation. This is a temporary explicit override, not permission to attach work to an unrelated Project.
