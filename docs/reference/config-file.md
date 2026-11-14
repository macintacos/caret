# Config file

*Audience: anyone changing caret's settings.*

caret reads its settings from an optional TOML file.

## Which file caret reads

caret takes the first match, in this order:

| When                       | Path                                 |
| -------------------------- | ------------------------------------ |
| `CARET_CONFIG_FILE` is set | that path, for any invocation        |
| `XDG_CONFIG_HOME` is set   | `$XDG_CONFIG_HOME/caret/config.toml` |
| otherwise                  | `~/.config/caret/config.toml`        |

How caret reads it:

- A missing file, or a missing key, takes the default.
- caret ignores a key it doesn't know, so a misspelled key has no effect.
- One invalid value makes the whole file invalid. caret then keeps the last valid parse.
    If there has never been one, it uses the defaults with token login on, so the
    [review page](glossary.md#review-page) opens only through a login link caret gives you
    (see
    [If caret stays on loopback](../how-to/remote-access.md#if-caret-stays-on-loopback)).
- caret re-reads the file when it changes, so the `[logging]` and `[updates]` keys apply
    without restarting the [background service](glossary.md#background-service). Each
    other section says when its keys apply.

## The `[logging]` table

| Key        | Default             | Purpose |
| ---------- | ------------------- | ------- |
| `level`    | `"info"`            | Minimum level written to the logs: `"debug"`, `"info"`, `"warn"`, or `"error"`. |
| `redact`   | `false`             | When `true`, caret scrubs identifiable data (home-directory paths, usernames in paths) from each log record as it writes it. |
| `max_size` | `5242880` (5 MiB)   | Size in bytes at which caret gzips a log into `logs/archive/` and empties it. Must be from `65536` (64 KiB) to `268435456` (256 MiB). |
| `keep`     | `10`                | Gzipped archives kept per log; caret deletes the oldest past that count. `0` empties a full log without archiving it, and clears that log's existing archives. |

These keys apply from the next record written. `CARET_LOG_MAX_SIZE` and `CARET_LOG_KEEP`
override `max_size` and `keep` (see [Environment variables](environment-variables.md)).

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

The `[daemon]` keys configure the background service under its older name, `daemon`. A
`CARET_*` variable overrides each key here except `daemon.host`, `daemon.hostnames`,
`daemon.auth`, and `review.band` (see [Environment variables](environment-variables.md)).

| Key                   | Default       | Purpose |
| --------------------- | ------------- | ------- |
| `daemon.port`         | `42718`       | The port the background service listens on. |
| `daemon.idle_ms`      | `60000`       | How long (ms) an on-demand background service waits with no review open before it exits. The installed service and `caret serve` ignore it. |
| `daemon.heartbeat_ms` | `8000`        | How long (ms) a waiting review holds one request open before it asks again. Must be below `250000`, because the background service's connection timeout derives from it. |
| `daemon.host`         | `"127.0.0.1"` | The address the background service listens on: an IP address, IPv6 unbracketed (`"::"`), or `localhost`, read as `127.0.0.1`. An address outside loopback (`127.0.0.0/8`, `::1`) exposes the review page to other devices and turns on token login unless `daemon.auth` says otherwise. On a device that doesn't own the address, it is instead where each review is sent, and no background service starts there (see [Send plans to caret on a server](../how-to/remote-review.md)). |
| `daemon.hostnames`    | `[]`          | Extra names the background service answers to, such as `"caret.home.lan"` or `"192.168.1.5"` (IPv6 bracketed). Matched case-insensitively on any port, over `http` or `https`. Review links and login links use the first entry. |
| `daemon.auth`         | *unset*       | `"token"` or `"none"`. Unset, token login is on exactly when `daemon.host` is outside loopback. |
| `review.timeout_s`    | `3600`        | How long, in seconds, caret waits for your decision before it turns the plan down. Must be below `3900` (see [Why a review times out](../explanation/how-caret-works.md#why-a-review-times-out)). |
| `review.band`         | `true`        | Claude Code only: shows a band above the prompt while a plan waits for review. See [Get notified about plans](../how-to/notifications.md#see-a-waiting-plan-in-your-agent-host). |

!!! warning "Token login off on an exposed host"

    With `host` outside loopback and `auth = "none"`, anyone who can reach the port can
    read your plans, read files under a review's working directory, and approve a plan.
    `caret serve` and `caret login-link` warn while it is set. See
    [Open caret from another device](../how-to/remote-access.md).

!!! note "When these keys apply"

    The `[daemon]` keys apply the next time the background service starts. To restart the
    installed service, see
    [Check, restart, or stop it](../how-to/background-service.md#check-restart-or-stop-it).
    The `[review]` keys apply from the next review.

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

Settings for caret's OpenCode plugin. The plugin reads them when OpenCode loads it, so
restart OpenCode after a change.

| Key                  | Default | Purpose |
| -------------------- | ------- | ------- |
| `opencode.plans_dir` | v1: `~/.local/share/opencode/plans`, under `$XDG_DATA_HOME` when set; v2: `~/.opencode/plan` | Where caret tells OpenCode's `plan` agent to write the plan file it submits for review. A leading `~` means your home directory. The default is the directory OpenCode lets the `plan` agent edit. If you choose another, let the `plan` agent edit it in OpenCode too, or caret refuses the review. |

```toml
[opencode]
plans_dir = "~/.local/share/opencode/plans"
```

## The `[updates]` table

| Key             | Default | Purpose |
| --------------- | ------- | ------- |
| `updates.check` | `true`  | Whether the background service checks once a day for a newer caret: on npm for an installed caret, on GitHub for a build from source. `false` also stops **What's new** from asking GitHub. Applies without a restart. |

```toml
[updates]
check = false
```

## Keys caret writes

caret writes two keys itself, each as a single line, and leaves the rest of the file
(comments, ordering, formatting) alone:

- `updates.check`, from the **Check for updates** switch in **Settings → Updates**.
- `review.band`, from the **Plan-waiting band** switch in **Settings → Notifications**.

caret changes nothing, and says so, when the key is spelled as a dotted key
(`updates.check = true`) or inside an inline table. Set it by hand in that case.

The same refusal blocks the one-time move of an update-check opt-out from the retired
`prefs.json` (`~/.local/state/caret/prefs.json`, or under `$XDG_STATE_HOME/caret`). caret
keeps that file, and warns each time the background service starts, until your
`config.toml` spells the key under an `[updates]` table header. Writing `check = false`
under that header by hand finishes the move.
