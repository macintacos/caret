# TypeScript Rules

These are the module-shaping habits that keep caret's core testable and legible. They bias
toward pure cores with injected effects, small single-concern files, and helpers extracted
only on genuine repetition — never speculative abstraction.

## Dependency injection for testability

The dominant pattern: a function takes a `Deps` interface of the effects it performs,
production wires the real effects at a composition point, and tests inject fakes.
`runReview(stdin, deps)` takes `ReviewDeps` (parseHookInput, ensureDaemon, postReview,
longPoll, openBrowser, expire) and never reaches a module global; the CLI builds the prod
deps, the test builds fakes. Same shape in `createAutosave(store, activeId, deps)` and
`collectReport(DiscoveryDeps)`.

Corollary — **prefer injectable state over module-level mutable state.** State a function
closes over should be passed in (the backing store, the clock, the timer), so a test can
construct a fresh instance and a load-bearing window can be driven deterministically
rather than slept through.

### Where the prod deps builder lives

Both placements are in the tree, and the choice is **what it costs a test to import**, not
which layer the builder belongs to:

- **Beside the interface it satisfies**, in the core module — when the builder reads only
  ambient effects (`process`, `Bun`, the clock, a path probe) and pulls in nothing the
  entrypoint owns. `prodEnsureDeps` (`src/daemon/lifecycle.ts`, shared by two entrypoints)
  and `prodDiagnosticsDeps` (`src/daemon/diagnostics.ts`, covered by
  `test/core/daemon/diagnostics.test.ts`) are here, both exported — importing the module
  costs a test, or a second caller, nothing.
- **At the wiring point**, in `src/commands/` — when the builder needs the entrypoint's
  own graph: the adapter registry, the store, the server, loaded UI assets.
  `prodDiscoveryDeps` (`src/commands/discovery.ts`) is here, and it is unexported, because
  a test that imported it would drag that graph in behind it.

What the builder cannot know — the boot timestamp, the resolved config path, the live
settings service — stays a parameter either way. That is what keeps the first bullet's
builders testable: a test constructs one, then asserts production wires the real readers
rather than constants.

## File-split discipline

- **One concern per module.** `cli.ts` is the precedent for a *thin entrypoint*: it only
  assembles the Commander tree and threads parsed options into the run functions in
  `src/commands/*`; the review core, daemon lifecycle, HTTP client, and build
  fingerprinting each live in their own module.
- **Split on seams, not on size.** Carve a file where its responsibilities have a natural
  joint (a protocol boundary, a lifecycle stage, a composition vs. core distinction) — not
  merely because it crossed a line count. A subcommand entrypoint goes in `src/commands/`;
  the logic it calls goes in the core module it belongs to.

## Import conventions

App-owned code imports through the **`@/` alias**, never a `../../` relative dance. `@/`
resolves to the current program's source root — `src/` for the root (bun) program,
`ui/src/` for the browser program — so `@/lib/log.ts`, `@/review/store.ts`, and
`@/state/polling.svelte.ts` mean the same file from anywhere in that program. Each program
carries the mapping in its own `tsconfig.json` (`paths`), and the UI mirrors it in
`ui/vite.config.ts` so svelte-check, the vite build, and `bun test` agree.

More aliases sit **beside** `@/` in the import grouping (they are app code, not
third-party):

- **`@/tasks/*`** — the dev/release tooling in `scripts/tasks/`, grafted onto the `@/`
  namespace by a longer-prefix `paths` entry in the shared root `tsconfig.json`
  (`@/tasks/x` → `scripts/tasks/x`, matched ahead of `@/x` → `src/x`). `scripts/` has no
  tsconfig of its own — it is node code tsc checks alongside `src`/`test`, not a separate
  build like `ui/` — so the alias lives in the same config as `@/`.
- **`@core/*`** — the browser UI reaching across into the tool-agnostic core (the wire
  contract and other node-free shared modules). UI-only; the root program uses `@/`. See
  `architecture-rules.md`.
- **`$lib`** — the UI's `ui/src/lib/` directory, the prefix shadcn-svelte's copied
  components and `components.json` assume. See `svelte-rules.md` / `shadcn-rules.md`.
- **`@test/*`, `@scripts/*`, `@opencode/*`, `@ui/*`** — the repo's other roots, so a test
  never addresses a target by counting `../` hops (EXC-879). `@test/*` also names *which*
  harness is meant: `test/support/` (bun) and `test/e2e/support/` (Playwright) are two
  different directories that a bare `./support/x` could not distinguish. These are
  top-level rather than grafted under `@/` deliberately — `@/` means "this program's
  source root", and widening it to "any root" would cost the one alias with a crisp
  definition.
- **`@root/package.json`** — exact rather than a `@root/*` wildcard, because the repo root
  is not a source root: `@root/*` would alias the whole tree at once, including every root
  above that already has its own alias, making it a second spelling for all of them. One
  suite reads the version; widen this only when a second root-level file needs it.

`@ui/*` and `@test/*` are repeated in `ui/tsconfig.json` because bun resolves `paths` from
the **nearest** tsconfig, so `ui/src/**/*.test.ts` never sees the root config's mapping.
Both are test-only — resolved by `bun test` and svelte-check, never by the vite build,
which does not compile `*.test.ts` — so they are deliberately **absent** from
`ui/vite.config.ts`. That is a considered exception to the mirror-vite rule above, which
exists for the aliases production UI code uses.

