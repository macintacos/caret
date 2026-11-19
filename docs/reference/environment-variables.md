# Environment variables

*Audience: anyone changing caret's settings from the shell or from the
[launchd agent or systemd unit](platform-support.md#operating-systems) that runs caret.*

A variable with a [config file](config-file.md) key overrides that key, so precedence is
**env var > config file > default**. caret ignores an invalid value for one of those
variables, such as one out of bounds, and uses the config file's value instead. It logs a
warning when it starts. A blank value counts as unset.

!!! warning "The installed service doesn't see your shell"

    The installed [background service](glossary.md#background-service) runs with the
    environment `caret install` captured when you chose **Keep it running**: `HOME`,
    `CLAUDE_CONFIG_DIR`, `XDG_STATE_HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`,
    `XDG_DATA_HOME`, `CARET_CONFIG_FILE`, `CARET_PORT`, and `CARET_AGENT`, plus
    `CARET_SUPERVISED=1`. A later export reaches each review and `caret serve`, but not
    the installed service. To change one there, export it and re-run `caret install` from
    that shell, keeping caret running. `CARET_HEARTBEAT_MS`, `CARET_LOG_MAX_SIZE`, and
    `CARET_LOG_KEEP` never reach the installed service; set their config keys instead.

| Env var | Config key | Default | Purpose |
| --- | --- | --- | --- |
| `CARET_PORT` | [`daemon.port`](config-file.md#the-daemon-and-review-tables) | `42718` | The port the background service listens on. |
| `CARET_TIMEOUT` | [`review.timeout_s`](config-file.md#the-daemon-and-review-tables) | `3600` | How long, in seconds, caret waits for your decision before it turns the plan down. |
| `CARET_IDLE_MS` | [`daemon.idle_ms`](config-file.md#the-daemon-and-review-tables) | `60000` | How long (ms) an on-demand background service waits with no review open before it exits. |
| `CARET_HEARTBEAT_MS` | [`daemon.heartbeat_ms`](config-file.md#the-daemon-and-review-tables) | `8000` | How long (ms) a waiting review holds one request open before it asks again. |
| `CARET_LOG_MAX_SIZE` | [`logging.max_size`](config-file.md#the-logging-table) | `5242880` | Size in bytes at which caret archives a log. |
| `CARET_LOG_KEEP` | [`logging.keep`](config-file.md#the-logging-table) | `10` | Gzipped archives kept per log. |
| `CARET_CONFIG_FILE` | — | *unset* | Path to the config file, in place of the usual one (see [Which file caret reads](config-file.md#which-file-caret-reads)). |
| `XDG_STATE_HOME` | — | `~/.local/state` | caret keeps its state under `$XDG_STATE_HOME/caret/`: logs, the plan formatter, and unresolved reviews, which come back after a restart for a week after their last change. |
| `CARET_AGENT` | — | `claude` | Which agent host's adapter caret speaks: `claude`, `opencode`, `pi`, or `codex` (provisional). The OpenCode plugin and pi extension set it themselves. |
| `CARET_SUPERVISED` | — | *unset* | The installed service's launchd agent or systemd unit sets it to `1`. The background service then stays running with no review open, and rotates its own `daemon-stderr.log`. |
| `CARET_RUMDL_BIN` | — | *unset* | Path to a rumdl binary for [plan formatting](../explanation/plan-formatting.md), in place of caret's download. caret uses it only when it reports the pinned version, v0.3.4; otherwise caret downloads its own. For offline installs, or to reuse a system rumdl. |
| `CARET_OPENCODE_BIN` | — | *unset* | Absolute path to the caret binary the OpenCode plugin runs, in place of the one in the `@macintacos/caret` package. Points an OpenCode install at a local build. |
| `CARET_OPENCODE_NO_UPDATE_CHECK` | — | *unset* | Any value stops the OpenCode plugin's daily check for a newer caret, and the toast it shows. |
| `CARET_PI_BIN` | — | *unset* | Absolute path to the caret binary pi's extension runs, in place of the one in the `@macintacos/caret` package. Points a pi install at a local build. |
