// EXC-1223: a standing probe of the JavaScriptCore regex defect that
// ui/src/lib/diffview/jsc-regex.ts works around.
//
// A real browser, and specifically a real WebKit: the defect is the engine's own,
// and it is already gone from both engines this repo runs — bun 1.4 has the fix
// and Chromium never had the bug — so a WebKit build is the only place left that
// can observe it. The pure half of the workaround (that jscSafeSource rewrites the
// `(^X)?` sites and leaves every other pattern byte-identical) is a unit in
// ui/src/lib/diffview/jsc-regex.test.ts.
//
// What runs here is PLAYWRIGHT'S WebKit — ms-playwright/webkit-<rev>, pinned by
// @playwright/test — not the Safari on anyone's machine. It tracks WebKit upstream
// and therefore LEADS shipping Safari, which in turn leads whichever Safari a
// reviewer has actually updated to.
//
// READ THIS BEFORE "FIXING" A RED HERE: THE FIRST ASSERTION IS INVERTED. It asserts
// the BUG STILL EXISTS, so it goes red on GOOD news — WebKit repaired the engine.
// The response is NOT to fix this test. Because of the lead above, a red means the
// fix landed upstream, NOT that Safari reviewers have it: it starts the retirement
// clock rather than ending it. Find which Safari release carries the fix and whether
// caret still serves one that does not; once it does not, DELETE
// ui/src/lib/diffview/jsc-regex.ts, with its callers, this spec, and the webkit
// project in playwright.config.ts. Deleting on the day the red arrives is the very
// regression this file exists to prevent: the module is a no-op on a fixed engine,
// while dropping it early silently mistokenizes every `//` comment for reviewers
// still on the old engine. During the wait, hold the red with `test.fail()` and the
// Safari version being waited on — never `test.skip`, which retires the signal
// instead of recording it.
//
// Without a red somewhere the workaround is un-deletable in practice: EXC-1156 swept
// the repo for workarounds its dependency bumps had made obsolete and could not
// retire this one, because nothing here could look at the engine.
//
// These tests boot a caret daemon they never talk to, and no spec here can decline
// it. Playwright's `_setupArtifacts` fixture is `auto`, and it depends on
// `_combinedContextOptions`, which reads `baseURL`, which fixtures.ts overrides to
// depend on `daemon` — so the boot happens for EVERY spec in this tree, including
// one that declares no fixtures at all. Taking `browser` instead of `page` does not
// dodge it (measured, not reasoned). Dodging it at all means changing fixtures.ts,
// which is machinery built for a single spec. So `page` it is — the same fixture
// every other spec takes.
//
// That leaves one caveat worth stating plainly, because this signal is supposed to
// mean exactly one thing: the daemon fixture hard-fails when no rumdl reporting
// RUMDL_VERSION resolves, so a red here CAN be a toolchain problem rather than a
// repaired engine. Read the failure before acting on it — a genuine retirement
// signal fails on the assertions below, naming the shape that stopped diverging.
//
// There is no page.goto below; about:blank is all page.evaluate needs.

import { expect, test } from "@test/e2e/support/fixtures.ts";
import { jscSafeSource } from "@ui/src/lib/diffview/jsc-regex.ts";

// The three `(^X)?` shapes shiki's bundle carries, kept in step with the list in
// ui/src/lib/diffview/jsc-regex.test.ts. That unit says of all three that they
// "earn their place on the second engine, not the one running them" — this is that
// engine, so all three run here rather than the first alone. They are not variants
// of one pattern: they put the alternation at the top level, nested inside a capture
// group, and bare with the capture following, which are three engine paths.
const BUNDLE_SHAPES = [
  String.raw`(^[\t ]+)?(?=\/\/)`,
  String.raw`((?:^[\t ]+)?)(?=\/\/)`,
  String.raw`(?:^[\t ]+)?(\/\/)`,
];

// The defect in its minimal form: JSC lets the optional group's `^` anchor the
// whole pattern, so the branch where the group matches nothing is never tried and
// a match at index 1 comes back null. A fixed engine returns ["b", undefined].
test("WebKit still anchors an optional group containing ^", async ({ page }) => {
  expect(await page.evaluate(() => /(^a)?b/.exec("xb"))).toBeNull();
});

// The workaround's payload, run as the REAL jscSafeSource output rather than a
// retyped copy of it, so the probe cannot drift from the transform: each rewritten
// shape must match the `//` after code that its original form misses under JSC. No
// regex flags — `.exec()?.index` needs none, and what is under test is the source
// rewrite, not how the pattern is compiled.
test("every rewritten bundle shape matches where the original diverges", async ({ page }) => {
  for (const source of BUNDLE_SHAPES) {
    const index = await page.evaluate(
      (rewritten) => new RegExp(rewritten).exec("code // x")?.index,
      jscSafeSource(source),
    );
    expect(index, source).toBe(5);
  }
});
