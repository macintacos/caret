---
description: Diagnose this caret install — run caret doctor, relay each failing check's remedy, and present the report ready to share
---

caret's `doctor` subcommand renders a verdict over a one-shot, read-only snapshot of the
local install: a `checks:` block naming what is wrong and how to fix it, then the state it
read that from — running caret processes, daemon identity, lock/port state, effective
settings, review counts, the agent adapter's install-state probe (plugin version, enabled
state, and whether a manual hook sits in the agent's user settings), log sizes and error
counts, install/runtime info, and system basics. The report is **always redacted** (home
paths become `~`, usernames in foreign home paths are censored) and never contains plan,
prompt, or feedback bodies, nor any log contents — it exists to be shared.

## 1. Run it

First ask the user (via `AskUserQuestion`) which format they want:

- **JSON** — for feeding to tooling.
- **Human-readable** — for scanning in the conversation.

Then run the matching invocation:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/caret" doctor --json   # JSON
"${CLAUDE_PLUGIN_ROOT}/bin/caret" doctor          # human-readable
```

The exit code is the verdict: `0` every check passed, `1` at least one failed, `2` no
report could be produced at all. On `2`, present the exit code and stderr instead — and if
the binary itself is missing (a source checkout that has never been built), say so and
point at `mise run build` (or `mise run build --install`).

## 2. Relay each failing check

A failing check already carries the remedy that closes it; relay it rather than inventing
one. What each id means:

| id | what failed | relay |
| --- | --- | --- |
| `daemon-reachable` | a caret service is installed but the daemon did not answer | the check's remedy, then offer to read `logs/daemon-stderr.log` |
| `daemon-lock` | the lock names a dead pid, or a port caret is not configured to bind | the check's remedy verbatim |
| `agent-install` | the active agent does not have caret enabled | `caret install` |
| `log-errors` | at least one live log holds an error record | step 4 |
| `opencode-caret-version` | OpenCode would load a caret behind the published one | `caret install --refresh` |

An `unknown` check is not a failure: it names its own `reason` (no network, an unreadable
config), and a doctor run offline reaching one is the normal case. A degraded state
section (`daemon error: …`, or `"error": "…"` under `--json`) is likewise normal when the
daemon is down — present it as-is rather than treating it as a failure of this command.

## 3. Present the report

End your output with the command's stdout **verbatim** in a fenced code block —
` ```json ` for the JSON format, plain ` ``` ` for the human-readable one — so the user
can copy it out in one piece. Add nothing inside the block and do not summarize away
sections; the report is already redacted and complete.

## 4. Debug a failing `log-errors`

When `log-errors` failed and the `/systematic-debugging` skill is available, invoke it to
drive root-cause investigation from the logs the check named. Otherwise read the last
error records yourself and reason from the failing step, msg, cause, and stack:

```bash
dir="${XDG_STATE_HOME:-$HOME/.local/state}/caret"
grep '^{' "$dir/logs/caret.log" | jq -s '[.[] | select(.level >= 50)] | .[-5:]'
grep '^{' "$dir/logs/daemon.log" | jq -s '[.[] | select(.level >= 50)] | .[-5:]'
tail -n 40 "$dir/logs/daemon-stderr.log"
```

A "socket connection closed" on the hook side often has its real cause on the daemon side,
so check both. If a failure predates the current live file, `gunzip -c` the segment you
need from `logs/archive/` and rerun the recipe against the result.

When reading the on-disk review records (`reviews/<id>.json`), never select or echo
`versions[].plan` or `generalCommentDraft` — they hold full plan and draft bodies.

## 5. Sharing the raw logs

If the report is not enough and the user wants to hand the raw material to a maintainer,
`caret doctor --bundle` writes a zip of the live logs and review records to caret's state
dir. Tell them plainly before suggesting it: that archive is **not** redacted — it holds
their logs and full plan bodies — so it is written only after they confirm, and it should
move over a channel they trust.
