# Run the background service

*Audience: anyone who wants caret's review page up from login, or whose background service
won't stay up.*

## Keep caret running

Answer **Keep it running** when `caret install` asks. The install registers a login
service that starts the [background service](../reference/glossary.md#background-service)
at login and keeps it up until told to stop. The
[review page](../reference/glossary.md#review-page) is then up before any plan arrives.
One background service serves every [agent host](../reference/glossary.md#agent-host):
Claude Code, OpenCode, and pi.

Windows has no login service, and neither does a Linux machine where systemd doesn't run
for your user. There, the install says so, and caret starts on demand when your agent
sends a plan.

## Check, restart, or stop it

The service `caret install` sets up is a launchd agent on macOS and a systemd user unit on
Linux:

|  | macOS | Linux |
| --- | --- | --- |
| **Service** | launchd agent `dev.excessive.caret`, in `~/Library/LaunchAgents/dev.excessive.caret.plist` | systemd user unit `caret.service`, in `~/.config/systemd/user/` |
| **Status** | `launchctl print gui/$(id -u)/dev.excessive.caret` | `systemctl --user status caret.service` |
| **Restart** | `launchctl kickstart -k gui/$(id -u)/dev.excessive.caret` | `systemctl --user restart caret.service` |
| **Stop** | `launchctl bootout gui/$(id -u)/dev.excessive.caret` — stopped until your next login | `systemctl --user stop caret.service` — stopped until your next login, or, if it [keeps running after you log out](#keep-it-running-after-you-log-out), your next boot |

On either platform, ask the background service whether it is resident (kept up rather than
exiting when idle) and which upkeep tasks it runs. `42718` is
[`daemon.port`](../reference/config-file.md#the-daemon-and-review-tables), and the filter
needs `jq`:

```sh
curl -s http://127.0.0.1:42718/api/diagnostics | jq '{resident, upkeep}'
```

With [token login](remote-access.md) on, add
`-H "Authorization: Bearer $(cat "${XDG_STATE_HOME:-$HOME/.local/state}/caret/daemon.token")"`.

While the service is stopped, the next review starts a background service on demand. That
one exits once it has sat idle for
[`daemon.idle_ms`](../reference/config-file.md#the-daemon-and-review-tables) with no
review pending and no review page tab open.

To open the review page from another device with token login on (see
[Open caret from another device](remote-access.md)), get the login link from
`caret login-link`. The service `caret install` sets up never prints one.

## Upgrade the background service

Restart the service (see [Check, restart, or stop it](#check-restart-or-stop-it)), or run
`caret install --refresh`, which restarts it for you. The first review from a newer caret
also restarts it, unless a local build is pinned.
[Which caret it runs](../explanation/background-service.md#which-caret-it-runs) says which
caret each start picks.

After it registers or restarts the service, `caret install` waits up to 30 seconds for the
service to answer with this caret version or newer. If none does, the install warns
instead of announcing the review page. The warning names the older version it found, if
any, and `logs/daemon-stderr.log` (see [Find the log files](logs.md#find-the-log-files)).

The service sees only the environment captured at install; see
[Environment variables](../reference/environment-variables.md).

## Fix a background service that keeps stopping

1. Read why it stopped in `logs/daemon-stderr.log`; see
    [Find the log files](logs.md#find-the-log-files).
2. Fix the cause the log names.
3. Run `caret install` to start the service again. On Linux it first clears the start
    limit below, which otherwise refuses every further start.

When the service exits, launchd starts it again after about 10 seconds and systemd after
5. systemd gives up after five starts inside 60 seconds and stops trying to restart it.

When there is nothing to run, no runnable caret or no bun, the service stops with exit
status 78 instead of restarting into the same failure. systemd honours that status itself.
On macOS the agent is booted out, and it loads again at your next login.

## Keep it running after you log out

On Linux, `caret install` runs `loginctl enable-linger` so the service outlives your
logout. Some distributions refuse that without admin rights. The install then logs
`lingering not enabled; caret stops at logout` and carries on, and caret stops when you
log out.

## Next steps

- Stop caret starting at login, or remove it, with [Turn caret off](turn-off.md).
- Read what the background service logged with [Find caret's logs](logs.md).
