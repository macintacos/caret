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

caret also installs into [OpenCode](https://opencode.ai), as an auto-loaded plugin. The
script installer detects OpenCode (and, if you also have Claude Code, asks which to
install into — or set `CARET_AGENTS`):

```sh
curl -fsSL https://raw.githubusercontent.com/macintacos/caret/trunk/scripts/install.sh \
  | CARET_AGENTS=opencode bash
```

The installer drops a `caret.ts` plugin plus the `/caret:demo`, `/caret:discovery`, and
`/caret:debug` commands into your OpenCode config dir, along with a `package.json` for its
one dependency (`@opencode-ai/plugin`) — it never touches your existing `plugin` config
array. **Restart OpenCode once** after installing (plugins load at startup), then
`/caret:demo` works. Approving or requesting changes flows back exactly as in Claude Code.
**Update** by re-running the installer; **uninstall** with
`caret install-opencode --uninstall` (which also removes that `package.json` entry). See
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

- `caret discovery` prints a one-shot, read-only diagnostics snapshot of your install —
  ready to paste into a bug report (`caret discovery --json` for machine-readable output).
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
