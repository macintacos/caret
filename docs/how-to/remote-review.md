# Send plans to caret on a server

*Audience: anyone whose agent runs on one computer but who reviews plans on caret on
another.*

Point a device's agent at a server's
[background service](../reference/glossary.md#background-service), so you review its plans
there instead of on a caret of the device's own. The steps are the same in every
[agent host](../reference/glossary.md#agent-host).

## Before you start

Set the server up first with [Open caret from another device](remote-access.md).

!!! warning

    The device sends the token with every request over plain HTTP. caret on the device
    cannot reach the server through an HTTPS proxy. Use this only on a network you trust.

## Install caret on the device

Install caret on the device for its agent, and answer **I'll run it myself** when
`caret install` asks.

## Point the device at the server

In the device's `config.toml`, set `daemon.host` to the server's IP address, not a name.
The server must answer to that IP: list it in the server's `daemon.hostnames`, or bind the
server to it. Set `daemon.port` and `daemon.hostnames` to the server's, so the links the
device prints use the server's name:

```toml
[daemon]
host = "192.168.1.5"
hostnames = ["caret.home.lan", "192.168.1.5"]
port = 42718
```

## Copy the server's token

Copy the server's `daemon.token` to the same path on the device,
`${XDG_STATE_HOME:-$HOME/.local/state}/caret/daemon.token`, and make it readable only by
its owner (`chmod 600`).

Copy it again after you [log every device out](remote-access.md#log-every-device-out).

## Fix a denied review

caret on the device only connects. It never starts, stops, or upgrades the server's
background service, whichever caret version each side runs.

- A [review](../reference/glossary.md#review) denied with
    `no caret daemon is answering at http://…` means nothing answered at the server's
    address. Check that the server's background service is running.
- A review denied with `the daemon rejected the token in …` means the device's copy of
    the token is stale. Copy the server's `daemon.token` again.

## What works differently

The server's background service acts on the server, with its files, its skills, and its
cmux. That, and how the device recognizes the server, set these limits:

- [File previews](../reference/glossary.md#file-preview) and file search come up empty
    for a project that is only on the device.
- The comment editor's `/` skill list shows the server user's own skills for the
    server's agent, not the project's.
- caret does not rewrap the agent's plan file on the device. Approval notes still reach
    it, because caret appends them on the device.
- cmux unread marks on the device are not cleared.
- On a network where the device itself holds `host`'s address, caret on the device
    treats the address as its own and starts the device's own background service there
    instead.

## Next steps

- Open the server's [review page](../reference/glossary.md#review-page) in a browser
    with [Open caret from another device](remote-access.md).
- Read what caret on the device logged with [Find caret's logs](logs.md).
