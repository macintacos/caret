---
name: browser-testing
description: How to choose where browser behavior gets tested — committed Playwright e2e, bun-test units, or throwaway exploration — plus the e2e harness contract and timing discipline.
---

# Browser Testing Rules

caret has two committed test layers plus an ad-hoc exploration path. Picking the wrong one is the
common mistake: an assertion about real rendering goes stale as a unit test, and pure logic dressed
up as an e2e spec is slow and flaky. Decide by what you are actually testing (EXC-453):

- **Real browser behavior** — text selection, focus/keyboard handling, scroll, popover positioning,
  and timing-driven UI (the 2s decision poll, the 500ms autosave debounce, safe mode's 300ms grace
  window and 2s suppression) → a **committed Playwright spec** in `e2e/*.e2e.ts`. Run:
  `mise run test-e2e`.
- **Pure logic** — parsing, anchoring math, formatting, state machines → a **`bun test` unit**
  (happy-dom when a DOM API is needed, wired by `ui/test-setup.ts`).
- **Throwaway exploration** — "what does this page actually do?" → the ad-hoc `playwright-cli`
  skill. Its scripts and output are **never committed**; reach for it to learn, then write the real
  test in one of the two layers above.

## Spec naming

Specs are named `*.e2e.ts`, deliberately distinct from the unit suffixes. `bun test` collects
`*.test.ts` **and** `*.spec.ts` repo-wide, so a Playwright spec under either of those names would be
swept into the unit runner and crash it. `.e2e.ts` keeps the two runners disjoint — Playwright owns
`e2e/`, `bun test` owns the rest.

## The harness contract

Every spec goes through `e2e/support/fixtures.ts`; never stand up a daemon by hand inside a spec.

- **Per-test isolated daemon.** The fixture boots a fresh daemon on an OS-assigned port (port 0),
  serving the built single-file `ui/dist/index.html`, with an ephemeral `XDG_STATE_HOME` wiped at
  teardown and idle shutdown disabled. The user's real daemon (`:42718`) and `~/.local/state/caret`
  are never touched.
- **Seed through the public API.** Reviews are created by `POST /api/reviews`, the same surface a
  real hook uses — never by reaching into the store directly.
- **No external daemon, no dev driver.** A spec must not reuse a running daemon, depend on
  `mise run dev`, or drive the dev driver. The `test-e2e` task `depends` on `build-ui`, so specs
  always exercise the shipped artifact, not a Vite dev server.

## Timing discipline

The split mirrors the test layers:

- **e2e uses auto-retrying, web-first assertions** (`expect(locator).toBeVisible()` and friends),
  which absorb the poll, debounce, and grace windows on their own. **Never** `page.waitForTimeout`:
  a fixed sleep is either slower than it needs to be or races the very window it is waiting on.
- **Units inject the clock instead of waiting.** A load-bearing window is passed in rather than
  slept through — `ui/src/lib/safeMode.ts` takes `now` / `graceMs` / `durationMs` options, which
  `safeMode.test.ts` drives deterministically. Follow that pattern for new timing logic so the
  behavior is unit-testable without an e2e.

## Artifact hygiene

Keep fixture plans **synthetic and non-identifying** — they are seeded data, not real plans. On
failure Playwright captures a trace and screenshot, which can render plan text; those artifacts
(`test-results/`, `playwright-report/`, `playwright/.cache/`, `.last-run.json`) are gitignored and
stay local. Never commit them, and never seed a fixture with real plan, prompt, or feedback content.
