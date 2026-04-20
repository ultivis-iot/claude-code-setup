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
- `scripts/ult-task-note.sh`
- `scripts/ult-task-status.sh`
- `scripts/ult-weekly-collect.sh`
- `scripts/ult-weekly-publish.sh`

If Notion integration is required, verify credentials and the available MCP/tooling in the current environment before promising automation.
