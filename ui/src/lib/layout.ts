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
