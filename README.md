# 🥕 caret

> ⚠️ **Prototype.** caret is an early prototype and may change substantially over the next little
> while — interfaces, hooks, storage, and the install flow are all still settling. Expect rough
> edges and breaking changes.

A Claude Code plugin that replaces the terminal plan-approval prompt with a local web UI. When
Claude presents a plan via `ExitPlanMode`, caret opens it in your browser so you can read it
rendered as HTML, **annotate passages inline** (Google-Docs style), and **approve** or **request
changes**. Your decision — and all annotation feedback — flows straight back to the agent. A single
local daemon is shared across concurrent Claude sessions, so several in-flight plans are reviewed
from one browser tab via a switcher.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/macintacos/caret/trunk/scripts/install.sh | bash
```

That one command clones caret at its latest release (the newest `vX.Y.Z` tag), builds the binary
for your platform, and registers it with Claude Code through the native plugin system — no manual
`git clone` and no `claude --plugin-dir`. It requires [`git`](https://git-scm.com),
[`bun`](https://bun.sh), and the [`claude`](https://claude.com/claude-code) CLI on your `PATH`.

Not sure what it'll touch? Set `CARET_DRY_RUN=1` and the installer runs the same read-only
detection — tool checks, release-tag lookup, clone-vs-update — then prints the exact commands it
would run and changes nothing:

```sh
curl -fsSL https://raw.githubusercontent.com/macintacos/caret/trunk/scripts/install.sh | CARET_DRY_RUN=1 bash
```

Then restart Claude Code (or run `/reload-plugins`) and try it:

```sh
/caret:demo    # presents a short fake plan to exercise the flow
```

Enter plan mode, let Claude present a plan, and a browser tab opens at the deep-linked review.
Select text to comment, then **Approve** (optionally "& accept edits" or "& auto mode") or
**Request changes**.

**Update** by re-running the same command — it fetches the latest release, rebuilds, and reinstalls.
**Uninstall** with:

```sh
claude plugin uninstall caret@caret
claude plugin marketplace remove caret
```

## How it works

caret ships one compiled binary (`bin/caret`) with five subcommands (`daemon`, `prewarm`, `review`,
`redact`, `discovery`).

### Architecture: tool-agnostic core + agent adapter

caret is built around one boundary. A **tool-agnostic core** (everything in `src/`) owns the daemon,
the on-disk review store, the review/revision lifecycle, the settings service, leveled logging, and
the browser UI — none of it knows which coding agent is on the other end. An **agent adapter**
(`src/adapters/`) owns everything agent-specific: parsing the agent's hook input, emitting the
agent's decision response, declaring the approve variants it offers, and probing the agent's local
install for diagnostics. The core hands the adapter raw hook stdin and a core decision; the adapter
hands back a normalized plan and a tool-specific stdout response. The dependency runs one way — an
adapter imports core types, never the reverse.

`src/adapters/claude/` is the first (today's only) implementation, for Claude Code. A future agent
tool plugs in as a second adapter without touching core internals. The hooks table and decision-JSON
block below, and the behavioral prose in `commands/*.md`, describe **Claude-adapter** surface — they
are agent-specific, not core behavior.

### The Claude Code adapter

caret wires into Claude Code through two plan-mode hooks:

| Hook                | Matcher         | Command         | Purpose                                                   |
| ------------------- | --------------- | --------------- | --------------------------------------------------------- |
| `PostToolUse`       | `EnterPlanMode` | `caret prewarm` | Warm-start the daemon when the model enters plan mode.    |
| `PermissionRequest` | `ExitPlanMode`  | `caret review`  | Block, open the plan in the browser, return the decision. |

The `PermissionRequest`/`ExitPlanMode` hook intercepts the plan-approval request itself, so an
**approve** auto-answers it (no native dialog) and a **request changes** returns the feedback to the
model, which revises and re-presents (captured as a new version). This was verified empirically —
`PreToolUse` does **not** work for this, because allowing the tool to run still shows the native
dialog.

The reviewer's approve choice is an opaque variant id the core stores and the UI renders; the Claude
adapter declares its variants (`default` / `acceptEdits` / `auto`) and rides them to the UI over
`GET /api/health`, so the approve split-button reflects the active adapter's capabilities rather than
hard-coded mode names. On a decision the adapter maps the chosen variant to a session `setMode`
permission and emits the resulting
[PermissionRequest decision](https://code.claude.com/docs/en/hooks) on stdout:

```jsonc
// approve (plain): no mode change
{ "hookSpecificOutput": { "hookEventName": "PermissionRequest",
  "decision": { "behavior": "allow" } } }
// approve & accept edits / & auto mode: switch the Claude session into that mode
{ "hookSpecificOutput": { "hookEventName": "PermissionRequest",
  "decision": { "behavior": "allow",
    "updatedPermissions": [{ "type": "setMode", "mode": "acceptEdits", "destination": "session" }] } } }
// request changes
{ "hookSpecificOutput": { "hookEventName": "PermissionRequest",
  "decision": { "behavior": "deny", "message": "<formatted annotations + comment>" } } }
```

**Fail-safe = deny.** On a bad payload, an unreachable daemon, a timeout, a signal, or daemon death,
caret emits `deny` with an explanation — it never auto-approves an unreviewed plan.

### Desktop notifications

When a new plan lands while caret is in the background — tab hidden or window unfocused — the page
fires a desktop notification; clicking it focuses the tab and opens that review (a notification
click is a user gesture, the one focus path browsers reliably allow). The bell badge in the top bar
shows the current permission — granted, blocked, or undecided — requests it on click when undecided,
and **sends a test notification on click when granted**. Page-context only, no service worker: the
tab must be open.

If the test click produces no toast, the page's side worked (the daemon log shows the fired/shown
records) and the OS is suppressing it — a granted notification the OS blocks fails silently, with no
error the page can catch. On macOS check, in order: System Settings → Notifications → your browser
("Allow notifications" on, alert style not "None"), Focus / Do Not Disturb, and the
"when mirroring or sharing" toggle if a display is shared. Note also that a *hidden* tab's poll is
throttled by Chrome after ~5 minutes in the background, which can delay a notification by up to a
minute; an unfocused-but-visible window polls at full rate.

## Configuration

### Config file

caret reads optional settings from `$XDG_CONFIG_HOME/caret/config.toml` when `XDG_CONFIG_HOME` is
set, otherwise `~/.config/caret/config.toml`. This lives deliberately apart from the state dir so
your config survives `mise run dev`, which wipes `XDG_STATE_HOME`.

The file is TOML, and both it and every key are optional — a missing file or a missing key falls
back to defaults. An invalid file never crashes caret: it keeps the last valid parse, or the
defaults if there has never been one. Settings hot-reload, so the file is re-read on change with no
daemon restart needed.

The `[logging]` table accepts two keys:

| Key      | Default  | Purpose                                                                                                                            |
| -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `level`  | `"info"` | Minimum level written to the logs — one of `"debug"`, `"info"`, `"warn"`, `"error"`. Set `level = "debug"` to turn on debug logging. |
| `redact` | `false`  | When `true`, identifiable data (home-directory paths, usernames in paths) is scrubbed from log records as they are written.         |

Logs are raw by default; `caret redact` (see [Logging & Debugging](#logging--debugging)) produces
shareable copies after the fact.

The `[daemon]` and `[review]` tables hold the tunables the `CARET_*` environment variables also
cover (see below); precedence is **env var > config file > default**:

| Key                    | Default | Purpose                                                                                                                                                       |
| ---------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `daemon.port`          | `42718` | Daemon port.                                                                                                                                                  |
| `daemon.idle_ms`       | `60000` | Idle delay (ms) before the daemon auto-shuts-down with no reviews.                                                                                            |
| `daemon.heartbeat_ms`  | `8000`  | Decision long-poll heartbeat window (ms).                                                                                                                     |
| `review.timeout_s`     | `3600`  | Review window in seconds before the hook fail-safe-denies (default 1 hour). The schema rejects values at or above the 3900s hook budget in `hooks/hooks.json`. |

Unlike the `[logging]` keys, which hot-reload live, the tunables are captured at startup: `port`,
`idle_ms`, and `heartbeat_ms` take effect on the next daemon start, and `timeout_s` on the next
review.

```toml
[logging]
level = "info"
redact = false

[daemon]
port = 42718
idle_ms = 60000
heartbeat_ms = 8000

[review]
timeout_s = 3600
```

### Environment variables

Each `CARET_*` var shadows its config-file key (precedence **env var > config file > default**). A
set-but-invalid value — wrong shape or out of bounds — is ignored with one boot-time warning in the
logs, and resolution falls through to the config file, then the default.

| Env var              | Config key            | Default          | Purpose                                                                                     |
| -------------------- | --------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `CARET_PORT`         | `daemon.port`         | `42718`          | Daemon port.                                                                                |
| `CARET_TIMEOUT`      | `review.timeout_s`    | `3600` (s)       | Review window before the hook fail-safe-denies, in seconds. Values ≥ 3900 are invalid.      |
| `CARET_IDLE_MS`      | `daemon.idle_ms`      | `60000`          | Idle delay before the daemon auto-shuts-down with no reviews.                               |
| `CARET_HEARTBEAT_MS` | `daemon.heartbeat_ms` | `8000`           | Decision long-poll heartbeat window (ms).                                                   |
| `XDG_STATE_HOME`     | —                     | `~/.local/state` | Unresolved reviews persist under `$XDG_STATE_HOME/caret/reviews/` and rehydrate on restart. |

## Logging & Debugging

Logs live under `$XDG_STATE_HOME/caret` when set, otherwise `~/.local/state/caret`:

- `caret.log` — NDJSON records from the short-lived `caret review` hook process.
- `daemon.log` — the detached daemon's stdout/stderr: the same NDJSON shape (tagged with `pid`),
  possibly interleaved with raw non-JSON crash output.

Browser-UI events ship to the daemon in batches (`POST /api/logs`) and land in `daemon.log` tagged
`source: "ui"`, subject to the same `[logging]` level and redact settings as everything else.

Each record is one JSON object per line (pino): `level` (numeric — 20 debug, 30 info, 40 warn,
50 error), `time` (ISO 8601 UTC, e.g. `2026-06-04T21:25:40.038Z`), `step` (a short fixed token),
`source` (the emitting process —
`"hook"`, `"daemon"`, or `"ui"`), `caller` (the `file:line` of the emitting call site — on hook and
daemon records; bridged UI records omit it), `msg`, plus structured extras. Normal operation logs at
info; only genuine failures sit at error.

To raise verbosity, set `level = "debug"` in `config.toml`'s `[logging]` table
(see [Configuration](#config-file)). It hot-reloads — no restart needed.

- `/caret:debug` — the slash command that reviews the current session —
  pending/approved/rejected/expired plans (from the on-disk review records) plus recent errors
  from both logs — and helps debug failures.
- `caret redact` — the binary's fourth subcommand: scrubs the two state-dir logs into shareable
  `*.redacted.log` siblings (home paths become `~`, usernames in foreign home paths are censored).
  For always-on scrubbing at write time, set `redact = true` in `[logging]`. Plan, prompt, and
  review-feedback bodies are never written to logs regardless of the toggle.
- `caret discovery` — the binary's fifth subcommand: a one-shot, read-only diagnostics snapshot of
  the local install — running caret processes, daemon identity (version, build, startup commit),
  lock/port state, effective settings, review counts, the agent adapter's install-state probe, log
  sizes and error/warn counts, install/runtime info, and system basics. Human-readable by default;
  `caret discovery --json` prints the same report as one JSON document (schema marker
  `caret-discovery/1`). Unlike the logs, the report is **always redacted** — it exists to be pasted
  into bug reports — and it never contains plan/prompt/feedback bodies or log contents. Probes are
  individually bounded and degrade per-section, so the command exits 0 even when the daemon is down.
- `/caret:discovery` — the slash command that wraps it: asks whether you want JSON or
  human-readable output, runs the subcommand, and ends with the report in a code block ready to
  paste into a bug report. Complements `/caret:debug` (the session timeline): discovery is the
  point-in-time snapshot of the installation.

Contributors should see `.claude/rules/logging-rules.md` for the logging conventions — when to log,
levels, and message style.

## Development

Requires [mise](https://mise.jdx.dev), which pins bun, biome, hk, and pkl.

```sh
mise run setup      # install pinned tools + JS deps + e2e Chromium + register git hooks
mise run build      # build:ui (Vite single-file) then build:bin (bun build --compile)
mise run dev        # isolated daemon + fake plan + Vite UI (ephemeral port)
mise run test       # bun test
mise run test-e2e   # Playwright browser e2e (isolated daemon, Chromium)
mise run lint       # Biome + tsc + svelte-check (read-only); the CI/pre-commit gate
mise run format     # Biome (write)
mise run preflight  # check-only pre-push gate: lint + tests (unit ∥ e2e) + build, concurrent
```

`mise run lint` (and the pre-commit hook) runs Biome lint, `tsc --noEmit`, and `svelte-check` —
type checking is folded into linting via `hk.pkl`.

`mise run dev` is self-contained — no separate `bin/caret daemon` needed. It starts an isolated
caret daemon as `caret daemon --ephemeral`, which binds an OS-assigned port; the dev task discovers
the real port from the daemon's lock file (`$XDG_STATE_HOME/caret/daemon.lock`, written after the
bind) and exports it as `CARET_PORT` before starting the driver and Vite. The state dir is an
ephemeral `XDG_STATE_HOME`, so any number of `mise run dev` sessions coexist — each claims its own
port and state dir, and Vite auto-increments its UI port per session. The daemon is seeded with one
fake pending plan, and a driver plays the agent's side through the real review hook path: each
request-changes appends a revision section quoting your feedback and resubmits, and approve re-seeds
a fresh plan, with real hook records landing in the dev state dir's `caret.log`. The driver also
seeds a genuinely-new review (fresh session, fresh review id) every 15 seconds by default, capped at
three unresolved extras at a time — grant notifications, background the tab, and the next seed fires
a clickable desktop notification. Set `CARET_DEV_NEW_REVIEW_MS` to tune the cadence in milliseconds
(`0` disables); the driver logs the seeder's armed/disabled state at boot either way. One
notification gotcha: browser notification grants are per-origin **including the port**, so when an
orphaned dev server squats Vite's port and a new session auto-increments to the next one, the UI
lands on a fresh origin whose permission is back to "default" — the bell shows the muted "?" again
and new plans log `plan notification skipped (permission)`. Re-grant via the bell, or kill the
straggler holding the port (`lsof -nP -iTCP:5173 -sTCP:LISTEN`). Everything is
reaped on Ctrl-C, and the dev daemon never reads or writes a globally-installed caret's reviews. To
pin a fixed dev port instead, set `CARET_DEV_PORT` to any free port other than `42718` (the
production default); this skips `--ephemeral` and binds that port, so only one such session can run
at a time.

`mise run test-e2e` runs the Playwright specs in `e2e/` against an isolated daemon that serves the
built single-file UI on an OS-assigned port with ephemeral state, so the suite never touches your
real daemon or `~/.local/state/caret`. `mise run setup` installs the Chromium browser the specs
drive. For when to write an e2e spec versus a `bun test` unit versus throwaway exploration, see
`.claude/rules/browser-testing.md`.

For a quick local trial without installing, load the plugin from a checkout:

```sh
mise run build
claude --plugin-dir ./    # load caret's hooks for this session only
/reload-plugins           # if you rebuild while Claude is running
```

### Icons

caret's icons are [Lucide](https://lucide.dev) SVGs vendored verbatim at a pinned release under
`ui/src/icons/`, rendered by `ui/src/components/Icon.svelte`. Adding one means following the
checklist in `.claude/rules/icon-rules.md` and adding a row to
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## Layout

```text
src/                tool-agnostic core (flat): cli.ts (Commander tree) · review.ts (review orchestration)
                    daemon.ts (Bun.serve) · daemon-lifecycle.ts · daemon-client.ts · store.ts · reviews.ts (revision threading)
                    decisions.ts · prefs.ts · log.ts (leveled NDJSON) · caller-location.ts · redact.ts · redact-core.ts (browser-safe)
                    settings.ts (config.toml) · constants.ts · paths.ts · build-id.ts (VERSION/identity/lock) · types.ts (wire contract)
                    json-file.ts · plan-format.ts · ui-asset.ts · ui-log-bridge.ts (/api/logs) · program.ts (shared CLI scaffolding)
src/commands/       per-subcommand entrypoints (daemon, prewarm, review, redact, discovery, boot)
src/adapters/       adapter.ts (AgentAdapter interface) · claude/ (the Claude Code adapter: hook parse, decision emission, approve variants, install probe)
ui/                 Svelte 5 single-file SPA (Vite + vite-plugin-singlefile) · src/state/ runes state modules · src/icons/ vendored Lucide SVGs
hooks/              hooks.json (PermissionRequest/ExitPlanMode + PostToolUse/EnterPlanMode) — Claude-adapter packaging
commands/           /caret:demo · /caret:debug · /caret:discovery — Claude-adapter packaging (agent-specific behavioral prose)
test/support/       shared test scaffolding (daemon boot, NDJSON parsing, redaction matchers)
scripts/            install.sh (build + register via the native plugin system)
```

The polished diff/compare viewer for plan versions is a planned fast-follow.

## License

MIT — see [LICENSE](LICENSE). Vendored third-party assets (the Lucide icons) are itemized in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) (ISC).
