// Typing `@` in a feedback editor completes a file under the review's own
// working directory (EXC-1175). Choosing a row leaves the cwd-relative path
// behind as literal text, so the reference still resolves when the plan is
// executed in some later session.
//
// This needs a real browser twice over, and neither half is visible from the
// test body. CodeMirror paints its completion list into a tooltip it positions
// against the live selection, and the list only opens on real keystrokes routed
// through the editor's chord layer — a mounted component can be handed neither.
// Underneath that, the daemon is a real subprocess reading a real project off
// disk, which is the other thing no prop can stand in for: the whole feature is
// "what is actually in this review's cwd". The pure halves stay units — the
// source's trigger, query, and result shape in ui/src/lib/fileCompletion.test.ts,
// the walk and its caps in test/core/plan/file-search.test.ts, and the route in
// test/core/daemon/file-search.test.ts.
//
// Each test writes a synthetic project dir and seeds a review whose cwd points
// at it. The content is throwaway, non-identifying scaffolding — never a real
// plan.

import type { Locator, Page } from "@playwright/test";

import { makeProject } from "@test/e2e/support/file-refs.ts";
import { expect, test } from "@test/e2e/support/fixtures.ts";
import { planSurface, revealGutterPlus } from "@test/e2e/support/source-view.ts";

/** A project with one obvious subsequence target and two near-misses beside it. */
const PROJECT = {
  "src/lib/foo.ts": "export {};\n",
  "src/lib/bar.ts": "export {};\n",
  "src/app.ts": "export {};\n",
  "readme.md": "# throwaway\n",
};

const list = ".cm-tooltip-autocomplete";
const rows = `${list} li[role="option"]`;
const header = `${list} completion-section`;

/** Open the gutter composer on a line and return its editor, focused. */
async function composer(page: Page): Promise<Locator> {
  await (await revealGutterPlus(page, 3)).click();
  const dialog = page.getByRole("dialog", { name: "Add a comment" });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole("textbox", { name: "Comment" });
  await input.click();
  await expect(input).toBeFocused();
  return input;
}

test("an @ opens the files under the review's working directory", async ({ daemon, page }) => {
  const project = await makeProject(PROJECT);
  try {
    await daemon.seed({ cwd: project.dir });
    await page.goto("/");
    await planSurface(page);

    const input = await composer(page);
    await page.keyboard.type("see @");
    await expect(page.locator(list)).toBeVisible();
    await expect(page.locator(rows)).toHaveText([
      "readme.md",
      "src/app.ts",
      "src/lib/bar.ts",
      "src/lib/foo.ts",
    ]);
    // A complete answer claims nothing about being partial.
    await expect(page.locator(header)).toHaveCount(0);
    await expect(input).toContainText("see @");
  } finally {
    await project.cleanup();
  }
});

test("typing narrows the list by subsequence, not by prefix", async ({ daemon, page }) => {
  const project = await makeProject(PROJECT);
  try {
    await daemon.seed({ cwd: project.dir });
    await page.goto("/");
    await planSurface(page);

    await composer(page);
    await page.keyboard.type("@srlbfoo");
    // Not one of these characters starts the path or any of its segments.
    await expect(page.locator(rows)).toHaveText(["src/lib/foo.ts"]);
  } finally {
    await project.cleanup();
  }
});

test("choosing a row inserts the cwd-relative path and takes the @ with it", async ({
  daemon,
  page,
}) => {
  const project = await makeProject(PROJECT);
  try {
    await daemon.seed({ cwd: project.dir });
    await page.goto("/");
    await planSurface(page);

    const input = await composer(page);
    await page.keyboard.type("look at @srlbfoo");
    await expect(page.locator(rows)).toHaveText(["src/lib/foo.ts"]);
    await page.keyboard.press("Enter");

    await expect(input).toContainText("look at src/lib/foo.ts");
    await expect(input).not.toContainText("@");
    await expect(page.locator(list)).toHaveCount(0);
  } finally {
    await project.cleanup();
  }
});

test("a truncated list says how much of the answer it is showing", async ({ daemon, page }) => {
  const many: Record<string, string> = {};
  // Comfortably past the daemon's result cap, so the walk stops on it.
  for (let i = 0; i < 60; i++) many[`f${String(i).padStart(3, "0")}.ts`] = "export {};\n";
  const project = await makeProject(many);
  try {
    await daemon.seed({ cwd: project.dir });
    await page.goto("/");
    await planSurface(page);

    await composer(page);
    await page.keyboard.type("@");
    await expect(page.locator(header)).toHaveText(/First \d+ matches — keep typing to narrow/);
  } finally {
    await project.cleanup();
  }
});

test("an ordinary path in prose leaves no list open over the text", async ({ daemon, page }) => {
  const project = await makeProject(PROJECT);
  try {
    await daemon.seed({ cwd: project.dir });
    await page.goto("/");
    await planSurface(page);

    const input = await composer(page);
    await page.keyboard.type("rework src/lib/foo.ts before landing");
    await expect(input).toContainText("rework src/lib/foo.ts before landing");
    await expect(page.locator(list)).toHaveCount(0);
  } finally {
    await project.cleanup();
  }
});

test("a search with no match closes the list rather than leaving it standing", async ({
  daemon,
  page,
}) => {
  const project = await makeProject(PROJECT);
  try {
    await daemon.seed({ cwd: project.dir });
    await page.goto("/");
    await planSurface(page);

    await composer(page);
    await page.keyboard.type("@src");
    await expect(page.locator(list)).toBeVisible();
    await page.keyboard.type("zzzz");
    await expect(page.locator(list)).toHaveCount(0);
  } finally {
    await project.cleanup();
  }
});
