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

## Which layer a spec belongs in

The bullets above decide the common case; the hard cases are decided in the spec itself.
**A spec opens with a header paragraph naming what in it needs a real browser and which
file holds the pure half** — `folder-refs`, `settings`, `plan-breadcrumbs`,
`topbar-overflow`, `vanity-origin`, `smoke`, `diff-surface`, `lifecycle`, and
`compare-comments` carry the fullest examples; every spec has a header, and most name the
layer choice. That paragraph is the whole mechanism: it makes "is this spec in the right
layer?" a question you answer by reading the file, so there is no register to keep in sync
(EXC-1052). Write one for every new spec, and add the layer half to any header that is
still only describing coverage.

Two things make a spec look unit-able when it is not, and neither is visible from the test
body:

- **Browser dependence behind a helper.** `createAnnotation`
  (`test/e2e/diff-surface.e2e.ts:1587`) reads as a few lines of intent, but it routes
  through `revealGutterPlus` (`test/e2e/support/source-view.ts:61`), which does
  `getBoundingClientRect()` and then `page.mouse.move()`. Inline the helper before
  concluding a spec is pure logic.
- **Browser dependence declared in the config.** `playwright.config.ts:70` emulates
  `colorScheme: "dark"`, so a spec asserting what a fresh origin paints is doing media
  emulation with nothing in its body that says so. Read the config's `use` block too.

A layer-choice note is only as good as someone re-reading the files it names.

**The axis that actually decides it is not "browser vs. logic" but "what does the fixture
daemon produce that props cannot".** `compare-comments` looks like a browser test and is
really a daemon test: what it needs is interleaved `addVersion` / `putDraft` state across
a real HTTP round-trip, which no mounted component can be handed as props. Ask that
question first — the browser question is often the less interesting half.

One spec sits against that axis deliberately. `smoke.e2e.ts` is a pure render assertion
and stays, because it is the harness canary: the one spec whose only job is that the
fixture, the spawned daemon, the built `ui/dist`, and the page load all work. Its header
says so; don't "fix" it into a unit.

## Spec naming

Specs are named `*.e2e.ts`, deliberately distinct from the unit suffixes. `bun test`
collects all four of `*.test.ts`, `*_test.ts`, `*.spec.ts` and `*_spec.ts` repo-wide, so a
Playwright spec under any of those names would be swept into the unit runner and crash it.
`.e2e.ts` keeps the two runners disjoint — Playwright owns `test/e2e/`, `bun test` owns
the rest.

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
- **A spec takes `test` and `expect` from the fixture, never from `@playwright/test`.**
  Importing them from `test/e2e/support/fixtures.ts` is what binds a spec to the isolated
  daemon; importing Playwright's own `test` is how one ends up standing a daemon up by
  hand. Types are a different matter — `import type { Page, Locator }` is erased, and is
  what every spec already does. The rule is about specs: the harness modules under
  `test/e2e/support/` are where Playwright's own exports are legitimately reached, which
  is where `fixtures.ts` extends `test as base` and re-exports `expect`. Gated for specs
  (§ What is gated).
- **Seed through the public API.** Reviews are created by `POST /api/reviews`, the same
  surface a real hook uses — never by reaching into the store directly.
- **No external daemon, no dev driver.** A spec must not reuse a running daemon, depend on
  `mise run dev`, or drive the dev driver. The `test e2e` task builds the UI first, so
  specs always exercise the shipped artifact, not a Vite dev server.
- **What a test pays for that isolation, as two costs rather than one.** Fixture boot is
  ~64ms serial and ~137ms at six workers; the test's first `seed()` adds ~11ms on top.
  Name them apart wherever they are quoted, `fixtures.ts`'s header included —
  **a claim that folds two costs into one is how a suite hides a 40% overhead.** Here that
  overhead was ~520ms per test, spent acquiring `rumdl` from scratch into each ephemeral
  state dir (roughly 1.7GB of downloads per suite run), and it went unlooked-for while
  boot was the only number anyone had (EXC-1053). What closed it is handing the daemon a
  pre-resolved binary through `CARET_RUMDL_BIN` (see `doc/CONFIGURING.md`; the variable is
  version-gated, so a bare command name is no longer resolved through `PATH`). The fixture
  **hard-fails** when no `rumdl` reporting `RUMDL_VERSION` is available — deliberately,
  because a bad binary degrades silently to storing plans raw, changing the canonical text
  every spec asserts against.
- **What stays expensive on purpose.** Per-test isolation is not negotiable (EXC-587), and
  `trace: "retain-on-failure"` costs ~90-180ms per test that is discarded on every pass.
  It is kept because it is the only failure diagnostic an unattended `mise run preflight`
  leaves behind.

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

The raising rule has five standing exceptions, all in `file-refs.e2e.ts`: four
`toPass({ timeout: 20_000 })` (lines 842, 852, 942, 949) and one `30_000` (line 1001),
guarding loops that walk a 300-line file's virtualised preview to both ends through real
chunked loading. That is product cost, and the fixture's 300 lines — not the budget — is
the tuning target. They predate the rule; a sixth needs an argument of the same kind.

