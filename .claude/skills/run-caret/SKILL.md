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
  `/playwright-cli` (see § Driving the UI).

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
running after the skill returns. The Bash tool writes the task's combined stdout + stderr
to an output file and returns its path — call that `<dev-output-file>` in the steps below.
Launch with `NO_COLOR=1` so Vite's banner stays plain text: under forced color (a CI
environment, `FORCE_COLOR`, or a PTY-backed shell) Vite wraps the `Local:` label and the
port digits in ANSI escapes, which would defeat the plain-text greps in steps 2–3.

```sh
NO_COLOR=1 mise run dev
```

If a caret dev instance from an earlier `/run-caret` in this session is already up, reuse
it instead of launching a second — the dev task warns that two sessions sharing a
persistent state dir clobber each other's `daemon.lock`.

### 2. Wait until the UI is ready (do not assume a fixed delay)

Readiness is the moment Vite prints its **`Local:`** banner line. Wait for it with a
bounded background poll that exits the instant the line appears (the "tell me when it's
ready" pattern — one completion notification, no fixed delay) but gives up after a
deadline so a wedged boot can't hang the skill:

```sh
deadline=$((SECONDS + 90))
until grep -qE 'Local:.*localhost:[0-9]+' "<dev-output-file>"; do
  [ "$SECONDS" -ge "$deadline" ] && { echo "caret dev not ready after 90s"; break; }
  sleep 0.5
done
```

If the deadline passes — or `mise run dev` exits — before that line appears, surface the
captured log: dev failed to boot. Do not declare success. (A crash surfaces on its own —
the Bash tool notifies you when the background task exits — so 90s is only the upper
bound, not the wait you sit through on a failed boot.)

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
open "$url"   # macOS; on Linux use `xdg-open "$url"`
```

Leave `mise run dev` running. The skill is done — report the URL and that dev is still up.
Do **not** click through the UI.

## Driving the UI

Drive the UI only when **either** holds:

- the user explicitly asked for an in-UI action (passed an instruction argument, or asks
  during the session), **or**
- an agent is running this skill to verify some functionality against a live instance.

In those cases, use `/playwright-cli` to navigate to `$url` and perform the action.
Outside those cases the skill stops after opening the browser (step 4).

## An isolated instance, for verification under concurrency

Everything above shares one persistent state dir — which is why step 1 says to reuse a
running dev instance rather than launch a second. That makes `mise run dev` the wrong tool
whenever another agent may also be running caret: two of them clobber each other's
`daemon.lock`, and the failure surfaces minutes later as an app that stopped responding
rather than as a boot error.

When an agent needs a live instance **to verify a change** — the case that has to work
while siblings are doing the same — boot the e2e daemon under its own state dir instead.
It is the same `createServer` the production daemon uses (see
`test/e2e/support/daemon-entry.ts` for why the boot path is deliberately separate), it
takes an OS-assigned port, and it reads no `config.toml`, so nothing about the developer's
own setup leaks in.

### 1. Build the UI it will serve

The daemon serves the built artifact and resolves it once at boot, so build before booting
and reboot after any later UI change:

```sh
mise run build ui
```

### 2. Boot it, holding stdin open

The daemon self-reaps when stdin closes. That matters more than it looks:
**`… &` inside a Bash call closes the pipe when the call returns**, and the daemon dies a
few minutes later — mid-drive, so it reads as a flaky app rather than a dead server. Run
it as the **foreground command of a backgrounded Bash call** instead, with `sleep` holding
stdin:

```sh
sleep 100000 | env XDG_STATE_HOME="$(mktemp -d)" bun test/e2e/support/daemon-entry.ts
```

It refuses to start without `XDG_STATE_HOME`, so the real `~/.local/state/caret` can never
be touched. Give every instance its own directory — sharing one is the same clobbering
problem in a new hat.

### 3. Read the port from the handshake

stdout carries exactly one JSON line; all logs go to stderr so the handshake cannot be
corrupted:

```sh
port=$(grep -o '{"port":[0-9]*}' "<daemon-output-file>" | head -1 | grep -o '[0-9]*')
```

### 4. Seed a review

The same `POST /api/reviews` the hook makes. `cwd` is what file references resolve against
— point it at a real checkout and a plan citing `path:line` gets working references:

```sh
curl -s -X POST "http://127.0.0.1:$port/api/reviews" \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"<uuid>","cwd":"<abs path>","plan":"# Plan\n\nSee `src/x.ts:42`.\n"}'
```

### 5. Skip onboarding before any focus work

The first-run notifications dialog **traps focus**. Any tab-order, keyboard or focus-ring
check will otherwise spend its whole budget on "Enable notifications" / "Maybe later":

```js
localStorage.setItem("caret.onboarded", "1"); // then reload
```

The committed e2e fixture does not need this — the dialog never appears there — so it is
not discoverable from the specs. It applies to the ad-hoc instance only.

### 6. Tear down

Close the browser, kill the daemon (`pkill -f daemon-entry.ts`), and remove the state dir
and any `.playwright-cli/` artifacts. Commit none of them.

### Measuring one

Two Bun traps, both of which fail quietly rather than loudly:

- **`process.memoryUsage().heapUsed` does not count JSC strings.** A measurement over
  string-heavy work — file contents, highlighted HTML — reports a number near zero and
  looks like a result. Use `heapStats().heapSize` from `bun:jsc`, which counts them.
- **A Bun script piping to a file block-buffers stdout**, so a long measurement shows
  nothing until it exits. Write results incrementally with `appendFileSync`, and run one
  case per process under `timeout` so a pathological case costs one case rather than the
  whole run.

## Guardrails

- The skill never edits `mise run dev` and adds no caret features — it only orchestrates
  the existing task.
- Always resolve the port from the launch output; never hardcode `5173`.
- Open the dev Vite origin, never the installed build's `caret.localhost:42718`.
- Leave dev running on success; tear it down only if you started it solely to verify
  something and the user (or the agent that ran the skill) is done with it. To tear down,
  stop the backgrounded launch (e.g. `TaskStop`, or `SIGTERM` the `mise run dev` process)
  — the dev task traps the signal and reaps the daemon, driver, and Vite together.
