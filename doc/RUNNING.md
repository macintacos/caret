# caret — Running

*Audience: users running caret day to day — desktop notifications, cmux unread marks, and
logging & debugging.*

Part of the deep reference behind [README.md](../README.md). For what caret is, how to
install it, and basic usage, start there.

## Desktop notifications

### When one fires

A new plan landing while caret is in the background — tab hidden or window unfocused —
fires a desktop notification. Clicking it focuses the tab and opens that review (a
notification click is a user gesture, the one focus path browsers reliably allow).

> [!NOTE]
> Page-context only, no service worker: the tab must be open.

### Where the permission lives

The bell badge in the top bar shows the current permission with a distinct indicator:

| Indicator         | Permission |
| ----------------- | ---------- |
| Green dot         | Granted    |
| Red dot           | Blocked    |
| Subtle-purple "?" | Undecided  |

Clicking the bell requests permission when undecided, and **sends a test notification**
when granted. On a first-ever run, an onboarding modal introduces desktop notifications
and offers to enable them.

The same permission state has a roomier home in **Settings → Notifications**, which reads
it live — On / Blocked / Off for those same three states — with the same enable / test
affordance as the bell. Open Settings from the top-bar button or `,` — a two-pane dialog
you can filter with `/`, and `?` opens the keyboard-shortcuts help from anywhere.

### Where a grant applies

> [!IMPORTANT]
> Grants are **per-origin** (scheme + host + port). The installed build opens the review
> UI at the vanity origin `http://caret.localhost:42718`, a different origin from
> `mise run dev`'s Vite server (`localhost:5173`) — so a grant made in dev does **not**
> carry over.

On the installed build, grant notifications once on `caret.localhost:42718` via the bell —
it shows the undecided "?" state until you do. While the grant stays undecided, a new plan
logs `plan notification skipped (permission)` at info in the daemon log, so a missing
grant is visible without enabling debug logging.

### When no toast appears

If the test click produces no toast, the page's side worked (the daemon log shows the
fired/shown records) and the OS is suppressing it — a granted notification the OS blocks
fails silently, with no error the page can catch. On macOS, check in order:

1. System Settings → Notifications → your browser: "Allow notifications" on, alert style
   not "None".
2. Focus / Do Not Disturb.
3. The "when mirroring or sharing" toggle, if a display is shared.

> [!NOTE]
> A *hidden* tab's poll is throttled by Chrome after ~5 minutes in the background, which
> can delay a notification by up to a minute. An unfocused-but-visible window polls at
> full rate.

## cmux unread marks

Under [cmux](https://github.com/coder/cmux), the pane an agent runs in gets an unread mark
when the agent submits a plan — but the plan is reviewed in the browser, so nothing would
otherwise clear it. caret joins the two ends: at submit time the hook captures its
`CMUX_WORKSPACE_ID` and `CMUX_SURFACE_ID`, and the ids ride along on the review record
(the daemon is long-lived and shared across sessions, so it never inherits any one agent's
environment).

Once the plan is reviewed, the daemon runs
`cmux mark-notification-read --workspace <id> --surface <id>` for that one pane. Two
things count as reviewed, and either clears the mark:

- **You decide on the plan** — approve, reject, or request changes.
- **You read it** — the plan on screen, the tab visible and focused, for 5 seconds
  uninterrupted. Losing focus or hiding the tab cancels the dwell rather than pausing it,
  so a backgrounded tab left open never clears a mark on its own.

Three details worth knowing:

- Both ids are required, and every call names both — caret never uses `--all`, so one
  plan's mark can only ever clear the pane that submitted it.
- There is nothing to configure: with either id missing the integration is silently inert,
  which is what running outside cmux looks like.
- If the `cmux` binary isn't on the daemon's PATH, the mark is left standing and one
  `warn` lands in the daemon log.

## Logging & Debugging

### Where the logs live

Logs live under `$XDG_STATE_HOME/caret/logs` when set, otherwise
`~/.local/state/caret/logs`:

| File                | What's in it                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `caret.log`         | NDJSON records from the short-lived `caret review` hook process.                                                                    |
| `daemon.log`        | The detached daemon's records: the same NDJSON shape, tagged with `pid`.                                                            |
| `daemon-stderr.log` | Whatever the detached daemon writes outside its logger — raw non-JSON crash output.                                                 |
| `archive/`          | Gzipped rotations, named `<log>-<stamp>.log.gz`. A log past `[logging].max_size` is archived here and emptied; the newest `[logging].keep` per log are kept. |

Browser-UI events ship to the daemon in batches (`POST /api/logs`) and land in
`daemon.log` tagged `source: "ui"`, subject to the same `[logging]` level and redact
settings as everything else.

### What a record carries

Each record is one JSON object per line (pino):

| Field    | Value                                                                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| `level`  | Numeric — 20 debug, 30 info, 40 warn, 50 error.                                                           |
| `time`   | ISO 8601 UTC, e.g. `2026-06-04T21:25:40.038Z`.                                                            |
| `step`   | A short fixed token.                                                                                      |
| `source` | The emitting process — `"hook"`, `"daemon"`, or `"ui"`.                                                   |
| `caller` | The `file:line` of the emitting call site. On hook and daemon records only; bridged UI records omit it.    |

Every record also carries `msg`, plus structured extras. Normal operation logs at info;
only genuine failures sit at error.

> [!TIP]
> To raise verbosity, set `level = "debug"` in `config.toml`'s `[logging]` table (see
> [Config file](CONFIGURING.md#config-file)). It hot-reloads — no restart needed.

### Diagnostics

- `/caret:debug` — the slash command that reviews the current session —
  pending/approved/rejected/expired plans (from the on-disk review records) plus recent
  errors from the live logs — and helps debug failures.
- `caret redact` — scrubs the three live logs, not the archives, into shareable
  `*.redacted.log` siblings (home paths become `~`, usernames in foreign home paths are
  censored). For always-on scrubbing at write time, set `redact = true` in `[logging]`.
  Plan, prompt, and review-feedback bodies are never written to logs regardless of the
  toggle.
- `caret discovery` — a one-shot, read-only diagnostics snapshot of the local install —
  running caret processes, daemon identity (version, build, startup commit), lock/port
  state, effective settings, review counts, the agent adapter's install-state probe, log
  sizes and error/warn counts, install/runtime info, and system basics. Human-readable by
  default; `caret discovery --json` prints the same report as one JSON document (schema
  marker `caret-discovery/1`). Unlike the logs, the report is **always redacted** — it
  exists to be shared — and it never contains plan/prompt/feedback bodies or log contents.
  Probes are individually bounded and degrade per-section, so the command exits 0 even
  when the daemon is down.
- `/caret:discovery` — the slash command that wraps it: asks whether you want JSON or
  human-readable output, runs the subcommand, and ends with the report in a code block
  ready to share. Complements `/caret:debug` (the session timeline): discovery is the
  point-in-time snapshot of the installation.

Contributors should see `agents/logging-rules.md` for the logging conventions — when to
log, levels, and message style.
