# 🥕 caret

> ⚠️ **Prototype.** caret is an early prototype and may change substantially over the next little
> while — interfaces, hooks, storage, and the install flow are all still settling. Expect rough
> edges and breaking changes.

A Claude Code plugin that replaces the terminal plan-approval prompt with a local web UI. When
Claude presents a plan via `ExitPlanMode`, caret opens it in your browser so you can read it
rendered as HTML, **annotate passages inline** (Google-Docs style), and **approve** or **request
changes**. Your decision — and all annotation feedback — flows straight back to the agent. A single
local daemon is shared across concurrent Claude sessions, so several in-flight plans are reviewed
from one browser tab via a switcher.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/macintacos/caret/trunk/scripts/install.sh | bash
```

That one command clones caret at its latest release (the newest `vX.Y.Z` tag), builds the binary
for your platform, and registers it with Claude Code through the native plugin system — no manual
`git clone` and no `claude --plugin-dir`. It requires [`git`](https://git-scm.com),
[`bun`](https://bun.sh), and the [`claude`](https://claude.com/claude-code) CLI on your `PATH`.

Not sure what it'll touch? Set `CARET_DRY_RUN=1` and the installer runs the same read-only
detection — tool checks, release-tag lookup, clone-vs-update — then prints the exact commands it
would run and changes nothing:

```sh
curl -fsSL https://raw.githubusercontent.com/macintacos/caret/trunk/scripts/install.sh | CARET_DRY_RUN=1 bash
```

Then restart Claude Code (or run `/reload-plugins`) and try it:

```sh
/caret:demo    # presents a short fake plan to exercise the flow
```

Enter plan mode, let Claude present a plan, and a browser tab opens at the deep-linked review.
Select text to comment, then **Approve** (optionally "& accept edits" or "& auto mode") or
**Request changes**.

**Update** by re-running the same command — it fetches the latest release, rebuilds, and reinstalls.
**Uninstall** with:

```sh
claude plugin uninstall caret@caret
claude plugin marketplace remove caret
```

## How it works

caret ships one compiled binary (`bin/caret`) with three subcommands, wired to two plan-mode hooks:

| Hook                | Matcher         | Command         | Purpose                                                   |
| ------------------- | --------------- | --------------- | --------------------------------------------------------- |
| `PostToolUse`       | `EnterPlanMode` | `caret prewarm` | Warm-start the daemon when the model enters plan mode.    |
| `PermissionRequest` | `ExitPlanMode`  | `caret review`  | Block, open the plan in the browser, return the decision. |

The `PermissionRequest`/`ExitPlanMode` hook intercepts the plan-approval request itself, so an
**approve** auto-answers it (no native dialog) and a **request changes** returns the feedback to the
model, which revises and re-presents (captured as a new version). This was verified empirically —
`PreToolUse` does **not** work for this, because allowing the tool to run still shows the native
dialog.

The hook emits the [PermissionRequest decision](https://code.claude.com/docs/en/hooks) on stdout:

```jsonc
// approve (optionally switching the session into acceptEdits / auto mode)
{ "hookSpecificOutput": { "hookEventName": "PermissionRequest",
  "decision": { "behavior": "allow",
    "updatedPermissions": [{ "type": "setMode", "mode": "acceptEdits", "destination": "session" }] } } }
// request changes
{ "hookSpecificOutput": { "hookEventName": "PermissionRequest",
  "decision": { "behavior": "deny", "message": "<formatted annotations + comment>" } } }
```

**Fail-safe = deny.** On a bad payload, an unreachable daemon, a timeout, a signal, or daemon death,
caret emits `deny` with an explanation — it never auto-approves an unreviewed plan.

## Configuration

| Env var          | Default          | Purpose                                                                                                                                   |
| ---------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `CARET_PORT`     | `42718`          | Daemon port.                                                                                                                              |
| `CARET_TIMEOUT`  | `3600` (s)       | Review window before the hook fail-safe-denies, in seconds (default 1 hour; must stay below the 3900s hook budget in `hooks/hooks.json`). |
| `CARET_IDLE_MS`  | `60000`          | Idle delay before the daemon auto-shuts-down with no reviews.                                                                             |
| `XDG_STATE_HOME` | `~/.local/state` | Unresolved reviews persist under `$XDG_STATE_HOME/caret/reviews/` and rehydrate on restart.                                               |

## Development

Requires [mise](https://mise.jdx.dev), which pins bun, biome, hk, and pkl.

```sh
mise run setup      # install pinned tools + JS deps + register git hooks
mise run build      # build:ui (Vite single-file) then build:bin (bun build --compile)
mise run dev        # isolated daemon + fake plan + Vite UI (dev port :42719)
mise run test       # bun test
mise run lint       # Biome + tsc + svelte-check (read-only); the CI/pre-commit gate
mise run format     # Biome (write)
mise run preflight  # format + lint + test + build before pushing
```

`mise run lint` (and the pre-commit hook) runs Biome lint, `tsc --noEmit`, and `svelte-check` —
type checking is folded into linting via `hk.pkl`.

`mise run dev` is self-contained — no separate `bin/caret daemon` needed. It starts an isolated
caret daemon on a dedicated dev port (`CARET_PORT`, default `42719`, distinct from the `42718`
production default) with an ephemeral `XDG_STATE_HOME`, seeds it with one fake pending plan, and
runs a driver that plays the agent's side so request-changes / approve round-trips keep working.
Everything is reaped on Ctrl-C, and the dev daemon never reads or writes a globally-installed
caret's reviews. Override the port with `CARET_DEV_PORT` if `42719` is taken.

For a quick local trial without installing, load the plugin from a checkout:

```sh
mise run build
claude --plugin-dir ./    # load caret's hooks for this session only
/reload-plugins           # if you rebuild while Claude is running
```

## Layout

```text
src/        cli.ts (subcommands) · daemon.ts (Bun.serve) · store.ts · decisions.ts
            reviews.ts (revision threading) · feedback.ts · paths.ts · types.ts
ui/         Svelte 5 single-file SPA (Vite + vite-plugin-singlefile)
hooks/      hooks.json (PermissionRequest/ExitPlanMode + PostToolUse/EnterPlanMode)
commands/   /caret:demo
scripts/    install.sh (build + register via the native plugin system)
```

The polished diff/compare viewer for plan versions is a planned fast-follow.

## License

MIT — see [LICENSE](LICENSE).
