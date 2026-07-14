# caret — Advanced

*Audience: users and contributors who need caret's full reference — building from source,
the architecture, the agent adapters, the complete configuration surface, and the
development workflow.*

This is the deep reference behind [README.md](../README.md). For what caret is, how to
install it, and basic usage, start there.

## Build from source

Prefer a platform-native compiled binary over the `bun` bundle? The build-from-source
installer clones caret at its latest release (the newest `vX.Y.Z` tag), compiles the
binary for your platform, and registers it with your agent(s) — no `claude --plugin-dir`.
It needs [`git`](https://git-scm.com) and [`bun`](https://bun.sh) on your `PATH`; it
detects Claude Code and/or OpenCode and installs into the one(s) present (the
[`claude`](https://claude.com/claude-code) CLI is required only for the Claude target —
set `CARET_AGENTS=claude,opencode` to choose non-interactively):

```sh
curl -fsSL https://raw.githubusercontent.com/macintacos/caret/trunk/scripts/install.sh | bash
```

Set `CARET_DRY_RUN=1` and the installer runs the same read-only detection — tool checks,
release-tag lookup, clone-vs-update — then prints the exact commands it would run and
changes nothing:

```sh
curl -fsSL https://raw.githubusercontent.com/macintacos/caret/trunk/scripts/install.sh | CARET_DRY_RUN=1 bash
```

## How it works

Claude Code's hooks invoke `bin/caret`, a small entrypoint shim that runs caret's
subcommands. The shim execs the platform-native compiled binary (`bin/caret-native`) when
a build-from-source install produced one, and otherwise runs the `bun` bundle
(`dist/cli.js`) that the marketplace install ships.

### Architecture: tool-agnostic core + agent adapter

caret is built around one boundary. A **tool-agnostic core** (everything in `src/`) owns
the daemon, the on-disk review store, the review/revision lifecycle, the settings service,
leveled logging, and the browser UI — none of it knows which coding agent is on the other
end. An **agent adapter** (`src/adapters/`) owns everything agent-specific: parsing the
agent's hook input, emitting the agent's decision response, declaring the approve variants
it offers, and probing the agent's local install for diagnostics. The core hands the
adapter raw hook stdin and a core decision; the adapter hands back a normalized plan and a
tool-specific stdout response. The dependency runs one way — an adapter imports core
types, never the reverse.

`src/adapters/claude/` is the reference implementation, for Claude Code, and the default
adapter. `src/adapters/codex/` is a second adapter for the OpenAI Codex CLI that proves
the boundary is real: it is **default-off and provisional** — its PermissionRequest wire
contract is modeled from Codex docs and not yet verified against a live Codex session, and
it ships no Codex packaging (no installer or hook manifests). `src/adapters/opencode/` is
a third adapter, for OpenCode — and unlike codex it ships real packaging: an in-process
plugin and its own installer. OpenCode is plugin-shaped, not command-hook-shaped, so caret
registers a `caret_review_plan` tool that bridges to `caret review` rather than a hook
(see [`agents/opencode-integration.md`](agents/opencode-integration.md)). Select an
adapter with `CARET_AGENT=codex` or `CARET_AGENT=opencode`; with no selector caret uses
Claude, so the shipped Claude plugin keeps working unchanged. The hooks table and
decision-JSON block below, and the behavioral prose in `commands/*.md`, describe
**Claude-adapter** surface — they are agent-specific, not core behavior.

### The Claude Code adapter

caret wires into Claude Code through three plan-mode hooks:

| Hook                | Matcher         | Command           | Purpose                                                     |
| ------------------- | --------------- | ----------------- | ----------------------------------------------------------- |
| `PostToolUse`       | `EnterPlanMode` | `caret prewarm`   | Warm-start the daemon when the model enters plan mode.      |
| `PermissionRequest` | `ExitPlanMode`  | `caret review`    | Block, open the plan in the browser, return the decision.   |
| `PostToolUse`       | `ExitPlanMode`  | `caret reconcile` | Reconcile a plan decided in the terminal into the daemon.   |

The `PermissionRequest`/`ExitPlanMode` hook intercepts the plan-approval request itself,
so an **approve** auto-answers it (no native dialog) and a **request changes** returns the
feedback to the model, which revises and re-presents (captured as a new version). This was
verified empirically — `PreToolUse` does **not** work for this, because allowing the tool
to run still shows the native dialog.

The `PostToolUse`/`ExitPlanMode` hook (`caret reconcile`) fires when a plan is approved.
If the approval happened in Claude's own interface rather than caret's UI — so the daemon
still holds the review as pending — it resolves that review to keep the two surfaces in
sync. When the UI already resolved the plan (the normal case) it is a no-op, and it never
gates: any failure is silent, so a stalled reconcile can't block the agent.

The reviewer's approve choice is an opaque variant id the core stores and the UI renders;
the Claude adapter declares its variants (`default` / `acceptEdits` / `auto`) and rides
them to the UI over `GET /api/health`, so the approve split-button reflects the active
adapter's capabilities rather than hard-coded mode names. On a decision the adapter maps
the chosen variant to a session `setMode` permission and emits the resulting
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

**Fail-safe = deny.** On a bad payload, an unreachable daemon, a timeout, a signal, or
daemon death, caret emits `deny` with an explanation — it never auto-approves an
unreviewed plan.

**Why the review has a timeout.** The `caret review` hook long-polls the daemon for the
reviewer's decision, but Claude Code kills any hook that outruns its `timeout` budget —
and a killed `PermissionRequest` hook fails _open_, letting the plan proceed unreviewed.
So caret bounds its own wait with `review.timeout_s` (default 1 hour) and fail-safe-denies
when it elapses — a controlled deny that lands before Claude Code would kill the hook. To
guarantee that ordering, `review.timeout_s` is pinned strictly below the hook's `timeout`
(`3900` s in `hooks/hooks.json`); the schema rejects any value at or above it, and a
coupling test keeps the two numbers from drifting into the unsafe direction. The timeout
is therefore a requirement of the hook model — not a limit on how long you may take — so
raise `review.timeout_s` (up to just under 3900 s) if you want a longer window.

### The OpenCode adapter

OpenCode has no `ExitPlanMode` hook to intercept, so caret wires in as an
**in-process plugin** rather than a command hook. The plugin (shipped in the
`@macintacos/caret` package) registers a `caret_review_plan` tool and steers the Plan
agent to call it; the tool's `execute()` spawns `caret review` (`CARET_AGENT=opencode`),
blocks on your decision in the browser, and returns an approval or a change request (the
reviewer feedback, without the plan echoed back) the agent revises and resubmits. The
whole daemon/review pipeline is reused unchanged — the plugin is the OpenCode-side
counterpart to Claude's `hooks.json`.

OpenCode doesn't fire plugin hooks for subagent tool calls, so caret restricts the review
tool to primary agents (`experimental.primary_tools` + per-agent `permission`) and
re-checks the caller in the tool body — a planning agent can't slip an unreviewed plan
past you through a subagent. The same **fail-safe = deny** rule holds: a spawn failure, an
unparseable decision, or a timeout all return `deny`.

caret installs into OpenCode as a `plugin` array entry: `caret install --target opencode`
adds `@macintacos/caret` to your OpenCode config's `plugin` array (comment-preserving, via
`jsonc-parser`) and deploys the `/caret:*` command files, or you can add the array entry
by hand. On its next start OpenCode installs the package and its `@opencode-ai/plugin`
dependency into its own cache and loads it — caret writes no config-dir manifest and runs
no `bun install` itself. The plugin resolves the caret binary and its own version at
runtime from the package it ships in (an env override, `CARET_OPENCODE_BIN`, still wins),
and on load it checks caret's latest GitHub release and toasts an update nudge when you're
behind (`CARET_OPENCODE_NO_UPDATE_CHECK` opts out). To take an update, delete OpenCode's
cached copy (`~/.cache/opencode/node_modules/@macintacos/caret`) and restart, or pin
`"@macintacos/caret@<version>"` in the array and bump it. `caret install --target claude`
registers caret with Claude Code through its plugin CLI, `--target opencode,claude` does
both agents at once, `--uninstall` reverses any target, and `--dry-run` previews the
changes without writing. See
[`agents/opencode-integration.md`](agents/opencode-integration.md) for the design.

### Desktop notifications

When a new plan lands while caret is in the background — tab hidden or window unfocused —
the page fires a desktop notification; clicking it focuses the tab and opens that review
(a notification click is a user gesture, the one focus path browsers reliably allow). The
bell badge in the top bar shows the current permission — granted, blocked, or undecided —
requests it on click when undecided, and
**sends a test notification on click when granted**. Page-context only, no service worker:
the tab must be open.

Grants are **per-origin** (scheme + host + port). The installed build opens the review UI
at the vanity origin `http://caret.localhost:42718`, which is a different origin from
`mise run dev`'s Vite server (`localhost:5173`) — so a grant made in dev does **not**
carry over. On the installed build, grant notifications once on `caret.localhost:42718`
via the bell (it shows the undecided "?" state until you do). While the grant stays
undecided, a new plan logs `plan notification skipped (permission)` at info in the daemon
log, so a missing grant is visible without enabling debug logging.

If the test click produces no toast, the page's side worked (the daemon log shows the
fired/shown records) and the OS is suppressing it — a granted notification the OS blocks
fails silently, with no error the page can catch. On macOS check, in order: System
Settings → Notifications → your browser ("Allow notifications" on, alert style not
"None"), Focus / Do Not Disturb, and the "when mirroring or sharing" toggle if a display
is shared. Note also that a _hidden_ tab's poll is throttled by Chrome after ~5 minutes in
the background, which can delay a notification by up to a minute; an unfocused-but-visible
window polls at full rate.

