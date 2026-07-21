---
description: Gather a redacted diagnostics snapshot of this caret install and present it ready to paste into a bug report
---

caret's `discovery` subcommand prints a one-shot, read-only snapshot of the local install
— running caret processes, daemon identity, lock/port state, effective settings, review
counts, the agent adapter's install-state probe (plugin version, enabled state, and
whether a manual hook sits in the agent's user settings), log sizes and error counts,
install/runtime info, and system basics. The report is **always redacted** (home paths
become `~`, usernames in foreign home paths are censored) and never contains plan, prompt,
or feedback bodies, nor any log contents — it exists to be shared.

First ask the user (via `AskUserQuestion`) which format they want:

- **JSON** — for pasting into a bug report or feeding to tooling.
- **Human-readable** — for scanning in the conversation.

Then run the matching invocation:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/caret" discovery --json   # JSON
"${CLAUDE_PLUGIN_ROOT}/bin/caret" discovery          # human-readable
```

End your output with the command's stdout **verbatim** in a fenced code block —
` ```json ` for the JSON format, plain ` ``` ` for the human-readable one — so the user
can copy it straight into a bug report. Add nothing inside the block and do not summarize
away sections; the report is already redacted and complete. A degraded section (e.g.
`daemon error: …` or `"error": "…"`) is normal when the daemon is down — present it as-is
rather than treating it as a failure of this command.

If the command exits non-zero, no report could be produced at all: present the exit code
and stderr instead, and suggest `/caret:debug` for log-side diagnosis. If the binary
itself is missing (a source checkout that has never been built), say so and point at
`mise run build` (or `mise run build --install`).
