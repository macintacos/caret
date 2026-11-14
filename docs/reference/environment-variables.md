# Environment variables

*Audience: anyone changing caret's settings from the shell or from the
[launchd agent or systemd unit](platform-support.md#operating-systems) that runs caret.*

Each `CARET_*` variable that has a [config file](config-file.md) key overrides it, so
precedence is **env var > config file > default**. caret ignores a set-but-invalid value —
wrong shape or out of bounds — and writes one warning to the logs when it starts. It then
falls through to the config file, then the default.

!!! warning "The service `caret install` sets up doesn't see your shell"

    When `caret install` keeps the [background service](glossary.md#background-service)
    running at login, it runs with only the environment `caret install` captured when you
    chose to keep it running — `HOME`, `CLAUDE_CONFIG_DIR`, `XDG_STATE_HOME`,
    `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME`, `CARET_CONFIG_FILE`,
    `CARET_PORT` and `CARET_AGENT` — plus `CARET_SUPERVISED=1`. A later export of
    `CARET_PORT`, `XDG_STATE_HOME`, `XDG_CONFIG_HOME` or `CARET_CONFIG_FILE` reaches hooks
    and `caret serve`, but not that service: re-run `caret install` from that shell,
    keeping caret running, to rewrite and reload its
    [launchd agent or systemd unit](platform-support.md#operating-systems). The other
    background-service variables below (`CARET_HEARTBEAT_MS`, `CARET_LOG_MAX_SIZE`,
    `CARET_LOG_KEEP`) never reach that service; set their `config.toml` keys instead.

| Env var              | Config key            | Default          | Purpose |
| -------------------- | --------------------- | ---------------- | ------- |
| `CARET_PORT`         | `daemon.port`         | `42718`          | The port the background service listens on. |
| `CARET_TIMEOUT`      | `review.timeout_s`    | `3600` (s)       | Review window before the hook denies the plan to fail safe, in seconds. Values ≥ 3900 are invalid. |
| `CARET_IDLE_MS`      | `daemon.idle_ms`      | `60000`          | Idle delay before the background service shuts itself down when no reviews are open. Ignored when the background service stays resident — under a supervisor (`CARET_SUPERVISED=1`) or `caret serve`. |
| `CARET_HEARTBEAT_MS` | `daemon.heartbeat_ms` | `8000`           | How long (ms) the hook waits on one request for your decision before it asks again. The socket's idle timeout derives from it, so values ≥ 250000 are invalid. |
| `CARET_LOG_MAX_SIZE` | `logging.max_size`    | `5242880` (5 MiB) | Size in bytes a log may reach before it is archived gzipped and emptied. Values below `65536` (64 KiB) or above `268435456` (256 MiB) are invalid. |
| `CARET_LOG_KEEP`     | `logging.keep`        | `10`             | Gzipped archives kept per log. `0` empties a full log without archiving it, and clears that log's existing archives. |
| `CARET_SUPERVISED`   | —                     | —                | Set to `1` by the generated launchd/systemd unit, naming a process started by something that manages its lifetime rather than by a hook. It makes the background service resident, reported as `resident` by `/api/health` and `/api/diagnostics`, and is itself reported as `supervised` by `/api/health`. It also turns on rotation of the background service's own `daemon-stderr.log`, which a supervised start otherwise skips, and tells `bin/caret-launcher` to open that log itself rather than leave its diagnostics on the terminal. |
| `CARET_AGENT`        | —                     | `claude`         | Which coding-agent adapter to drive: `claude` (default), `codex` (provisional, default-off), `opencode`, or `pi`. The OpenCode and pi extensions set it themselves when they spawn `caret review` — see [Architecture](https://github.com/macintacos/caret/blob/main/docs/ARCHITECTURE.md#architecture-tool-agnostic-core--agent-adapter). |
| `XDG_STATE_HOME`     | —                     | `~/.local/state` | Unresolved reviews persist under `$XDG_STATE_HOME/caret/reviews/` and come back after a restart for a week after their last change. |
| `CARET_CONFIG_FILE`  | —                     | *(see [Which file caret reads](config-file.md#which-file-caret-reads))* | Absolute path to the settings file, overriding the resolved `config.toml` location. |
| `CARET_RUMDL_BIN`    | —                     | *(downloads)*    | Absolute path to an existing rumdl binary for plan formatting, overriding the on-first-use download of the pinned v0.3.2 into `$XDG_STATE_HOME/caret/rumdl/`. Taken only when it reports that same pinned version; anything else falls back to the download. Blank counts as unset. Useful for offline / air-gapped installs or reusing a system rumdl. |
| `CARET_OPENCODE_BIN` | —                     | *(packaged)*     | Absolute path to the caret binary the OpenCode plugin spawns — for `caret review` and for starting the background service early — overriding the one shipped beside the plugin in the `@macintacos/caret` package. Blank counts as unset. The way to point a published-package OpenCode install at a local build. |
| `CARET_PI_BIN`       | —                     | *(packaged)*     | Absolute path to the caret binary pi's extension spawns for `caret review`, overriding the one shipped beside the extension in the `@macintacos/caret` package. Blank counts as unset. The way to point a pi install at a local build. The packaged binary runs on bun, so pi users need `bun` on `PATH`. |
