# Open caret from another device

*Audience: anyone who wants caret's review page on a phone, tablet, or another computer.*

This page logs a browser on another device in to the
[review page](../reference/glossary.md#review-page) a server serves. The server runs a
[background service](../reference/glossary.md#background-service): either the one
`caret install` keeps running, or one `caret serve` runs. Do the first four sections in
order. It works the same in every
[agent host](../reference/glossary.md#agent-host).

By default, caret listens on `127.0.0.1` only, with no login. These steps assume a network
you trust. On any other network, read [Use an HTTPS proxy](#use-an-https-proxy) first.

## Set the address

In the `[daemon]` table of [`config.toml`](../reference/config-file.md) (keys in
[The `[daemon]` and `[review]` tables](../reference/config-file.md#the-daemon-and-review-tables)),
bind caret to the network and give it a name:

```toml
[daemon]
host = "0.0.0.0"
hostnames = ["caret.home.lan"]
port = 42718
```

An exposed `host`, one outside loopback, turns token login on: devices then need the login
link below.

caret answers only to the `hostnames` entries, and to `host` when it is a specific
address. It refuses any other name with `403 host not recognized`. So with a wildcard bind
(`0.0.0.0` or `::`), a device that reaches the server by IP address needs that IP in
`hostnames`. The first `hostnames` entry is the name printed links use.

A specific address in `host` also works, but then caret can't start while that address is
missing: after a network or DHCP change, or a boot that beats the network. It exits rather
than waiting, so prefer a wildcard bind plus `hostnames`.

If the server runs a firewall, allow incoming TCP on `port`.

## Point a DNS record at the server

In your router or local DNS server, add an A or AAAA record from the first `hostnames`
entry to the server's LAN address. A computer can use a hosts-file entry instead.

Avoid a multicast DNS (mDNS) `.local` name: any device on the LAN can answer a `.local`
lookup and receive the token.

Skip this step if devices reach the server by an IP you listed.

## Restart the background service

These keys take effect on the next start. For `caret serve`, press `ctrl+c` and run it
again. For the service `caret install` sets up, use its
[restart command](background-service.md#check-restart-or-stop-it).
`caret install --refresh` also restarts it.

## Open the login link on each device

`caret serve` prints the login link on every start. Otherwise, run `caret login-link`:

```sh
caret login-link
# http://caret.home.lan:42718/?token=…
```

Open the link once on each device. It sets a cookie that keeps the device logged in.

The link is a secret: anyone holding it can log in.

`caret login-link` reads `config.toml` and the token file, not the running background
service. So its link works only once the background service has restarted.

## Set up the other devices

A device that only opens the review page needs a browser and the login link, not caret.
Only the server runs caret as a service.

If another device runs caret for its own agent, answer **I'll run it myself** when
`caret install` asks. Unless it sends its plans to the server (below), keep the server's
`host` and `hostnames` out of that device's `config.toml`. Otherwise its background
service also listens on the network and prints links to the server's name. Those links
open the server, so you never see the device's own reviews.

By default, an agent on another device reviews its plans on that device's own background
service, at `caret.localhost`. To review them on the server instead, see
[Send plans to caret on a server](remote-review.md).

## Log every device out

Delete the token file, then
[restart the background service](#restart-the-background-service):

```sh
rm "${XDG_STATE_HOME:-$HOME/.local/state}/caret/daemon.token"
```

caret mints a new token at start, so every device's cookie stops matching. Open the new
link from `caret login-link` on each device you keep.

## Use an HTTPS proxy

caret speaks plain HTTP, so everything crosses the LAN unencrypted, the token in the link
and the cookie included. On a network you don't trust, put caret behind an HTTPS reverse
proxy rather than exposing the bind.

Run the proxy on the same machine and keep `host` on loopback. List the proxy's name in
`hostnames`, and set `auth = "token"`, since a loopback bind leaves the login off
otherwise:

```toml
[daemon]
host = "127.0.0.1"
hostnames = ["caret.example.com"]
auth = "token"
```

Configured names match on any port and over `https`, so the proxy's requests pass. The
links caret prints stay `http://<name>:<port>`. Rewrite them to the proxy's
`https://<name>/`, keeping the `?token=` part.

Have the proxy send `X-Forwarded-Proto: https`. Caddy does by default, and nginx needs
`proxy_set_header X-Forwarded-Proto $scheme;`. A login through the proxy then sets a
`Secure` cookie, which a browser never sends over plain `http://`. A device already logged
in keeps its old cookie until it opens the `https://` login link again.

caret trusts that header only while `host` is loopback.

## Turn the login off

`auth = "none"` on an exposed bind turns the login off. Devices open
`http://<name>:<port>/` directly, and `caret login-link` prints that URL instead of a
link.

!!! warning

    With the login off, anyone who can reach the port can read plans, read files under a
    review's working directory, and approve a plan. `caret serve` and `caret login-link`
    warn while `auth = "none"` is set.

## If caret stays on loopback

- **An invalid `config.toml`** leaves caret on loopback with token login on, rather than
    falling back to no login. `caret serve` and `caret login-link` then print a link to
    `caret.localhost` instead of your `hostnames` name.
- **An older caret ignores these keys** and keeps listening on loopback only.

## Next steps

- Send another computer's plans to this server with
    [Send plans to caret on a server](remote-review.md).
- Keep the server's background service up with
    [Run the background service](background-service.md).
