# Config file

*Audience: anyone changing caret's settings.*

caret reads optional settings from a TOML file you own. caret writes only two lines
itself, `[updates] check` and `[review] band` (see
[The `[updates]` table](#the-updates-table)). This page lists each table and key the file
accepts.

## Which file caret reads

caret takes the first match, in this order:

| When                       | Path                                 |
| -------------------------- | ------------------------------------ |
| `CARET_CONFIG_FILE` is set | that path, for any invocation        |
| `XDG_CONFIG_HOME` is set   | `$XDG_CONFIG_HOME/caret/config.toml` |
| otherwise                  | `~/.config/caret/config.toml`        |

The file and every key in it are optional:

- A missing file, or a missing key, falls back to the default.
- An invalid file never crashes caret. It keeps the last valid parse, or, if there has
    never been one, the defaults with token login on, where the
    [review page](glossary.md#review-page) opens only through a login link caret gives you
    (see
    [If the background service stays on loopback](https://github.com/macintacos/caret/blob/main/docs/RUNNING.md#if-the-daemon-stays-on-loopback)).
- Settings reload on their own: caret re-reads the file when it changes, so you don't
    restart the [background service](glossary.md#background-service). The `[daemon]`,
    `[review]`, and `[opencode]` settings are the exceptions; see below.

## The `[logging]` table

| Key        | Default   | Purpose                                                                                                                             |
| ---------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `level`    | `"info"`  | Minimum level written to the logs — one of `"debug"`, `"info"`, `"warn"`, `"error"`. Set `level = "debug"` to turn on debug logging. |
| `redact`   | `false`   | When `true`, identifiable data (home-directory paths, usernames in paths) is scrubbed from log records as they are written.          |
| `max_size` | `5242880` | Size in bytes a log may reach before it is archived gzipped under `logs/archive/` and emptied. 5 MiB by default; values below `65536` (64 KiB) or above `268435456` (256 MiB) are rejected. |
| `keep`     | `10`      | Gzipped archives kept per log — the oldest are deleted past that count. `0` empties a full log without archiving it, and clears that log's existing archives. |

You can also set `max_size` and `keep` with an environment variable, which wins over the
config file, which wins over the default (see
[Environment variables](environment-variables.md)). caret reads both live, so an edit
takes effect on the next record written, with no restart.

```toml
[logging]
level = "info"
redact = false
max_size = 5242880
keep = 10
```

Logs are raw by default. `caret redact` makes shareable copies after the fact (see
[Scrub the logs before sharing](../how-to/logs.md#scrub-the-logs-before-sharing)).

## The `[daemon]` and `[review]` tables

The `[daemon]` keys configure the background service; they keep its older name, `daemon`.
The `CARET_*` environment variables also cover these settings (see
[Environment variables](environment-variables.md)), except `daemon.host`,
`daemon.hostnames`, and `daemon.auth`, which you set only here. Precedence is
**env var > config file > default**.

| Key                   | Default       | Purpose |
| --------------------- | ------------- | ------- |
| `daemon.port`         | `42718`       | The port the background service listens on. |
| `daemon.idle_ms`      | `60000`       | Idle delay (ms) before the background service shuts itself down when no reviews are open. Ignored when the background service stays resident — under a supervisor (`CARET_SUPERVISED=1`) or `caret serve`. |
| `daemon.heartbeat_ms` | `8000`        | How long (ms) the hook waits on one request for your decision before it asks again: the decision long-poll heartbeat window. The background service derives its socket's idle timeout from it (heartbeat seconds plus headroom), so it must stay below `250000`; values at or above that are rejected. |
| `daemon.host`         | `"127.0.0.1"` | Address the background service listens on: an IP literal or `localhost`, IPv6 unbracketed (`"::"`); `localhost` means `127.0.0.1`. Any address outside loopback (`127.0.0.0/8`, `::1`, `localhost`) exposes the review page to other devices and turns token login on unless `daemon.auth` says otherwise. Takes effect when the background service restarts. On a device where `host` is not one of its own addresses, it is instead where hooks send reviews: read on each hook, never listened on, and no background service starts (see [Reviewing on the server from another device](https://github.com/macintacos/caret/blob/main/docs/RUNNING.md#reviewing-on-the-server-from-another-device)). See [Reaching caret from another device](https://github.com/macintacos/caret/blob/main/docs/RUNNING.md#reaching-caret-from-another-device). |
| `daemon.hostnames`    | `[]`          | Extra names the background service answers to, such as `"caret.home.lan"` or `"192.168.1.5"` (IPv6 bracketed). Matched case-insensitively on any port, over `http` or `https`. The first entry is the name review links and login links use. Takes effect when the background service restarts. |
| `daemon.auth`         | *unset*       | `"token"` or `"none"`. Unset, token login is on exactly when `daemon.host` is exposed. Takes effect when the background service restarts. |
| `review.timeout_s`    | `3600`        | Review window in seconds before the hook denies the plan to fail safe (default 1 hour). Values at or above `3900`, the hook's own time limit, are rejected. |
| `review.band`         | `true`        | Claude Code only: shows a band above the prompt while a plan waits for review. `false` turns the band off. See [Get notified about plans](../how-to/notifications.md#see-a-waiting-plan-in-your-agent-host). |

!!! warning "Opening caret to other devices"

    A `host` outside loopback (`127.0.0.0/8`, `::1`, `localhost`) lets any device that can
    reach that address and port reach the background service; caret asks for a login link
    unless `auth` says otherwise. Setting `auth = "none"` on such a `host` turns that
    login off: anyone who can reach the port can then read plans, read files under a
    review's working directory, and approve a plan. `caret serve` and `caret login-link`
    warn while it is set. See
    [Reaching caret from another device](https://github.com/macintacos/caret/blob/main/docs/RUNNING.md#reaching-caret-from-another-device).

!!! note

    Unlike the `[logging]` keys, these settings don't reload on their own. `port`,
    `idle_ms`, `heartbeat_ms`, `host`, `hostnames`, and `auth` take effect the next time
    the background service starts, and `timeout_s` on the next review. If `caret install`
    keeps the background service running, restart it with `caret install --refresh`, which
    also moves it to the newest caret installed, or
    [restart the service](https://github.com/macintacos/caret/blob/main/docs/RUNNING.md#the-caret-service).

    caret reads `band` on every `caret band-link` run, so it applies from the next review
    with no restart.

```toml
[daemon]
port = 42718
idle_ms = 60000
heartbeat_ms = 8000

[review]
timeout_s = 3600
band = true
```

## The `[opencode]` table

Settings for caret's OpenCode plugin. The plugin reads them when OpenCode loads it, so a
change takes effect after you restart OpenCode.

| Key                  | Default                          | Purpose |
| -------------------- | -------------------------------- | ------- |
| `opencode.plans_dir` | per OpenCode version (see Purpose) | Where the Plan agent is told to write the plan file it submits for review. A leading `~` means your home directory. The default is the directory OpenCode's Plan agent is allowed to edit: on OpenCode v1, its data-dir `plans/` (`~/.local/share/opencode/plans`, under `$XDG_DATA_HOME` when that is set); on OpenCode v2, `~/.opencode/plan`. On either version, OpenCode must also let the Plan agent edit a directory you choose instead, or caret refuses the review. |

```toml
[opencode]
plans_dir = "~/.local/share/opencode/plans"
```

## The `[updates]` table

| Key             | Default | Purpose |
| --------------- | ------- | ------- |
| `updates.check` | `true`  | Whether the background service asks once a day whether a newer caret is out — the npm registry for an installed caret, GitHub instead for a build from source. Off also stops **What's new** from asking GitHub. Reloads on its own, so turning it off takes effect without restarting the background service. |

```toml
[updates]
check = false
```

These are the keys caret writes itself: **Settings → Updates** edits `updates.check` and
the review-band toggle edits `[review] band`, each a single line, leaving the rest of your
file — comments, ordering, formatting — alone. When it cannot do that safely, which it
can't if you spelled the key as a dotted `updates.check = true` or as an inline table, it
changes nothing and says so, so you can set it by hand.

That same refusal blocks the one-time move of an opt-out out of the retired `prefs.json`
(`~/.local/state/caret/prefs.json`, or under `$XDG_STATE_HOME/caret`): caret keeps that
file and warns every time the background service starts until your `config.toml` spells
the key as an `[updates]` table. Writing `check = false` under that header by hand
finishes the move.