**No `../` import anywhere under `test/` or `ui/src/`.** A `./x` import is correct only
for a true same-directory sibling — the idiomatic barrel form, with no path arithmetic to
get wrong. Anything that leaves the directory uses an alias. Two exclusions: the vendored
shadcn-svelte barrels under `ui/src/lib/components/ui/` (re-synced with
`shadcn-svelte add`, so not ours to police — the same boundary `biome.jsonc` draws), and
the string literals in `test/scripts/generate-ui-manifest.test.ts` that assert the
*generated* manifest's own relative imports, which are expected output rather than module
references. `test/structure/import-conventions.test.ts` enforces this, so a reintroduced
`../` fails `bun test` rather than waiting for review.

Biome's `organizeImports` (configured in `biome.jsonc`) sorts and groups every `.ts`
file's imports into blocks, blank-line separated: runtime built-ins (`node:`/`bun:`),
third-party packages, app code (`@/`, `@/tasks`, `$lib`, `@core`, and the root aliases
above), then any leftover relative paths. It is applied by `mise run format` and gated
read-only by `mise run lint` — so ordering is mechanical, never hand-maintained.
(`.svelte` files carry the `@/` aliases but Biome does not reorder them; it doesn't parse
Svelte.) Every alias that isn't `@/`-prefixed looks like a scoped npm package to Biome, so
each is carved out of the package group explicitly (`!@core/**`, `!@test/**`, and so on)
and folded in with the app code — a pattern to extend when adding a root alias, not a
one-off. The match is on the exact segment, which is why `!@opencode/**` leaves the real
`@opencode-ai/*` package where it belongs. Don't remove those carve-outs.

## Shared-helper policy

Extract a helper **only on genuine repetition with identical semantics**, and keep sites
bespoke when the semantics differ.

- **Extract on identical semantics:** `errorMessage(err)` (the one
  `err instanceof Error ? err.message : String(err)` coercion, in `src/lib/types.ts` so
  the browser can import it too), `readJsonFile`/`readJsonFileSync` (the "any failure →
  null" parse, `src/lib/json-file.ts`), and cross-cutting constants
  (`src/config/constants.ts`). A repeated expression with one meaning becomes one named
  helper; grep should find zero hand-rolled copies left.
- **Keep bespoke when semantics differ:** `prefs.ts`'s `readApproveMode` keeps its own
  try/catch because it must distinguish ENOENT (a normal first run, logged calmly) from
  other read failures — which is exactly what `readJsonFile`'s any-failure→null collapse
  erases. Folding it into the shared helper would lose a meaningful branch. When two sites
  *look* alike but one needs a distinction the helper flattens, leave it bespoke and say
  why in a comment.
- **No speculative abstraction.** Don't introduce an interface, a wrapper, or a "client"
  object for a single call site or a future that isn't here. Add the seam when the second
  real case arrives.

## Boundary validation with zod

Validate untrusted input at the boundary with zod (already a dependency), and
**preserve lenient semantics where degradation is deliberate.** The daemon's request
bodies parse through zod schemas with `.catch(...)` fallbacks (`PlanInputSchema`,
`ResolveBodySchema`, `DraftBodySchema` in `daemon.ts`): a malformed body degrades to the
schema's fallback rather than 400-ing, exactly as the former cast-and-trust did. The win
is a named, per-field boundary — not stricter rejection. When adding a schema at a
boundary that historically tolerated junk, replicate the tolerance (e.g. fail-safe: an
absent `behavior` falls back to `"allow"`, never `"deny"`); don't tighten behavior under
cover of "adding validation."

## Test-assertion discipline

- **Assert stable contracts, not exact prose.** Pin the durable shape — a log record's
  `step` token, `level`, and structured fields — not the human-readable `msg` string,
  which is free to be reworded. An assertion on exact message text is brittle by design.
- **Make invariants falsifiable.** A "never throws" claim gets a regression test that
  *injects the failure*: `test/core/lib/log.test.ts`'s `poisoned()` returns an object with
  a getter that throws, and the test asserts the logger swallows it and the caller
  continues. A guarantee with no test that could break it is documentation, not an
  invariant.
- **Commit fixtures for back-compat claims.** A "still reads the old format" claim is
  anchored by a checked-in artifact in the old shape, run through the *real* read path —
  `test/adapters/claude/fixtures/*` drive `back-compat.test.ts` through `readApproveMode`
  and the daemon's persisted-decision serve, so a change that strands those files fails
  loudly.

## Comments describe current state

Comments and docstrings explain how the code works **now** — never the change that
produced it. No "moved from X", "was previously", "refactored to", or issue-history
narration. (Citing the introducing issue id as a tag, like the `// EXC-398`
settings-schema convention, is fine; recounting a migration is not.)

## Related rules

- `architecture-rules.md` — the core/adapter boundary the DI pattern serves.
- `logging-rules.md` — the never-throw guarantee these tests pin.
- `settings-rules.md` — the docs-land-with-code rule for new config keys.
