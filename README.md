# 🥕 caret

> ⚠️ **Prototype.** caret is an early prototype and may change substantially over the next
> little while — interfaces, hooks, storage, and the install flow are all still settling.
> Expect rough edges and breaking changes.

caret is a Claude Code (and OpenCode) plugin that replaces the terminal plan-approval
prompt with a local web UI. When your agent presents a plan, caret opens it in your
browser so you can read it as rendered HTML, **annotate passages inline** (Google-Docs
style), and **approve** or **request changes** — your feedback flows straight back to the
agent. A single local daemon is shared across concurrent sessions, so several in-flight
plans can be reviewed from one browser tab via a switcher.

Want to develop caret rather than use it? Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## Screenshots

<!-- TODO(EXC-666): review-UI screenshots — plan view + inline annotation,
request-changes flow, multi-session switcher. -->

_Review-UI screenshots coming soon._

## Install

caret needs [`bun`](https://bun.sh) on your `PATH` — it runs from a `bun` bundle — plus
the [`claude`](https://claude.com/claude-code) CLI you already have.

### Claude Code

caret installs from its GitHub-based plugin marketplace. From inside Claude Code:

```sh
/plugin marketplace add macintacos/caret
/plugin install caret@caret
```

This fetches the published plugin — a self-contained `bun` bundle plus the prebuilt UI —
into Claude Code's plugin cache. No `git clone`, no compile step, no
`claude --plugin-dir`. Then restart Claude Code (or run `/reload-plugins`) and try it:

```sh
/caret:demo    # presents a short fake plan to exercise the flow
```

**Update** with `/plugin marketplace update caret` (then `/reload-plugins`). **Uninstall**
with:

```sh
claude plugin uninstall caret@caret
claude plugin marketplace remove caret
```

### OpenCode

caret installs into [OpenCode](https://opencode.ai) as a first-class
[plugin](https://opencode.ai/docs/plugins/): add its package to your OpenCode `plugin`
array and restart OpenCode once.

```jsonc
// ~/.config/opencode/opencode.json
{ "plugin": ["@macintacos/caret"] }
```

On its next start OpenCode installs `@macintacos/caret` (and its one dependency) into its
own cache and loads it — no separate caret install, though it still needs
[`bun`](https://bun.sh) on your `PATH`. From then on, when OpenCode's Plan agent presents
a plan, caret opens it for review just as it does for Claude Code.

Prefer a command — or want the `/caret:demo`, `/caret:discovery`, and `/caret:debug` slash
commands too? If you have the caret binary (from the [script installer](#claude-code) or
npm), run:

```sh
caret install --target opencode        # or --target opencode,claude to install both agents
```

That adds the array entry for you and drops the command files into your OpenCode config
dir. The script installer does the same non-interactively (`CARET_AGENTS=opencode`); you
no longer need it for a one-time install.

**Update**: caret checks its
[latest release](https://github.com/macintacos/caret/releases) at OpenCode startup and
toasts you when a newer version is available; to take it, repin the array entry (or clear
OpenCode's plugin cache) and restart. **Uninstall**:
`caret install --target opencode --uninstall`, or just remove the array entry. See
[`doc/ADVANCED.md`](doc/ADVANCED.md#the-opencode-adapter) for how the integration works.

## Using caret

Whenever your agent presents a plan — Claude Code's `ExitPlanMode`, or the Plan agent in
OpenCode — caret intercepts it and opens it in your browser instead of the terminal
prompt. There you:

- **Read** the plan as rendered HTML.
- **Annotate** — select any passage to attach an inline comment.
- **Decide** — **Approve** (optionally also switching the session into accept-edits or
  auto mode) or **Request changes**, which sends your comments back to the agent to revise
  and re-present.

A single local daemon serves every session, so concurrent plans queue up in one tab behind
a switcher.

## Configuration

caret runs with sensible defaults and needs no configuration. To tune it, it reads an
optional `config.toml` and `CARET_*` environment variables (for example the daemon port or
the review timeout); logs are written raw by default. The full list of keys, their
defaults, and the environment variables is in
[`doc/ADVANCED.md`](doc/ADVANCED.md#configuration).

## Reporting bugs

- `/caret:discovery` prints a one-shot, read-only diagnostics snapshot of your install —
  ready to paste into a bug report.
- `/caret:debug` reviews the current session's plans and recent errors.

Details, plus how to scrub logs with `caret redact`, are in
[`doc/ADVANCED.md`](doc/ADVANCED.md#logging--debugging).

## Platform support

caret is **macOS-first**; Linux and Windows are best-effort. See
[`doc/ADVANCED.md`](doc/ADVANCED.md#platform-support) for the details.

## Documentation

- [`doc/ADVANCED.md`](doc/ADVANCED.md) — the deep reference: build-from-source,
  architecture, the agent adapters, the full configuration surface, and the development
  workflow.
- [CONTRIBUTING.md](CONTRIBUTING.md) — develop caret locally: setup, the `mise` workflow,
  and where tests live.
- [`doc/`](doc/) — contributor rules-of-the-road, routed from [CLAUDE.md](CLAUDE.md).

## License

MIT — see [LICENSE](LICENSE). Vendored third-party assets (the Lucide icons) are itemized
in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) (ISC).
