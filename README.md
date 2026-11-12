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

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="doc/assets/caret-review-ui-dark.png">
  <img src="doc/assets/caret-review-ui-light.png" alt="caret's review UI: a plan with two inline comments, the file it cites open in a preview, and the comment list open">
</picture>

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

1. **Restart the agent.** OpenCode installs the plugin package on its next start; in pi,
   run `/reload` or restart it.
2. **Run `/caret demo`.** It presents a short demo plan that points at files in the repo
   you run it from, so you can exercise the whole flow before a real one arrives.
3. **Run `/caret <what you want done>`** to plan a real change and review it in `caret`
   before the agent implements it. Bare `/caret` lists what it takes. In Claude Code, the
   command is listed as `caret:caret`; a typed `/caret` resolves to it.

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

`--refresh` restarts the caret service on the newest caret installed, never older than the
one you ran; caret keeps a copy of it under `~/.local/state/caret/roots/`.

`caret`'s UI is designed to check for updates, at most once a day. When a newer `caret` is
out, the review UI says so once: a toast on load that opens **What's new** (the skipped
release notes or trunk commits), a mark on the settings button, and a
**Settings → Updates** pane naming the version and the exact command to take it.

Turn the check off from that same pane, or by hand in
[`config.toml`](doc/CONFIGURING.md#the-updates-table):

```toml
[updates]
check = false
```

`caret` supports OpenCode v1 1.3.4 or later and v2 2.0.29 or later; an older v2 still
loads caret but can't review a plan file the agent wrote, so the agent sends the plan text
instead. See [the OpenCode adapter](doc/ARCHITECTURE.md#the-opencode-adapter) for the
by-hand equivalents, for pinning a version in OpenCode's plugin array (`plugin` on v1,
`plugins` on v2); [`caret install`](doc/ARCHITECTURE.md#installing-with-caret-install)
covers what each agent's install touches;
[the Claude Code adapter](doc/ARCHITECTURE.md#the-claude-code-adapter) covers the hooks
`caret` registers there. `caret install` also installs into pi 1.5.0 or later when `pi` is
on your PATH; run `/reload` in pi or restart it to pick caret up. `caret install` and
`caret doctor` manage only pi's user-scope packages and ignore a project-scope install
(`pi install -l`). OpenCode and pi both load caret from its npm package, which runs on
bun, so `bun` must be on the PATH they run with. See
[the pi adapter](doc/ARCHITECTURE.md#the-pi-adapter) for the by-hand equivalents.

## Using `caret`

Whenever your agent presents a plan, `caret` should intercept it and opens the plan in
your browser instead of the terminal prompt. There you:

- **Read** the plan as rendered HTML.
- **Annotate** — select any passage to attach an inline comment.
- **Decide** — **Approve** — with any comments you've left, applied without another
  planning round (optionally also switching the session into accept-edits or auto mode,
  or, on OpenCode v2 from the plan agent, to the build agent) or **Request changes**,
  which sends your comments back to the agent to revise and re-present.

> [!TIP]
> You don't have to wait to be intercepted: `/caret <what you want done>` asks the agent
> for a plan and routes it straight to the review UI. In OpenCode it runs on the `plan`
> agent, so switch to `build` to implement once you approve. A skill of your own can do
> the same with the plan-review tool `caret` gives each agent — `review_plan` in Claude
> Code (from the plugin's MCP server) and `caret_review_plan` in OpenCode and pi. The tool
> is for plans only; see
> [`doc/ARCHITECTURE.md`](doc/ARCHITECTURE.md#calling-the-review-tool-from-your-own-skill).
> In OpenCode v2, `<leader>p` (`ctrl+x p` by default) opens the plan waiting in the
> session; rebind the key as `caret.open` under OpenCode's `keybinds`.

### Using `caret` in pi

pi has no plan mode of its own, so `caret` brings a small one:

1. `/caret <what you want done>` turns on planning mode. The agent researches, writes its
   plan into pi's plans folder (`~/.pi/agent/plans` by default), and sends it to `caret`.
   Until you approve, `caret` blocks the agent's `edit` and `write` tools outside that
   folder; shell commands are only discouraged. While planning, `/caret plan` on its own
   turns planning off.
2. While a review waits, a notice sits above the editor and the footer reads
   `^ plan waiting`. `ctrl+alt+o` opens the plan in your browser. In Terminal.app or
   iTerm2, set Option to act as Meta (Esc+) for the shortcut to reach pi.
3. Approve, and the agent implements. Request changes, and it revises and resubmits. Esc
   in pi cancels a waiting review, and the agent is told not to implement the plan.

`/caret demo` presents a demo plan, and `/caret doctor` runs `caret doctor` and shows its
report in the session (see [Diagnostics](#diagnostics)).

## Configuration

`caret` runs with sensible defaults and needs no configuration. To tune it — the daemon
port, the review timeout, the log level — it reads an optional `config.toml` and `CARET_*`
environment variables. Every key, every variable, and their defaults are in
[`doc/CONFIGURING.md`](doc/CONFIGURING.md).
To open the review UI from another device, such as a phone or a laptop, see
[Reaching caret from another device](doc/RUNNING.md#reaching-caret-from-another-device).
Only the machine that serves the review UI runs caret as a service;
[the other devices](doc/RUNNING.md#on-the-other-devices) need only a browser and the login
link.

## Documentation

[`doc/README.md`](doc/README.md) maps the `doc/` directory — start there and it routes you
to the reference page that answers your question.

Two more live at the repo root:

- [CONTRIBUTING.md](CONTRIBUTING.md) — develop `caret` locally: setup, the `mise`
  workflow, and where tests live. PRs run the full eight-check gate in CI;
  `mise run preflight` is the fast local one.
- [AGENTS.md](AGENTS.md) — for coding agents: routes a change to the rules-of-the-road
  that govern it.

## Diagnostics

- `/caret doctor` runs `caret doctor`: a one-shot, read-only check of your install —
  what's wrong, how to fix it, and the state it read that from. Always redacted, and it
  never contains plan, prompt, or feedback bodies, nor any log message, error or stack
  text.
- `caret doctor --bundle` archives the raw logs and review records when a maintainer needs
  them. That archive is **not** redacted, so caret asks before writing it.

## License

MIT — see [LICENSE](LICENSE). Vendored third-party code and assets are itemized, with
their licenses, in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
