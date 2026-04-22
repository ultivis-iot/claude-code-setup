# Ultivis / Notion Flow

Use this reference when the user asks for issue lookup, Task/Story handling, or weekly Ultivis workflow that originally lived in Claude slash commands.

## Scope

- issue lookup from branch name or issue number
- Ultivis task creation and status updates
- Story/task note publishing
- weekly report collection and publishing

## Working rule

Prefer the repository scripts under `scripts/` when they already implement the operation:

- `scripts/issue.sh`
- `scripts/ult-my-tasks.sh`
- `scripts/ult-story-create-exec.sh`
- `scripts/ult-sync-task.sh`
- `scripts/ult-task-create.sh`
- `scripts/ult-task-link-issue.sh`
- `scripts/ult-task-note.sh`
- `scripts/ult-task-status.sh`
- `scripts/ult-weekly-collect.sh`
- `scripts/ult-weekly-publish.sh`

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

## Story-Based Agent Worktree Flow

Use this model for multi-task Story work. These rules are the operating checklist:

- Story is the orchestration unit. Task is the execution unit.
- Main agent owns the Story: Notion Story, GitHub Story Issue, Story branch, Story worktree, dependency map, handoff, integration, and final review.
- Each subagent owns exactly one Task: Notion Task, GitHub Issue, Task branch, Task worktree, implementation, verification, and Task PR.
- Task branches are created from the Story branch. Task PRs target the Story branch. Only the final Story PR targets `dev`.
- `Parent Task` means prerequisite/dependency, not hierarchy. Only dependency-ready Tasks may run in parallel.
- Task `Repository` relation is the source of truth for repo ownership. Cross-repo references must use `repo#issue` or Issue URL, never bare issue numbers.
- Maintain `tmp/story-handoff.md` and `tmp/story-handoff.json`. Publish the initial handoff to both the Notion Story and GitHub Story Issue, then record execution updates only on the GitHub Story Issue.
- Run review-cycle twice: once for each Task PR before merging to Story branch, and again for the Story PR before merging to `dev`.
- Story/Task Notion pages must use configured templates; appended markdown must render as Notion blocks, not raw markdown.
- Before assigning Task work, run `scripts/ult-story-run.sh` to classify Ready/Blocked Tasks and generate subagent prompts.
- During Task execution, do not create additional Notion Tasks, GitHub Issues, branches, or worktrees unless the user explicitly approves that new Task creation. Record out-of-scope follow-up work as Story carryover instead.

Branch flow:

```text
dev
└── Story branch
    ├── Task branch -> PR to Story branch
    ├── Task branch -> PR to Story branch
    └── Task branch -> PR to Story branch

Story branch -> PR to dev
```

Additional rules:

- Create a GitHub Story Issue for the Story and store it in Notion Story `Issue URL`.
- Store the final Story PR in Notion Story `PR URL`.
- Preserve branch ancestry with git `branch.<name>.gh-merge-base`, the initial Notion comment, and the GitHub Story Issue handoff.
- Branch names do not need `story/` or `task/` prefixes. Story/Task identity is determined by Notion relation, GitHub issue relation, branch base, and PR target.
- Agents must not edit another agent's worktree.

## Story Handoff Rules

For Story-based work, maintain `tmp/story-handoff.md` and `tmp/story-handoff.json` in the Story worktree. Publish the same initial content to the Notion Story and GitHub Story Issue.

The handoff should include:

- Story title, Notion Story URL, and GitHub Story Issue URL.
- Story branch, base branch, and worktree.
- Task issue, branch, base branch, worktree, status, and owner.
- Cross-repo dependencies and review carryover.

After creation, GitHub Story Issue is the mutable handoff source. Notion is used for inspection and fallback lookup only.

Use `scripts/ult-story-run.sh` to generate a current run summary and Ready Task prompts. It reads local handoff first, then GitHub Story Issue handoff, and only falls back to Notion when no handoff is available. This script does not spawn subagents by itself; the main agent may spawn subagents only when the user has explicitly allowed subagent/parallel work.

When adding a Task to an existing Story, prefer passing the GitHub Story Issue URL or running from the Story/Task worktree. `scripts/ult-task-create.sh` resolves Story context from local handoff, GitHub Story Issue, GitHub Task Issue, current branch issue, and then Notion title search. New Task branches should base on the Story branch, and new Tasks should be appended to Story handoff when available.

## Task Dependency Rules

In this workflow, Notion `Parent Task` means prerequisite/dependency, not ownership hierarchy.

- A Task with no Parent Task is ready to start.
- A Task with Parent Task is blocked until every parent is complete or merged into the Story branch.
- Only ready Tasks may be started in parallel.
- Do not parallelize Tasks that are likely to modify the same files.
- Cross-repo dependencies must also be represented with `Parent Task`.

## Cross-Repo Story Rules

A Story may span multiple repositories.

- Do not require a direct Repository relation on Story.
- Task `Repository` relation is the source of truth for repository ownership.
- Derive Story repositories from the Story's Tasks.
- Bare GitHub issue numbers are not valid cross-repo identifiers. Use `repo#issue` or Issue URL.
- A consuming repo Task may start only after the producer Task is complete, merged into its repository Story branch, or otherwise available for consumption.
- The Story is complete only when every repository's Story PR is merged and cross-repo validation is done.

## Notion Template Rules

When creating Notion Story or Task pages:

- Always create pages with the configured Notion template ID.
- Do not create blank pages with properties only.
- If the template ID is missing or template application cannot be confirmed, stop instead of silently creating a blank page.
- Insert markdown body after the template's `설명` block when present; fall back to appending at the end.
- Convert appended markdown body to real Notion blocks; raw markdown headings, bullets, or checkboxes should not remain as plain text.

## Story Review Cycle Rules

Story-based work has two review-cycle layers.

- Run review-cycle on each Task PR until AI review and CI are clear, then merge the Task PR into the Story branch.
- After all Task PRs are merged, open the Story PR to `dev` and run review-cycle again for integrated behavior.
- If Task PR feedback belongs to Story-wide design or another Task scope, do not expand the Task PR. Record it in `tmp/story-handoff.md` and the GitHub Story Issue.
- Do not mark the Story complete until every repository Story PR is merged, review-cycle is clear, and cross-repo validation is done.

## Repository Project Relation Gaps

If `ult-task-create.sh` fails with `Repository에서 Project relation을 찾을 수 없습니다`, do not continue with an unscoped Story guess.

Use this recovery order:

1. Confirm the GitHub repository slug reported by the script is the intended repo.
2. If the correct Project is known from the current Story/plan, rerun with `--project <Project name|Notion page id|URL>`.
3. If the Project is not clear, ask the user to choose the Project before creating issues/tasks.
4. After creating the Task, mention that the Notion Repository DB still needs its Project relation fixed so future automation works without `--project`.

When using `--project`, the script narrows Story selection to that Project and still validates the selected Story's Project relation. This is a temporary explicit override, not permission to attach work to an unrelated Project.
