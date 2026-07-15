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

## File-split discipline

- **One concern per module.** `cli.ts` is the precedent for a *thin entrypoint*: it only
  assembles the Commander tree and threads parsed options into the run functions in
  `src/commands/*`; the review core, daemon lifecycle, HTTP client, and build
  fingerprinting each live in their own module.
- **Split on seams, not on size.** Carve a file where its responsibilities have a natural
  joint (a protocol boundary, a lifecycle stage, a composition vs. core distinction) — not
  merely because it crossed a line count. A subcommand entrypoint goes in `src/commands/`;
  the logic it calls goes in the core module it belongs to.

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
  *injects the failure*: `test/core/log.test.ts`'s `poisoned()` returns an object with a
  getter that throws, and the test asserts the logger swallows it and the caller
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
