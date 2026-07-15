# Test Layout Rules

caret's `test/` mirrors the core/adapter boundary that `src/` draws (EXC-494), so the test
layout tells you which layer a suite belongs to without opening it. `bun test` collects
`**/*.test.ts` repo-wide, so a suite lands in the runner from anywhere under `test/` — the
directories are a legibility contract for humans, not a collection filter.

- **`test/core/`** — the tool-agnostic core suites, named for the `src/` module they
  cover. `src/` groups the core into domain directories (`daemon/`, `review/`, `plan/`, …)
  while `test/core/` stays flat, so a suite's compound name tracks its module rather than
  mirroring the directory (`daemon`, `daemon-lifecycle`, `review-threading`,
  `plan-format`, `redact-core`, `settings`, `log`, `store`, …). A core suite must
  **not encode Claude assumptions**: no hardcoded `acceptEdits`/`auto` mode literals, no
  PermissionRequest `hookSpecificOutput` shape, no `caret@caret` plugin probing. Where
  core code takes an adapter capability (the approve-variant set, `parseHookInput`), the
  test **injects it as a dependency** rather than reaching into `src/adapters/`. A future
  second adapter inherits `test/core/` unchanged as proof of agent-independence — that
  inheritance is the invariant these rules protect.
- **`test/adapters/claude/`** — the Claude-Code adapter suites: the adapter contract,
  decision emission (PermissionRequest/`setMode`), approve-variant mapping, the install
  probe, and the pre-epic back-compat fixtures (Claude `acceptMode` vocabulary). Anything
  that names Claude's wire shape or mode vocabulary lives here, beside the
  `src/adapters/claude/` module it exercises. A new agent adapter gets its own
  `test/adapters/<tool>/` directory; it never edits `test/core/`.
- **`test/scripts/`** — coverage for `scripts/` (release tooling, the dev driver,
  preflight). These mirror `scripts/`, not `src/`, so they sit apart from the core/adapter
  split.
- **`test/support/`** — shared bun-test scaffolding (daemon boot, env isolation, NDJSON
  parsing, polling, free ports, the recording logger, the never-log-body matcher). Support
  modules are plain `.ts` (not `*.test.ts`), so their location — not a naming comment — is
  what keeps `bun test` from collecting them. Import helpers from here, never re-derive
  them in a suite.

## The boundary rule

The test that catches drift is structural: a Claude literal appearing in `test/core/` is
the smell. When a core suite needs an agent-specific value, the value arrives through an
injected dep (the pattern the daemon/review suites already follow) — that is what keeps
the core layer honest and the adapter directory the single home for tool-specific
vocabulary.

## Where else tests live

- **Browser/UI** — `ui/src/**/*.test.ts` (happy-dom units) and `test/e2e/*.e2e.ts`
  (Playwright; the `.e2e.ts` suffix keeps them out of `bun test`'s collection even though
  they sit under `test/`). The unit-vs-e2e split is governed by `browser-testing.md`; this
  file governs only the backend `test/` subtrees (`core`, `adapters`, `scripts`,
  `support`).
