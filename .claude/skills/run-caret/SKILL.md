---
name: run-caret
description: Launch a local caret dev instance and open its review UI in the browser. Starts `mise run dev` in the background, waits until Vite reports the dev UI is ready, resolves the dev URL (the Vite dev origin on localhost — not the installed build's caret.localhost:42718 vanity origin), opens the browser, and leaves dev running. Triggers on "/run-caret", "run caret", "launch caret", "open the caret UI", "boot caret dev", "start a caret dev instance".
argument-hint: "[in-UI action to perform after launch]"
---

# Run caret

Boot a local caret dev instance and open its review UI in one step. The skill orchestrates
the existing `mise run dev` task — it adds no new behavior to caret and never edits the
dev task itself. Its whole job is: launch dev in the background, wait for the UI to come
up, resolve the dev URL, and open it — leaving dev running so the UI stays usable after
the skill returns.

By **default the skill only launches dev and opens the browser**. It drives the UI
(clicking, typing, navigating within the app) only on demand — see § Driving the UI.

## Arguments

`/run-caret [in-UI action to perform after launch]`

- **No argument** — launch dev and open the browser at the dev URL. Stop there; do not
  click through the UI.
- **An instruction** (e.g. `/run-caret open the latest review and approve the plan`) —
  launch + open as above, then drive the UI to carry out the instruction via
  `/superpowers-chrome:browsing` (see § Driving the UI).

## Why a dedicated skill

Running caret for a quick look is otherwise a multi-step ritual: start `mise run dev`,
wait for the daemon + Vite server to come up, pick the right URL, and open it. Two URL
traps make "pick the right URL" error-prone, and getting them right every time is the
reason this skill exists:

- **Dev origin, not the installed build.** The installed binary serves caret at the vanity
  origin `caret.localhost:42718` (the daemon's production default port). That is _not_
  what `mise run dev` serves — open the **dev Vite origin** instead, or you are looking at
  a stale installed build rather than your working tree.
- **The port shifts.** Vite sets no fixed `server.port` (see `ui/vite.config.ts`), so it
  uses `5173` by default but moves to `5174`, `5175`, … when the port is already taken.
  Never hardcode the port — always read it from the launch output (step 3).

## Steps

### 1. Launch `mise run dev` in the background

Start it with the Bash tool using `run_in_background: true` so the dev server keeps
running after the skill returns, and note the task's **output file path** (it captures
combined stdout + stderr):

```sh
mise run dev
```

If a caret dev instance from an earlier `/run-caret` in this session is already up, reuse
it instead of launching a second — the dev task warns that two sessions sharing a
persistent state dir clobber each other's `daemon.lock`.

### 2. Wait until the UI is ready (do not assume a fixed delay)

Readiness is the moment Vite prints its **`Local:`** banner line. Wait for it with a
bounded background poll that exits the instant the line appears (the "tell me when it's
ready" pattern — one completion notification, no fixed sleep):

```sh
until grep -qE 'Local:.*localhost:[0-9]+' "<dev-output-file>"; do sleep 0.5; done
```

If `mise run dev` exits before that line appears, surface the captured log — it failed to
boot; do not declare success.

### 3. Resolve and surface the dev URL

Parse the port from the `Local:` line and build the dev URL on `localhost`. Vite's dev
banner prints the cosmetic vanity host `caret.localhost:<port>` (EXC-426), so match on the
port rather than the literal host, and normalize to `localhost`:

```sh
port=$(grep -m1 'Local:' "<dev-output-file>" \
  | grep -oE 'localhost:[0-9]+' | head -1 | cut -d: -f2)
url="http://localhost:$port"
echo "caret dev UI: $url"
```

Surface `$url` to the user.

### 4. Open the browser

```sh
open "$url"
```

Leave `mise run dev` running. The skill is done — report the URL and that dev is still up.
Do **not** click through the UI.

## Driving the UI

Drive the UI only when **either** holds:

- the user explicitly asked for an in-UI action (passed an instruction argument, or asks
  during the session), **or**
- an agent is running this skill to verify some functionality against a live instance.

In those cases, use `/superpowers-chrome:browsing` to navigate to `$url` and perform the
action. Outside those cases the skill stops after opening the browser (step 4).

## Guardrails

- The skill never edits `mise run dev` and adds no caret features — it only orchestrates
  the existing task.
- Always resolve the port from the launch output; never hardcode `5173`.
- Open the dev Vite origin, never the installed build's `caret.localhost:42718`.
- Leave dev running on success; tear it down only if you started it solely to verify
  something and the user (or the agent that ran the skill) is done with it.
