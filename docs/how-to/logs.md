# Find caret's logs

*Audience: anyone tracking down what caret did, or preparing logs to share.*

## Find the log files

Logs live under `$XDG_STATE_HOME/caret/logs` when that variable is set, otherwise under
`~/.local/state/caret/logs`. They are the same in every
[agent host](../reference/glossary.md#agent-host):

| File                | What's in it |
| ------------------- | ------------ |
| `caret.log`         | Records from the short-lived `caret review` process your agent host starts for each [plan](../reference/glossary.md#plan): Claude Code's hook, OpenCode's plugin, or pi's tool. |
| `daemon.log`        | The [background service](../reference/glossary.md#background-service)'s records, in the same shape, tagged with `pid`. |
| `daemon-stderr.log` | Whatever the background service writes outside its logger, such as raw crash output, plus the [launcher](../explanation/background-service.md#which-caret-it-runs)'s own failures when a supervised start cannot find caret or bun. |
| `archive/`          | Gzipped old logs, named `<log>-<stamp>.log.gz`. A log past [`logging.max_size`](../reference/config-file.md#the-logging-table) is archived here and emptied; the newest `logging.keep` per log are kept. |

Events from the [review page](../reference/glossary.md#review-page) reach the background
service in batches and land in `daemon.log` tagged `source: "ui"`. The same `[logging]`
level and redact settings apply to them.

## Read a log record

Each line of `caret.log` and `daemon.log` is one JSON object:

| Field                    | Value |
| ------------------------ | ----- |
| `level`                  | A number: 20 debug, 30 info, 40 warn, 50 error. |
| `time`                   | ISO 8601 UTC, for example `2026-06-04T21:25:40.038Z`. |
| `step`                   | A short fixed token. |
| `source`                 | The process that wrote it: `"hook"` (`caret review`), `"daemon"` (the background service), or `"ui"` (the review page). |
| `caller`                 | The `file:line` of the call that wrote it. Only on records from `caret review` and the background service; records from the review page omit it. |
| `code`                   | On error records only: a stable failure code (`review-timeout`, `request-failed`, …). A shipped code is never renamed. |
| `reviewId` / `sessionId` | On a [review](../reference/glossary.md#review)'s records in both logs: they tie one review together across `caret.log` and `daemon.log`. Records written before the background service assigns an id carry `sessionId` alone. |

Every record also carries `msg`, plus structured extras. Normal operation logs at info;
only failures log at error.

## Log more detail

Set `level = "debug"` in `config.toml`'s `[logging]` table (see
[The `[logging]` table](../reference/config-file.md#the-logging-table)). The change
applies at once, with no restart.

## Scrub the logs before sharing

Run `caret redact`. It writes scrubbed copies of the three live logs beside them, as
`*.redacted.log` files, with home paths turned into `~` and usernames in other users' home
paths hidden. It does not touch `archive/`.

To scrub every record as it is written, set `redact = true` in the `[logging]` table.

Plan, prompt, and feedback bodies, and the names in `daemon.hostnames`, never reach the
logs, whatever this setting says.

## Next steps

- Check your install with [Diagnose a problem](diagnostics.md).
- See every logging setting in
    [The `[logging]` table](../reference/config-file.md#the-logging-table).
