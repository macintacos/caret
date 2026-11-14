# caret — Running

*Audience: users running caret day to day — the caret service, reaching caret from another
device, turning caret off, and logging & debugging.*

Part of the deep reference behind [README.md](../README.md). For what caret is, how to
install it, and basic usage, start there.

## Reaching caret from another device

By default the daemon listens on `127.0.0.1` only, with no auth. These steps take a server
running a resident daemon, [the caret service](how-to/background-service.md) or
`caret serve`, to a logged-in browser on a phone, tablet or another computer. They assume
a network you trust; otherwise see
[Plain HTTP and an HTTPS proxy](#plain-http-and-an-https-proxy).

1. **Set the address.** In the `[daemon]` table of
   [`config.toml`](reference/config-file.md) (keys in
   [The daemon and review tables](reference/config-file.md#the-daemon-and-review-tables)),
   bind the daemon to the network and give it a name:

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
   [Restart command](how-to/background-service.md#check-restart-or-stop-it):
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
