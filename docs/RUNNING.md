# caret — Running

*Audience: users running caret day to day — the caret service, reaching caret from another
device, turning caret off, and logging & debugging.*

Part of the deep reference behind [README.md](../README.md). For what caret is, how to
install it, and basic usage, start there.

## The caret service

Answer **Keep it running** when `caret install` asks (`mise run build --install` included)
and the install registers the caret service: a login service that keeps a resident daemon
— one that stays up until told to stop — on the port, so the review UI it serves is up
before any plan arrives. Windows has no service, and neither does a Linux host without a
systemd user session; there, install says so and caret runs on demand.

|  | macOS | Linux |
| --- | --- | --- |
| **Service** | launchd agent `dev.excessive.caret`, in `~/Library/LaunchAgents/dev.excessive.caret.plist` | systemd user unit `caret.service`, in `~/.config/systemd/user/` |
| **Status** | `launchctl print gui/$(id -u)/dev.excessive.caret` | `systemctl --user status caret.service` |
| **Restart** | `launchctl kickstart -k gui/$(id -u)/dev.excessive.caret` | `systemctl --user restart caret.service` |
| **Stop** | `launchctl bootout gui/$(id -u)/dev.excessive.caret` — stopped until your next login | `systemctl --user stop caret.service` — stopped until your next login, or with lingering your next boot |

On either platform, the daemon reports whether it is resident and which upkeep tasks it
runs (`42718` is `[daemon].port`):

```sh
curl -s http://127.0.0.1:42718/api/diagnostics | jq '{resident, upkeep}'
```

With token auth on, add
`-H "Authorization: Bearer $(cat "${XDG_STATE_HOME:-$HOME/.local/state}/caret/daemon.token")"`.

While the service is stopped, the next review starts an on-demand daemon, which exits once
it has sat idle for `[daemon].idle_ms` with no review pending and no review UI tab open.

