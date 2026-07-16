---
name: research
description: Investigate a question against high-trust primary sources and capture cited findings. Use when the user wants a topic researched, documentation or API facts gathered, or claims verified.
---

When `ultivis-flow` is installed, it remains the lifecycle baseline. Research in the main session unless the user has explicitly authorized subagent or parallel work; authorization to research alone does not authorize delegation.

Its job:

1. Investigate the question against **primary sources** — official docs, source code, specs, first-party APIs — not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings to a single Markdown file when the user asked for a durable artifact, citing each claim's source. For a direct question, return the cited answer without creating a file.
3. Save durable research where the repo already keeps such notes; match the existing convention, and if there is none, propose a sensible location before adding a new convention.
