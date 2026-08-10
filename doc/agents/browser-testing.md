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

Every deadline the suite runs under lives in `playwright.config.ts` (EXC-1050), and each
is sized for the machine the suite actually runs on rather than an idle one. Playwright's
own defaults — 30s per test, 5s per assertion — assume the suite owns the host, and inside
`mise run preflight` it does not: `lint` and `test` (unit) are already running when
`test e2e` starts, `build bin` and `smoke` land during it, and six e2e workers each
driving a Chromium tree plus a spawned daemon saturate the cores before any of that
arrives. On a 12-core host the unit suite measures 31s standalone against 88s inside the
gate — 2.8x. That figure is the unit suite's; e2e's own factor was never measured, and
2.8x is the working number the budgets are sized against.

**The contention is cross-task, landing on top of intra-e2e saturation the worker cap
deliberately accepts.** Both halves are real and the distinction decides the fix: at the
shipped 50% cap the suite passes standalone and reds only inside the gate, so the sibling
tasks are what tips it — but they tip a host the suite had already filled on its own. The
consequence is that a flake here is never a property of the spec that happened to red. It
selects whichever test was mid-flight when the host stalled, so the failing set differs
run to run, and chasing the named spec finds nothing wrong with it.

The per-test budget is the one that binds, because Playwright ships **no** default
`actionTimeout`, `navigationTimeout`, or `toPass` budget. `locator.click()`,
`page.goto()`, `page.waitForFunction()`, and a bare `toPass()` all fall through to
whichever deadline is left — usually the test's — so a starved step quietly eats the whole
thing and the run dies on a timeout naming the test rather than the step inside it.
`expect.timeout` does **not** reach `toPass`, which is why the config sets it separately.

Two rules follow, and both are about direction rather than magnitude:

- **A per-call `{ timeout: … }` that *raises* a budget above the config is the smell** —
  if a spec needs more than the suite gives it, that is a finding about the spec, not a
  number to bump. *Lowering* one is sanctioned and load-bearing: the inner
  `toBeHidden({ timeout: 500 })` inside the `toPass()` retry loops in
  `approve-options.e2e.ts`, `review-switcher.e2e.ts`, `folder-refs.e2e.ts`, and
  `file-drawer.e2e.ts` has to fail fast so the loop can press the key again.
- **Never reach for `retries`.** A retry re-runs the test: it hides that the first attempt
  failed, doubles the worst case, and leaves the contention invisible. A deadline hides
  nothing — the test still runs once, still asserts the same thing, still fails when the
  app is wrong — and it is free on the happy path, because a web-first assertion resolves
  the instant its condition is true. A flake is a bug to name, not a run to repeat.

**Adjusting the numbers.** The assertion budget is ~3x Playwright's default, tracking the
measured contention factor; the per-test budget is 2x, the point at which the throttle
probe below turned red into green where 30s could not. Re-derive both the same way rather
than nudging them — and if a re-measurement moves the factor, the config is the one place
the values live.

**Reproducing load-induced failure on demand.** Two levers, neither needing a code change:

- **Real contention**, closest to the gate: raise the worker cap past the core count, e.g.
  `CARET_E2E_WORKERS=<2x cores> mise run test e2e`. Faithful, but stochastic — what it
  turns up depends on what else the host is doing. It is also deliberately the fan-out
  EXC-587 capped, so don't SIGKILL such a run and do check for stray `chromium`/daemon
  processes afterwards; an interrupted oversubscribed run is exactly the orphan storm the
  cap exists to prevent.
- **Deterministic**, and the one to reach for when a specific spec is in question: drive
  it from a throwaway `playwright-cli` probe that CPU-throttles the renderer over CDP
  (`Emulation.setCPUThrottlingRate`), which widens every browser-side wait by a fixed
  factor. Escalate the rate until it reds — the two specs EXC-1050 was filed against
  survive 60x and fail 4/4 at 90x — then confirm the fix against the same rate. Probes
  like this are exploration and are **never committed**: write the finding down, delete
  the probe.

## Artifact hygiene

Keep fixture plans **synthetic and non-identifying** — they are seeded data, not real
plans. On failure Playwright captures a trace and screenshot, which can render plan text;
those artifacts (`test-results/`, `playwright-report/`, `playwright/.cache/`,
`.last-run.json`) are gitignored and stay local. Never commit them, and never seed a
fixture with real plan, prompt, or feedback content.
