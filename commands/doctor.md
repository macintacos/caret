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
report — doctor could not produce one, or a `--bundle` run had no terminal to ask consent
at and stopped before collecting anything. On `2`, present the exit code and stderr
instead — and if the binary itself is missing (a source checkout that has never been
built), say so and point at `mise run build` (or `mise run build --install`).

## 2. Relay each failing check

A failing check already carries the remedy that closes it; relay it rather than inventing
one. What each id means:

| id | what failed | relay |
| --- | --- | --- |
| `daemon-reachable` | a caret service is recorded but the daemon did not answer, or the effective port answers as something other than caret | the check's remedy verbatim, then offer to read any log it names |
| `daemon-lock` | the lock names a dead pid, or a port caret is not configured to bind | the check's remedy verbatim |
| `agent-install` | the active agent does not have caret enabled | `caret install` |
| `log-errors` | a live log wrote an NDJSON error record in the last 24h; the detail names which log and when it last erred | step 4 |
| `opencode-caret-version` | OpenCode would load a caret behind the published one | the check's remedy verbatim |

An `unknown` check is not a failure: it names its own `reason` — no network, an unreadable
config, or a report section that never collected, which also shows as `<name> error: …`
(`"error": "…"` under `--json`) and leaves the check with no detail. A doctor run offline
reaching one is the normal case; present it as-is rather than treating it as a failure of
this command. A daemon that is simply not running is not one of these — it reports
`reachable false` and *passes*, because an on-demand daemon idle-exits by design.

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
so check both. `log-errors` counts only NDJSON error records, so a crash that reached
`daemon-stderr.log` alone leaves it passing — tail that file even when the check is green.
It fails only on records from the last 24h, so a log that has settled passes while still
reporting when it last erred; work from that time rather than from the count. If a failure
predates the current live file, `gunzip -c` the segment you need from `logs/archive/` and
rerun the recipe against the result.

## 5. Review this session's plans

The report counts reviews in aggregate; it does not say what happened in *this* session.
When the user wants that timeline, reconstruct it from the records — identify the session
by the most recently updated review whose `cwd` matches, then list every review in it,
oldest first:

```bash
dir="${XDG_STATE_HOME:-$HOME/.local/state}/caret"
sid=$(jq -rs --arg cwd "$PWD" '[.[] | select(.cwd == $cwd)] | sort_by(.updatedAt) | last | .sessionId // empty' "$dir"/reviews/*.json)
jq -s --arg sid "$sid" '[.[] | select(.sessionId == $sid)] | sort_by(.createdAt) | .[] | {id, title, status, versions: (.versions | length), decidedAt: .decision.decidedAt, feedback: .decision.feedback}' "$dir"/reviews/*.json
```

That field whitelist is deliberate: `versions[].plan` and `generalCommentDraft` hold full
plan and draft bodies — never select or echo them.

If `sid` comes back empty, no review matches the working directory. Say so, then fall back
to the most recently updated session across all reviews and re-run the listing with it:

```bash
sid=$(jq -rs 'sort_by(.updatedAt) | last | .sessionId // empty' "$dir"/reviews/*.json)
```

If `$dir/reviews` is missing or empty the glob won't match and these commands error (shell
or jq, depending on the shell) — that is "no reviews recorded", not a failure.

Present the result grouped by status, each review with its id, title, and version count
(the number of plan revisions):

- **pending** — awaiting a decision in the browser.
- **rejected** — changes requested; awaiting a revised plan. Include a short excerpt of
  the decision `feedback`.
- **approved** — plan accepted; terminal success.
- **expired** — abandoned by its hook (timeout) or superseded by a resubmitted plan;
  terminal, never reviewed.

## 6. Sharing the raw logs

If the report is not enough and the user wants to hand the raw material to a maintainer,
`caret doctor --bundle` writes a zip of the live logs and review records to caret's state
dir. Tell them plainly before suggesting it: that archive is **not** redacted — it holds
their logs and full plan bodies — so it is written only after they confirm, and it should
move over a channel they trust. caret asks at a terminal and your run has none, so carry
their answer with `--yes` — never before they have given it.
