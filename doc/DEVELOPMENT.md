# caret — Development

*Audience: contributors hacking on caret — building from source, the dev workflow, the
tasks CLI, and icons.*

Part of the deep reference behind [README.md](../README.md). For what caret is, how to
install it, and basic usage, start there. [CONTRIBUTING.md](../CONTRIBUTING.md) is the
one-page front door — prerequisites, the everyday tasks, and where tests live. This page
is the full catalog behind it.

> [!TIP]
> **`mise run dev` is the local development loop.** It runs the daemon and the UI straight
> from the _current_ checkout, so your edits are live with no rebuild — and it is fully
> isolated: an ephemeral port, an ephemeral state dir, and its own `config.dev.toml` — so
> it never touches, reads, or overwrites your installed caret. Reach for it by default.
>
> **`mise run build --install` overwrites your installed build.** It rewrites Claude Code
> plugin state, points OpenCode's `plugin` array at the checkout, and takes over the
> daemon. Reach for it only when you need to exercise the real installed integration — not
> to look at a UI change.

## Build from source

The [install path in the README](../README.md#install) ships prebuilt artifacts — the
`bun` bundle behind the plugin, and the published `@macintacos/caret` package — so you
never need a compiler to _use_ caret; `caret install` just registers those with your
agents. Build from source only when you want the platform-native compiled binary
(`bin/caret-native`, which the entrypoint shim prefers when it is present) or you are
hacking on caret itself. It uses the `mise` toolchain from a checkout:

```sh
git clone https://github.com/macintacos/caret.git
cd caret
mise run build            # compile bin/caret-native + build the UI
mise run build --install  # …then install THIS local build into your detected agent(s)
```

`mise run build --install` is the _install_ loop, not the development loop: it registers
the freshly built checkout with Claude Code (via a private dev marketplace) and OpenCode
and cycles the daemon — see [`mise run build --install`](#mise-run-build---install) below.
Day to day, reach for [`mise run dev`](#mise-run-dev) instead.

Prerequisites are [`git`](https://git-scm.com) and [mise](https://mise.jdx.dev); the first
`mise run` installs [`bun`](https://bun.sh) and the rest of the pinned toolchain. The
[`claude`](https://claude.com/claude-code) CLI is required only for the Claude target.

## Development

```sh
mise run setup      # install pinned tools + JS deps + the generated palette + e2e Chromium + register git hooks
mise run build      # build the UI (Vite multi-asset) then the binary (bun build --compile, embeds the UI)
mise run build ui   # just the Svelte UI (Vite -> ui/dist); also `build bin` / `build bundle`
mise run dev        # dev console: isolated daemon + three fake plans + Vite UI
mise run caret      # caret's own CLI from src/cli.ts, e.g. `mise run caret discovery`
mise run test       # bun test (unit); `mise run test unit` is the same target
mise run test e2e   # Playwright browser e2e (isolated daemon, Chromium)
mise run lint       # read-only gate: formatting + Biome lint + tsc + svelte-check
mise run format     # Biome (write)
mise run smoke      # smoke the shipped artifacts; also `smoke bin` / `smoke bundle`
mise run preflight  # pre-push gate: lint + tests (unit ∥ e2e) + build + smoke, scoped to the diff
```

### Bootstrapping a clone

A fresh clone can go straight to `mise run dev` or `mise run lint` — there is no setup
step to run first.

That works because every task sources `scripts/bootstrap.sh` before it reaches bun, so
whichever task you run first installs the pinned tools, the JS deps, and the generated
palette before doing its own job.

The one thing the bootstrap deliberately excludes is the e2e Chromium download, which is
why `mise run setup` exists alongside it — same three steps, plus Chromium. On a fresh
clone its own forwarder has already run the three, so it goes straight to the download.

One wrinkle worth knowing about ahead of time: in a non-interactive shell, a clone whose
mise config you have not trusted is a hard error rather than a prompt. `mise trust`
answers that up front.

The same preamble keeps an _existing_ clone current: when a pull moves `bun.lock` or
`package.json` ahead of your last install, the next task reinstalls the JS deps first — no
manual `mise run setup`, and no `Cannot find package` crash as your only hint. It tracks
that with a stamp file, `node_modules/.caret-deps`; delete it to reinstall.

### The lint gate

`mise run lint` — and the pre-commit hook — runs every formatter in read-only check mode
alongside Biome lint, `tsc --noEmit`, and `svelte-check`.

Formatting, linting, and type checking are all folded into `hk.pkl`'s `check` hook. That
is deliberate: an unformatted or tab-indented file fails the gate instead of being
silently reflowed at commit time, so what you committed is what you wrote.

**Two TypeScript majors are installed, and the gate uses the newer one.** Type checking
runs on TypeScript 7 (the Go port), which arrives as the `@typescript/native` alias, while
`typescript` stays at 6.x because `svelte-check` requires both. Your editor's language
service resolves `node_modules/typescript` — the 6.x one — so a green editor is not by
itself a green gate. To reproduce the gate locally, name the compiler it actually runs:
`bun node_modules/@typescript/native/bin/tsc --noEmit`. `package.json`'s `held` block has
the full reasoning.

### Generated files

Two files in the tree are generated, gitignored, and never hand-edited:

- `ui/src/styles/palette.generated.css` — emitted by `ui/generate-palette-css.ts` from
  `THEMES["caret-dark"]`, so the palette lives in exactly one place. `app.css` imports it
  for the caret-dark first-paint fallback.
- `src/ui-manifest.generated.ts` — the build-generated asset manifest.

Every task that consumes `app.css` runs the palette generator first: the Vite config (both
the build and the dev server), plus `mise run test`, `mise run lint`, `mise run format`,
and `mise run setup`. Lint and format need it because hk's Tailwind step loads `app.css`
as its theme and resolves that `@import`. So does the git pre-commit hook, which runs hk
directly — and is therefore the one path that expects the partial to already exist.

### `mise run dev`

The development loop. It is self-contained: no separate `bin/caret daemon` needed.

`mise run dev` starts an isolated daemon as `caret daemon --ephemeral`, which binds an
OS-assigned port. The dev task discovers the real port from the daemon's lock file
(`$XDG_STATE_HOME/caret/daemon.lock`, written after the bind) and exports it as
`CARET_PORT` before starting the driver and Vite. The state dir is an ephemeral
`XDG_STATE_HOME`, so any number of `mise run dev` sessions coexist — each claims its own
port and state dir, and Vite auto-increments its UI port per session. Everything is reaped
on Ctrl-C.

Open the UI at the `Local:` URL Vite prints on boot. Tell it from your installed build by
the **port**, not the host — Vite prints the same `caret.localhost` vanity origin the
installed build uses (EXC-426, cosmetic; the bind stays `localhost`). `42718` is the
installed daemon; anything else is your dev session. Vite's port is its own: it is not the
daemon port, and `--port` below does not pin it.

The isolation is total. The dev daemon never reads or writes a globally-installed caret's
reviews or config: it reads `config.dev.toml`, not your production `config.toml` (see
[Config file](CONFIGURING.md#config-file)).

The daemon is seeded with three fake pending plans, and a driver plays the agent's side
through the real review hook path — **Request changes** appends a revision section quoting
your feedback and resubmits, **Approve** re-seeds a fresh plan, and real hook records land
in the dev state dir's `logs/caret.log`.

#### Knobs

Where a knob has more than one source they resolve in order: a **flag** beats an
**environment variable**, which beats **`config.dev.toml`**, which beats the built-in
**default**. Arming the seeder is the exception — `--notify`, `[dev.notify].enabled`, and
a positive `CARET_DEV_NEW_REVIEW_MS` each arm it on their own, and none of them can turn
it off. The config keys are documented in full under
[The `[dev]` table](CONFIGURING.md#the-dev-table), and the environment variables under
[Dev-only](CONFIGURING.md#dev-only).

| Flag                | Env var                 | `config.dev.toml`        | Default   | Effect                                                                                    |
| ------------------- | ----------------------- | ------------------------ | --------- | ----------------------------------------------------------------------------------------- |
| `--port <n>`        | `CARET_DEV_PORT`        | `[dev].port`             | ephemeral | Bind a fixed daemon port instead of `--ephemeral`. Any free port but `42718` (the production default); one session at a time. |
| `--state-dir <dir>` | `CARET_DEV_STATE_DIR`   | `[dev].state_dir`        | ephemeral | Keep dev state across restarts.                                                           |
| `--persist`         | —                       | —                        | off       | Keep even the ephemeral state dir on exit, so you can read its `logs/caret.log`.          |
| `--notify`          | `CARET_DEV_NEW_REVIEW_MS` † | `[dev.notify].enabled` | off      | Arm the recurring extra-review seeder.                                                    |
| —                   | `CARET_DEV_NEW_REVIEW_MS` | `[dev.notify].interval_ms` | `15000` | Seeder cadence, in milliseconds.                                                          |
| —                   | —                       | `[dev.notify].max_pending` | `3`     | Cap on unresolved extra reviews.                                                          |
| `--num-versions <n>`| —                       | —                        | `4`       | How many versions the primary dev review opens with; a positive integer.                  |
| `--fresh`           | —                       | —                        | off       | Boot as a brand-new user — see below.                                                     |
| `--plain`           | —                       | —                        | off       | Skip the dev console and stream logs straight to the terminal, so they scroll and pipe.   |

† A positive `CARET_DEV_NEW_REVIEW_MS` also arms the seeder, not just sets its cadence.

#### The extra-review seeder

Off by default. Armed, it seeds a genuinely-new review — fresh session, fresh review id —
every 15 seconds, capped at three unresolved extras at a time. Grant notifications,
background the tab, and the next seed fires a clickable desktop notification. The driver
logs the seeder's armed/off state at boot either way.

> [!NOTE]
> Browser notification grants are per-origin **including the port**. When an orphaned dev
> server squats Vite's port and a new session auto-increments to the next one, the UI
> lands on a fresh origin whose permission is back to "default" — the bell shows "?" again
> and new plans log `plan notification skipped (permission)`. Re-grant via the bell, or
> kill the straggler holding the port (`lsof -nP -iTCP:5173 -sTCP:LISTEN`).

#### `--fresh`

`mise run dev --fresh` boots as a brand-new user: it ignores `config.dev.toml` (booting
from built-in defaults) and, via `CARET_FRESH`, tells the UI to clear its saved
preferences — theme back to the default, first-run onboarding shown again — so you can
re-test the new-user experience.

It cannot reset the browser's own notification permission (there is no page-level API for
that), but the dev origin is already separate from the installed build, so that permission
is independent regardless.

Every user-facing UI setting the browser persists is built through `definePref` /
`defineFlagPref` (`ui/src/lib/definePref.ts`), which registers its key so `--fresh` resets
it. `knownPrefKeys()` derives from those registrations, and `prefKeys.test.ts` fails if a
persisted key isn't registered.

#### The three plans, and injecting a fourth

Boot opens three pending plans, in the order the switcher lists them:

| Plan              | What it is                                               | Versions         |
| ----------------- | -------------------------------------------------------- | ---------------- |
| `fake-plan.md`    | The long markdown stress test — the showcase below       | `--num-versions` |
| `short-plan-a.md` | _Retry the worker health check before declaring it dead_ | 2                |
| `short-plan-b.md` | _Move the session cookie's expiry into config_           | 2                |

The big one is bootstrapped first and the daemon sorts pending reviews oldest-first, so it
stays at the top of the switcher and is the plan you land on. The two short ones exist to
give the switcher something to switch _to_ — ordinary small plans, deliberately short
enough that the dropdown and the version picker have realistic content without four extra
screens of markdown.

Each plan threads its own session and runs its own driver loop, so they never expire one
another: a verdict on one leaves the other two on screen, and approving one re-seeds that
loop's next plan, so you stay at three.

The switcher marks a plan **unread** — a dot on the trigger, a marker on its dropdown row
— when it shows up, or gains a version, while you are reading a different one; opening it
clears the mark. You can fire either event on demand from the terminal running
`mise run dev`, and watch it land in a browser tab that is already open.

#### The dev console

In a terminal, `mise run dev` takes over the screen: a header with the URL to open, the
keys you can press down the left, and the live log — daemon, Vite, and the driver,
interleaved — filling the rest.

The header names **two different ports**, which is the thing to get right:

```text
caret dev  ·  open  http://caret.localhost:5173  ·  daemon  :52241
```

`open` is Vite's dev server — the one to click, and the only one that serves the UI. Vite
picks that port itself and auto-increments when 5173 is taken, so it is read back from
Vite's own banner rather than chosen by the dev task. `daemon` is the review daemon's
ephemeral port: it is what the `?review=` links in the log point at, and it changes every
run. Opening the daemon port instead of the UI port is the easy mistake; the labels exist
to stop it.

Press a key in that terminal, with no Enter:

| Key           | What it does                                                             |
| ------------- | ------------------------------------------------------------------------ |
| `n`           | Seed a brand-new plan under a fresh session — a plan **arrives**         |
| `r`           | Request changes on the newest pending plan — that plan is **revised**    |
| `↑` `↓`       | Scroll the log a line                                                    |
| `PgUp` `PgDn` | Scroll the log a page                                                    |
| `G`           | Jump back to following the live tail                                     |
| `q`, `Ctrl-C` | Quit, tearing down the daemon, Vite, and the state dir                   |

`n` is the same one-shot the extra-review seeder above fires on a timer, so it produces a
review id the page has never seen. `r` targets the **newest** pending plan — the bottom of
the switcher, not the one you land on — whose own loop appends a `Revision N` section and
resubmits it under the same review id.

Taking the screen is what buys the fixed key list: a terminal can reserve rows but never
columns, so there is no way to pin a left-hand rail and still let output scroll past it
normally. That costs the terminal's own scrollback, which is why the log pane scrolls
itself. Because the keys are read raw, `Ctrl-C` is handled in the console rather than
arriving as a signal — it still tears the whole stack down.

**`mise run dev --plain` turns the console off** and streams logs straight to the terminal
— so they scroll with your terminal's own scrollback, copy, and pipe, which is what you
want when capturing output rather than driving the loop. The keys still work there, but in
line mode: `n` and `r` need Enter, because raw mode with no console to catch Ctrl-C would
leave nothing to quit with.

Piped or redirected, the console never starts in the first place:
`mise run dev > log.txt`, or any non-TTY run, keeps the plain interleaved output it always
had.

One artifact of `r`: the daemon's review list is pending-only, so between the
request-changes and the resubmit the plan is briefly absent. If the UI's 2s poll ticks
inside that sub-second window it sees the plan leave and come back, and marks it as an
arrival rather than a revision. The mark is right either way; only the event that produced
it differs.

#### The markdown showcase

The primary seed plan (`scripts/tasks/dev/fake-plan.md`) carries a `## Rendering showcase`
section near its end: one sub-heading per markdown construct — `Emphasis`, `Inline code`,
`Links`, `File and folder references`, `Paths that look like markup`, `Fenced blocks`,
`Task lists`, `Bullet and ordered lists`, `Quoted text`, `Tabular data`,
`Rules and separators`, `Images` — each short enough to screenshot whole. It is the fixed
surface plan-view rendering is compared against, so a change to how a plan is drawn has a
shared baseline instead of each change growing a throwaway fixture and reverting it.

Two of those sub-sections do double duty: `DEMO_EDITS` in `scripts/tasks/dev/protocol.ts`
reproduces the bodies of `Task lists` and `Rules and separators` verbatim so it can stub
them out in an older draft, which is what puts the showcase in the version-compare picker
as a block-shaped diff. Editing either body means editing that copy in the same change —
`test/scripts/dev-driver.test.ts` fails loudly if you don't.

The convention that goes with it: **a pull request that changes how the plan view renders
markdown names the showcase sub-heading its change is responsible for**, so a reviewer can
go from the diff straight to the rows it draws. Add a sub-heading when a new construct
starts being decorated rather than folding one into an existing row.

Three fence shapes are named there rather than armed, because a seeded plan cannot carry
them: an untagged fence is refused by the plan-format gate, and both a tilde fence and an
unclosed one are rewritten by the ingest reflow before the review is ever created. Their
rendering is covered by `ui/src/lib/diffview/codeBlocks.test.ts` instead.

### `mise run build --install`

The install loop: it swaps your agents over to this checkout. After building, it runs
`bin/caret install --from-local`, which:

1. Reuses the fresh `bin/caret-native` + `bin/ui` — never rebuilding them. A missing
   artifact is an error telling you to run `mise run build`.
2. Registers a local dev marketplace whose plugin source symlinks to the checkout, and
   reinstalls the caret plugin through Claude Code's native plugin system.
3. Installs into OpenCode by pointing its `plugin` array at the checkout
   (`file:<checkout>`, which OpenCode symlinks — so later rebuilds need no reinstall).
4. Acquires rumdl, and prewarms so the just-built binary takes over the daemon.

After a `/reload-plugins` (or a Claude Code restart), `/caret:*` resolves to your local
build.

Because it mutates your Claude plugin state and daemon, `--install` is for local
development only, never CI. `bin/caret install --from-local --dry-run` previews the
install steps without performing them.

Two things can leave an old build serving after a successful `--install`, and both look
identical from the browser. The first: the handoff retires a current-build daemon
automatically, but a long-running daemon from an _older_ build — no retire endpoint, no
lock file — can't be retired and keeps serving until you restart it once. `kill` its pid,
and any review respawns the fresh build. The second is below.

> [!WARNING]
> **Abandoned reviews hold an old build alive.** A `caret review` blocks until the
> reviewer decides or `[review].timeout_s` elapses — an hour by default — so closing the
> browser tab instead of deciding leaves the process running. A reconnecting client only
> ever _attaches_ to whichever daemon is serving, but one built before that rule takes
> over instead: it respawns its own daemon every time the poll drops, quietly reinstating
> the old build no matter how often you rebuild.
>
> If a fresh build's UI never appears, look for stragglers with
> `ps -eo pid,command | grep caret` and kill the `caret review` processes, not just the
> daemon.

### End-to-end tests

`mise run test e2e` runs the Playwright specs in `test/e2e/` against an isolated daemon
that serves the built `ui/dist/` artifact on an OS-assigned port with ephemeral state, so
the suite never touches your real daemon or `~/.local/state/caret`. It builds the UI first
(honouring `CARET_SKIP_BUILD_UI`), and `mise run setup` installs the Chromium the specs
drive.

For when to write an e2e spec versus a `bun test` unit versus throwaway exploration, see
[`agents/browser-testing.md`](agents/browser-testing.md).

### A quick trial without installing

To exercise caret's hooks from a checkout without registering anything, load the plugin
directly for one Claude Code session:

```sh
mise run build
claude --plugin-dir ./    # load caret's hooks for this session only
/reload-plugins           # if you rebuild while Claude is running
```

### The tasks CLI

The `.mise/tasks/*` file tasks are thin forwarders to a single
[Commander](https://github.com/tj/commander.js) CLI at `scripts/tasks/cli.ts` — the same
scaffolding (`src/lib/program.ts`) as the product CLI (`src/cli.ts`).

Each task file is a fresh-clone guard above a one-line exec: `.mise/tasks/dev` sources
`scripts/bootstrap.sh` and then execs `bun scripts/tasks/cli.ts dev "$@"`. The CLI owns
every flag's parsing, validation, defaults, and `--help`; the task stays trivial. Each
forwarder sets `#MISE raw_args=true` so mise hands every argument — including a bare
`--help` — straight to the CLI instead of intercepting it, which is why
`mise run dev --help` shows a subcommand's real flags with no `--` separator.

| Subcommand                                          | Module                          | Notes                                                                             |
| --------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------- |
| `dev`                                               | `scripts/tasks/dev/`            | The one multi-file task, so it keeps a folder rather than a single module.        |
| `build` — bare, `ui`, `bin`, `bundle`               | `scripts/tasks/build.ts`        | Bare is the umbrella; `mise run build bin` reaches a target.                      |
| `test` — bare / `unit`, `e2e`                       | `scripts/tasks/test.ts`         | Bare and `unit` are the same bun target; `e2e` is Playwright.                     |
| `smoke` — bare, `bin`, `bundle`                     | `scripts/tasks/smoke.ts`        | Bare smokes both artifacts.                                                       |
| `assets` — bare, `stitch`, `video`                  | `scripts/tasks/assets.ts`       | Regenerates the README hero image and demo recording. Needs ImageMagick and ffmpeg on `PATH`. |
| `lint`, `format`, `caret`                           | `scripts/tasks/lint.ts` et al.  | Passthroughs: operands and flags reach the underlying tool. Only `caret` forwards a bare `--help`. |
| `setup`                                             | `scripts/tasks/setup.ts`        | The bootstrap's three steps, plus the e2e Chromium.                               |
| `preflight`                                         | `scripts/preflight.ts`          | The one task with real Commander options: `--json`, `-v`, `--grep`, `--task`, `--full`. |
| `release` — `compute`, `baseline`, `prepare`, `finalize` | `scripts/tasks/release/command.ts` | JSON on stdout so `/release-caret` can parse it.                            |

Task modules are siblings of the CLI in `scripts/tasks/`, named after their group; the
table above names the two that are not. Code shared across tasks lives in
`scripts/tasks/lib/`: `exec.ts` (the `runForward` / `execAndExit` spawn helpers),
`signals.ts` (the cleanup-on-exit/signal wiring the supervising tasks share), and
`smoke-probe.ts` (the over-the-wire UI probe both smoke targets run). Every subcommand's
parsing contract is unit-tested in `test/scripts/tasks-cli.test.ts`.

Two groups diverge from the plain-module shape. `release` keeps its own JSON-on-stdout
error discipline — Commander help and errors to stderr, a typed JSON result per action —
so `/release-caret` can parse it, independent of the CLI's plain-stderr top-level
handling. And `preflight` forwards through `.mise/tasks/preflight` (`raw_args=true`) into
`caret-tasks preflight`, whose action hands the parsed flags to the gate orchestrator in
`scripts/preflight.ts`: the concurrent task DAG, the live listr2 display, and the `--json`
report builders.

`mise run dev`'s own orchestration lives in `scripts/tasks/dev/run.ts` — resolve the port
mode and state dir (`scripts/tasks/dev/dev-env.ts`), spawn the daemon, the tail that feeds
pino-pretty, and Vite, run the protocol driver in-process (so commander parses
`--num-versions` once, with no re-spawned child to reap), discover the daemon's bound port
from its lock, and reap every child on exit. The daemon writes its records to
`logs/daemon.log`, so the human-readable render tails that file rather than the daemon's
stderr, which inherits the terminal and carries only crash output. Note that `Bun.spawn`
snapshots `process.env` at startup and ignores later mutations, so env overrides
(`XDG_STATE_HOME`, `CARET_IDLE_MS`, `CARET_PORT`) are passed explicitly to each child
rather than set on `process.env`. The smoke targets (`scripts/tasks/smoke.ts`) follow the
same daemon-supervision pattern, and their shared over-the-wire probe is unit-tested in
`test/scripts/smoke-probe.test.ts`.

#### Task ordering

Ordering lives in the CLI, not in a mise `depends` edge (EXC-738/739/740).

The ui-dependent targets — `build bin`, `build bundle`, and `test e2e` — build the UI
themselves first, UNLESS `CARET_SKIP_BUILD_UI` is set; `smoke bin` and `smoke bundle`
build their artifact (via the tasks CLI) before smoking it. `scripts/preflight.ts` sets
`CARET_SKIP_BUILD_UI=1` on the dependents it spawns, so the gate builds the UI exactly
once — two concurrent Vite builds would race on `ui/dist`. Consolidating the per-variant
tasks into single multi-target `build`/`test`/`smoke` tasks is what made that possible.

The gate's DAG has one second-order edge: `smoke` waits on `build bin`, not on `build ui`
(EXC-914), and is spawned with `CARET_SKIP_BUILD_BIN=1` alongside the UI skip. That is the
sibling of `CARET_SKIP_BUILD_UI` one artifact up — `smoke bin` reuses the
`bin/caret-native` the gate's own `build bin` just compiled instead of compiling a second
one, so the only build smoke pays for in-gate is `build bundle`, which no other task runs.
`smoke` is deliberately last in the task array: listr2 fills its concurrency slots in
order, so a lower `CARET_PREFLIGHT_JOBS` can't park `smoke` in a slot while the
`build bin` it waits on is still queued.

#### Which tasks the gate runs

The gate scopes itself to the diff (EXC-1042). It reads the paths your working tree
changes against its merge base with `origin/HEAD` — the committed, staged and unstaged
diff, plus untracked files — and picks a task set from them:

- **Every changed path is Markdown, and none is on the exception list below** → `lint`
  alone. `build ui`, `build bin`, `test e2e` and `smoke` cannot see docs at all, and the
  remaining Markdown is read by no test.
- **…and one of them is on the exception list** → `lint` and `test`. A handful of Markdown
  files really are read from disk at test time, so `test` can observe a change to them.
  They are listed as `MARKDOWN_READ_BY_TESTS` in `scripts/preflight.ts`:
  `scripts/tasks/dev/fake-plan.md` (`test/scripts/dev-driver.test.ts` asserts on its
  content), `doc/ARCHITECTURE.md` (`test/adapters/opencode/docs-cache-path.test.ts` checks
  the `rm -rf` cache path it prints), `THIRD_PARTY_LICENSES.md`
  (`ui/src/lib/icons.test.ts` checks its table against the icon registry), and this page
  (`test/scripts/dev-driver.test.ts` checks the line citations the fake plan makes into
  it). **Add to that list whenever a test starts reading a Markdown file at run time** —
  the suite checks that each listed path still exists, but nothing can catch an omission,
  and an omission silently stops running a real check.
- **Anything else** → all six, exactly as before. That covers a non-Markdown path, an
  empty diff, and a diff that could not be read at all (no `origin/HEAD`, a shallow
  clone). The default is always the full gate; narrowing is an optimisation, never a
  weakening.

`mise run preflight --full` forces all six regardless. Unlike `-v` / `--grep` / `--task`,
it is not `--json`-only — the human display narrows too, so it needs the same escape
hatch.

The narrowing is never silent. In `--json` mode the `start` document carries a `selection`
object (`narrowed` plus a `reason`) alongside the shortened `tasks` list; the human
summary prints the same reason on a `scope:` line. This is also why the report
`schemaVersion` is `2`: `ok` now means "every task that ran passed", not "all six passed".

**Only _which tasks_ run is scoped — never which files a task sees.** Every task is still
spawned as a bare `mise run <task>`, and `lint` in particular must keep scanning the whole
tree: `rumdl` resolves an MD051 cross-file link fragment only when the file it points into
is in the same scan, so a lint handed just the changed files would quietly stop checking
every cross-file anchor whose target is unchanged. `doc/` is held together almost entirely
by those links.

#### Adding a task

1. Register a subcommand on the tasks CLI.
2. Put its logic in a `scripts/tasks/<name>.ts` module — shared helpers go in
   `scripts/tasks/lib/`.
3. Add a forwarder `.mise/tasks/<name>` — copy an existing one. It is the fresh-clone
   guard (`source .../scripts/bootstrap.sh || exit 1`) above
   `exec bun scripts/tasks/cli.ts <name> "$@"`, carrying `#MISE raw_args=true` so the CLI
   owns `--help`, plus any `#MISE description=` and `#MISE depends=[...]` the task needs.
4. Cover its parsing contract in `test/scripts/tasks-cli.test.ts`, alongside every other
   subcommand's.

The task file stays **bash**, not bun. mise derives the task name from the extensionless
filename, and an extensionless TypeScript file can be neither Biome-linted nor
`tsc`-typechecked, and falls outside the shell linters too — hk's shfmt and shellcheck
steps detect shell by shebang, so a bun-shebanged forwarder would be checked by nothing at
all. The trivial `exec` forwarder sidesteps all of that while keeping the real logic in
typed, tested TS.

That shape replaced per-task bash scripts carrying `#USAGE` flag specs. Those worked, but
were fragile: mise runs file tasks under macOS `/bin/bash` 3.2, where expanding an empty
`"${arr[@]}"` under `set -u` is a fatal "unbound variable". A flagless `mise run dev` once
aborted the task mid-boot and left Vite proxying to a killed daemon, and the smoke tasks
built exactly such arrays from the served asset list. A typed, unit-tested CLI removes
that whole class of footgun.

### Regenerating the README assets

The two artifacts under `doc/assets/` — the hero image and the demo recording — come out
of `mise run assets`, so refreshing them after the UI moves is a task run rather than a
hand-composed screenshot. It builds the UI, boots an isolated daemon on an ephemeral port,
and drives the shipped `ui/dist` through the Playwright library:

```sh
mise run assets          # both artifacts
mise run assets stitch   # just doc/assets/caret-review-ui.png
mise run assets video    # just doc/assets/caret-review-demo.mp4
```

`stitch` captures the plan view in four palettes — caret-dark, caret-light, dracula,
catppuccin-latte — and composites them into bands cut along parallel seams, stroked in the
live `--accent`. Two choices there are load-bearing rather than decorative. The palettes
**alternate dark and light**, because four of one scheme sit within a few RGB points of
each other, so adjacent bands merge and the seams vanish. And the seams run at **60°**,
steep enough that every one enters the frame's top edge and leaves its bottom edge: a
shallower cut exits through a side instead, which turns the outer bands into corner
triangles and makes evenly spaced seams produce visibly uneven bands.

`video` records the review arc, with the dev driver playing the agent's side through the
real hook path, so **Request changes** really appends a revision and **Approve** really
unblocks. It prints its frame count, rate and resolution; keep the duration under about a
minute.

Both artifacts render at **2× device pixels** so they stay crisp on a high-DPI display,
and the recording uses a narrower CSS viewport than the still — the UI lays out in CSS
pixels, so fewer of them across the window makes every glyph a larger fraction of the
frame. That is what makes a recording readable; resolution alone only makes small text
sharp.

Two host tools are required — **ImageMagick** for the stitch (`brew install imagemagick`)
and **ffmpeg** for the recording (`brew install ffmpeg`). Neither is pinned in
`mise.toml`: neither has an `aqua:` entry, and the registry alternatives would put a
multi-minute build in front of every fresh clone. Each target names its own missing tool
and the formula that installs it.

#### Publishing the recording

Only the stitch is committed. The recording is uploaded to GitHub and linked from the
README by its **attachment URL**, which keeps a multi-megabyte blob out of history on
every regeneration — and is the only form a reader can watch, since a repo path offers a
download and a file this size is past what GitHub's own file viewer will preview.
`caret-review-demo.mp4` is gitignored for that reason. To publish a new one:

1. Run `mise run assets video`.
2. Open any pull request or issue on the repo, and drag `doc/assets/caret-review-demo.mp4`
   into the comment box. GitHub uploads it and writes a
   `https://github.com/user-attachments/assets/…` URL into the box.
3. Put that URL in the README's link and **do not post the comment** — the upload has
   already happened, and the URL is permanent whether or not the comment is.

A **link**, not an embed: GitHub's markdown sanitizer strips `<video>` outright — relative
`src`, absolute `src`, and an attachment URL alike all render as an empty paragraph.

The old attachment stays live when a new one is uploaded, so a stale README shows the
previous recording rather than a broken link. Run the regeneration when the UI has
actually changed, not as a matter of course.

### Icons

caret's icons are [Lucide](https://lucide.dev) SVGs vendored verbatim at a pinned release
under `ui/src/icons/`, rendered by `ui/src/components/Icon.svelte`. Adding one means
following the checklist in [`agents/icon-rules.md`](agents/icon-rules.md) and adding a row
to [THIRD_PARTY_LICENSES.md](../THIRD_PARTY_LICENSES.md).
