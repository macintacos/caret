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

Each agent host has its own copy of caret, and the copies can be at different versions.
Each time the installed service starts, it runs the newest caret installed for any
[agent host](../reference/glossary.md#agent-host), or the copy `caret install` keeps for
itself, so restarting it is how it upgrades. When a plan comes from a newer caret than the
installed service runs, caret restarts the installed service (unless you pinned a local
build). A plan from a caret of any other version replaces an on-demand service or a
`caret serve` with its own. `caret serve` replaces an on-demand service, and refuses to
start while the installed service runs.

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
