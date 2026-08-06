# 🥕 caret

> [!WARNING]
> caret is an early prototype and may change substantially over the next little while —
> interfaces, hooks, storage, and the install flow are all still settling. Expect rough
> edges and breaking changes.

caret is a Claude Code (and OpenCode) plugin that replaces the terminal plan-approval
prompt with a local web UI. When your agent presents a plan, caret opens it in your
browser so you can read it as rendered HTML, **annotate passages inline** (Google-Docs
style), and **approve** or **request changes** — your feedback flows straight back to the
agent. A single local daemon is shared across concurrent sessions, so several in-flight
plans can be reviewed from one browser tab via a switcher.

Want to develop caret rather than use it? Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## Screenshots

![caret review UI with an inline annotation, both themes](doc/assets/caret-review-ui.png)

## Install

caret needs [`bun`](https://bun.sh) on your `PATH` — it runs from a `bun` bundle.

> [!NOTE]
> caret is **macOS-first**; Linux and Windows are best-effort. See
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

Two steps finish the job:

1. **Restart the agent.** OpenCode installs the plugin package on its next start.
2. **Run `/caret:demo`.** It presents a short fake plan, so you can exercise the whole
   flow before a real one arrives.

| Flag                | What it does                                                      |
| ------------------- | ----------------------------------------------------------------- |
| `--target <agents>` | Skip the chooser: `claude`, `opencode`, or both, comma-separated. |
| `--dry-run`         | Preview the run without changing anything.                        |
| `--refresh`         | Update an existing install.                                       |
| `--uninstall`       | Remove caret, offering the same agent chooser.                    |

### Updating and uninstalling

Both are the install command with one flag:

```sh
bunx --no-cache @macintacos/caret@latest install --refresh    # update
bunx --no-cache @macintacos/caret@latest install --uninstall  # remove
```

`--target` pins the agents on both, exactly as it does on a fresh install. Restarting each
agent applies an update. In OpenCode, caret toasts you at startup when a newer release is
out; a plain `install` at a terminal runs its own check against npm and asks before taking
it.

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
> **In OpenCode**, you don't have to wait to be intercepted: caret registers a
> `caret_review_plan` tool your agent can call directly, so a skill of your own can route
> its approval step through the same review UI. Claude Code has no equivalent — see
> [`doc/ARCHITECTURE.md`](doc/ARCHITECTURE.md#calling-the-review-tool-from-your-own-skill).

## Configuration

caret runs with sensible defaults and needs no configuration. To tune it — the daemon
port, the review timeout, the log level — it reads an optional `config.toml` and `CARET_*`
environment variables. Every key, every variable, and their defaults are in
[`doc/CONFIGURING.md`](doc/CONFIGURING.md).

## Reporting bugs

- `/caret:discovery` prints a one-shot, read-only diagnostics snapshot of your install —
  ready to paste into a bug report.
- `/caret:debug` reviews the current session's plans and recent errors.

Logs are written raw by default. Where they live, and how to scrub them with
`caret redact` before sharing, is in
[`doc/RUNNING.md`](doc/RUNNING.md#logging--debugging).

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
