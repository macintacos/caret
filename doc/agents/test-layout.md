# Test Layout Rules

caret's `test/` mirrors `src/`, so you find a module's suite by walking the same path
rather than guessing a filename. The rule is mechanical:
**`src/x/y.ts` is covered by `test/core/x/y.test.ts`.** `bun test` collects `**/*.test.ts`
repo-wide, so a suite runs from anywhere under `test/` — these directories are a
legibility contract for humans, not a collection filter.

A suite that covers an aspect spanning several modules rather than one module keeps a
descriptive leaf inside the owning domain directory. That is the only sanctioned departure
from the mapping rule; prefer the mapping.

- **`test/core/`** — the tool-agnostic core suites, carrying the same domain directories
  `src/` uses. A core suite must **not encode Claude assumptions**: no hardcoded
  `acceptEdits`/`auto` mode literals, no PermissionRequest `hookSpecificOutput` shape, no
  `caret@caret` plugin probing. Where core code takes an adapter capability (the
  approve-variant set, `parseHookInput`), the test **injects it as a dependency** rather
  than reaching into `src/adapters/`. A future second adapter inherits `test/core/`
  unchanged as proof of agent-independence — that inheritance is the invariant these rules
  protect.
- **`test/adapters/<tool>/`** — the per-agent adapter suites, each beside the
  `src/adapters/<tool>/` module it exercises: the adapter contract, decision emission,
  approve-variant mapping, the install probe, and any back-compat fixtures. Anything that
  names a tool's wire shape or mode vocabulary lives here. A new agent adapter gets its
  own directory; it never edits `test/core/`.
- **`test/opencode/`** — coverage for the repo-root `opencode/` program, the package
  entrypoint OpenCode loads. It mirrors `opencode/`, not `src/`, which is why it sits
  outside the core/adapter split — the OpenCode *adapter* is tested under
  `test/adapters/opencode/`.
- **`test/scripts/`** — coverage for `scripts/` (release tooling, the dev driver,
  preflight). These mirror `scripts/`, not `src/`, so they sit apart from the core/adapter
  split.
- **`test/structure/`** — invariants about the shape of the repository itself rather than
  the behaviour of any one module, so they mirror no source path. A structural rule stated
  only in prose drifts; a suite here makes it falsifiable.
- **`test/support/`** — shared bun-test scaffolding (daemon boot, env isolation, NDJSON
  parsing, polling, free ports, the recording logger, the never-log-body matcher). Support
  modules are plain `.ts` (not `*.test.ts`), so their location — not a naming comment — is
  what keeps `bun test` from collecting them. Reach them through the **`@test/*` alias**
  (see `typescript-rules.md`); import helpers from here, never re-derive them in a suite.

## The boundary rule

The test that catches drift is structural: a Claude literal appearing in `test/core/` is
the smell. When a core suite needs an agent-specific value, the value arrives through an
injected dep (the pattern the daemon/review suites already follow) — that is what keeps
the core layer honest and the adapter directory the single home for tool-specific
vocabulary.

Mirroring is what preserves this. `test/core/` remains one directory to grep, so "is the
core still tool-agnostic?" stays a question the layout can answer; the domain directories
sit *under* it rather than replacing it. Colocating core suites beside their modules — the
alternative considered in EXC-879 — would scatter that answer across every domain
directory and cost the boundary its single home, so it was rejected even though it would
have matched `ui/`.

## Two conventions, by decision

The backend keeps a separate `test/` tree; the browser program colocates its units at
`ui/src/**/*.test.ts`. That split is deliberate, not drift: the boundary rule above is
what `test/` buys, and `ui/` has no core/adapter boundary to protect. Don't "fix" either
side to match the other.

## Where else tests live

- **Browser/UI** — `ui/src/**/*.test.ts` (happy-dom units) and `test/e2e/*.e2e.ts`
  (Playwright; the `.e2e.ts` suffix keeps them out of `bun test`'s collection even though
  they sit under `test/`, and its harness is `test/e2e/support/`, distinct from
  `test/support/`). The unit-vs-e2e split is governed by `browser-testing.md`; this file
  governs only the backend `test/` subtrees.
