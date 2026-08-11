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
`compare-comments` carry the fullest examples; every spec has a header, and every header
names the layer choice (EXC-1052, EXC-1059). That paragraph is the whole mechanism: it
makes "is this spec in the right layer?" a question you answer by reading the file, so
there is no register to keep in sync. Write one for every new spec — coverage *and* the
layer half.

Two things make a spec look unit-able when it is not, and neither is visible from the test
body:

- **Browser dependence behind a helper.** `createAnnotation`
  (`test/e2e/diff-surface.e2e.ts:1587`) reads as a few lines of intent, but it routes
  through `revealGutterPlus` (`test/e2e/support/source-view.ts:61`), which does
  `getBoundingClientRect()` and then `page.mouse.move()`. Inline the helper before
  concluding a spec is pure logic.
- **Browser dependence declared in the config.** `playwright.config.ts:78` emulates
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
- **`test` and `expect` come from the fixture, never from `@playwright/test`.** Importing
  them from `test/e2e/support/fixtures.ts` is what binds a spec to the isolated daemon;
  importing Playwright's own `test` is how one ends up standing a daemon up by hand. Types
  are a different matter — `import type { Page, Locator }` is erased, and is what every
  spec already does. **`fixtures.ts` is the single module under `test/e2e/` that reaches
  Playwright's own exports** — it extends `test as base` and re-exports `expect`, and
  every other module in the tree, harness modules included, takes them from it (EXC-1058).
  Gated across the whole tree (§ What is gated).
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

**One of the budgets is not one of Playwright's own knobs.** `bootTimeoutMs` sizes a
test's daemon coming up, and Playwright ships no built-in option that governs a spawned
child process — so it reaches the config as a **test option** instead: the fixture
declares it with the `[default, { option: true }]` tuple form, and `defineConfig`'s `use`
block sets the value that binds (EXC-1058). It was a module constant only `fixtures.ts`
could see, which left the one deadline a genuinely slow host hits *first* as the one
deadline nobody could tune. Read it as one number spent twice rather than as a total: the
stdout port handshake takes it as a real deadline, then the `/health` poll spends it again
as `bootTimeoutMs / 50` probes. That second half is an **attempt count, not a clock** —
`httpHealth` carries its own 500ms abort, so against a daemon that listens but never
answers the poll runs well past the number and the per-test budget is what fires.
Re-derive it like the others: it is a process spawn plus an HTTP handshake, so it moves
with host load and with nothing in the app.

Two rules follow, and both are about direction rather than magnitude:

- **A per-call `{ timeout: … }` that *raises* a budget above the config is the smell** —
  if a spec needs more than the suite gives it, that is a finding about the spec, not a
  number to bump. *Lowering* one is sanctioned and load-bearing: the inner
  `toHaveCount(0, { timeout: 500 })` inside the `toPass()` retry loops in
  `approve-options.e2e.ts`, `review-switcher.e2e.ts`, `folder-refs.e2e.ts`,
  `file-refs.e2e.ts` (twice), and `file-drawer.e2e.ts` has to fail fast so the loop can
  press the key again.
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
(`test/e2e/support/fixtures.ts:347`) is an honest wait: `ui/src/lib/safeMode.ts` arms a
300ms grace window at mount, and the helper captures `t0` *after* mount is asserted then
waits to `t0 + 350` on the same `performance.now()` clock the guard reads — so it cannot
race a slow hydrate, and the window's expiry has no DOM signal to poll. The other ten are
sleeps wearing that costume: "give the pointer pipeline a beat, then assert nothing
appeared", where the number names nothing in the app. **The discriminator is whether code
in `ui/` holds a deadline on that clock at that number.** If it does, the wait is honest.
If it does not, you have written `page.waitForTimeout` with extra steps — reach for
`waitForTwoPollTicks` (`fixtures.ts:365`) or a `page.waitForResponse` on the event that
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

### The unit lane holds the same rules, and one the e2e side does not

The lane runs under the gate too, and reddened it for weeks (EXC-1056). Everything above
transfers — a deadline is a budget for the loaded host, and `retries` is never the answer
— but the lane's own flake arrived from a direction none of it covers.

