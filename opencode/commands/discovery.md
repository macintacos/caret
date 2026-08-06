---
description: Gather a redacted caret diagnostics snapshot ready to share
---

caret's `discovery` subcommand prints a one-shot, read-only snapshot of the local install
— running caret processes, daemon identity, lock/port state, effective settings, review
counts, the OpenCode adapter's install-state probe (plugin version, enabled state), log
sizes and error counts, and system basics. The report is **always redacted** (home paths
become `~`, foreign usernames censored) and never contains plan, prompt, or feedback
bodies — it exists to be shared.

First ask the user (briefly) which format they want:

- **JSON** — for feeding to tooling.
- **Human-readable** — for scanning in the conversation.

Then run the matching invocation (the `CARET_AGENT=opencode` selector makes the install
probe read caret's OpenCode plugin state):

```bash
CARET_AGENT=opencode "__CARET_BIN__" discovery --json   # JSON
CARET_AGENT=opencode "__CARET_BIN__" discovery          # human-readable
```

End your output with the command's stdout **verbatim** in a fenced code block so the user
can copy it out in one piece. Add nothing inside the block and do not summarize sections
away — the report is already redacted and complete. A degraded section (e.g.
`daemon error: …`) is normal when the daemon is down; present it as-is.

If the command exits non-zero, present the exit code and stderr instead. If the binary is
missing (a checkout that was never built), say so and point at caret's install script.
