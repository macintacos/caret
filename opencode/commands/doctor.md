---
description: Diagnose this caret install — run caret doctor, relay each failing check's remedy, and present the report ready to share
---

caret's `doctor` subcommand renders a verdict over a one-shot, read-only snapshot of the
local install: a `checks:` block naming what is wrong and how to fix it, then the state it
read that from — running caret processes, daemon identity, lock/port state, effective
settings, review counts, the OpenCode adapter's install-state probe (plugin version,
enabled state), log sizes and error counts, and system basics. The report is
**always redacted** (home paths become `~`, foreign usernames censored) and never contains
plan, prompt, or feedback bodies — it exists to be shared.

## 1. Run it

First ask the user (briefly) which format they want:

- **JSON** — for feeding to tooling.
- **Human-readable** — for scanning in the conversation.

Then run the matching invocation (the `CARET_AGENT=opencode` selector makes the install
probe read caret's OpenCode plugin state):

```bash
CARET_AGENT=opencode "__CARET_BIN__" doctor --json   # JSON
CARET_AGENT=opencode "__CARET_BIN__" doctor          # human-readable
```

The exit code is the verdict: `0` every check passed, `1` at least one failed, `2` no
report — doctor could not produce one, or a `--bundle` run had no terminal to ask consent
at and stopped before collecting anything. On `2`, present the exit code and stderr
instead. If the binary is missing (a checkout that was never built), say so and point at
caret's install script.

## 2. Relay each failing check

A failing check already carries the remedy that closes it; relay it rather than inventing
one. What each id means:

| id | what failed | relay |
| --- | --- | --- |
| `daemon-reachable` | a caret service is recorded but the daemon did not answer, or the effective port answers as something other than caret | the check's remedy verbatim, then offer to read any log it names |
| `daemon-lock` | the lock names a dead pid, or a port caret is not configured to bind | the check's remedy verbatim |
| `agent-install` | the active agent does not have caret enabled | `caret install` |
| `log-errors` | at least one live log holds an NDJSON error record | step 4 |
| `opencode-caret-version` | OpenCode would load a caret behind the published one | the check's remedy verbatim |

An `unknown` check is not a failure: it names its own `reason` — no network, an unreadable
config, or a report section that never collected, which also shows as `<name> error: …`
and leaves the check with no detail. Present it as-is. A daemon that is simply not running
is not one of these — it reports `reachable false` and *passes*.

## 3. Present the report

End your output with the command's stdout **verbatim** in a fenced code block so the user
can copy it out in one piece. Add nothing inside the block and do not summarize sections
away — the report is already redacted and complete.

## 4. Debug a failing `log-errors`

When `log-errors` failed, read the last error records from the logs the check named and
reason from the failing step, msg, cause, and stack:

```bash
dir="${XDG_STATE_HOME:-$HOME/.local/state}/caret"
grep '^{' "$dir/logs/caret.log" | jq -s '[.[] | select(.level >= 50)] | .[-5:]'
grep '^{' "$dir/logs/daemon.log" | jq -s '[.[] | select(.level >= 50)] | .[-5:]'
tail -n 40 "$dir/logs/daemon-stderr.log"
```

A "socket connection closed" on the hook side often has its real cause on the daemon side,
so check both. `log-errors` counts only NDJSON error records, so a crash that reached
`daemon-stderr.log` alone leaves it passing — tail that file even when the check is green.
If a failure predates the current live file, `gunzip -c` the segment you need from
`logs/archive/` and rerun the recipe against the result.

## 5. Review this session's plans

The report counts reviews in aggregate, not what happened in *this* session. Reconstruct
that from the records — the newest session whose `cwd` matches the working directory,
oldest review first — and present it grouped by status (pending / rejected / approved /
expired), each review with its id, title, and version count. The field whitelist is
deliberate: never select or echo `versions[].plan` or `generalCommentDraft`, which hold
full plan/draft bodies.

```bash
dir="${XDG_STATE_HOME:-$HOME/.local/state}/caret"
sid=$(jq -rs --arg cwd "$PWD" '[.[] | select(.cwd == $cwd)] | sort_by(.updatedAt) | last | .sessionId // empty' "$dir"/reviews/*.json)
jq -s --arg sid "$sid" '[.[] | select(.sessionId == $sid)] | sort_by(.createdAt) | .[] | {id, title, status, versions: (.versions | length), feedback: .decision.feedback}' "$dir"/reviews/*.json
```

An empty `sid` means no review matches the working directory: say so, then fall back to
the most recently updated session across all reviews and re-run the listing with
`sid=$(jq -rs 'sort_by(.updatedAt) | last | .sessionId // empty' "$dir"/reviews/*.json)`.
If `$dir/reviews` is missing or empty the glob won't match — that is "no reviews
recorded", not a failure.

## 6. Sharing the raw logs

If the report is not enough and the user wants to hand the raw material to a maintainer,
`caret doctor --bundle` writes a zip of the live logs and review records to caret's state
dir. Tell them plainly before suggesting it: that archive is **not** redacted — it holds
their logs and full plan bodies — so it is written only after they confirm, and it should
move over a channel they trust. caret asks at a terminal and your run has none, so carry
their answer with `--yes` — never before they have given it.