**Two deadlines, and which one a slow test wants depends on WHY it is slow.** bun's own
default is 5000ms, a quiet-host number. What breaks first under the gate is not the
CPU-heavy test but the SPAWN-heavy one: `test/scripts/dev-driver.test.ts` posts several
plan versions through the real submit → reflow → store path and each reflow spawns rumdl,
so it measures a few hundred ms standalone and crosses 5s in the gate — better than 10x,
against a suite average nearer 2.8x. Observed twice independently: in this issue's own
ten-run validation, and by EXC-1059, whose diff touched `test/e2e/` and one doc and so
could not reach the unit suite at all — three of its four runs at one unchanged commit red
on exactly these tests, the fourth green.

- **Contended** — the lane's `--timeout 30000`, in `scripts/tasks/test.ts` and mirrored on
  `package.json`'s `test`, exactly as `--conditions browser` is (see `bunfig.toml`). This
  is the gate's budget, and it rides the entry points the gate uses.
- **Intrinsically slow** — a per-test third argument, and one test has one: the shiki
  pattern sweep's `60_000`, ~10s of real work. That form reaches EVERY entry point,
  including a bare `bun test <file>`, which is what the lane flag cannot do — so a test
  that is genuinely slow needs it, and a test that is merely contended must not use it.
  Reaching for the literal to paper over contention buries the distinction.

Neither is a retry. The test still runs once and asserts the same thing, so nothing is
hidden; a budget only stops the suite asserting the machine was idle. Both stay finite so
a genuine hang is still bounded.

**Do not try to unify them into one number.** `bunfig.toml`'s `[test]` has no `timeout`
key — bun ignores one silently — and a preload calling `setDefaultTimeout`, which would
reach all three entry points at once, applies to only some files of a multi-file run on
bun 1.3. Both were tried and reverted.

**A deadline inside a dependency is the same bug, without the error.** shiki defaults
`tokenizeTimeLimit` to 500ms and spends it as wall clock inside vscode-textmate's scan
loop: when it runs out the line is abandoned where it stands and its remainder comes back
as a single token wearing whatever scope was in force. Nothing throws and nothing is
logged, so a caller cannot tell a truncated line from a real one — a test finds a token
missing, and a reviewer on a busy machine gets a line that stops being highlighted
part-way. That is worse than a timeout, which at least says so.

So caret runs with it off. `CARET_TOKENIZE_OPTIONS`
(`ui/src/lib/diffview/shiki-bundle.ts`) is spread into every tokenize call, and `0` rather
than a larger number because any finite wall-clock budget is the same bug at a different
threshold. What replaces it is a bound on the *input*: `MAX_HIGHLIGHT_LINE_CHARS`
(`ui/src/lib/diffview/highlight.ts`) refuses the pathological long line the time limit was
really guarding, and holds identically on an idle host and a saturated one. Gated (§ What
is gated).

shiki ships an input bound of its own — `tokenizeMaxLineLength`, in the same options bag —
and caret does **not** use it, which is a decision rather than an oversight. shiki skips
an over-long line without advancing the grammar state, so a block comment opening on a
skipped line would silently miscolour every row below it. caret's callers refuse the whole
chunk instead, which is the failure the surrounding code already contracts for. Reach for
`tokenizeMaxLineLength` only at a call site with no chunk to fall back to.

**Reproducing it on demand** needs no load at all, which is what made this one findable
where the e2e flakes were not. The first tokenize in a bun process spends ~800ms
translating a grammar's patterns through JIT-cold transpiler code, so it blows the 500ms
budget on its own — filter the suite down to the offending describe and the failure is
deterministic:

```bash
bun test --conditions browser ui/src/lib/caret-theme.test.ts \
  -t "caret themes over a real TypeScript sample"
```

Tightening the budget instead (`tokenizeTimeLimit: 1`) reproduces the collapse at any load
and is what `shiki-bundle.test.ts` pins the mechanism with. **A test that passes only
because an earlier test in the file warmed something is the shape to watch for** — that
spec passed 90/90 as a whole file and failed 100% of the time alone.

## Locators

**Query by role and accessible name where the element publishes one that is stable; use a
`data-*` or class selector where it does not.** Both halves are the policy — the second is
not a concession (EXC-1051). Three things disqualify a role query: no role in the
accessibility tree at all, a role carrying no accessible name, and — the case that catches
people — a name that is really fixture data. Each gets a bullet below.

