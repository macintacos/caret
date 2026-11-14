# The background service

*Audience: people who use caret and want to know why it works as it does.*

The [background service](../reference/glossary.md#background-service) is the small server
on your machine that holds your reviews and serves the
[review page](../reference/glossary.md#review-page). What started it decides how long it
runs.

## Three ways it runs

- **The installed service.** When you answer **Keep it running** in `caret install`,
    your system starts the installed service at login and restarts it whenever it stops.
    It runs until you tell it to stop.
- **`caret serve`.** It runs in your terminal until you stop it, or until a plan from a
    caret of another version replaces it. Nothing restarts it.
- **On demand.** When neither of the others is running, the caret your agent runs starts
    an on-demand service. It stops by itself after `daemon.idle_ms` with no review waiting
    and no review page open (see
    [The `[daemon]` and `[review]` tables](../reference/config-file.md#the-daemon-and-review-tables)).

## Which caret it runs

Each [agent host](../reference/glossary.md#agent-host) has its own copy of caret, and the
copies can be at different versions. How the background service runs decides which copy it
runs and what replaces it:

- **The installed service** runs the newest caret installed for any agent host, or the
    copy `caret install` keeps for itself, chosen each time it starts. Restarting it is
    how it upgrades. When a plan comes from a newer caret than it runs, caret restarts it,
    unless you pinned a local build with `caret install --from-local`.
- **`caret serve`** runs the caret you started it with. A plan from a caret of any other
    version replaces it. It refuses to start while the installed service runs.
- **An on-demand service** runs the caret your agent ran. A plan from a caret of any
    other version replaces it, and so does `caret serve`.

The installed service starts through a launcher script that caret installs at
`~/.local/state/caret/bin/caret`, under `$XDG_STATE_HOME` when that is set. Each time the
service starts, the launcher picks which caret and which bun to run:

- **caret**: the pinned local build, if any. Otherwise, the newest version found in
    Claude Code's plugin cache, OpenCode's package cache, pi's npm folder
    (`~/.pi/agent/npm`, the default agent dir only), and caret's own copies under
    `~/.local/state/caret/roots/`. An agent host's copy wins a version tie. The launcher
    skips a caret missing its executable `bin/caret` or its review page build.
- **bun**: the one recorded at install, else the first found in `~/.bun/bin`,
    `/opt/homebrew/bin`, `/usr/local/bin`, mise's shims and installs, then
    `~/.asdf/shims`.

caret keeps its own copy whenever `caret install` runs from npm. So after
`caret install --refresh`, the service runs that copy until a newer caret is installed for
an agent host. That usually happens at OpenCode's next start, when OpenCode re-resolves
its package cache.

When the launcher finds no caret anywhere, its own copies included, it looks twice more,
five seconds apart. If it still finds none, it removes the service's unit file, itself,
the records it reads (the bun path, the pinned build, and the service's name), and caret's
own copies. It keeps your reviews. When caret is installed but can't run, the launcher
stops the service instead (see
[Fix a background service that keeps stopping](../how-to/background-service.md#fix-a-background-service-that-keeps-stopping)).
Either way, `caret install` brings the service back.

## Housekeeping

The installed service and `caret serve` can run for days, so once an hour each does two
pieces of upkeep:

- It checks whether caret is due to look for an update, which it does about once a day.
- It forgets reviews unchanged for a week. If a revised plan arrives more than a week
    after your last decision on it, it opens as a new review, not a new
    [version](../reference/glossary.md#version).

## Warming up

caret starts the background service as your agent begins planning, so the review page
opens without waiting for it to start:

- Claude Code: when the agent enters plan mode.
- OpenCode: on each message to the `plan` agent.
- pi: while [`/caret`](../reference/glossary.md#caret-command) plans.

To check, restart, or stop the installed service, see
[Run the background service](../how-to/background-service.md#check-restart-or-stop-it).
