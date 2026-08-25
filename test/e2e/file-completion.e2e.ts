// Typing `@` in a feedback editor completes a file under the review's own
// working directory (EXC-1175). Choosing a row leaves the cwd-relative path
// behind as literal text, so the reference still resolves when the plan is
// executed in some later session.
//
// Ctrl+Space over that list opens a preview panel beside it (EXC-1186), showing
// the file's opening lines — or the lines around a `:42` typed after the name,
// which also rides into what choosing the row inserts.
//
// This needs a real browser twice over, and neither half is visible from the
// test body. CodeMirror paints its completion list into a tooltip it positions
// against the live selection, and the list only opens on real keystrokes routed
// through the editor's chord layer — a mounted component can be handed neither.
// Underneath that, the daemon is a real subprocess reading a real project off
// disk, which is the other thing no prop can stand in for: the whole feature is
// "what is actually in this review's cwd".
//
// The preview adds a third thing only a browser has: the panel and the hint strip
// are CodeMirror `theme()` rules and a `::before`, the one class of rule no colour
// gate in this repo covers, and one has already shipped inert twice in this epic
// by losing on specificity to the base theme's doubled class. Reading the values
// back off the live elements is what proves those rules apply at all. Arrowing
// between rows is the other: the panel is re-evaluated only when the SELECTED
// element changes, which no pure call can move.
//
// The pure halves stay units — the source's trigger, query, result shape, and
// what each row's panel asks for in ui/src/lib/fileCompletion.test.ts, the hint
// classes in ui/src/lib/editorCompletion.test.ts, the walk and its caps in
// test/core/plan/file-search.test.ts, and the route in
// test/core/daemon/file-search.test.ts. The `/` half of the preview has no e2e at
// all: the fixture daemon deliberately wires no skill capability, so no `/` list
// opens here (test/e2e/support/daemon-entry.ts says why).
//
// Each test writes a synthetic project dir and seeds a review whose cwd points
// at it. The content is throwaway, non-identifying scaffolding — never a real
// plan.

import type { Page } from "@playwright/test";

import { makeProject } from "@test/e2e/support/file-refs.ts";
import type { Daemon } from "@test/e2e/support/fixtures.ts";
import { expect, test } from "@test/e2e/support/fixtures.ts";
import { composer, planSurface } from "@test/e2e/support/source-view.ts";

/** A project with one obvious subsequence target and two near-misses beside it. */
const PROJECT = {
  "src/lib/foo.ts": "export {};\n",
  "src/lib/bar.ts": "export {};\n",
  "src/app.ts": "export {};\n",
  "readme.md": "# throwaway\n",
};

/** A project whose one long file makes a cited line mean something, beside a
 * short neighbour to arrow onto. */
const PREVIEW_PROJECT = {
  "src/lib/alpha.ts": `${Array.from({ length: 60 }, (_, i) => `const alpha${i + 1} = ${i + 1};`).join("\n")}\n`,
  "src/lib/beta.ts": "const beta = 0;\n",
};

const list = ".cm-tooltip-autocomplete";
// Rows publish the listbox role, so the spec asserts the semantics the
// completion actually exposes rather than a class shape.
const rowsIn = (page: Page) => page.locator(list).getByRole("option");
const header = `${list} completion-section`;
// CodeMirror's own panel element, and caret's own parts inside it. No role and no
// accessible name — it is a description CodeMirror wires to the selected row
// through aria-describedby, not a landmark — so a class selector is what reaches
// it (browser-testing.md § Locators).
const panel = ".cm-completionInfo";
const markedLine = `${panel} .caret-preview-marked`;

/** The hint strip above the list, which is a `::before` on the tooltip rather
 * than a node — so it is read off the computed style or not at all. */
function hintText(page: Page): Promise<string> {
  return page.locator(list).evaluate((el) => getComputedStyle(el, "::before").content);
}

/** Write a throwaway project, seed a review whose cwd points at it, open the plan,
 * and clean up afterwards — the preamble every test here shares. */
