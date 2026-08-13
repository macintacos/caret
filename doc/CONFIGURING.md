# caret — Configuring

*Audience: users and contributors tuning caret — the supported platforms, the config file,
the `CARET_*` environment variables, and plan formatting.*

Part of the deep reference behind [README.md](../README.md). For what caret is, how to
install it, and basic usage, start there.

## Platform support

caret is **macOS-first**. It runs on Linux and Windows, but those paths are best-effort:
the platform-specific branches below are exercised primarily on macOS, and the
process-discovery probe behind `caret discovery` (`src/discovery.ts`) shells out to the
BSD-flavored `ps -axo pid=,comm=` everywhere.

The review-URL opener (`openBrowser` in `src/commands/review.ts`) ships one branch per
platform:

| Platform | Opener         |
| -------- | -------------- |
| macOS    | `open`         |
| Linux    | `xdg-open`     |
| Windows  | `cmd /c start` |

> [!NOTE]
> If the browser doesn't open, or discovery shows no processes, on Linux or Windows: the
> review URL caret prints to stderr is the fallback.

## Config file

caret reads optional settings from a TOML file. Which file, in precedence order:

| When                       | Path                                 |
| -------------------------- | ------------------------------------ |
| `CARET_CONFIG_FILE` is set | that path, for any invocation        |
| `XDG_CONFIG_HOME` is set   | `$XDG_CONFIG_HOME/caret/config.toml` |
| otherwise                  | `~/.config/caret/config.toml`        |

`mise run dev` takes the first of those: it points `CARET_CONFIG_FILE` at a separate
`config.dev.toml` beside your `config.toml`.

> [!NOTE]
> A dev instance never reads or writes your production config, and its state and logs are
> already isolated under an ephemeral `XDG_STATE_HOME`.

The file and every key in it are optional:

- A missing file, or a missing key, falls back to the default.
- An invalid file never crashes caret: it keeps the last valid parse, or the defaults if
  there has never been one.
- Settings hot-reload — the file is re-read on change, with no daemon restart needed. The
  `[daemon]`, `[review]`, and `[dev]` tunables are the exceptions; see below.

### The `[logging]` table

| Key        | Default   | Purpose                                                                                                                             |
| ---------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `level`    | `"info"`  | Minimum level written to the logs — one of `"debug"`, `"info"`, `"warn"`, `"error"`. Set `level = "debug"` to turn on debug logging. |
| `redact`   | `false`   | When `true`, identifiable data (home-directory paths, usernames in paths) is scrubbed from log records as they are written.          |
| `max_size` | `5242880` | Size in bytes a log may reach before it is archived gzipped under `logs/archive/` and emptied. 5 MiB by default; values below `65536` (64 KiB) or above `268435456` (256 MiB) are rejected. |
| `keep`     | `10`      | Gzipped archives kept per log — the oldest are deleted past that count. `0` empties a full log without archiving it, and clears that log's existing archives. |

