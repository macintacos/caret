// A reference caret recognizes wears a chip while the reviewer is still typing
// it; one it cannot resolve stays prose (EXC-1177). That is the whole feedback
// loop the composing side was missing — until now a wrong path only announced
// itself when the plan came back from the agent, which is too late to fix.
//
// This needs a real browser and a real daemon, and neither is visible from the
// test body. The chip is a CodeMirror mark styled by `.float-chip` from the
// document's own stylesheet, painted into content the diffs library slot-projects
// into its shadow root — so whether the atom actually reaches it is a question
// only a rendered page answers. Underneath that, recognition IS the filesystem:
// the daemon is a subprocess reading a real project off disk, which is what no
// prop can stand in for. And the last two cases are the criteria a mounted
// component cannot reach at all — that a chip does not break a drag-selection
// across it, or the caret walking through it.
//
// The pure halves stay units. Which runs are reference-shaped, and the
// scheduling contract behind the resolve, are in ui/src/lib/editorRefs.test.ts;
// that the editor turns a recognized key into marks over the right text is in
// ui/src/lib/markdownEditor.test.ts.
//
// Each test writes a synthetic project dir and seeds a review whose cwd points at
// it. The content is throwaway, non-identifying scaffolding — never a real plan.

import type { Page } from "@playwright/test";

import { makeProject } from "@test/e2e/support/file-refs.ts";
import type { Daemon } from "@test/e2e/support/fixtures.ts";
import { expect, test } from "@test/e2e/support/fixtures.ts";
import { composer, planSurface } from "@test/e2e/support/source-view.ts";

const PROJECT = {
  "src/lib/foo.ts": "export {};\n",
  "readme.md": "# throwaway\n",
};

const chips = (page: Page) => page.locator(".cm-md-ref");

/** Write a throwaway project, seed a review whose cwd points at it, open the
 * plan, and clean up afterwards. */
async function withProject(
  daemon: Daemon,
  page: Page,
  run: (page: Page) => Promise<void>,
): Promise<void> {
  const project = await makeProject(PROJECT);
  try {
    await daemon.seed({ cwd: project.dir });
    await page.goto("/");
    await planSurface(page);
    await run(page);
  } finally {
    await project.cleanup();
  }
}

test("a path that resolves is chipped and one that does not stays prose", async ({
  daemon,
  page,
}) => {
  await withProject(daemon, page, async () => {
    await composer(page);
    await page.keyboard.type("rework src/lib/foo.ts, not src/lib/gone.ts");
    await expect(chips(page)).toHaveText(["src/lib/foo.ts"]);
  });
});

test("the chip wears the shared atom's fill rather than the editor's background", async ({
  daemon,
  page,
}) => {
  // `.float-chip` lives in the document's stylesheet and the editor's content is
  // slot-projected into the diffs library's shadow root. A class-name assertion
  // would pass whether or not the rule reached it; a painted fill would not.
  await withProject(daemon, page, async () => {
    await composer(page);
    await page.keyboard.type("see readme.md");
    await expect(chips(page)).toHaveCount(1);
    const fill = await chips(page).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(fill).not.toBe("rgba(0, 0, 0, 0)");
    expect(fill).not.toBe("transparent");
  });
});

test("a known skill is chipped and an invented one is not", async ({ daemon, page }) => {
  // The e2e daemon deliberately wires no skill capability (its `/skills` route
  // 404s, so a spec can never read the developer's real ~/.claude), so this one
  // answers the route itself.
  await page.route("**/api/reviews/*/skills", (route) =>
    route.fulfill({ json: [{ name: "git", origin: "user" }] }),
  );
  await withProject(daemon, page, async () => {
    await composer(page);
    await page.keyboard.type("run /git before /nope");
    await expect(chips(page)).toHaveText(["/git"]);
  });
});

test("editing a chipped path until it stops resolving drops the chip", async ({ daemon, page }) => {
  await withProject(daemon, page, async () => {
    await composer(page);
    await page.keyboard.type("rework src/lib/foo.ts");
    await expect(chips(page)).toHaveText(["src/lib/foo.ts"]);
    await page.keyboard.type("x");
    await expect(chips(page)).toHaveCount(0);
  });
});

test("a chip is presentation only: selecting across it yields the literal text", async ({
  daemon,
  page,
}) => {
  await withProject(daemon, page, async () => {
    const input = await composer(page);
    await page.keyboard.type("rework src/lib/foo.ts now");
    await expect(chips(page)).toHaveCount(1);

    await page.keyboard.press("ControlOrMeta+a");
    const selected = await input.evaluate(() => document.getSelection()?.toString() ?? "");
    expect(selected).toBe("rework src/lib/foo.ts now");
  });
});

test("the caret walks through a chip a character at a time", async ({ daemon, page }) => {
  await withProject(daemon, page, async () => {
    await composer(page);
    await page.keyboard.type("see src/lib/foo.ts");
    await expect(chips(page)).toHaveCount(1);

    // Home, then one ArrowRight per character of "see src/lib/foo.ts" minus the
    // last: a mark that swallowed movement (a widget, or a replacing decoration)
    // would land the caret past the end, and typing would append rather than
    // insert before the final character.
    await page.keyboard.press("Home");
    for (let i = 0; i < "see src/lib/foo.t".length; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.type("X");
    await expect(page.locator(".cm-content")).toHaveText("see src/lib/foo.tXs");
  });
});