async function withProject(
  daemon: Daemon,
  page: Page,
  files: Record<string, string>,
  run: () => Promise<void>,
): Promise<void> {
  const project = await makeProject(files);
  try {
    await daemon.seed({ cwd: project.dir });
    await page.goto("/");
    await planSurface(page);
    await run();
  } finally {
    await project.cleanup();
  }
}

test("an @ opens the files under the review's working directory", async ({ daemon, page }) => {
  await withProject(daemon, page, PROJECT, async () => {
    const input = await composer(page);
    await page.keyboard.type("see @");
    await expect(page.locator(list)).toBeVisible();
    await expect(rowsIn(page)).toHaveText([
      "readme.md",
      "src/app.ts",
      "src/lib/bar.ts",
      "src/lib/foo.ts",
    ]);
    // A complete answer claims nothing about being partial.
    await expect(page.locator(header)).toHaveCount(0);
    await expect(input).toContainText("see @");
    // And the list says the preview is there to be opened. The strip is a
    // `::before`, so this is also the assertion that the theme rule drawing it
    // applies at all — nothing else in the suite would notice it losing on
    // specificity to the base theme.
    expect(await hintText(page)).toContain("ctrl+space");
    // Nothing is previewed until it is asked for.
    await expect(page.locator(panel)).toHaveCount(0);
  });
});

test("typing narrows by subsequence, and each row shows which characters matched", async ({
  daemon,
  page,
}) => {
  await withProject(daemon, page, PROJECT, async () => {
    await composer(page);
    await page.keyboard.type("@srlbfoo");
    // Not one of these characters starts the path or any of its segments.
    await expect(rowsIn(page)).toHaveText(["src/lib/foo.ts"]);

    // Which is exactly why the row has to SAY what matched: nothing about
    // `src/lib/foo.ts` looks like `srlbfoo` until the seven characters are picked
    // out of it. `filter: false` switches CodeMirror's own match ranges off along
    // with its filtering — it hands each option `getMatch ? getMatch(option) : []`
    // — so before the source supplied `getMatch`, this locator found nothing.
    const matched = rowsIn(page).locator(".cm-completionMatchedText");
    expect((await matched.allTextContents()).join("")).toBe("srlbfoo");

    // And that the emphasis is VISIBLE, which the DOM above does not say. It is a
    // CodeMirror `theme()` spec, the one class of rule no colour gate in this repo
    // covers, and one has already shipped inert twice in this epic by losing on
    // specificity to the base theme's doubled class. Reading the value back off
    // the live element is the only thing that proves the rule applies at all.
    const wash = await matched.first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(wash).not.toBe("rgba(0, 0, 0, 0)");
    expect(wash).not.toBe("transparent");
  });
});

test("choosing a row inserts the cwd-relative path and takes the @ with it", async ({
  daemon,
  page,
}) => {
  await withProject(daemon, page, PROJECT, async () => {
    const input = await composer(page);
    await page.keyboard.type("look at @srlbfoo");
    await expect(rowsIn(page)).toHaveText(["src/lib/foo.ts"]);
    // Clicked rather than Entered, and deliberately: a prefix of this query
    // matches the same single row, so `toHaveText` can pass on the previous
    // query's rows while the final one is still in flight — and `acceptCompletion`
    // correctly refuses a list that stale, so the keypress would be swallowed with
    // nothing in the DOM to have waited for. A click applies the row it is on.
    // That Enter reaches the list at all is pinned in markdownEditor.test.ts.
    await rowsIn(page).filter({ hasText: "src/lib/foo.ts" }).click();

    await expect(input).toContainText("look at src/lib/foo.ts");
    await expect(input).not.toContainText("@");
    await expect(page.locator(list)).toHaveCount(0);
  });
});

test("a truncated list says how much of the answer it is showing", async ({ daemon, page }) => {
  const many: Record<string, string> = {};
  // Comfortably past the daemon's result cap, so the walk stops on it.
  for (let i = 0; i < 60; i++) many[`f${String(i).padStart(3, "0")}.ts`] = "export {};\n";
  await withProject(daemon, page, many, async () => {
    await composer(page);
    await page.keyboard.type("@");
    await expect(page.locator(header)).toHaveText(/First \d+ matches — keep typing to narrow/);
  });
});

