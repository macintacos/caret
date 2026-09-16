# 🥕 `caret`

`caret` is a plugin that replaces the terminal plan-approval prompt with a local web UI.
When your agent presents a plan, `caret` opens it in your browser so you can read it as
rendered HTML, **annotate passages inline** (Google-Docs style), and **approve** or
**request changes**. Your feedback flows straight back to the agent. A single local daemon
is shared across concurrent sessions, so several in-flight plans can be reviewed from one
browser tab via a switcher.

Want to develop `caret` rather than use it? Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## Screenshots

[Check out a short demo here!](https://youtu.be/zesv5AunUW4)

![caret review UI with an inline annotation, stitched across four themes](doc/assets/caret-review-ui.png)

## Install

```sh
bunx --no-cache @macintacos/caret@latest install
```

> [!NOTE]
> `caret` supports macOS and Linux, where the review UI can run as a long-lived login
> service. Windows is best-effort and runs `caret` on demand only. See
> [`doc/CONFIGURING.md`](doc/CONFIGURING.md#platform-support) for what differs on each
> platform and what to fall back on.

Assuming that you installed it as a long-lived service (the default), you can navigate to
<http://caret.localhost:42718> to see the `caret` UI.

After installing:

1. **Restart the agent.** OpenCode installs the plugin package on its next start.
2. **Run `/caret:demo`.** It presents a short demo plan that points at files in the repo
   you run it from, so you can exercise the whole flow before a real one arrives.

### Running `caret` yourself

If you'd rather `caret` not start at login, answer **I'll run it myself** when
`caret install` asks. That removes the service if one is registered. Then, whenever you
want the review UI up, run:

```sh
bunx @macintacos/caret@latest serve
```

This will keep the UI up at `http://caret.localhost:42718` until the process is
terminated.

### Updating and uninstalling

Both are the install command with one flag:

```sh
bunx --no-cache @macintacos/caret@latest install --refresh    # update
bunx --no-cache @macintacos/caret@latest install --uninstall  # remove
```

`caret`'s UI is designed to check for updates, at most once a day. When a newer `caret` is
out, the review UI says so once: a toast on load, a mark on the settings button, and a
**Settings → Updates** pane naming the version and the exact command to take it.

Turn the check off from that same pane, or by hand in
[`config.toml`](doc/CONFIGURING.md#the-updates-table):

```toml
[updates]
check = false
```

See [the OpenCode adapter](doc/ARCHITECTURE.md#the-opencode-adapter) for the by-hand
equivalents, for pinning a version in OpenCode's `plugin` array, and for what each agent's
install touches; [the Claude Code adapter](doc/ARCHITECTURE.md#the-claude-code-adapter)
covers the hooks `caret` registers there.

## Using `caret`

Whenever your agent presents a plan, `caret` should intercept it and opens the plan in
your browser instead of the terminal prompt. There you:

- **Read** the plan as rendered HTML.
- **Annotate** — select any passage to attach an inline comment.
- **Decide** — **Approve** (optionally also switching the session into accept-edits or
  auto mode) or **Request changes**, which sends your comments back to the agent to revise
  and re-present.

> [!TIP]
> You don't have to wait to be intercepted: `caret` gives both agents a plan-review tool
> they can call directly — `review_plan` in Claude Code (from the plugin's MCP server) and
> `caret_review_plan` in OpenCode — so a skill of your own can route its plan through the
> same review UI. The tool is for plans only; see
> [`doc/ARCHITECTURE.md`](doc/ARCHITECTURE.md#calling-the-review-tool-from-your-own-skill).

## Configuration

`caret` runs with sensible defaults and needs no configuration. To tune it — the daemon
port, the review timeout, the log level — it reads an optional `config.toml` and `CARET_*`
environment variables. Every key, every variable, and their defaults are in
[`doc/CONFIGURING.md`](doc/CONFIGURING.md).

## Documentation

[`doc/README.md`](doc/README.md) maps the `doc/` directory — start there and it routes you
to the reference page that answers your question.

Two more live at the repo root:

- [CONTRIBUTING.md](CONTRIBUTING.md) — develop `caret` locally: setup, the `mise`
  workflow, and where tests live.
- [CLAUDE.md](CLAUDE.md) — for coding agents: routes a change to the rules-of-the-road
  that govern it.

## Diagnostics

- `/caret:discovery` prints a one-shot, read-only diagnostics snapshot of your install —
  always redacted, and it never contains plan, prompt, or feedback bodies, nor any log
  contents.
- `/caret:debug` reviews the current session's plans and recent errors.

## License

MIT — see [LICENSE](LICENSE). Vendored third-party assets (the Lucide icons) are itemized
in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) (ISC).
