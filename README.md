# 🥕 caret

caret is a Claude Code (and OpenCode) plugin that replaces the terminal plan-approval
prompt with a local web UI. When your agent presents a plan, caret opens it in your
browser so you can read it as rendered HTML, **annotate passages inline** (Google-Docs
style), and **approve** or **request changes** — your feedback flows straight back to the
agent. A single local daemon is shared across concurrent sessions, so several in-flight
plans can be reviewed from one browser tab via a switcher.

Want to develop caret rather than use it? Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## Screenshots

![caret review UI with an inline annotation, stitched across four themes](doc/assets/caret-review-ui.png)

[Check out a short demo here!](https://youtu.be/zesv5AunUW4)

## Install

caret needs [`bun`](https://bun.sh) on your `PATH` — it runs from a `bun` bundle.

> [!NOTE]
> caret supports macOS and Linux, where the review UI can run as a login service (launchd
> or systemd). Windows is best-effort and runs caret on demand only. See
> [`doc/CONFIGURING.md`](doc/CONFIGURING.md#platform-support) for what differs on each
> platform and what to fall back on.

```sh
bunx --no-cache @macintacos/caret@latest install
```

That is the whole install — no `git clone`, no compile step. It detects which agents you
have — [Claude Code](https://claude.com/claude-code), [OpenCode](https://opencode.ai), or
both — asks which of them to install into, and registers the _published_ caret with each:
prebuilt artifacts, the `/caret:*` slash commands, and the [rumdl](https://rumdl.dev/)
plan formatter. Where it can't ask — off a terminal — it installs into every agent it
detected.

Every install at a terminal also asks whether to keep caret's review UI running all the
time, and doesn't remember the answer. Keeping it running registers a service that starts
at login and serves the UI at `http://caret.localhost:42718`; the other answer is
[running caret yourself](#running-caret-yourself). Off a terminal it doesn't ask, and
leaves the service however it finds it. To turn the service off later, run `caret install`
and answer **I'll run it myself**, or use `--uninstall` — see
[turning caret off](doc/RUNNING.md#turning-caret-off) and
[the caret service](doc/RUNNING.md#the-caret-service).

Two steps finish the job:

1. **Restart the agent.** OpenCode installs the plugin package on its next start.
2. **Run `/caret:demo`.** It presents a short demo plan that points at files in the repo
   you run it from, so you can exercise the whole flow before a real one arrives.

| Flag          | What it does                                          |
| ------------- | ----------------------------------------------------- |
| `--dry-run`   | Preview the run without changing anything.            |
| `--refresh`   | Update an existing install.                           |
| `--uninstall` | Remove caret from every agent, and from this machine. |

### Running caret yourself

If you'd rather caret not start at login, answer **I'll run it myself** when
`caret install` asks. That removes the service if one is registered. Then, whenever you
want the review UI up, run:

```sh
bunx --no-cache @macintacos/caret@latest serve
```

It keeps the UI up at `http://caret.localhost:42718` until you press Ctrl+C. If caret
already started on demand, `serve` stops that copy and takes the port; if caret's service
still holds it, `serve` says so and exits. Without `serve`, caret still works: it starts
when your agent submits a plan, and stops about a minute after the last review is
resolved.

After updating caret, run `caret serve` again yourself: the first plan from the new
version stops the old one, and nothing brings it back.

### Updating and uninstalling

Both are the install command with one flag:

```sh
bunx --no-cache @macintacos/caret@latest install --refresh    # update
bunx --no-cache @macintacos/caret@latest install --uninstall  # remove
```

An update picks its agents exactly as a fresh install does — the chooser at a terminal,
detection otherwise — and at a terminal asks the review-UI question again; an uninstall
takes every agent. Where caret's service stays registered, `--refresh` also cycles it onto
the new version, and restarting each agent loads that agent's own updated copy. In
OpenCode, caret toasts you at startup when a newer release is out; a plain `install` at a
terminal runs its own check against npm and asks before taking it.

caret's daemon runs the same check for itself, at most once a day. The call is
unauthenticated and sends nothing about you — just a request to npm or GitHub, depending
on how caret was installed, for the newest published version. When a newer caret is out,
the review UI says so once: a toast on load, a mark on the settings button, and a
**Settings → Updates** pane naming the version and the exact command to take it.

Turn the check off from that same pane, or by setting `updates.check` to `false` in
`prefs.json` (`~/.local/state/caret/prefs.json`, or under `$XDG_STATE_HOME/caret`):

```json
{ "updates": { "check": false } }
```

See [the OpenCode adapter](doc/ARCHITECTURE.md#the-opencode-adapter) for the by-hand
equivalents, for pinning a version in OpenCode's `plugin` array, and for what each agent's
install touches; [the Claude Code adapter](doc/ARCHITECTURE.md#the-claude-code-adapter)
covers the hooks caret registers there.

## Using caret

Whenever your agent presents a plan — Claude Code's `ExitPlanMode`, or the Plan agent in
OpenCode — caret intercepts it and opens it in your browser instead of the terminal
prompt. There you:

- **Read** the plan as rendered HTML.
- **Annotate** — select any passage to attach an inline comment.
- **Decide** — **Approve** (optionally also switching the session into accept-edits or
  auto mode) or **Request changes**, which sends your comments back to the agent to revise
  and re-present.

> [!TIP]
> You don't have to wait to be intercepted: caret gives both agents a plan-review tool
> they can call directly — `review_plan` in Claude Code (from the plugin's MCP server) and
> `caret_review_plan` in OpenCode — so a skill of your own can route its plan through the
> same review UI. The tool is for plans only; see
> [`doc/ARCHITECTURE.md`](doc/ARCHITECTURE.md#calling-the-review-tool-from-your-own-skill).

## Configuration

caret runs with sensible defaults and needs no configuration. To tune it — the daemon
port, the review timeout, the log level — it reads an optional `config.toml` and `CARET_*`
environment variables. Every key, every variable, and their defaults are in
[`doc/CONFIGURING.md`](doc/CONFIGURING.md).

## Diagnostics

- `/caret:discovery` prints a one-shot, read-only diagnostics snapshot of your install —
  always redacted, and it never contains plan, prompt, or feedback bodies, nor any log
  contents.
- `/caret:debug` reviews the current session's plans and recent errors.

Logs are written raw by default. `caret redact` writes scrubbed `*.redacted.log` copies
alongside them — paste one of those into a chat, a gist, or an AI assistant, never the
original. [`doc/RUNNING.md`](doc/RUNNING.md#logging--debugging) says where they live.

## Documentation

[`doc/README.md`](doc/README.md) maps the `doc/` directory — start there and it routes you
to the reference page that answers your question.

Two more live at the repo root:

- [CONTRIBUTING.md](CONTRIBUTING.md) — develop caret locally: setup, the `mise` workflow,
  and where tests live.
- [CLAUDE.md](CLAUDE.md) — for coding agents: routes a change to the rules-of-the-road
  that govern it.

## License

MIT — see [LICENSE](LICENSE). Vendored third-party assets (the Lucide icons) are itemized
in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) (ISC).
