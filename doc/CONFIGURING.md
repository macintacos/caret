# caret — Configuring

*Audience: users and contributors tuning caret — the supported platforms, the config file,
the `CARET_*` environment variables, and plan formatting.*

Part of the deep reference behind [README.md](../README.md). For what caret is, how to
install it, and basic usage, start there.

## Platform support

caret is **macOS-first**. It runs on Linux and Windows, but those paths are best-effort:
the review-URL opener (`openBrowser` in `src/commands/review.ts`) ships `xdg-open` (Linux)
and `cmd /c start` (Windows) branches alongside macOS's `open`, and the process-discovery
probe used by `caret discovery` (`src/discovery.ts`) shells out to the BSD-flavored
`ps -axo pid=,comm=`. These non-darwin branches are exercised primarily on macOS; if the
browser doesn't open or discovery shows no processes on Linux/Windows, the review URL
printed to stderr is the fallback.

## Config file

caret reads optional settings from `$XDG_CONFIG_HOME/caret/config.toml` when
`XDG_CONFIG_HOME` is set, otherwise `~/.config/caret/config.toml`. `mise run dev` reads a
separate `config.dev.toml` in the same directory instead (it points `CARET_CONFIG_FILE` at
that file), so a dev instance never reads or writes your production config — and its state
and logs are already isolated under an ephemeral `XDG_STATE_HOME`. `CARET_CONFIG_FILE`
overrides the config path outright for any invocation.

The file is TOML, and both it and every key are optional — a missing file or a missing key
falls back to defaults. An invalid file never crashes caret: it keeps the last valid
parse, or the defaults if there has never been one. Settings hot-reload, so the file is
re-read on change with no daemon restart needed.

The `[logging]` table accepts two keys:

| Key      | Default  | Purpose                                                                                                                            |
| -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `level`  | `"info"` | Minimum level written to the logs — one of `"debug"`, `"info"`, `"warn"`, `"error"`. Set `level = "debug"` to turn on debug logging. |
| `redact` | `false`  | When `true`, identifiable data (home-directory paths, usernames in paths) is scrubbed from log records as they are written.         |

Logs are raw by default; `caret redact` (see
[Logging & Debugging](RUNNING.md#logging--debugging)) produces shareable copies after the
fact.

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
persistent state dir, and the recurring extra-review notification seeder. Put it in
`config.dev.toml` (the config `mise run dev` reads — see [Config file](#config-file)), not
the production `config.toml`. It is **ignored in a production build** — its only consumers
are the dev tooling (`mise run dev`, `scripts/tasks/dev/*`), which never ship in the
compiled binary, and the settings layer build-gates it so `[dev]` resolves to inert
defaults in a prod build regardless of `config.toml`. These keys are
**captured at startup** when `mise run dev` boots (not hot-reloaded); the matching
`CARET_DEV_*` environment variables override them.

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

## Environment variables

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
| `CARET_CONFIG_FILE`  | —                     | `config.toml`    | Absolute path to the settings file, overriding the default `config.toml` location. `mise run dev` sets it to `config.dev.toml`; `--fresh` sets it to a nonexistent path so dev boots from built-in defaults. |
| `CARET_RUMDL_BIN`    | —                     | _(downloads)_    | Absolute path to an existing rumdl binary for plan formatting, overriding the on-first-use download of the pinned v0.2.47 into `$XDG_STATE_HOME/caret/rumdl/`. Blank counts as unset. Useful for offline / air-gapped installs or reusing a system rumdl. |
| `CARET_OPENCODE_BIN` | —                     | _(packaged)_     | Absolute path to the caret binary the OpenCode plugin spawns — for `caret review` and the daemon prewarm alike — overriding the one shipped beside the plugin in the `@macintacos/caret` package. Blank counts as unset. The way to point a published-package OpenCode install at a local build. |
| `CARET_DEV_PORT`         | `dev.port`            | —                | **Dev-only.** Fixed `mise run dev` daemon port; unset → ephemeral. Must differ from `42718`. |
| `CARET_DEV_STATE_DIR`    | `dev.state_dir`       | —                | **Dev-only.** Persistent `mise run dev` state dir; unset → ephemeral. |
| `CARET_DEV_NEW_REVIEW_MS` | `dev.notify.interval_ms` | —             | **Dev-only.** Extra-review seeder cadence override (ms); a positive value also arms the seeder. Unset → cadence falls to `[dev.notify].interval_ms` (`15000`), and arming is governed by `--notify` / `[dev.notify].enabled`. |
| `CARET_FRESH`            | —                     | —                | **Dev-only.** Set to `1` by `mise run dev --fresh`; surfaced in `/api/health` so the UI resets its saved preferences (theme, first-run onboarding) on boot. |
| `CARET_PREFLIGHT_JOBS`   | —                     | CPU count        | **Preflight-only.** Max `mise run preflight` tasks in flight; a positive int. Lower it (e.g. `1`) to serialize the gate on a constrained or stacked host. Invalid/unset → the host's CPU count. |
| `CARET_E2E_WORKERS`      | —                     | `50%` of cores   | **Preflight-only.** Playwright e2e worker count (each drives a Chromium tree + daemon); a positive int. Lower it to shrink the e2e footprint on a constrained or stacked host. Unset → half the cores. |

## Plan formatting (rumdl)

caret canonicalizes every incoming plan by reflowing it to a 90-column MD013 shape with
[rumdl](https://github.com/rvben/rumdl). Link URLs are exempt from that measurement —
nothing can break inside a URL, so counting it would only fragment the prose around it —
which means a line carrying a link runs wider than 90 and scrolls in the plan reader.
rumdl is not a runtime prerequisite: caret installs the pinned binary (v0.2.47) into
`$XDG_STATE_HOME/caret/rumdl/` and verifies its checksum — so formatting behaves the same
however caret was installed (Claude plugin or OpenCode).

**caret only ever formats with that one binary, at that one path.** A `rumdl` on your PATH
is never used: which version reflows your plans must not depend on what the machine
happens to have installed. The binary already at caret's path is reused only when it
reports exactly the pinned version — an older copy left by a previous caret, or a file
that won't run, is replaced. `caret install` runs that check at install time so the first
plan doesn't pay the download, and a failure there is a warning rather than a failed
install (the first plan retries). If a plan can't be formatted (rumdl missing, offline, or
an unsupported platform), caret stores it unchanged and logs one warning — a plan is never
lost. `CARET_RUMDL_BIN` is the one deliberate opt-out: point it at a binary of your own
and caret uses that instead, unchecked.