## Configuration

### Platform support

caret is **macOS-first**. It runs on Linux and Windows, but those paths are best-effort:
the review-URL opener (`openBrowser` in `src/commands/review.ts`) ships `xdg-open` (Linux)
and `cmd /c start` (Windows) branches alongside macOS's `open`, and the process-discovery
probe used by `caret discovery` (`src/discovery.ts`) shells out to the BSD-flavored
`ps -axo pid=,comm=`. These non-darwin branches are exercised primarily on macOS; if the
browser doesn't open or discovery shows no processes on Linux/Windows, the review URL
printed to stderr is the fallback.

### Config file

caret reads optional settings from `$XDG_CONFIG_HOME/caret/config.toml` when
`XDG_CONFIG_HOME` is set, otherwise `~/.config/caret/config.toml`. This lives deliberately
apart from the state dir so your config survives `mise run dev`, which wipes
`XDG_STATE_HOME`.

The file is TOML, and both it and every key are optional — a missing file or a missing key
falls back to defaults. An invalid file never crashes caret: it keeps the last valid
parse, or the defaults if there has never been one. Settings hot-reload, so the file is
re-read on change with no daemon restart needed.

The `[logging]` table accepts two keys:

| Key      | Default  | Purpose                                                                                                                            |
| -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `level`  | `"info"` | Minimum level written to the logs — one of `"debug"`, `"info"`, `"warn"`, `"error"`. Set `level = "debug"` to turn on debug logging. |
| `redact` | `false`  | When `true`, identifiable data (home-directory paths, usernames in paths) is scrubbed from log records as they are written.         |

