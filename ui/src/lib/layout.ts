// Shared layout constants. Pure TS (no node imports) so it stays node-free
// and is importable from both the UI and the Playwright config.

/**
 * The reference layout width, in CSS px: the viewport at which the source view
 * and its contents pane have room for the full plan column alongside the pane.
 * playwright.config.ts derives its e2e viewport from this constant (with
 * headroom) so the e2e layout tracks the reference width instead of being
 * coupled to it by prose alone; `layout.test.ts` asserts that derivation.
 */
export const REFERENCE_WIDTH_PX = 1400;

/**
 * Width foundation for the responsive effort (EXC-806, parent EXC-770). Three
 * thresholds, single-sourced here and mirrored as `--w-*` custom properties in
 * `app.css`; `layout.test.ts` pins the two in sync. `@media` conditions cannot
 * read `var()`, so the surface tickets (EXC-807–814) write these px literals in
 * their media queries — this file is the canonical source those literals must
 * match.
 *
 * Values are grounded in a narrow-width screenshot audit, not generic
 * breakpoints:
 * - {@link MIN_APP_WIDTH_PX} (≈ ⅓ of a 1440 display) — the supported minimum.
 *   `.shell` takes it as a `min-width` floor, so below it the window scrolls
 *   horizontally instead of the layout collapsing further.
 * - {@link TIGHT_WIDTH_PX} — the ~⅓-screen regime: ToC auto-collapses, TopBar
 *   controls go icon-only, pinned chrome stacks.
 * - {@link NARROW_WIDTH_PX} — the ~½-screen regime: TopBar consolidation,
 *   unified compare diff, and cwd relocation begin at/below this width.
 */
export const MIN_APP_WIDTH_PX = 480;
export const TIGHT_WIDTH_PX = 640;
export const NARROW_WIDTH_PX = 960;
