# Graft Code Map

Use Graft as the default structural code map when it is available. This reference owns the shared Ultivis lifecycle policy.

## Runtime and privacy

- Graft requires Node.js 20 or later. If the current runtime has a tree-sitter native-module compatibility error, retry with LTS Node 24; do not require Node 24 otherwise.
- Use the local structural graph only. Never run `graft build --deep` unless the user explicitly requests model-backed enrichment and accepts the provider implications.
- Workflow-managed builds set `DO_NOT_TRACK=1`.
- MCP is not required. Claude Code and Codex use the same CLI commands.
- `graft/` is a regenerable, worktree-local cache. Never commit it, copy it between machines, or symlink it across worktrees.

## Exploration order

1. Use `graft map` to orient in an unfamiliar repository.
2. Use `graft ask "<question>"` to locate relevant code before opening broad file sets.
3. Use `graft skeleton <file>` before reading a large implementation file when its API surface is enough.
4. Use `graft callers <symbol> -d 2` before changing shared behavior or estimating blast radius.
5. Use `graft grep` for graph-aware exhaustive matches; use `rg` for exact text searches and as the fallback when Graft is unavailable or incomplete.

Queries refresh the structural graph against the current worktree before answering. Do not rebuild after every edit.

## Lifecycle

- `ult-wt-add.sh` invokes `graft-refresh.sh` after creating or reusing a worktree.
- The managed `post-merge` hook invokes it after merge or pull updates a local worktree, including the main worktree.
- A remote PR merge does not change the local main worktree; refresh occurs when that worktree is next updated locally.
- Missing Node.js 20+, a missing CLI, or a build failure must recommend installation and fall back to normal exploration without blocking Git.

The helper is installed at `~/.claude/scripts/graft-refresh.sh` for Claude Code and `~/.codex/scripts/graft-refresh.sh` for Codex. Repository hooks receive a managed copy from `hooks/install-hooks.sh`.