Logs are raw by default; `caret redact` (see [Logging & Debugging](#logging--debugging))
produces shareable copies after the fact.

The `[daemon]` and `[review]` tables hold the tunables the `CARET_*` environment variables
also cover (see below); precedence is **env var > config file > default**:

| Key                    | Default | Purpose                                                                                                                                                       |
| ---------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `daemon.port`          | `42718` | Daemon port.                                                                                                                                                  |
| `daemon.idle_ms`       | `60000` | Idle delay (ms) before the daemon auto-shuts-down with no reviews.                                                                                            |
| `daemon.heartbeat_ms`  | `8000`  | Decision long-poll heartbeat window (ms). The daemon's socket `idleTimeout` is derived from this (heartbeat seconds + headroom), so it must stay below `250000`; values at or above that are rejected.    |
| `review.timeout_s`     | `3600`  | Review window in seconds before the hook fail-safe-denies (default 1 hour). The schema rejects values at or above the 3900s hook budget in `hooks/hooks.json`. |

Unlike the `[logging]` keys, which hot-reload live, the tunables are captured at startup:
`port`, `idle_ms`, and `heartbeat_ms` take effect on the next daemon start, and
`timeout_s` on the next review.

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

The `[dev]` table holds **dev-only** settings for `mise run dev`: a fixed daemon port, a
persistent state dir, and the recurring extra-review notification seeder. It is
**ignored in a production build** — its only consumers are the dev tooling
(`mise run dev`, `scripts/tasks/dev/*`), which never ship in the compiled binary, and the
settings layer build-gates it so `[dev]` resolves to inert defaults in a prod build
regardless of `config.toml`. These keys are **captured at startup** when `mise run dev`
boots (not hot-reloaded); the matching `CARET_DEV_*` environment variables override them.

| Key                      | Default | Purpose                                                                                   |
| ------------------------ | ------- | ----------------------------------------------------------------------------------------- |
| `dev.port`               | _unset_ | Fixed dev daemon port; unset → an OS-assigned ephemeral port. Must differ from `42718`.   |
| `dev.state_dir`          | _unset_ | Persistent dev state dir; unset → an ephemeral dir wiped on exit.                          |
| `dev.notify.enabled`     | `false` | When `true`, the extra-review seeder runs without `mise run dev --notify` (persist it on). |
| `dev.notify.interval_ms` | `15000` | Seeder cadence in milliseconds — a genuinely-new review every interval.                   |
| `dev.notify.max_pending` | `3`     | Cap on unresolved extra reviews; the seeder pauses while at the cap.                       |

```toml
[dev]
port = 4000
state_dir = "/path/to/persistent/dev-state"

[dev.notify]
enabled = true
interval_ms = 15000
max_pending = 3
```

### Environment variables

Each `CARET_*` var shadows its config-file key (precedence
**env var > config file > default**). A set-but-invalid value — wrong shape or out of
bounds — is ignored with one boot-time warning in the logs, and resolution falls through
to the config file, then the default.

| Env var              | Config key            | Default          | Purpose                                                                                     |
| -------------------- | --------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `CARET_PORT`         | `daemon.port`         | `42718`          | Daemon port.                                                                                |
| `CARET_TIMEOUT`      | `review.timeout_s`    | `3600` (s)       | Review window before the hook fail-safe-denies, in seconds. Values ≥ 3900 are invalid.      |
| `CARET_IDLE_MS`      | `daemon.idle_ms`      | `60000`          | Idle delay before the daemon auto-shuts-down with no reviews.                               |
| `CARET_HEARTBEAT_MS` | `daemon.heartbeat_ms` | `8000`           | Decision long-poll heartbeat window (ms). The socket `idleTimeout` derives from it, so values ≥ 250000 are invalid. |
| `CARET_AGENT`        | —                     | `claude`         | Which coding-agent adapter to drive. `claude` (default) or `codex` (provisional, default-off — see below). |
| `XDG_STATE_HOME`     | —                     | `~/.local/state` | Unresolved reviews persist under `$XDG_STATE_HOME/caret/reviews/` and rehydrate on restart. |
| `CARET_DEV_PORT`         | `dev.port`            | —                | **Dev-only.** Fixed `mise run dev` daemon port; unset → ephemeral. Must differ from `42718`. |
| `CARET_DEV_STATE_DIR`    | `dev.state_dir`       | —                | **Dev-only.** Persistent `mise run dev` state dir; unset → ephemeral. |
| `CARET_DEV_NEW_REVIEW_MS` | `dev.notify.interval_ms` | —             | **Dev-only.** Extra-review seeder cadence override (ms); a positive value also arms the seeder. Unset → cadence falls to `[dev.notify].interval_ms` (`15000`), and arming is governed by `--notify` / `[dev.notify].enabled`. |
| `CARET_PREFLIGHT_JOBS`   | —                     | CPU count        | **Preflight-only.** Max `mise run preflight` tasks in flight; a positive int. Lower it (e.g. `1`) to serialize the gate on a constrained or stacked host. Invalid/unset → the host's CPU count. |
| `CARET_E2E_WORKERS`      | —                     | `50%` of cores   | **Preflight-only.** Playwright e2e worker count (each drives a Chromium tree + daemon); a positive int. Lower it to shrink the e2e footprint on a constrained or stacked host. Unset → half the cores. |

## Logging & Debugging

Logs live under `$XDG_STATE_HOME/caret` when set, otherwise `~/.local/state/caret`:

- `caret.log` — NDJSON records from the short-lived `caret review` hook process.
- `daemon.log` — the detached daemon's stdout/stderr: the same NDJSON shape (tagged with
  `pid`), possibly interleaved with raw non-JSON crash output.

Browser-UI events ship to the daemon in batches (`POST /api/logs`) and land in
`daemon.log` tagged `source: "ui"`, subject to the same `[logging]` level and redact
settings as everything else.

Each record is one JSON object per line (pino): `level` (numeric — 20 debug, 30 info, 40
warn, 50 error), `time` (ISO 8601 UTC, e.g. `2026-06-04T21:25:40.038Z`), `step` (a short
fixed token), `source` (the emitting process — `"hook"`, `"daemon"`, or `"ui"`), `caller`
(the `file:line` of the emitting call site — on hook and daemon records; bridged UI
records omit it), `msg`, plus structured extras. Normal operation logs at info; only
genuine failures sit at error.

To raise verbosity, set `level = "debug"` in `config.toml`'s `[logging]` table (see
[Configuration](#config-file)). It hot-reloads — no restart needed.

- `/caret:debug` — the slash command that reviews the current session —
  pending/approved/rejected/expired plans (from the on-disk review records) plus recent
  errors from both logs — and helps debug failures.
- `caret redact` — scrubs the two state-dir logs into shareable `*.redacted.log` siblings
  (home paths become `~`, usernames in foreign home paths are censored). For always-on
  scrubbing at write time, set `redact = true` in `[logging]`. Plan, prompt, and
  review-feedback bodies are never written to logs regardless of the toggle.
- `caret discovery` — a one-shot, read-only diagnostics snapshot of the local install —
  running caret processes, daemon identity (version, build, startup commit), lock/port
  state, effective settings, review counts, the agent adapter's install-state probe, log
  sizes and error/warn counts, install/runtime info, and system basics. Human-readable by
  default; `caret discovery --json` prints the same report as one JSON document (schema
  marker `caret-discovery/1`). Unlike the logs, the report is **always redacted** — it
  exists to be pasted into bug reports — and it never contains plan/prompt/feedback bodies
  or log contents. Probes are individually bounded and degrade per-section, so the command
  exits 0 even when the daemon is down.
- `/caret:discovery` — the slash command that wraps it: asks whether you want JSON or
  human-readable output, runs the subcommand, and ends with the report in a code block
  ready to paste into a bug report. Complements `/caret:debug` (the session timeline):
  discovery is the point-in-time snapshot of the installation.

Contributors should see `agents/logging-rules.md` for the logging conventions — when to
log, levels, and message style.

## Development

Requires [mise](https://mise.jdx.dev), which pins bun, biome, hk, and pkl.

```sh
mise run setup      # install pinned tools + JS deps + e2e Chromium + register git hooks
mise run build      # build the UI (Vite multi-asset) then the binary (bun build --compile, embeds the UI)
mise run build ui   # just the Svelte UI (Vite -> ui/dist); also `build bin` / `build bundle`
mise run dev        # isolated daemon + fake plan + Vite UI (ephemeral port)
mise run test       # bun test (unit); `mise run test unit` is the same target
mise run test e2e   # Playwright browser e2e (isolated daemon, Chromium)
mise run lint       # read-only gate: formatting + Biome lint + tsc + svelte-check
mise run format     # Biome (write)
mise run preflight  # check-only pre-push gate: lint + tests (unit ∥ e2e) + build, concurrent
```

`mise run lint` (and the pre-commit hook) runs every formatter in read-only check mode
alongside Biome lint, `tsc --noEmit`, and `svelte-check` — formatting, linting, and type
checking are all folded into `hk.pkl`'s `check` hook, so an unformatted or tab-indented
file fails the gate instead of being silently reflowed at commit time.

`mise run build --install` goes one step further than `mise run build`: after building, it
hands the fresh `bin/caret-native` + `bin/ui` to `scripts/install.sh --from-local`, which
reuses those artifacts (no rebuild), registers a local dev marketplace pointing at the
checkout, reinstalls the caret plugin through Claude Code's native plugin system, and
prewarms so the just-built binary takes over the daemon — so after a `/reload-plugins` (or
a Claude Code restart) `/caret:*` resolves to your local build. The handoff retires a
current-build daemon automatically; a long-running daemon from an older build (no retire
endpoint, no lock file) can't be retired and keeps serving until you restart it once —
`kill` its pid, then any review respawns the fresh build. It mutates your Claude plugin
state and daemon, so it is for local development only, not CI; run
`CARET_DRY_RUN=1 mise run build --install` to preview the install steps without performing
them.

`mise run dev` is self-contained — no separate `bin/caret daemon` needed. It starts an
isolated caret daemon as `caret daemon --ephemeral`, which binds an OS-assigned port; the
dev task discovers the real port from the daemon's lock file
(`$XDG_STATE_HOME/caret/daemon.lock`, written after the bind) and exports it as
`CARET_PORT` before starting the driver and Vite. The state dir is an ephemeral
`XDG_STATE_HOME`, so any number of `mise run dev` sessions coexist — each claims its own
port and state dir, and Vite auto-increments its UI port per session. The daemon is seeded
with one fake pending plan, and a driver plays the agent's side through the real review
hook path: each request-changes appends a revision section quoting your feedback and
resubmits, and approve re-seeds a fresh plan, with real hook records landing in the dev
state dir's `caret.log`. The recurring extra-review seeder is off by default. Arm it three
ways: pass `mise run dev --notify`, set `enabled = true` under `[dev.notify]` in
`config.toml` to persist it on across runs, or set a positive `CARET_DEV_NEW_REVIEW_MS`.
When armed, it seeds a genuinely-new review (fresh session, fresh review id) every 15
seconds by default, capped at three unresolved extras at a time — grant notifications,
background the tab, and the next seed fires a clickable desktop notification. The cadence
and the pending cap come from `[dev.notify]` (`interval_ms` / `max_pending`), and
`CARET_DEV_NEW_REVIEW_MS` overrides the cadence; the driver logs the seeder's armed/off
state at boot either way. One notification gotcha: browser notification grants are
per-origin **including the port**, so when an orphaned dev server squats Vite's port and a
new session auto-increments to the next one, the UI lands on a fresh origin whose
permission is back to "default" — the bell shows the muted "?" again and new plans log
`plan notification skipped (permission)`. Re-grant via the bell, or kill the straggler
holding the port (`lsof -nP -iTCP:5173 -sTCP:LISTEN`). Everything is reaped on Ctrl-C, and
the dev daemon never reads or writes a globally-installed caret's reviews. To pin a fixed
dev port instead, set `CARET_DEV_PORT` (or `[dev].port` in `config.toml`) to any free port
other than `42718` (the production default); this skips `--ephemeral` and binds that port,
so only one such session can run at a time. Likewise, set `CARET_DEV_STATE_DIR` (or
`[dev].state_dir`) to keep dev state across restarts instead of the ephemeral default. The
same three knobs are also `mise run dev` flags — `--port <n>`, `--state-dir <dir>`, and
`--persist` — which take precedence over the environment variables and the `[dev]` config;
`--persist` keeps even the ephemeral default state dir on exit (so you can inspect its
`caret.log`) rather than wiping it.

`mise run test e2e` runs the Playwright specs in `test/e2e/` against an isolated daemon
that serves the built `ui/dist/` artifact on an OS-assigned port with ephemeral state, so
the suite never touches your real daemon or `~/.local/state/caret`. It builds the UI first
(honouring `CARET_SKIP_BUILD_UI`). `mise run setup` installs the Chromium browser the
specs drive. For when to write an e2e spec versus a `bun test` unit versus throwaway
exploration, see `agents/browser-testing.md`.

For a quick local trial without installing, load the plugin from a checkout:

```sh
mise run build
claude --plugin-dir ./    # load caret's hooks for this session only
/reload-plugins           # if you rebuild while Claude is running
```

### The tasks CLI

The `.mise/tasks/*` file tasks are thin forwarders to a single
[Commander](https://github.com/tj/commander.js) CLI at `scripts/tasks/cli.ts` — the same
scaffolding (`src/program.ts`) as the product CLI (`src/cli.ts`). Each task file is one
line: `.mise/tasks/dev` is just `exec bun scripts/tasks/cli.ts dev "$@"`, so the CLI owns
every flag's parsing, validation, defaults, and `--help`, and the task stays trivial. Each
forwarder sets `#MISE raw_args=true` so mise hands every argument — including a bare
`--help` — straight to the CLI instead of intercepting it, so `mise run dev --help` shows
a subcommand's real flags with no `--` separator.

The CLI hosts `dev`; the `build` group (bare umbrella plus the `ui`/`bin`/`bundle`
targets, `mise run build bin`); the `test` group (bare/`unit` = bun, `e2e` = Playwright);
the `smoke` group (bare = both, plus `bin`/`bundle`); `lint`, `format`, `setup`,
`preflight`; and the nested `release` group (`compute|baseline|prepare|finalize`). Every
task module is a sibling of the CLI in `scripts/tasks/` — one file per task group, named
after it (e.g. `scripts/tasks/build.ts`, `scripts/tasks/smoke.ts`) — except the larger,
multi-file `dev` task, which keeps its own `scripts/tasks/dev/` folder. Code shared across
tasks lives in `scripts/tasks/lib/`: `exec.ts` (the `runForward` / `execAndExit` spawn
helpers), `signals.ts` (the cleanup-on-exit/signal wiring the supervising tasks share),
and `smoke-probe.ts` (the over-the-wire UI probe both smoke targets run). Every
subcommand's parsing contract is unit-tested in `test/scripts/tasks-cli.test.ts`. The
`release` subcommand group lives in `scripts/tasks/release.ts` and keeps its own
JSON-on-stdout error discipline (Commander help/errors to stderr, a typed JSON result per
action) so `/release-caret` can parse it, independent of the CLI's plain-stderr top-level
handling. The `preflight` gate is a CLI subcommand too, but unlike the passthrough tasks
its `--json` / `-v` / `--grep` / `--task` flags are real Commander options — the interface
the task's mise `usage` spec once carried via `usage_*` env vars. `mise run preflight`
forwards through `.mise/tasks/preflight` (`raw_args=true`) into `caret-tasks preflight`,
whose action hands the parsed flags to the gate orchestrator in `scripts/preflight.ts`
(the concurrent task DAG, the live listr2 display, and the `--json` report builders).

Task ordering lives in the CLI, not a mise `depends` edge (EXC-738/739/740): the
ui-dependent targets — `build bin`, `build bundle`, and `test e2e` — build the UI
themselves first, UNLESS `CARET_SKIP_BUILD_UI` is set, and `smoke bin`/`smoke bundle`
build their artifact (via the tasks CLI) before smoking it. `scripts/preflight.ts` sets
`CARET_SKIP_BUILD_UI=1` on the dependents it spawns so the gate builds the UI exactly once
(two concurrent Vite builds would race on `ui/dist`). This is why the per-variant tasks
were consolidated into single multi-target `build`/`test`/`smoke` tasks.

`mise run dev` takes `--num-versions <n>` (how many versions the primary dev review opens
with; default 3, a positive integer), `--notify` (arm the extra-review seeder), and
`--port` / `--state-dir` / `--persist` (the port, state dir, and state-persistence
overrides described under Configuration above). Its orchestration — resolve the port mode
and state dir (`scripts/tasks/dev/dev-env.ts`), spawn the daemon, pino-pretty, and Vite,
run the protocol driver in-process (so commander parses `--num-versions` once, with no
re-spawned child to reap), discover the daemon's bound port from its lock, and reap every
child on exit — lives in `scripts/tasks/dev/run.ts`. Note `Bun.spawn` snapshots
`process.env` at startup and ignores later mutations, so env overrides (`XDG_STATE_HOME`,
`CARET_IDLE_MS`, `CARET_PORT`) are passed explicitly to each child rather than set on
`process.env`; the smoke targets (`scripts/tasks/smoke.ts`) follow the same
daemon-supervision pattern, and their shared over-the-wire probe is unit-tested in
`test/scripts/smoke-probe.test.ts`.

This replaces per-task bash scripts carrying `#USAGE` flag specs. Those worked but were
fragile: mise runs file tasks under macOS `/bin/bash` 3.2, where expanding an empty
`"${arr[@]}"` under `set -u` is a fatal "unbound variable" — a flagless `mise run dev`
once aborted the task mid-boot and left Vite proxying to a killed daemon, and the smoke
tasks built exactly such arrays from the served asset list. A typed, unit-tested CLI
removes that whole class of footgun.

To add a task: register a subcommand on the tasks CLI, put its logic in a
`scripts/tasks/<name>.ts` module (shared helpers go in `scripts/tasks/lib/`), and add a
one-line forwarder `.mise/tasks/<name>` = `exec bun scripts/tasks/cli.ts <name> "$@"`
(carrying `#MISE raw_args=true` so the CLI owns `--help`, plus any `#MISE description=`
and `#MISE depends=[...]` the task needs). The task file stays **bash**, not bun: mise
derives the task name from the extensionless filename, and an extensionless TypeScript
file can be neither Biome-linted nor `tsc`-typechecked and breaks the shell linters
(`hk.pkl` globs `.mise/tasks/*` as shell). The trivial `exec` forwarder sidesteps all of
that while keeping the real logic in typed, tested TS.

### Icons

caret's icons are [Lucide](https://lucide.dev) SVGs vendored verbatim at a pinned release
under `ui/src/icons/`, rendered by `ui/src/components/Icon.svelte`. Adding one means
following the checklist in `agents/icon-rules.md` and adding a row to
[THIRD_PARTY_LICENSES.md](../THIRD_PARTY_LICENSES.md).

## Layout

```text
src/                tool-agnostic core (flat): cli.ts (Commander tree) · review.ts (review orchestration)
                    daemon.ts (Bun.serve) · daemon-lifecycle.ts · daemon-client.ts · store.ts · reviews.ts (revision threading)
                    decisions.ts · prefs.ts · log.ts (leveled NDJSON) · caller-location.ts · redact.ts · redact-core.ts (browser-safe)
                    settings.ts (config.toml) · constants.ts · paths.ts · build-id.ts (VERSION/identity/lock) · types.ts (wire contract)
                    json-file.ts · plan-format.ts · ui-assets.ts (resolves the embedded UI for the daemon to serve) · ui-log-bridge.ts (/api/logs) · program.ts (shared CLI scaffolding)
src/commands/       per-subcommand entrypoints (one file per subcommand)
src/adapters/       adapter.ts (AgentAdapter interface) · index.ts (registry + CARET_AGENT selection) · claude/ (Claude Code adapter, default) · codex/ (OpenAI Codex CLI adapter, default-off + provisional)
ui/                 Svelte 5 multi-asset SPA (Vite) embedded into the binary via the build-generated asset manifest, served by the daemon by URL path · src/state/ runes state modules · src/icons/ vendored Lucide SVGs
hooks/              hooks.json (PermissionRequest/ExitPlanMode + PostToolUse/EnterPlanMode + PostToolUse/ExitPlanMode) — Claude-adapter packaging
commands/           /caret:demo · /caret:debug · /caret:discovery — Claude-adapter packaging (agent-specific behavioral prose)
test/               core/ (tool-agnostic suites) · adapters/claude/ + adapters/codex/ (per-adapter suites + fixtures) · scripts/ (release + dev tooling) · support/ (shared scaffolding)
scripts/            install.sh (build + register via the native plugin system)
```

The polished diff/compare viewer for plan versions is a planned fast-follow.