`max_size` and `keep` are also settable per the precedence
**environment variable > config file > default** (see
[Environment variables](#environment-variables)), and both are read live — an edit takes
effect on the next record written, with no restart.

Logs are raw by default; `caret redact` (see
[Logging & Debugging](RUNNING.md#logging--debugging)) produces shareable copies after the
fact.

### The `[daemon]` and `[review]` tables

These hold the tunables the `CARET_*` environment variables also cover (see
[Environment variables](#environment-variables)); precedence is
**env var > config file > default**.

| Key                   | Default | Purpose                                                                                                                                                                                               |
| --------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `daemon.port`         | `42718` | Daemon port.                                                                                                                                                                                          |
| `daemon.idle_ms`      | `60000` | Idle delay (ms) before the daemon auto-shuts-down with no reviews.                                                                                                                                    |
| `daemon.heartbeat_ms` | `8000`  | Decision long-poll heartbeat window (ms). The daemon's socket `idleTimeout` is derived from this (heartbeat seconds + headroom), so it must stay below `250000`; values at or above that are rejected. |
| `review.timeout_s`    | `3600`  | Review window in seconds before the hook fail-safe-denies (default 1 hour). The schema rejects values at or above the 3900s hook budget in `hooks/hooks.json`.                                         |

> [!NOTE]
> Unlike the `[logging]` keys, which hot-reload live, these tunables are captured at
> startup: `port`, `idle_ms`, and `heartbeat_ms` take effect on the next daemon start, and
> `timeout_s` on the next review.

```toml
[logging]
level = "info"
redact = false
max_size = 5242880
keep = 10

[daemon]
port = 42718
idle_ms = 60000
heartbeat_ms = 8000

[review]
timeout_s = 3600
```

### The `[dev]` table

Dev-only settings for `mise run dev`: a fixed daemon port, a persistent state dir, and the
recurring extra-review notification seeder.

> [!WARNING]
> `[dev]` is **ignored in a production build**. Its only consumers are the dev tooling
> (`mise run dev`, `scripts/tasks/dev/*`), which never ships in the compiled binary, and
> the settings layer build-gates it so `[dev]` resolves to inert defaults in a prod build
> regardless of `config.toml`.

| Key                      | Default | Purpose                                                                                   |
| ------------------------ | ------- | ----------------------------------------------------------------------------------------- |
| `dev.port`               | _unset_ | Fixed dev daemon port; unset → an OS-assigned ephemeral port. Must differ from `42718`.   |
| `dev.state_dir`          | _unset_ | Persistent dev state dir; unset → an ephemeral dir wiped on exit.                          |
| `dev.notify.enabled`     | `false` | When `true`, the extra-review seeder runs without `mise run dev --notify` (persist it on). |
| `dev.notify.interval_ms` | `15000` | Seeder cadence in milliseconds — a genuinely-new review every interval.                   |
| `dev.notify.max_pending` | `3`     | Cap on unresolved extra reviews; the seeder pauses while at the cap.                       |

> [!IMPORTANT]
> Put `[dev]` in `config.dev.toml` — the config `mise run dev` reads (see
> [Config file](#config-file)) — not in the production `config.toml`.

These keys are **captured at startup** when `mise run dev` boots (not hot-reloaded); the
matching `CARET_DEV_*` environment variables override them.

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

### Runtime

| Env var              | Config key            | Default          | Purpose                                                                                                                                                                                                                                                                                                 |
| -------------------- | --------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CARET_PORT`         | `daemon.port`         | `42718`          | Daemon port.                                                                                                                                                                                                                                                                                            |
| `CARET_TIMEOUT`      | `review.timeout_s`    | `3600` (s)       | Review window before the hook fail-safe-denies, in seconds. Values ≥ 3900 are invalid.                                                                                                                                                                                                                  |
| `CARET_IDLE_MS`      | `daemon.idle_ms`      | `60000`          | Idle delay before the daemon auto-shuts-down with no reviews.                                                                                                                                                                                                                                           |
| `CARET_HEARTBEAT_MS` | `daemon.heartbeat_ms` | `8000`           | Decision long-poll heartbeat window (ms). The socket `idleTimeout` derives from it, so values ≥ 250000 are invalid.                                                                                                                                                                                     |
| `CARET_LOG_MAX_SIZE` | `logging.max_size`    | `5242880` (5 MiB) | Size in bytes a log may reach before it is archived gzipped and emptied. Values below `65536` (64 KiB) or above `268435456` (256 MiB) are invalid.                                                                                                                                                       |
| `CARET_LOG_KEEP`     | `logging.keep`        | `10`             | Gzipped archives kept per log. `0` empties a full log without archiving it, and clears that log's existing archives.                                                                                                                                                                                    |
| `CARET_AGENT`        | —                     | `claude`         | Which coding-agent adapter to drive. `claude` (default) or `codex` (provisional, default-off — see [Architecture](ARCHITECTURE.md#architecture-tool-agnostic-core--agent-adapter)).                                                                                                                      |
| `XDG_STATE_HOME`     | —                     | `~/.local/state` | Unresolved reviews persist under `$XDG_STATE_HOME/caret/reviews/` and rehydrate on restart.                                                                                                                                                                                                             |
| `CARET_CONFIG_FILE`  | —                     | _(see [Config file](#config-file))_ | Absolute path to the settings file, overriding the resolved `config.toml` location. `mise run dev` sets it to `config.dev.toml`; `--fresh` sets it to a nonexistent path so dev boots from built-in defaults.                                                                                             |
| `CARET_RUMDL_BIN`    | —                     | _(downloads)_    | Absolute path to an existing rumdl binary for plan formatting, overriding the on-first-use download of the pinned v0.2.54 into `$XDG_STATE_HOME/caret/rumdl/`. Taken only when it reports that same pinned version; anything else falls back to the download. Blank counts as unset. Useful for offline / air-gapped installs or reusing a system rumdl. |
| `CARET_OPENCODE_BIN` | —                     | _(packaged)_     | Absolute path to the caret binary the OpenCode plugin spawns — for `caret review` and the daemon prewarm alike — overriding the one shipped beside the plugin in the `@macintacos/caret` package. Blank counts as unset. The way to point a published-package OpenCode install at a local build.          |

### Dev-only

Set by `mise run dev` and its tooling. The `CARET_DEV_*` vars shadow `[dev]` keys, which
never reach a production build.

| Env var                   | Config key               | Default | Purpose                                                                                                                                                                                                              |
| ------------------------- | ------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CARET_DEV_PORT`          | `dev.port`               | —       | Fixed `mise run dev` daemon port; unset → ephemeral. Must differ from `42718`.                                                                                                                                       |
| `CARET_DEV_STATE_DIR`     | `dev.state_dir`          | —       | Persistent `mise run dev` state dir; unset → ephemeral.                                                                                                                                                              |
| `CARET_DEV_NEW_REVIEW_MS` | `dev.notify.interval_ms` | —       | Extra-review seeder cadence override (ms); a positive value also arms the seeder. Unset → cadence falls to `[dev.notify].interval_ms` (`15000`), and arming is governed by `--notify` / `[dev.notify].enabled`.       |
| `CARET_FRESH`             | —                        | —       | Set to `1` by `mise run dev --fresh`; surfaced in `/api/health` so the UI resets its saved preferences (theme, first-run onboarding) on boot.                                                                         |

### Preflight-only

Read by `mise run preflight`; lower either to shrink the gate's footprint on a constrained
or stacked host.

| Env var                | Config key | Default        | Purpose                                                                                                                            |
| ---------------------- | ---------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `CARET_PREFLIGHT_JOBS` | —          | CPU count      | Max `mise run preflight` tasks in flight; a positive int. Set it to `1` to serialize the gate. Invalid/unset → the host's CPU count. |
| `CARET_E2E_WORKERS`    | —          | `50%` of cores | Playwright e2e worker count (each drives a Chromium tree + daemon); a positive int. Unset → half the cores.                          |

## Plan formatting (rumdl)

caret canonicalizes every incoming plan by reflowing it to a 90-column MD013 shape with
[rumdl](https://github.com/rvben/rumdl). Link URLs are exempt from that measurement —
nothing can break inside a URL, so counting it would only fragment the prose around it —
which means a line carrying a link runs wider than 90 and scrolls in the plan reader.

rumdl is not a runtime prerequisite: caret installs the pinned binary (v0.2.54) into
`$XDG_STATE_HOME/caret/rumdl/` and verifies its checksum, so formatting behaves the same
however caret was installed (Claude plugin or OpenCode).

> [!IMPORTANT]
> caret only ever formats with that one binary, at that one path. A `rumdl` on your `PATH`
> is never used: which version reflows your plans must not depend on what the machine
> happens to have installed.

How that plays out:

- **Reuse is version-pinned.** The binary already at caret's path is reused only when it
  reports exactly the pinned version; an older copy left by a previous caret, or a file
  that won't run, is replaced.
- **Install warms it; the first plan is the fallback.** `caret install` runs that check at
  install time so the first plan doesn't pay the download, and a failure there is a
  warning rather than a failed install — the first plan retries.
- **Formatting never loses a plan.** If a plan can't be formatted (rumdl missing, offline,
  or an unsupported platform), caret stores it unchanged and logs one warning.
- **`CARET_RUMDL_BIN` opts out of the download, not the pin.** Point it at a rumdl of your
  own and caret uses that instead of downloading — but only when it reports the pinned
  version too; anything else falls back to the download.
