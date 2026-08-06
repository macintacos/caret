# caret — Development

*Audience: contributors hacking on caret — building from source, the dev workflow, the
tasks CLI, and icons.*

Part of the deep reference behind [README.md](../README.md). For what caret is, how to
install it, and basic usage, start there.

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
and cycles the daemon — see [Development](#development) below and
[CONTRIBUTING.md](../CONTRIBUTING.md). Day to day, reach for `mise run dev` instead. It
needs [`git`](https://git-scm.com) and [mise](https://mise.jdx.dev) — the first `mise run`
installs [`bun`](https://bun.sh) and the rest of the pinned toolchain; the
[`claude`](https://claude.com/claude-code) CLI is required only for the Claude target.

## Development

Requires [mise](https://mise.jdx.dev), which pins bun, biome, hk, and pkl.

```sh
mise run setup      # install pinned tools + JS deps + the generated palette + e2e Chromium + register git hooks
mise run build      # build the UI (Vite multi-asset) then the binary (bun build --compile, embeds the UI)
mise run build ui   # just the Svelte UI (Vite -> ui/dist); also `build bin` / `build bundle`
mise run dev        # isolated daemon + fake plan + Vite UI (ephemeral port)
mise run caret      # caret's own CLI from src/cli.ts, e.g. `mise run caret discovery`
mise run test       # bun test (unit); `mise run test unit` is the same target
mise run test e2e   # Playwright browser e2e (isolated daemon, Chromium)
mise run lint       # read-only gate: formatting + Biome lint + tsc + svelte-check
mise run format     # Biome (write)
mise run smoke      # smoke the shipped artifacts; also `smoke bin` / `smoke bundle`
mise run preflight  # pre-push gate: lint + tests (unit ∥ e2e) + build + smoke, concurrent
```

Past git, mise is the only prerequisite. Every task sources `scripts/bootstrap.sh` before
it reaches bun, so the first one run in a fresh clone installs the pinned tools, JS deps,
and the generated palette before doing its own job — a clone can go straight to
`mise run build --install` or `mise run lint` with no separate setup step.
`mise run setup` runs those same three steps and adds the e2e Chromium download the
bootstrap deliberately excludes; on a fresh clone its own forwarder has already run those
three, so it goes straight to Chromium. mise does ask you to trust the clone's config the
first time; `mise trust` answers that up front, and in a non-interactive shell an
untrusted config is a hard error rather than a prompt.

`mise run lint` (and the pre-commit hook) runs every formatter in read-only check mode
alongside Biome lint, `tsc --noEmit`, and `svelte-check` — formatting, linting, and type
checking are all folded into `hk.pkl`'s `check` hook, so an unformatted or tab-indented
file fails the gate instead of being silently reflowed at commit time.

`ui/src/styles/palette.generated.css` is generated, not committed: `app.css` imports it
for the caret-dark first-paint fallback, and `ui/generate-palette-css.ts` emits it from
`THEMES["caret-dark"]` so the palette lives in one place. Every task that consumes
`app.css` runs the generator first — the Vite config (build and dev server), plus
`mise run test`, `mise run lint`, `mise run format`, and `mise run setup`. The lint and
format tasks need it because hk's Tailwind step loads `app.css` as its theme and resolves
that `@import`; so does the git pre-commit hook, which runs hk directly and is therefore
the one path that expects the partial to already exist. Like the build-generated asset
manifest (`src/ui-manifest.generated.ts`), it is gitignored and never hand-edited.

`mise run build --install` goes one step further than `mise run build`: after building, it
runs `bin/caret install --from-local`, which reuses the fresh `bin/caret-native` +
`bin/ui` (never rebuilding them — a missing artifact is an error telling you to run
`mise run build`), registers a local dev marketplace whose plugin source symlinks to the
checkout, reinstalls the caret plugin through Claude Code's native plugin system, installs
into OpenCode by pointing its `plugin` array at the checkout (`file:<checkout>`, which
OpenCode symlinks — so later rebuilds need no reinstall), acquires rumdl, and prewarms so
the just-built binary takes over the daemon — so after a `/reload-plugins` (or a Claude
Code restart) `/caret:*` resolves to your local build. The handoff retires a current-build
daemon automatically; a long-running daemon from an older build (no retire endpoint, no
lock file) can't be retired and keeps serving until you restart it once — `kill` its pid,
then any review respawns the fresh build.

**Abandoned reviews hold an old build alive.** A `caret review` blocks until the reviewer
decides or `[review].timeout_s` elapses (an hour by default), so closing the browser tab
instead of deciding leaves the process running. A reconnecting client only ever _attaches_
to whichever daemon is serving, but one built before that rule takes over instead: it
respawns its own daemon every time the poll drops, which quietly reinstates the old build
no matter how often you rebuild. If a fresh build's UI never appears, look for stragglers
with `ps -eo pid,command | grep caret` and kill the `caret review` processes, not just the
daemon.

`mise run build --install` mutates your Claude plugin state and daemon, so it is for local
development only, not CI; run `bin/caret install --from-local --dry-run` to preview the
install steps without performing them.

`mise run dev` is self-contained — no separate `bin/caret daemon` needed. It starts an
isolated caret daemon as `caret daemon --ephemeral`, which binds an OS-assigned port; the
dev task discovers the real port from the daemon's lock file
(`$XDG_STATE_HOME/caret/daemon.lock`, written after the bind) and exports it as
`CARET_PORT` before starting the driver and Vite. The state dir is an ephemeral
`XDG_STATE_HOME`, so any number of `mise run dev` sessions coexist — each claims its own
port and state dir, and Vite auto-increments its UI port per session. The daemon is seeded
with one fake pending plan, and a driver plays the agent's side through the real review
hook path: each request-changes appends a revision section quoting your feedback and
resubmits, and approve re-seeds a fresh plan, with real hook records landing in the dev
state dir's `caret.log`. The recurring extra-review seeder is off by default. Arm it three
ways: pass `mise run dev --notify`, set `enabled = true` under `[dev.notify]` in
`config.dev.toml` to persist it on across runs, or set a positive
`CARET_DEV_NEW_REVIEW_MS`. When armed, it seeds a genuinely-new review (fresh session,
fresh review id) every 15 seconds by default, capped at three unresolved extras at a time
— grant notifications, background the tab, and the next seed fires a clickable desktop
notification. The cadence and the pending cap come from `[dev.notify]` (`interval_ms` /
`max_pending`), and `CARET_DEV_NEW_REVIEW_MS` overrides the cadence; the driver logs the
seeder's armed/off state at boot either way. One notification gotcha: browser notification
grants are per-origin **including the port**, so when an orphaned dev server squats Vite's
port and a new session auto-increments to the next one, the UI lands on a fresh origin
whose permission is back to "default" — the bell shows the "?" again and new plans log
`plan notification skipped (permission)`. Re-grant via the bell, or kill the straggler
holding the port (`lsof -nP -iTCP:5173 -sTCP:LISTEN`). Everything is reaped on Ctrl-C, and
the dev daemon never reads or writes a globally-installed caret's reviews or config — it
reads `config.dev.toml`, not your production `config.toml` (see
[Config file](CONFIGURING.md#config-file)). To pin a fixed dev port instead, set
`CARET_DEV_PORT` (or `[dev].port` in `config.dev.toml`) to any free port other than
`42718` (the production default); this skips `--ephemeral` and binds that port, so only
one such session can run at a time. Likewise, set `CARET_DEV_STATE_DIR` (or
`[dev].state_dir`) to keep dev state across restarts instead of the ephemeral default. The
same three knobs are also `mise run dev` flags — `--port <n>`, `--state-dir <dir>`, and
`--persist` — which take precedence over the environment variables and the `[dev]` config;
`--persist` keeps even the ephemeral default state dir on exit (so you can inspect its
`caret.log`) rather than wiping it.

`mise run dev --fresh` boots as a brand-new user: it ignores `config.dev.toml` (booting
from built-in defaults) and, via `CARET_FRESH`, tells the UI to clear its saved
preferences — theme back to the default, and first-run onboarding shown again — so you can
re-test the new-user experience. It cannot reset the browser's own notification permission
(no page-level API), but the dev origin is already separate from the installed build, so
that permission is independent regardless. Every user-facing UI setting the browser
persists is built through `definePref` / `defineFlagPref` (`ui/src/lib/definePref.ts`),
which registers its key so `--fresh` resets it; `knownPrefKeys()` derives from those
registrations and `prefKeys.test.ts` fails if a persisted key isn't registered.

`mise run test e2e` runs the Playwright specs in `test/e2e/` against an isolated daemon
that serves the built `ui/dist/` artifact on an OS-assigned port with ephemeral state, so
the suite never touches your real daemon or `~/.local/state/caret`. It builds the UI first
(honouring `CARET_SKIP_BUILD_UI`). `mise run setup` installs the Chromium browser the
specs drive. For when to write an e2e spec versus a `bun test` unit versus throwaway
exploration, see `agents/browser-testing.md`.

For a quick local trial without installing, load the plugin from a checkout:

```sh
mise run build
claude --plugin-dir ./    # load caret's hooks for this session only
/reload-plugins           # if you rebuild while Claude is running
```

### The tasks CLI

The `.mise/tasks/*` file tasks are thin forwarders to a single
[Commander](https://github.com/tj/commander.js) CLI at `scripts/tasks/cli.ts` — the same
scaffolding (`src/lib/program.ts`) as the product CLI (`src/cli.ts`). Each task file is a
fresh-clone guard above a one-line exec: `.mise/tasks/dev` sources `scripts/bootstrap.sh`
(see [Development](#development)) and then execs `bun scripts/tasks/cli.ts dev "$@"`, so
the CLI owns every flag's parsing, validation, defaults, and `--help`, and the task stays
trivial. Each forwarder sets `#MISE raw_args=true` so mise hands every argument —
including a bare `--help` — straight to the CLI instead of intercepting it, so
`mise run dev --help` shows a subcommand's real flags with no `--` separator.

The CLI hosts `dev`; the `build` group (bare umbrella plus the `ui`/`bin`/`bundle`
targets, `mise run build bin`); the `test` group (bare/`unit` = bun, `e2e` = Playwright);
the `smoke` group (bare = both, plus `bin`/`bundle`); `lint`, `format`, `setup`,
`preflight`; and the nested `release` group (`compute|baseline|prepare|finalize`). Every
task module is a sibling of the CLI in `scripts/tasks/` — one file per task group, named
after it (e.g. `scripts/tasks/build.ts`, `scripts/tasks/smoke.ts`) — except the larger,
multi-file `dev` task, which keeps its own `scripts/tasks/dev/` folder. Code shared across
tasks lives in `scripts/tasks/lib/`: `exec.ts` (the `runForward` / `execAndExit` spawn
helpers), `signals.ts` (the cleanup-on-exit/signal wiring the supervising tasks share),
and `smoke-probe.ts` (the over-the-wire UI probe both smoke targets run). Every
subcommand's parsing contract is unit-tested in `test/scripts/tasks-cli.test.ts`. The
`release` subcommand group lives in `scripts/tasks/release/command.ts` and keeps its own
JSON-on-stdout error discipline (Commander help/errors to stderr, a typed JSON result per
action) so `/release-caret` can parse it, independent of the CLI's plain-stderr top-level
handling. The `preflight` gate is a CLI subcommand too, but unlike the passthrough tasks
its `--json` / `-v` / `--grep` / `--task` flags are real Commander options — the interface
the task's mise `usage` spec once carried via `usage_*` env vars. `mise run preflight`
forwards through `.mise/tasks/preflight` (`raw_args=true`) into `caret-tasks preflight`,
whose action hands the parsed flags to the gate orchestrator in `scripts/preflight.ts`
(the concurrent task DAG, the live listr2 display, and the `--json` report builders).

Task ordering lives in the CLI, not a mise `depends` edge (EXC-738/739/740): the
ui-dependent targets — `build bin`, `build bundle`, and `test e2e` — build the UI
themselves first, UNLESS `CARET_SKIP_BUILD_UI` is set, and `smoke bin`/`smoke bundle`
build their artifact (via the tasks CLI) before smoking it. `scripts/preflight.ts` sets
`CARET_SKIP_BUILD_UI=1` on the dependents it spawns so the gate builds the UI exactly once
(two concurrent Vite builds would race on `ui/dist`). This is why the per-variant tasks
were consolidated into single multi-target `build`/`test`/`smoke` tasks.

The gate's DAG has one second-order edge: `smoke` waits on `build bin`, not on `build ui`
(EXC-914), and is spawned with `CARET_SKIP_BUILD_BIN=1` alongside the UI skip. That is the
sibling of `CARET_SKIP_BUILD_UI` one artifact up — `smoke bin` reuses the
`bin/caret-native` the gate's own `build bin` just compiled instead of compiling a second
one, so the only build smoke pays for in-gate is `build bundle`, which no other task runs.
`smoke` is deliberately last in the task array: listr2 fills its concurrency slots in
order, so a lower `CARET_PREFLIGHT_JOBS` can't park `smoke` in a slot while the
`build bin` it waits on is still queued.

`mise run dev` takes `--num-versions <n>` (how many versions the primary dev review opens
with; default 4, a positive integer), `--notify` (arm the extra-review seeder), and
`--port` / `--state-dir` / `--persist` (the port, state dir, and state-persistence
overrides described under [Configuration](CONFIGURING.md#config-file)). Its orchestration
— resolve the port mode and state dir (`scripts/tasks/dev/dev-env.ts`), spawn the daemon,
pino-pretty, and Vite, run the protocol driver in-process (so commander parses
`--num-versions` once, with no re-spawned child to reap), discover the daemon's bound port
from its lock, and reap every child on exit — lives in `scripts/tasks/dev/run.ts`. Note
`Bun.spawn` snapshots `process.env` at startup and ignores later mutations, so env
overrides (`XDG_STATE_HOME`, `CARET_IDLE_MS`, `CARET_PORT`) are passed explicitly to each
child rather than set on `process.env`; the smoke targets (`scripts/tasks/smoke.ts`)
follow the same daemon-supervision pattern, and their shared over-the-wire probe is
unit-tested in `test/scripts/smoke-probe.test.ts`.

This replaces per-task bash scripts carrying `#USAGE` flag specs. Those worked but were
fragile: mise runs file tasks under macOS `/bin/bash` 3.2, where expanding an empty
`"${arr[@]}"` under `set -u` is a fatal "unbound variable" — a flagless `mise run dev`
once aborted the task mid-boot and left Vite proxying to a killed daemon, and the smoke
tasks built exactly such arrays from the served asset list. A typed, unit-tested CLI
removes that whole class of footgun.

To add a task: register a subcommand on the tasks CLI, put its logic in a
`scripts/tasks/<name>.ts` module (shared helpers go in `scripts/tasks/lib/`), and add a
one-line forwarder `.mise/tasks/<name>` = `exec bun scripts/tasks/cli.ts <name> "$@"`
(carrying `#MISE raw_args=true` so the CLI owns `--help`, plus any `#MISE description=`
and `#MISE depends=[...]` the task needs). The task file stays **bash**, not bun: mise
derives the task name from the extensionless filename, and an extensionless TypeScript
file can be neither Biome-linted nor `tsc`-typechecked and breaks the shell linters
(`hk.pkl` globs `.mise/tasks/*` as shell). The trivial `exec` forwarder sidesteps all of
that while keeping the real logic in typed, tested TS.

### Icons

caret's icons are [Lucide](https://lucide.dev) SVGs vendored verbatim at a pinned release
under `ui/src/icons/`, rendered by `ui/src/components/Icon.svelte`. Adding one means
following the checklist in `agents/icon-rules.md` and adding a row to
[THIRD_PARTY_LICENSES.md](../THIRD_PARTY_LICENSES.md).
