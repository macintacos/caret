# Diagnose a problem

*Audience: anyone whose caret is misbehaving, or who needs to send a maintainer a report.*

This page covers running `caret doctor` to find what is wrong and how to fix it, running
it from your agent host, and sharing a full bundle of logs when the report is not enough.

## Run caret doctor

Run `caret doctor`. It reads your install, changes nothing, and prints a report.

The report opens with its checks:

- Whether the [background service](../reference/glossary.md#background-service) answers,
  and whether it is older than the latest on npm.
- The background service's lock file.
- Whether your [agent host](../reference/glossary.md#agent-host) has caret enabled.
- Recent error records in the live logs.
- Whether OpenCode would load an older caret in place of the published one, checked only
  when OpenCode's config names caret.
- Whether `pi` is 1.5.0 or later, lists caret exactly once with its extension loaded,
    and loads the published caret, checked only when pi's settings list caret.

Failing checks come first, in one block that counts them, and each names the fix that
closes it. The rest follow, marked `✓` passed or `?` undecided. The log check weighs only
the last 24 hours and says when each noisy log last logged an error, so an install that
has stopped failing turns green on its own.

Three checks read caret's latest version from npm, and each shows `unknown` when you are
offline:

- The version check, which reads npm only when a published caret answers as the
    background service.
- The OpenCode check.
- The pi check, run only when pi installs caret from npm.

Below the checks is the state doctor read:

- Running caret processes.
- The background service's version, build, and startup commit.
- Lock and port state.
- Effective settings and review counts.
- Whether caret is installed in your agent host.
- Log sizes, with error and warning counts.
- The last 24 hours' failures, grouped by [review](../reference/glossary.md#review) with
  their error codes.
- Install and system details.

The last line says what to run next.

Color appears only when the output is a terminal. A pipe, `TERM=dumb`, `NO_COLOR`, CI, or
`--no-color` gets plain text.

`caret doctor --json` prints the same report as one JSON object, with the schema marker
`caret-doctor/1`. The report is **always redacted**, because it exists to be shared. It
never contains plan, prompt, or feedback bodies, or any log message, error, or stack text.

The exit code is the verdict:

| Code | Meaning |
| ---- | ------- |
| `0`  | All clear. |
| `1`  | A check failed. |
| `2`  | No report: doctor could not produce one, or `--bundle` had no terminal to ask consent at and stopped before collecting anything. |

## Run it from your agent host

The [`/caret` command](../reference/glossary.md#caret-command) runs `caret doctor` for
you. What it does with the report depends on your agent host.

### Claude Code

`/caret doctor` asks whether you want JSON or human-readable output, then runs
`caret doctor`. It repeats each failing check's fix and ends with the report in a code
block, ready to share.

### OpenCode

`/caret doctor` works as in Claude Code: it asks for JSON or human-readable output,
repeats each failing check's fix, and ends with the report in a code block. It leaves the
session on the plan agent.

### pi

`/caret doctor` runs the human-readable report and shows it in the session as an entry the
model never sees.

## Share a full bundle

When a maintainer needs more than the report, run `caret doctor --bundle`. It writes a zip
of the three live logs and up to 5000 review records to caret's state directory
(`$XDG_STATE_HOME/caret` when that variable is set, otherwise `~/.local/state/caret`),
readable only by you (`0600`). It never includes the old logs in `logs/archive/`.

!!! warning

    The bundle is the one caret file that is **not** redacted. It holds your logs in full
    and complete plan bodies. Move it over a channel you trust.

caret asks before writing the bundle. With no terminal to ask at, it refuses; pass `--yes`
to confirm from a script.

To share only the logs, with home paths scrubbed, use
[Scrub the logs before sharing](logs.md#scrub-the-logs-before-sharing) instead.

## Next steps

- Read the logs yourself with [Find caret's logs](logs.md).
