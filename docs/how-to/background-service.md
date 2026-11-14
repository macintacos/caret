# Run the background service

*Audience: anyone who wants caret's review page up from login, or whose background service
won't stay up.*

This page covers keeping caret running from login: checking, restarting, and stopping the
[background service](../reference/glossary.md#background-service), upgrading it, and
fixing one that keeps stopping. One background service serves every
[agent host](../reference/glossary.md#agent-host): Claude Code, OpenCode, and pi.

## Keep caret running

Answer **Keep it running** when `caret install` asks (`mise run build --install`
included). The install then registers a login service that starts the background service
at login and keeps it up until told to stop, so the
[review page](../reference/glossary.md#review-page) is up before any plan arrives.

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

On either platform, ask the background service whether it is resident and which upkeep
tasks it runs (`42718` is `[daemon].port`):

```sh
curl -s http://127.0.0.1:42718/api/diagnostics | jq '{resident, upkeep}'
```

With token auth on, add
`-H "Authorization: Bearer $(cat "${XDG_STATE_HOME:-$HOME/.local/state}/caret/daemon.token")"`.

While the service is stopped, the next review starts a background service on demand. That
one exits once it has sat idle for `[daemon].idle_ms` with no review pending and no review
page tab open.

To open the review page from another device with token auth on (see
[Open caret from another device](remote-access.md)),
get the login link from `caret login-link`. The service `caret install` sets up never
prints one.

## Upgrade the background service

Restart the service `caret install` sets up to upgrade it: each time it starts, it picks
which caret and which bun to run.

- **caret**: the version a `--from-local` build pinned, else the newest one installed
    across Claude Code's plugin cache, OpenCode's package cache, pi's npm folder
    (`~/.pi/agent/npm`, the default agent dir only), and caret's own copy at
    `~/.local/state/caret/roots/`. An agent host's copy wins a version tie. A caret
    missing its executable `bin/caret` or its review page build is skipped.
- **bun**: the one recorded at install, else the first found in `~/.bun/bin`,
    `/opt/homebrew/bin`, `/usr/local/bin`, mise's shims and installs, then
    `~/.asdf/shims`.

`caret install --refresh` restarts it, and so does the first review from a newer caret
unless a local build is pinned. A `caret install` run from npm keeps its own copy, so
after `--refresh` the service runs that copy until something newer is installed. Usually
that is OpenCode's next start, which re-resolves its package cache.

After it registers or restarts the service, `caret install` waits up to 30 seconds for the
service to answer. The service must run this caret version or newer. If none answers, the
install warns instead of announcing the review page. The warning names the older version
it found, if any, and `logs/daemon-stderr.log` (see
[Find the log files](logs.md#find-the-log-files)).

The service `caret install` sets up sees only the environment captured at install; see
[Environment variables](../reference/environment-variables.md).

## Fix a background service that keeps stopping

When the background service exits, launchd starts it again after about 10 seconds and
systemd after 5. systemd gives up after five starts inside 60 seconds and stops trying to
restart it.

When there is nothing to run, no runnable caret or no bun, the service stops with exit
status 78 instead of restarting into the same failure. systemd honours that status itself.
On macOS the agent is booted out, and it loads again at your next login. Run
`caret install` to restore it now.

The reason lands in `logs/daemon-stderr.log`; see
[Find the log files](logs.md#find-the-log-files).

## Keep it running after you log out

On Linux, `caret install` also runs `loginctl enable-linger` so the service outlives your
logout. Some distributions refuse that without admin rights. The install then logs
`lingering not enabled; caret stops at logout` and carries on, and caret stops when you
log out.

## Next steps

- Stop caret starting at login, or remove it, with [Turn caret off](turn-off.md).
- Read what the background service logged with [Find caret's logs](logs.md).