The service's daemon never prints its login link; with token auth on (see
[Reaching caret from another device](#reaching-caret-from-another-device)),
get it from `caret login-link`.

### What the service runs

Every unit runs `$XDG_STATE_HOME/caret/bin/caret daemon`. That file is
`bin/caret-launcher`, which chooses what to run each time it starts:

- **caret** — the version a `--from-local` build pinned, else the newest one installed
  across Claude Code's plugin cache, OpenCode's package cache, pi's npm folder
  (`~/.pi/agent/npm`, the default agent dir only), and caret's own copy at
  `~/.local/state/caret/roots/`. A published `caret install` keeps that copy of itself, so
  after `--refresh` the service runs it until something newer is installed — usually
  OpenCode's next start, which re-resolves its cache. An agent's copy wins a version tie.
  A caret missing its executable `bin/caret`, or any UI build (`ui/dist`, or the one a
  compiled `bin/caret-native` embeds), is skipped.
- **bun** — the one recorded at install, else the first found in `~/.bun/bin`,
  `/opt/homebrew/bin`, `/usr/local/bin`, mise's shims and installs, then `~/.asdf/shims`.

So restarting the service is how its daemon takes an upgrade. `caret install --refresh`
restarts it, and so does the first review from a newer caret unless a local build is
pinned. After it registers or restarts the service, `caret install` waits up to 30 seconds
for the service's daemon, at least as new as itself. If none answers, it warns instead of
announcing the review UI, and names the older version it found, if any, and
`logs/daemon-stderr.log`. The service's daemon also sees only the environment captured at
install — see [Runtime](CONFIGURING.md#runtime).

### When the daemon exits

The supervisor starts it again: launchd after its throttle of about 10 seconds, systemd
after 5. systemd gives up after five starts inside 60 seconds and parks the unit.

When the launcher cannot run anything — no runnable caret, or no bun — it exits with
status 78, and the service stops instead of restarting into the same failure. systemd
honours that status itself; on macOS the launcher boots the agent out, and the plist loads
again at your next login. `caret install` restores it. The launcher's reason lands in
`logs/daemon-stderr.log` (see [Where the logs live](#where-the-logs-live)).

On Linux, install also runs `loginctl enable-linger` so the service outlives your logout.
Some distributions refuse that without admin rights; install then logs
`lingering not enabled; caret stops at logout` and carries on, and caret stops when you
log out.

## Reaching caret from another device

By default the daemon listens on `127.0.0.1` only, with no auth. These steps take a server
running a resident daemon, [the caret service](#the-caret-service) or `caret serve`, to a
logged-in browser on a phone, tablet or another computer. They assume a network you trust;
otherwise see [Plain HTTP and an HTTPS proxy](#plain-http-and-an-https-proxy).

1. **Set the address.** In the `[daemon]` table of
   [`config.toml`](CONFIGURING.md#config-file) (keys in
   [The daemon and review tables](CONFIGURING.md#the-daemon-and-review-tables)), bind the
   daemon to the network and give it a name:

   ```toml
   [daemon]
   host = "0.0.0.0"
   hostnames = ["caret.home.lan"]
   port = 42718
   ```

   An exposed `host` turns token auth on. The daemon answers only to the `hostnames`
   entries, and to `host` when it is a specific address, and refuses any other name with
   `403 host not recognized`, so with a wildcard bind (`0.0.0.0` or `::`), a device that
   reaches the server by IP address needs that IP in `hostnames`. The first `hostnames`
   entry is the name printed links use. A specific address in `host` also works, but the
   daemon can't start while that address is missing (after a network or DHCP change, or a
   boot that beats the network) and exits rather than waiting, so prefer a wildcard bind
   plus `hostnames`. If the server runs a firewall, allow incoming TCP on `port`.
2. **Point a DNS record at the server.** In your router or local DNS server, add an A or
   AAAA record from the first `hostnames` entry to the server's LAN address; a computer
   can use a hosts-file entry instead. Avoid an mDNS `.local` name: any device on the LAN
   can answer a `.local` lookup and receive the token. Skip this step if devices reach the
   server by an IP you listed.
3. **Restart the daemon.** These keys take effect on the next start. For `caret serve`,
   press Ctrl+C and run it again. For the caret service, use its
   [Restart command](#the-caret-service):
   `launchctl kickstart -k gui/$(id -u)/dev.excessive.caret` on macOS,
   `systemctl --user restart caret.service` on Linux. `caret install --refresh` also
   restarts it.
4. **Open the login link once on each device.** `caret serve` prints it on every start.
   Otherwise, run `caret login-link`:

   ```sh
   caret login-link
   # http://caret.home.lan:42718/?token=…
   ```

   Opening the link sets a cookie that keeps the device logged in. The link is a secret:
   anyone holding it can log in. `caret login-link` reads `config.toml` and the token
   file, not the running daemon, so its link works only once the daemon has restarted
   (step 3).

### On the other devices

A device that only opens the review UI needs a browser and the login link (step 4), not
caret. Only the server runs caret as a service.

If another device runs caret for its own agent, answer **I'll run it myself** when
`caret install` asks. Unless it reviews on the server (below), keep the server's `host`
and `hostnames` out of that device's `config.toml`. Otherwise its daemon also listens on
the network and prints links to the server's name. Those links open the server, so you
never see the device's own reviews.

By default, an agent on another device reviews its plans on that device's own daemon, at
`caret.localhost`. To review them on the server instead, see
[Reviewing on the server from another device](#reviewing-on-the-server-from-another-device).

### Reviewing on the server from another device

A device's agent can send its plans to the server's daemon instead of running its own:

1. Install caret on the device for its agent, and answer **I'll run it myself**.
2. In the device's `config.toml`, set `[daemon]` `host` to the server's IP address, not a
   name. The server must answer to that IP: list it in the server's `hostnames`, or bind
   the server to it. Set `port` and `hostnames` to the server's, so the links the device
   prints use the server's name:

   ```toml
   [daemon]
   host = "192.168.1.5"
   hostnames = ["caret.home.lan", "192.168.1.5"]
   port = 42718
   ```

3. Copy the server's `daemon.token` to the same path on the device,
   `${XDG_STATE_HOME:-$HOME/.local/state}/caret/daemon.token`, and make it readable only
   by its owner (`chmod 600`). Copy it again after
   [Logging every device out](#logging-every-device-out).

The device's hooks only connect. They never start, stop, or upgrade the server's daemon,
whichever caret version each side runs. When nothing answers, caret denies the review with
`no caret daemon is answering at http://…`. A review denied with
`the daemon rejected the token in …` means the device's copy is stale: copy the server's
`daemon.token` again.

The device sends the token with every request over plain HTTP, and it cannot go through an
HTTPS proxy, so use this only on a network you trust.

The server's daemon acts on the server, with its files, its skills and its cmux. That, and
how the device recognizes the server, set these limits:

- File previews and file search come up empty for a project that is only on the device.
- The comment editor's `/` skill list shows the server user's own skills for the server's
  agent, not the project's.
- caret does not rewrap the agent's plan file on the device. Approval notes still reach
  it, because the hook appends them on the device.
- cmux unread marks on the device are not cleared.
- On a network where the device itself holds `host`'s address, its hooks treat the address
  as their own and start the device's own daemon there instead.

### Logging every device out

Delete the token file and restart the daemon (step 3):

```sh
rm "${XDG_STATE_HOME:-$HOME/.local/state}/caret/daemon.token"
```

The daemon mints a new token at start, so every device's cookie stops matching. Open the
new link from `caret login-link` on each device you keep.

### Plain HTTP and an HTTPS proxy

caret speaks plain HTTP, so everything, the token in the link and the cookie included,
crosses the LAN unencrypted. On a network you don't trust, put caret behind an HTTPS
reverse proxy rather than exposing the bind. Run the proxy on the same machine, keep
`host` on loopback, list the proxy's name in `hostnames`, and set `auth = "token"`, since
a loopback bind leaves auth off otherwise:

```toml
[daemon]
host = "127.0.0.1"
hostnames = ["caret.example.com"]
auth = "token"
```

Configured names match on any port and over `https`, so the proxy's requests pass. The
links caret prints stay `http://<name>:<port>`; rewrite them to the proxy's
`https://<name>/`, keeping the `?token=` part.

Have the proxy send `X-Forwarded-Proto: https`; Caddy does by default, and nginx needs
`proxy_set_header X-Forwarded-Proto $scheme;`. A login through the proxy then sets a
`Secure` cookie, which a browser never sends over plain `http://`. A device already logged
in keeps its old cookie until it opens the `https://` login link again. caret trusts the
header only while `host` is loopback.

### Turning auth off

`auth = "none"` on an exposed bind turns the login off: devices open
`http://<name>:<port>/` directly, and `caret login-link` prints that URL instead of a
link. Anyone who can reach the port can then read plans, read files under a review's
working directory, and approve a plan. `caret serve` and `caret login-link` warn when it
is set.

### If the daemon stays on loopback

- **An invalid `config.toml`** leaves the daemon on loopback with token auth on, rather
  than falling back to no auth. `caret serve` and `caret login-link` then print a link to
  `caret.localhost` instead of your `hostnames` name.
- **An older caret ignores these keys** and keeps listening on loopback only.

## Turning caret off

Two commands turn caret off, and they turn off different amounts of it:

| Command | What it does |
| --- | --- |
| `caret install`, answering **I'll run it myself** | Stops caret being resident: the review UI is no longer up from login onward. Your agent still reaches caret, and caret starts on demand. |
| `caret install --uninstall` | Removes caret from every agent, and from this machine. |

Answering **I'll run it myself** removes the service, and the install prints how to bring
the review UI up by hand: `caret serve` keeps it up until you stop it with Ctrl+C (see
[Run caret yourself](how-to/install.md#run-caret-yourself)). The choice isn't saved
anywhere. A later `caret install` at a terminal asks again. One off a terminal can't ask,
so it leaves things as they are: it refreshes a service that is already registered, and
registers none where there isn't one.

> [!IMPORTANT]
> On macOS caret also appears under **System Settings › Login Items**, but that switch is
> neither of these. caret cannot read it, so a later `caret install` that keeps the review
> UI running registers the service again and reports success while the switch still reads
> off. Run `caret install` and answer **I'll run it myself**, or use `--uninstall`,
> instead.

Alongside the agents, `--uninstall` removes the service's unit file, the launcher, and the
records the launcher reads, and caret's own copy under `~/.local/state/caret/roots/`,
keeping your reviews. The launcher removes the same things itself when it finds no caret
anywhere (its own copy counts), after looking twice more, five seconds apart. When caret
is installed but can't run, it stops the service instead (see
[When the daemon exits](#when-the-daemon-exits)). `caret install` brings back either.

## Logging & Debugging

### Where the logs live

Logs live under `$XDG_STATE_HOME/caret/logs` when set, otherwise
`~/.local/state/caret/logs`:

| File                | What's in it                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `caret.log`         | NDJSON records from the short-lived `caret review` hook process.                                                                    |
| `daemon.log`        | The daemon's records: the same NDJSON shape, tagged with `pid`.                                                            |
| `daemon-stderr.log` | Whatever the daemon writes outside its logger — raw non-JSON crash output — plus `bin/caret-launcher`'s own failures when a supervised start cannot resolve caret or bun. |
| `archive/`          | Gzipped rotations, named `<log>-<stamp>.log.gz`. A log past `[logging].max_size` is archived here and emptied; the newest `[logging].keep` per log are kept. |

Browser-UI events ship to the daemon in batches (`POST /api/logs`) and land in
`daemon.log` tagged `source: "ui"`, subject to the same `[logging]` level and redact
settings as everything else.

### What a record carries

Each record is one JSON object per line (pino):

| Field                    | Value                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `level`                  | Numeric — 20 debug, 30 info, 40 warn, 50 error.                                                                                                                          |
| `time`                   | ISO 8601 UTC, e.g. `2026-06-04T21:25:40.038Z`.                                                                                                                           |
| `step`                   | A short fixed token.                                                                                                                                                     |
| `source`                 | The emitting process — `"hook"`, `"daemon"`, or `"ui"`.                                                                                                                  |
| `caller`                 | The `file:line` of the emitting call site. On hook and daemon records only; bridged UI records omit it.                                                                  |
| `code`                   | On error records only: a stable failure code (`review-timeout`, `request-failed`, …). A shipped code is never renamed.                                                   |
| `reviewId` / `sessionId` | On a review's records in both logs: they stitch one review across `caret.log` and `daemon.log`. Records written before the daemon assigns an id carry `sessionId` alone. |

Every record also carries `msg`, plus structured extras. Normal operation logs at info;
only genuine failures sit at error.

> [!TIP]
> To raise verbosity, set `level = "debug"` in `config.toml`'s `[logging]` table (see
> [Config file](CONFIGURING.md#config-file)). It hot-reloads — no restart needed.

### Diagnostics

- `caret doctor` — a one-shot, read-only diagnosis of the local install. It opens with its
  checks — the daemon's reachability, the running daemon's version against npm's latest,
  the daemon lock, whether your agent has caret enabled, recent NDJSON error records in
  the live logs, whether OpenCode would load a caret behind the published one, and — only
  when pi's settings list caret — whether `pi` is 1.5.0 or later, lists caret exactly once
  with its extension loaded, and loads the published caret. Failing checks come first, in
  one block that counts them, and each names the remedy that closes it; the rest follow,
  marked `✓` passed or `?` undecided. Color appears only when stdout is a terminal, so a
  pipe, `TERM=dumb`, `NO_COLOR`, CI, or `--no-color` gets plain text. The log check weighs
  only the last 24 hours and reports when each noisy log last erred: an install that has
  stopped failing goes green on its own rather than waiting for the record to rotate away.
  Three checks read npm's published caret version, each degrading to `unknown` offline:
  the daemon-version check, only when a published caret daemon answers, the OpenCode
  check, only when OpenCode's config names caret, and the pi check, only when pi installs
  caret from npm. Under that sits the state it read those from: running caret processes,
  daemon identity (version, build, startup commit), lock/port state, effective settings,
  review counts, the agent adapter's install-state probe, log sizes and error/warn counts,
  the last 24 hours' failures from both logs grouped by review with their error codes,
  install and runtime info, and system basics. The last line says what to run next.

  Human-readable by default; `caret doctor --json` prints the same document as one JSON
  object (schema marker `caret-doctor/1`). Unlike the logs, it is **always redacted** — it
  exists to be shared — and never contains plan/prompt/feedback bodies or any log message,
  error or stack text. Probes are individually bounded and degrade per-section. The exit
  code is the verdict: `0` all clear, `1` a check failed, `2` no report — doctor could not
  produce one, or `--bundle` had no terminal to ask consent at and stopped before
  collecting anything.
- `/caret doctor` — the slash command that wraps it. In Claude Code and OpenCode it asks
  whether you want JSON or human-readable output, runs the subcommand, relays each failing
  check's remedy, and ends with the report in a code block ready to share. On OpenCode it
  leaves the session on the plan agent. In pi it runs the human-readable report and shows
  it in the session as an entry the model never sees.
- `caret doctor --bundle` — when the report isn't enough, a zip of the three live logs and
  up to 5000 review records, written to caret's state dir at `0600`. This archive is the
  one caret artifact that is **not** redacted: it holds your logs in full and complete
  plan bodies. caret asks before writing it, refuses outright when there is no terminal to
  ask at (pass `--yes` to confirm in a script), and never includes the rotated
  `logs/archive/` segments. Move it over a channel you trust.
- `caret redact` — scrubs the three live logs, not the archives, into shareable
  `*.redacted.log` siblings (home paths become `~`, usernames in foreign home paths are
  censored). For always-on scrubbing at write time, set `redact = true` in `[logging]`.
  Plan, prompt, and review-feedback bodies, and the names in `daemon.hostnames`, are never
  written to logs regardless of the toggle.

Contributors should see `agents/logging-rules.md` for the logging conventions — when to
log, levels, and message style.