**A disqualification is sometimes a finding about the app, not about the spec.** Where the
missing role or name is a real gap for assistive tech, the fix belongs in the component
and the conversion follows for free — but a test-only diff is the wrong place to make it,
so the honest move is to note it, leave the class selector, and file it.

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
- **A selector *production* code queries is a contract, not a styling hook.**
  `ui/src/components/CommentNavigator.svelte` reads `[data-nav-row]` to build its keyboard
  list, so a spec addressing it is addressing the same thing the component depends on.
  Leave those as they are and say why in the spec — narrowing one to a role query silently
  drops the coupling the test was covering. Write such a contract as a `data-*` attribute
  rather than a class (EXC-1057): a class reads as a styling hook, so nothing warns the
  next restyle that renaming it breaks the component, while the attribute states what it
  is where that person will see it. This is not the `data-testid` the EXC-1040 policy bars
  — the difference is that production code, not a spec, is the one that reads it.
- **Scope a role locator to a `data-*` anchor before adding markup.** When a role has no
  accessible name — `role="status"` is not name-from-content, and two components publish
  it — scoping resolves the collision with no change to the app
  (`page.locator("[data-file-preview]").getByRole("status")`). Two cases predicted to need
  a new `aria-label` were solved this way instead.
- **A control whose name would be its content should name itself.** The review-switcher
  trigger computed as `button "Widget Cache Refactor 2"` — the active plan's title run
  together with its count Badge, changing on every switch and saying nothing about the
  control. It now carries `aria-label="Switch review"`, with the count on its accessible
  description via an `aria-describedby` to a `hidden` span (the accname algorithm reads a
  hidden node that a description references directly). Query it through `reviewSwitcher()`
  and assert the count with `toHaveAccessibleDescription`. The same shape fits any chrome
  control that renders live data inside a button — but check where the displaced content
  lands, because `aria-label` suppresses name-from-content: the switcher's active title is
  announced by the menu's checked item (a labelled `Icon`, not a decorative one) rather
  than by the trigger.
- **A group that is already a named region does not need its list named too.** The Request
  Changes dialog's two comment groups are each a `<ul>` inside a
  `<section aria-labelledby>`; naming the list as well announces the same string twice and
  puts a third copy of it in the markup. Reach the rows through the region instead —
  `inlineRows` / `unsentRows` in `chrome.ts` do, matching the region's name as a substring
  so its tally never has to be spelled out.
- **Never bind to a name that is fixture data.** `RequestChangesDialog`'s `.row-trigger`
  stays a class: its name is name-from-content over the comment text, so a name query
  there hard-codes the fixture. The trap extends to any action queried *inside* such a
  row, because Playwright matches `name` on substring by default — a row-scoped
  `getByRole("button", { name: "Discard" })` also collects a trigger whose comment reads
  "discard this draft". Pass `exact: true`, as `inlineRows` / `unsentRows` in `chrome.ts`
  document.

Shared locators live in `test/e2e/support/chrome.ts` (the chrome around the plan) and
`test/e2e/support/source-view.ts` (the plan surface itself) — one idiom, one home.

## Absence and invisibility

**`toBeHidden()` is satisfied by a hidden element, an absent one, and a renamed one
alike**, so on its own it cannot tell "this control is no longer offered" from "this
control is still mounted and stopped painting". Where the claim is absence,
`toHaveCount(0)` says so (EXC-1059).

**The matcher follows what the locator can resolve to, not what the assertion feels
like.** A class or `data-*` selector *can* resolve to a hidden node, so there the two
matchers genuinely differ and the component decides which is true — `.safe-mode-toast` is
`{#if safeMode}` in `App.svelte` and is absent, while `.approve-slot` is `display: none`
inside a `@media` block in `TopBar.svelte` and is merely invisible. A role-and-name
locator *cannot* resolve to a hidden node at all, because Playwright's role engine matches
only the accessibility tree and `display: none` takes an element out of it; there the two
matchers are equivalent whatever the component does, and `toHaveCount(0)` is the spelling
to use for saying plainly what is being proven. Read the component before converting a
class or `data-*` site; a role site needs no such reading.

