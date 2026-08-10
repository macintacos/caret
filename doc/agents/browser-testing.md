# Browser Testing Rules

caret has two committed test layers plus an ad-hoc exploration path. Picking the wrong one
is the common mistake: an assertion about real rendering goes stale as a unit test, and
pure logic dressed up as an e2e spec is slow and flaky. Decide by what you are actually
testing (EXC-453):

- **Real browser behavior** — text selection, focus/keyboard handling, scroll, popover
  positioning, and timing-driven UI (the 2s decision poll, the 500ms autosave debounce,
  safe mode's 300ms grace window and 2s suppression) → a **committed Playwright spec** in
  `test/e2e/*.e2e.ts`. Run: `mise run test e2e`.
- **Pure logic** — parsing, anchoring math, formatting, state machines → a
  **`bun test` unit** (happy-dom when a DOM API is needed, wired by `ui/test-setup.ts`).
  One runner covers both backend and UI suites; the component suite additionally needs the
  `--conditions browser` flag (carried by `mise run test` / `package.json`'s `test`), and
  bare `bun test` fails component mounts with an actionable error. The keep-one-runner
  decision and the flag's mechanics live in `svelte-rules.md`.
- **Throwaway exploration** — "what does this page actually do?" → the ad-hoc
  `playwright-cli` skill. Its scripts and output are **never committed**; reach for it to
  learn, then write the real test in one of the two layers above.

## Spec naming

Specs are named `*.e2e.ts`, deliberately distinct from the unit suffixes. `bun test`
collects `*.test.ts` **and** `*.spec.ts` repo-wide, so a Playwright spec under either of
those names would be swept into the unit runner and crash it. `.e2e.ts` keeps the two
runners disjoint — Playwright owns `test/e2e/`, `bun test` owns the rest.

## The harness contract

Every spec goes through `test/e2e/support/fixtures.ts`; never stand up a daemon by hand
inside a spec.

- **Per-test isolated daemon.** The fixture boots a fresh daemon on an OS-assigned port
  (port 0), serving the built `ui/dist/` tree (index plus its hashed assets), with an
  ephemeral `XDG_STATE_HOME` wiped at teardown and idle shutdown disabled. The user's real
  daemon (`:42718`) and `~/.local/state/caret` are never touched. This boot lives in
  `test/e2e/support/daemon-entry.ts`, a second daemon-boot path deliberately kept
  alongside the production `runDaemon` (`src/commands/daemon.ts`): the e2e boot needs an
  OS-assigned port (the settings `Port` schema rejects 0, so only a direct `createServer`
  can ask for one), config hermeticity (no `config.toml` read), a never-idle daemon with a
  no-op shutdown (so it can't `process.exit` mid-test), and a stdout port handshake.
  Collapsing the two behind a shared factory would parameterize it across every one of
  those deltas — speculative abstraction for one extra call site — so the parallel boot is
  documented current-state in `daemon-entry.ts`'s header rather than abstracted away
  (EXC-547).
- **Seed through the public API.** Reviews are created by `POST /api/reviews`, the same
  surface a real hook uses — never by reaching into the store directly.
- **No external daemon, no dev driver.** A spec must not reuse a running daemon, depend on
  `mise run dev`, or drive the dev driver. The `test e2e` task builds the UI first, so
  specs always exercise the shipped artifact, not a Vite dev server.

## Timing discipline

The split mirrors the test layers:

- **e2e uses auto-retrying, web-first assertions** (`expect(locator).toBeVisible()` and
  friends), which absorb the poll, debounce, and grace windows on their own. **Never**
  `page.waitForTimeout`: a fixed sleep is either slower than it needs to be or races the
  very window it is waiting on.
- **Units inject the clock instead of waiting.** A load-bearing window is passed in rather
  than slept through — `ui/src/lib/safeMode.ts` takes `now` / `graceMs` / `durationMs`
  options, which `safeMode.test.ts` drives deterministically. Follow that pattern for new
  timing logic so the behavior is unit-testable without an e2e.

### Timeouts are budgets for the loaded host

`playwright.config.ts` raises the per-test budget to 60s and the assertion budget to 15s,
over Playwright's 30s/5s defaults, and `retries: 0` stays (EXC-1050). Both numbers exist
because the suite's real home is `mise run preflight`, not an idle machine: the gate runs
`test` (unit), `build bin`, and `smoke` alongside `test e2e`, on top of six e2e workers
that already saturate the cores. Measured on a 12-core host, the unit suite takes 31s
standalone and 88s inside the gate — everything sharing that window is roughly 3x slower,
so a suite whose deadlines were calibrated standalone reds the gate for reasons that have
nothing to do with the change under test.

The per-test budget is the one that binds. Playwright ships **no** default `actionTimeout`
or `navigationTimeout`, so `locator.click()`, `page.goto()`, and `page.waitForFunction()`
retry against the *test* budget rather than one of their own — a starved action quietly
eats the whole thing, and the run dies on a timeout that names the test rather than the
step inside it. Don't paper over a slow spec with a per-call `{ timeout: … }` override; if
a spec needs more than the config gives it, that is a finding about the spec.

**Never reach for `retries`.** A retry re-runs the test: it hides that the first attempt
failed, doubles the worst case, and leaves the contention invisible. A deadline hides
nothing — the test still runs once, still asserts the same thing, still fails when the app
is wrong — and it is free on the happy path, because a web-first assertion resolves the
instant its condition is true. A flake is a bug to be named, not a run to be repeated.

**Reproducing load-induced failure on demand.** Two levers, neither needing a code change:

- **Real contention**, closest to the gate: raise the worker cap past the core count, e.g.
  `CARET_E2E_WORKERS=<2x cores> mise run test e2e`. Faithful, but stochastic — what it
  turns up depends on what else the host is doing, and the failing set differs run to run.
- **Deterministic**, for asking whether one spec has headroom: drive it from a throwaway
  `playwright-cli` probe that CPU-throttles the renderer over CDP
  (`Emulation.setCPUThrottlingRate`), which widens every browser-side wait by a fixed
  factor. Probes like this are exploration and are **never committed** — write the finding
  down, then delete the probe.

## Artifact hygiene

Keep fixture plans **synthetic and non-identifying** — they are seeded data, not real
plans. On failure Playwright captures a trace and screenshot, which can render plan text;
those artifacts (`test-results/`, `playwright-report/`, `playwright/.cache/`,
`.last-run.json`) are gitignored and stay local. Never commit them, and never seed a
fixture with real plan, prompt, or feedback content.