test("an ordinary path in prose leaves no list open over the text", async ({ daemon, page }) => {
  await withProject(daemon, page, PROJECT, async () => {
    const input = await composer(page);
    await page.keyboard.type("rework src/lib/foo.ts before landing");
    await expect(input).toContainText("rework src/lib/foo.ts before landing");
    await expect(page.locator(list)).toHaveCount(0);
  });
});

test("a search with no match closes the list rather than leaving it standing", async ({
  daemon,
  page,
}) => {
  await withProject(daemon, page, PROJECT, async () => {
    await composer(page);
    await page.keyboard.type("@src");
    await expect(page.locator(list)).toBeVisible();
    await page.keyboard.type("zzzz");
    await expect(page.locator(list)).toHaveCount(0);
  });
});

test("ctrl+space previews the highlighted file, and follows the arrow keys", async ({
  daemon,
  page,
}) => {
  await withProject(daemon, page, PREVIEW_PROJECT, async () => {
    await composer(page);
    await page.keyboard.type("@src/lib/");
    await expect(rowsIn(page)).toHaveText(["src/lib/alpha.ts", "src/lib/beta.ts"]);

    await page.keyboard.press("Control+Space");
    await expect(page.locator(panel)).toBeVisible();
    await expect(page.locator(panel)).toContainText("src/lib/alpha.ts");
    await expect(page.locator(panel)).toContainText("const alpha1 = 1;");

    // That the panel is PAINTED as caret chrome, not just present: it is a
    // theme() rule nested under a doubled class in the base theme, so reading the
    // value back off the live element is the only thing that proves it applies.
    const paper = await page.locator(panel).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(paper).not.toBe("rgba(0, 0, 0, 0)");
    expect(paper).not.toBe("transparent");

    // The panel is re-evaluated only when the SELECTED element changes, which is
    // why moving between rows is the gesture worth driving in a real browser.
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(panel)).toContainText("const beta = 0;");

    // And the strip now names the way back out.
    expect(await hintText(page)).toContain("close");

    await page.keyboard.press("Control+Space");
    await expect(page.locator(panel)).toHaveCount(0);
  });
});

test("a cited line moves the preview to it, and rides into what is inserted", async ({
  daemon,
  page,
}) => {
  await withProject(daemon, page, PREVIEW_PROJECT, async () => {
    const input = await composer(page);
    await page.keyboard.type("@src/lib/alpha.ts:42");
    // The daemon is asked for the path half, so the row is still the bare path.
    await expect(rowsIn(page)).toHaveText(["src/lib/alpha.ts"]);

    await page.keyboard.press("Control+Space");
    await expect(page.locator(markedLine)).toHaveText(/const alpha42 = 42;/);
    // The window is centred on the citation rather than starting at the file's head.
    await expect(page.locator(panel)).not.toContainText("const alpha1 = 1;");

    // Clicked rather than Entered, for the reason the insertion test above gives:
    // a prefix of this query matches the same single row, so a keypress can land
    // on a list `acceptCompletion` correctly refuses as stale.
    await rowsIn(page).filter({ hasText: "src/lib/alpha.ts" }).click();
    await expect(input).toContainText("src/lib/alpha.ts:42");
  });
});

test("turning shortcut hints off takes the strip away and leaves the shortcut", async ({
  daemon,
  page,
}) => {
  // Settings → Shortcut hints, set before the origin loads — the same route
  // shortcut-hints.e2e.ts and plan-search.e2e.ts take to the pref.
  await page.addInitScript(() => localStorage.setItem("caret.shortcutHints", "off"));
  await withProject(daemon, page, PREVIEW_PROJECT, async () => {
    await composer(page);
    await page.keyboard.type("@src/lib/alpha");
    await expect(rowsIn(page)).toHaveText(["src/lib/alpha.ts"]);
    expect(await hintText(page)).toBe("none");

    // The preference hides the affordance, never the shortcut.
    await page.keyboard.press("Control+Space");
    await expect(page.locator(panel)).toBeVisible();
    expect(await hintText(page)).toBe("none");
  });
});