Three sites are the invisibility case and say so where they sit: `.approve-slot`
(`topbar-overflow.e2e.ts`), `request-changes`' `.context-lines` inside a collapsed
disclosure, and `plan-breadcrumbs`' `.crumb-ellipsis`, deliberately left in the list so
the full trail keeps measuring. They are the only `toBeHidden()` calls under `test/e2e/`.

**What this recovers is the still-mounted case, and only that.** A renamed class and a
renamed accessible name both still pass silently under either matcher — which is why the
locator policy above carries more weight here than the choice of assertion does.

**The rule is not AST-decidable, so it is not gated.** A parser sees
`expect(x).toBeHidden()` and nothing more; what decides the call is whether a Svelte
component wraps the node in `{#if}` or hides it with `display: none`, in a file the spec
never names. A detector that cannot be right without reading another file is the § What is
gated bar exactly, so this stays prose. To settle a site cheaply, convert it and run the
spec: a still-mounted node reds on the spot.

## What is gated, and what stays prose

`test/structure/e2e-conventions.test.ts` runs under `bun test` — not under `test e2e`, so
it costs the Playwright suite nothing — and fails the build on four of the rules above
(EXC-1054):

| Rule | Stated in |
| --- | --- |
| no `waitForTimeout` call under `test/e2e/` | § Timing discipline |
| no file under `test/e2e/` named for a unit suffix | § Spec naming — the collision crashes `bun test` |
| no **value** import of `@playwright/test` under `test/e2e/`, `fixtures.ts` aside | § The harness contract — `test` and `expect` come from `fixtures.ts` |
| no non-zero `retries` | § Timeouts are budgets for the loaded host |

`test/structure/tokenize-conventions.test.ts` gates the fifth, over `src/` and `ui/src/`
instead: every shiki tokenize call carries `tokenizeTimeLimit`, and outside a `*.test.ts`
it carries a literal `0` or the spread (§ The unit lane holds the same rules, and one the
e2e side does not). A test may starve the tokenizer on purpose — that is what pins the
mechanism — so the value half applies to production files only, which is a category the
walk reads off the path rather than a list it appends to. It is a separate suite because
it walks a different tree, not a different kind of rule; it meets the same bar, needing no
allowlist and no judgment.

Two surfaces it deliberately does not reach. `.svelte` files are outside the walk (none
tokenizes today, and its glob is `**/*.ts`). And `@pierre/diffs` keeps its own private
highlighter: it sets `tokenizeMaxLineLength: 1000` but takes shiki's 500ms default, so the
plan and source views — the code a reviewer actually reads — still tokenize against the
wall clock on an ordinary line. Its renderer options expose no `tokenizeTimeLimit` to
thread, and wrapping the highlighter would strip the only bound standing between a
pathological line and a frozen main thread. That is a standing finding for upstream, not
an exception carved here.

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

**Naming `fixtures.ts` in the import rule is not that first exception.** The rule *is*
"Playwright's values enter the tree at exactly one module", so the module has to be named
for the rule to say anything at all — the same way `playwright.config.ts` is named because
it is where `defineConfig` is legitimately called. An allowlist entry excuses a file from
a rule that still applies to it; this one states where the rule's boundary sits, and
moving a value import to a different harness module reds the gate exactly as it should
(EXC-1058).

**The bar for gating a rule is that it needs no allowlist**, and that bar sorts the rules
cleanly. An allowlist entry excusing a place the *detector* is wrong is a detector defect
— fix the detector. An allowlist entry excusing a place the *rule* is wrong means the rule
needs judgment, so it belongs in this file rather than in the suite. That is why the
eleven `performance.now()` waits, the five raised `toPass` budgets, the locator policy,
the layer-choice convention, and the absence-versus-invisibility rule are all written
above and none of them are enforced below: every one needs someone to read a component, an
app timer, or a fixture before deciding, and a gate shipped with a list of "these ones are
fine" teaches appending rather than thinking.

## Artifact hygiene

Keep fixture plans **synthetic and non-identifying** — they are seeded data, not real
plans. On failure Playwright captures a trace and screenshot, which can render plan text;
those artifacts (`test-results/`, `playwright-report/`, `playwright/.cache/`,
`.last-run.json`) are gitignored and stay local. Never commit them, and never seed a
fixture with real plan, prompt, or feedback content.