**A `waitForFunction` on the clock is a fixed sleep unless the app holds the same
deadline.** The suite writes
`await page.waitForFunction((t) => performance.now() > t + N, t0)` in eleven places and
they are not all the same thing. `waitPastSafeModeGrace`
(`test/e2e/support/fixtures.ts:320`) is an honest wait: `ui/src/lib/safeMode.ts` arms a
300ms grace window at mount, and the helper captures `t0` *after* mount is asserted then
waits to `t0 + 350` on the same `performance.now()` clock the guard reads — so it cannot
race a slow hydrate, and the window's expiry has no DOM signal to poll. The other ten are
sleeps wearing that costume: "give the pointer pipeline a beat, then assert nothing
appeared", where the number names nothing in the app. **The discriminator is whether code
in `ui/` holds a deadline on that clock at that number.** If it does, the wait is honest.
If it does not, you have written `page.waitForTimeout` with extra steps — reach for
`waitForTwoPollTicks` (`fixtures.ts:338`) or a `page.waitForResponse` on the event that
must not happen, both of which say what they are waiting for. The ten are a standing
finding, not a licence to add an eleventh.

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

## Locators

**Query by role and accessible name where the element publishes one that is stable; use a
`data-*` or class selector where it does not.** Both halves are the policy — the second is
not a concession (EXC-1051). Three things disqualify a role query: no role in the
accessibility tree at all, a role carrying no accessible name, and — the case that catches
people — a name that is really fixture data. Each gets a bullet below.

- **Where no accessible target exists, say so rather than apologising.** The plan surface
  is `<div class="diff-plan" role="presentation">`
  (`ui/src/components/DiffPlanView.svelte:1378`), deliberately out of the accessibility
  tree; the `@pierre/diffs` code grid, the file-preview internals, and CodeMirror's DOM
  are third-party or presentational markup with no meaningful roles. That is
  **362 of the suite's 581 class-selector calls — 62%** (EXC-1049's inventory; re-derive
  it the same way rather than trusting the number). What that surface wants is stability,
  not semantics: prefer `[data-*]`, and reach the plan through `planSurface()` /
  `PLAN_SURFACE` (`test/e2e/support/source-view.ts`) rather than writing a fresh
  `.diff-plan` literal per spec.
- **`getByRole("dialog")` does not match `role="alertdialog"`.** That is why
  `ConfirmPopover` (`ui/src/components/ConfirmPopover.svelte:147-148`) went so long
  queried by class despite publishing both a role and an `aria-label`. Ask for
  `getByRole("alertdialog", { name })`.
- **A class that *production* code queries is a contract, not a styling hook.**
  `ui/src/components/CommentNavigator.svelte:90` reads `.nav-item` to build its keyboard
  list, so a spec addressing `.nav-item` is addressing the same thing the component
  depends on. Leave those as they are and say why in the spec — narrowing one to a role
  query silently drops the coupling the test was covering.
- **Scope a role locator to a `data-*` anchor before adding markup.** When a role has no
  accessible name — `role="status"` is not name-from-content, and two components publish
  it — scoping resolves the collision with no change to the app
  (`page.locator("[data-file-preview]").getByRole("status")`). Two cases predicted to need
  a new `aria-label` were solved this way instead.
- **Never bind to a name that is fixture data.** `.switcher-trigger` stays a class: its
  accessible name is the plan title plus a count badge, so a name query would hard-code
  the fixture and stop matching the thing under test.

Shared locators live in `test/e2e/support/chrome.ts` (the chrome around the plan) and
`test/e2e/support/source-view.ts` (the plan surface itself) — one idiom, one home.

## What is gated, and what stays prose

`test/structure/e2e-conventions.test.ts` runs under `bun test` — not under `test e2e`, so
it costs the Playwright suite nothing — and fails the build on four of the rules above
(EXC-1054):

| Rule | Stated in |
| --- | --- |
| no `waitForTimeout` call under `test/e2e/` | § Timing discipline |
| no file under `test/e2e/` named for a unit suffix | § Spec naming — the collision crashes `bun test` |
| no **value** import of `@playwright/test` in a spec | § The harness contract — `test` and `expect` come from `fixtures.ts` |
| no non-zero `retries` | § Timeouts are budgets for the loaded host |

Each is decided from the **TypeScript AST**, never from text, and that is what keeps the
gate **allowlist-free**. A parser sees calls and imports, so `fixtures.ts`'s header
explaining the sleep rule, and a spec's own comment about why it does not sleep, are
simply not violations. A text rule would have to carve out every one of them, and each
carve-out is a place the next author learns to add one more. The same discipline decides
how narrowly each rule aims: `retries` is an ordinary English word, so that rule matches
only inside the options object Playwright reads it from (`defineConfig`,
`test.describe.configure`, or a config's default export) rather than anywhere the word
appears — which is what stops an unrelated `{ retries: 3 }` in a `page.evaluate` payload
from becoming the first exception.

**The bar for gating a rule is that it needs no allowlist**, and that bar sorts the rules
cleanly. An allowlist entry excusing a place the *detector* is wrong is a detector defect
— fix the detector. An allowlist entry excusing a place the *rule* is wrong means the rule
needs judgment, so it belongs in this file rather than in the suite. That is why the
eleven `performance.now()` waits, the five raised `toPass` budgets, the locator policy,
and the layer-choice convention are all written above and none of them are enforced below:
every one needs someone to read a component, an app timer, or a fixture before deciding,
and a gate shipped with a list of "these ones are fine" teaches appending rather than
thinking.

## Artifact hygiene

Keep fixture plans **synthetic and non-identifying** — they are seeded data, not real
plans. On failure Playwright captures a trace and screenshot, which can render plan text;
those artifacts (`test-results/`, `playwright-report/`, `playwright/.cache/`,
`.last-run.json`) are gitignored and stay local. Never commit them, and never seed a
fixture with real plan, prompt, or feedback content.
