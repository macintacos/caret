# caret

A Claude Code plugin that replaces the terminal plan-approval prompt with a local web UI. When Claude presents a plan via `ExitPlanMode`, caret opens it in your browser so you can read it rendered as HTML, **annotate passages inline** (Google-Docs style), and **approve** or **request changes**. Your decision — and all annotation feedback — flows straight back to the agent. A single local daemon is shared across concurrent Claude sessions, so several in-flight plans are reviewed from one browser tab via a switcher.

## How it works

caret ships one compiled binary (`bin/caret`) with three subcommands, wired to two plan-mode hooks:

| Hook | Matcher | Command | Purpose |
| --- | --- | --- | --- |
| `PostToolUse` | `EnterPlanMode` | `caret prewarm` | Warm-start the daemon when the model enters plan mode. |
| `PermissionRequest` | `ExitPlanMode` | `caret review` | Block, open the plan in the browser, return the decision. |

The `PermissionRequest`/`ExitPlanMode` hook intercepts the plan-approval request itself, so an **approve** auto-answers it (no native dialog) and a **request changes** returns the feedback to the model, which revises and re-presents (captured as a new version). This was verified empirically — `PreToolUse` does **not** work for this, because allowing the tool to run still shows the native dialog.

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

**Fail-safe = deny.** On a bad payload, an unreachable daemon, a timeout, a signal, or daemon death, caret emits `deny` with an explanation — it never auto-approves an unreviewed plan.

## Build

Requires [mise](https://mise.jdx.dev) (it pins bun, biome, hk, pkl).

```sh
mise run setup    # install tools + JS deps + register git hooks
mise run build    # build:ui (Vite single-file) then build:bin (bun build --compile)
```

`build` produces `bin/caret` with the UI embedded. The binary is platform-specific (built for your OS/arch).

## Try it

```sh
mise run build
claude --plugin-dir ./        # load caret's hooks (no marketplace needed)
/reload-plugins               # if you rebuild while Claude is running
/caret:demo                   # presents a short fake plan to exercise the flow
```

Enter plan mode, let Claude present a plan, and a browser tab opens at the deep-linked review. Select text to comment, then **Approve** (optionally "& accept edits" or "& auto mode") or **Request changes**.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `CARET_PORT` | `42718` | Daemon port. |
| `CARET_TIMEOUT` | `300` (s) | Review timeout before the hook fail-safe-denies (must stay below the 600s hook budget). |
| `CARET_IDLE_MS` | `60000` | Idle delay before the daemon auto-shuts-down with no reviews. |
| `XDG_STATE_HOME` | `~/.local/state` | Unresolved reviews persist under `$XDG_STATE_HOME/caret/reviews/` and rehydrate on restart. |

## Development

```sh
mise run dev        # Vite UI dev server (proxies /api to the daemon on :42718)
mise run test       # bun test
mise run lint       # biome (read-only)
mise run typecheck  # tsc --noEmit
mise run preflight  # lint + typecheck + test
```

For UI dev, run a daemon (`bin/caret daemon`) alongside `mise run dev`.

## Layout

```text
src/        cli.ts (subcommands) · daemon.ts (Bun.serve) · store.ts · decisions.ts
            reviews.ts (revision threading) · feedback.ts · paths.ts · types.ts
ui/         Svelte 5 single-file SPA (Vite + vite-plugin-singlefile)
hooks/      hooks.json (PermissionRequest/ExitPlanMode + PostToolUse/EnterPlanMode)
commands/   /caret:demo
```

The polished diff/compare viewer for plan versions is a planned fast-follow.
