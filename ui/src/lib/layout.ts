// Shared layout constants. Pure TS (no node imports) so it stays singlefile-safe
// and is importable from both the UI and the Playwright config.

/**
 * The single responsive breakpoint, in CSS px. Below it the contents rail
 * (Toc.svelte) is `display:none`, the plan re-centers, and the gutter narrows.
 *
 * CSS media-query conditions cannot read custom properties, so the value is
 * hand-written into three `@media (width ... 1400px)` rules (app.css, Toc.svelte,
 * PlanView.svelte). `layout.test.ts` parses those rules and asserts they match
 * this constant, so a CSS edit that drifts from it fails the unit suite — and
 * playwright.config.ts derives its viewport from it, so the e2e viewport tracks
 * the breakpoint instead of being coupled to it by prose alone.
 */
export const TOC_BREAKPOINT_PX = 1400;
