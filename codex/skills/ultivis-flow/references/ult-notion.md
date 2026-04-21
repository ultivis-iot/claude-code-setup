# Isaac / Notion Flow

Use this reference when the user asks for issue lookup, Task/Story handling, or weekly Isaac flow that originally lived in Claude slash commands.

## Scope

- issue lookup from branch name or issue number
- Isaac task creation and status updates
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

## Repository Project Relation Gaps

If `ult-task-create.sh` fails with `Repository에서 Project relation을 찾을 수 없습니다`, do not continue with an unscoped Story guess.

Use this recovery order:

1. Confirm the GitHub repository slug reported by the script is the intended repo.
2. If the correct Project is known from the current Story/plan, rerun with `--project <Project name|Notion page id|URL>`.
3. If the Project is not clear, ask the user to choose the Project before creating issues/tasks.
4. After creating the Task, mention that the Notion Repository DB still needs its Project relation fixed so future automation works without `--project`.

When using `--project`, the script narrows Story selection to that Project and still validates the selected Story's Project relation. This is a temporary explicit override, not permission to attach work to an unrelated Project.
