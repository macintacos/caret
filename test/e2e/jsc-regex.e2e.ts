// EXC-1223: a standing probe of the JavaScriptCore regex defect that
// ui/src/lib/diffview/jsc-regex.ts works around.
//
// A real browser, and specifically a real WebKit: the defect is the engine's own,
// and it is already gone from both engines that could otherwise see it — bun 1.4
// has the fix and Chromium never had the bug — so shipping Safari's engine is the
// only place left that can observe it. The pure half of the workaround (that
// jscSafeSource rewrites the `(^X)?` sites and leaves every other pattern
// byte-identical) is a unit in ui/src/lib/diffview/jsc-regex.test.ts.
//
// READ THIS BEFORE "FIXING" A RED HERE: THE FIRST ASSERTION IS INVERTED. It
// asserts the BUG STILL EXISTS, so it goes red on GOOD news — WebKit repaired the
// engine. The response is NOT to fix this test. It is to DELETE
// ui/src/lib/diffview/jsc-regex.ts (with its callers, this spec, and the webkit
// project in playwright.config.ts), which is the entire reason this file exists.
// Without a red somewhere, the workaround is un-deletable in practice: EXC-1156
// swept the repo for workarounds its dependency bumps had made obsolete and could
// not retire this one, because nothing here could look at the engine.
//
// What the probe pays for and never uses: Playwright's `page` fixture depends on
// `_contextOptions`, which depends on `baseURL`, which fixtures.ts overrides to
// depend on `daemon` — so merely touching `page` boots a caret daemon (~137ms at
// six workers, plus the fixture's hard requirement that rumdl resolve) that these
// two tests never talk to. There is no page.goto below; about:blank is all
// page.evaluate needs. Paying the boot is deliberate — standing up an escape hatch
// in fixtures.ts to dodge one daemon is machinery built for a single spec.
//
// Both evaluates below are pure computation on a constant input, reading no
// renderer state, so the poll-or-record rule in doc/agents/browser-testing.md has
// nothing to settle here.

import { expect, test } from "@test/e2e/support/fixtures.ts";
import { jscSafeSource } from "@ui/src/lib/diffview/jsc-regex.ts";

// The defect in its minimal form: JSC lets the optional group's `^` anchor the
// whole pattern, so the branch where the group matches nothing is never tried and
// a match at index 1 comes back null. A fixed engine returns ["b", undefined].
test("WebKit still anchors an optional group containing ^", async ({ page }) => {
  expect(await page.evaluate(() => /(^a)?b/.exec("xb"))).toBeNull();
});

// The workaround's payload, run as the REAL jscSafeSource output rather than a
// retyped copy of it, so the probe cannot drift from the transform: the shape
// taken from the TypeScript grammar's comment rule matches the `//` after code
// that the original form misses under JSC.
test("the rewritten form matches where the original diverges", async ({ page }) => {
  const rewritten = jscSafeSource(String.raw`(^[\t ]+)?(?=\/\/)`);
  const index = await page.evaluate(
    (source) => new RegExp(source, "d").exec("code // x")?.index,
    rewritten,
  );
  expect(index).toBe(5);
});
