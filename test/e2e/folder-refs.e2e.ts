// Folder references in the plan (EXC-918). A path-shaped token the daemon
// resolves to a DIRECTORY gets a folder glyph rather than a file one, and
// clicking it opens an interactive tree rooted at that path: its immediate
// children collapsed, each deeper level fetched only when the reader opens the
// folder above it.
//
// Everything here needs a real browser. The tree is @pierre/trees mounted
// through its web-components entry, so every row lives behind a custom element's
// own shadow root and is virtualized against a layout happy-dom does not do —
// and the affordances under test (a level arriving on expand, a file row doing
// nothing, Escape and outside-click dismissal, a click inside NOT dismissing)
// are real hit-testing and real key handling. The pure halves stay units: the
// path arithmetic and card placement in folderTree.test.ts, the card's own
// loading / empty / error / elision framing in FolderTree.test.ts.
//
// The daemon is a real subprocess reading the local filesystem, so each test
// writes a synthetic project dir and seeds a review whose cwd points at it. The
// content is throwaway, non-identifying scaffolding — never a real plan.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { makeProject } from "@test/e2e/support/file-refs.ts";
import { expect, test } from "@test/e2e/support/fixtures.ts";
import { MAX_DIR_ENTRIES } from "@/plan/directory.ts";

/** A project whose `src` holds one file and one nested directory, so a card
 * opened on `src` has exactly one folder to expand and one level below it. */
const NESTED = {
  "src/cache.ts": "export const cache = new Map();\n",
  "src/lib/util.ts": "export {};\n",
  "src/lib/deep/leaf.ts": "export {};\n",
};

const card = "[data-folder-tree]";
const rows = `${card} [data-type="item"]`;
const row = (path: string) => `${card} [data-item-path="${path}"]`;

test("a directory reference draws a folder glyph and a file reference a file one", async ({
  daemon,
  page,
}) => {
  // The kind rides on the tag's VALUE, so both spellings still match
  // `[data-file-ref]` — which is what every hit-test and hover rule uses — while
  // only the directory selects the folder mask.
  const proj = await makeProject(NESTED);
  try {
    await daemon.seed({
      cwd: proj.dir,
      plan: "# Refs\n\nEdit `src/cache.ts`, which lives under `src/lib`.\n",
    });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();

    await expect(page.locator("[data-file-ref]")).toHaveCount(2);
    await expect(page.locator('[data-file-ref="directory"]')).toHaveText("src/lib");
    // The file's tag is valueless, so an attribute-value selector must not match
    // it — a regression that tagged both would still leave the count at 2.
    await expect(page.locator('[data-file-ref=""]')).toHaveText("src/cache.ts");
  } finally {
    await proj.cleanup();
  }
});

test("clicking a directory reference opens its immediate children, collapsed", async ({
  daemon,
  page,
}) => {
  const proj = await makeProject(NESTED);
  try {
    await daemon.seed({ cwd: proj.dir, plan: "# Refs\n\nThe tree under `src` matters.\n" });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();
    await expect(page.locator('[data-file-ref="directory"]')).toHaveCount(1);

    await page.locator('[data-file-ref="directory"]').click();
    await expect(page.locator(card)).toBeVisible();
    await expect(page.locator(`${card} .ft-path`)).toHaveText("src");

    // Exactly `src`'s own two children — the directory first, then the file —
    // and nothing from the level below, which no one has asked for yet.
    await expect(page.locator(rows)).toHaveCount(2);
    await expect(page.locator(row("lib/"))).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(row("cache.ts"))).toBeVisible();
    await expect(page.locator(row("lib/util.ts"))).toHaveCount(0);
  } finally {
    await proj.cleanup();
  }
});

test("expanding a folder fetches that level and only that level", async ({ daemon, page }) => {
  // The lazy half. `src/lib` holds a file and a further directory; opening it
  // must bring both and stop there, leaving `deep`'s own contents unfetched
  // until the reader opens it too.
  const proj = await makeProject(NESTED);
  try {
    await daemon.seed({ cwd: proj.dir, plan: "# Refs\n\nThe tree under `src` matters.\n" });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();
    await expect(page.locator('[data-file-ref="directory"]')).toHaveCount(1);
    await page.locator('[data-file-ref="directory"]').click();
    await expect(page.locator(card)).toBeVisible();

    await page.locator(row("lib/")).click();
    await expect(page.locator(row("lib/"))).toHaveAttribute("aria-expanded", "true");
    // The level arrived: both of `lib`'s children are rows now.
    await expect(page.locator(row("lib/util.ts"))).toBeVisible();
    await expect(page.locator(row("lib/deep/"))).toBeVisible();
    // …and it stopped there. `deep`'s own child is a level nobody opened.
    await expect(page.locator(row("lib/deep/leaf.ts"))).toHaveCount(0);

    // Opening `deep` is what fetches it — the same gesture, one level deeper.
    await page.locator(row("lib/deep/")).click();
    await expect(page.locator(row("lib/deep/leaf.ts"))).toBeVisible();
  } finally {
    await proj.cleanup();
  }
});

test("a directory holding only another directory still expands in one click", async ({
  daemon,
  page,
}) => {
  // The library flattens a chain of single-child directories into one row by
  // default, and reports that row as the chain's TERMINAL. Under one-level-at-a-
  // time loading that turns the first click into a no-op the reader can see: the
  // row they clicked renames itself from `only` to `only/deeper` and reads as
  // collapsed the moment its level lands. `flattenEmptyDirectories: false` is
  // what prevents it, and nothing else in the suite has a level of exactly one
  // directory to catch a regression.
  const proj = await makeProject({ "src/only/deeper/leaf.ts": "export {};\n" });
  try {
    await daemon.seed({ cwd: proj.dir, plan: "# Refs\n\nA chain lives under `src`.\n" });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();
    await expect(page.locator('[data-file-ref="directory"]')).toHaveCount(1);
    await page.locator('[data-file-ref="directory"]').click();
    await expect(page.locator(card)).toBeVisible();

    // The row is the directory itself, not the chain compacted into its tail.
    await expect(page.locator(rows)).toHaveCount(1);
    await expect(page.locator(row("only/"))).toBeVisible();

    // One click opens it, and it stays open with its child beneath it.
    await page.locator(row("only/")).click();
    await expect(page.locator(row("only/"))).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(row("only/deeper/"))).toBeVisible();
  } finally {
    await proj.cleanup();
  }
});

test("the tree can be entered and walked from the keyboard", async ({ daemon, page }) => {
  // Every element the library renders is `tabIndex -1` until something sets its
  // focused path, so without the card focusing its first row on open the tree is
  // reachable by pointer only. Tab order and native key handling are real-browser
  // behaviour, so this is the only layer that can tell whether the fix holds.
  const proj = await makeProject(NESTED);
  try {
    await daemon.seed({ cwd: proj.dir, plan: "# Refs\n\nThe tree under `src` matters.\n" });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();
    await expect(page.locator('[data-file-ref="directory"]')).toHaveCount(1);
    await page.locator('[data-file-ref="directory"]').click();
    await expect(page.locator(card)).toBeVisible();

    // The first row carries the tab stop — the whole tree is `-1` without it.
    await expect(page.locator(row("lib/"))).toHaveAttribute("tabindex", "0");

    // Walk the tab order to it rather than focusing it directly: the claim is
    // that it IS in the tab order.
    const inCard = () =>
      page.evaluate(() => document.activeElement?.tagName === "FILE-TREE-CONTAINER");
    await expect(async () => {
      await page.keyboard.press("Tab");
      expect(await inCard()).toBe(true);
    }).toPass();

    // ArrowRight expands the focused row, and that expansion fetches its level
    // exactly as a click would — the reason the loader is driven off the model
    // rather than off a click handler.
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(row("lib/"))).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(row("lib/util.ts"))).toBeVisible();
  } finally {
    await proj.cleanup();
  }
});

test("clicking a file row does nothing", async ({ daemon, page }) => {
  // Files are inert by design: the card is for navigating a directory's shape,
  // and a file row is a leaf of that shape, not a link. So a click opens no
  // excerpt preview, dismisses nothing, and leaves the tree exactly as it was.
  const proj = await makeProject(NESTED);
  try {
    await daemon.seed({ cwd: proj.dir, plan: "# Refs\n\nThe tree under `src` matters.\n" });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();
    await expect(page.locator('[data-file-ref="directory"]')).toHaveCount(1);
    await page.locator('[data-file-ref="directory"]').click();
    await expect(page.locator(card)).toBeVisible();
    await expect(page.locator(rows)).toHaveCount(2);

    await page.locator(row("cache.ts")).click();

    // No positive event to await, so give the click pipeline a beat before
    // asserting nothing happened — a bare toHaveCount(0) would pass on its first
    // poll and so would race the very state change it rules out.
    const t0 = await page.evaluate(() => performance.now());
    await page.waitForFunction((t) => performance.now() > t + 300, t0);
    await expect(page.locator("[data-file-preview]")).toHaveCount(0);
    await expect(page.locator(card)).toBeVisible();
    await expect(page.locator(rows)).toHaveCount(2);
  } finally {
    await proj.cleanup();
  }
});

test("a click inside the card leaves it open, a click outside closes it", async ({
  daemon,
  page,
}) => {
  // The card is navigated rather than peeked at, so the dismissal has to tell
  // "the reader is using it" from "the reader is done with it". Both halves are
  // one capture-phase handler, and the inside test is the one that only holds if
  // composedPath is consulted — every row is behind a shadow root, so an
  // ordinary target check would read a click on a row as a click on the page.
  const proj = await makeProject(NESTED);
  try {
    await daemon.seed({
      cwd: proj.dir,
      plan: "# Refs\n\nThe tree under `src` matters.\n\nJust some plain prose here.\n",
    });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();
    await expect(page.locator('[data-file-ref="directory"]')).toHaveCount(1);
    await page.locator('[data-file-ref="directory"]').click();
    await expect(page.locator(card)).toBeVisible();

    // Inside, on the card's own chrome rather than a row: still open.
    await page.locator(`${card} .ft-header`).click();
    await expect(page.locator(card)).toBeVisible();

    // Inside, on a row behind the shadow root: still open.
    await page.locator(row("lib/")).click();
    await expect(page.locator(card)).toBeVisible();

    // Outside: closed. The click is swallowed too, so it does not also open the
    // line's comment composer — a second click would.
    await page.locator(".diffview").getByText("Just some plain prose here.").click();
    await expect(page.locator(card)).toHaveCount(0);
    const t0 = await page.evaluate(() => performance.now());
    await page.waitForFunction((t) => performance.now() > t + 300, t0);
    await expect(page.getByRole("dialog", { name: "Add a comment" })).toHaveCount(0);
  } finally {
    await proj.cleanup();
  }
});

test("Escape closes the card", async ({ daemon, page }) => {
  const proj = await makeProject(NESTED);
  try {
    await daemon.seed({ cwd: proj.dir, plan: "# Refs\n\nThe tree under `src` matters.\n" });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();
    await expect(page.locator('[data-file-ref="directory"]')).toHaveCount(1);
    await page.locator('[data-file-ref="directory"]').click();
    await expect(page.locator(card)).toBeVisible();

    // Retried, like the file preview's Escape spec: right after the view gains
    // focus, Safe Mode swallows keystrokes for a short window, so one immediate
    // press can be eaten.
    await expect(async () => {
      await page.keyboard.press("Escape");
      await expect(page.locator(card)).toHaveCount(0, { timeout: 500 });
    }).toPass();
  } finally {
    await proj.cleanup();
  }
});

test("a skipped directory is a row, and opening it reports that it is not listed", async ({
  daemon,
  page,
}) => {
  // The daemon marks `node_modules` (and `dist`, and any dotted name) as one it
  // will not enumerate. The card shows it anyway — the tree should match what is
  // on disk — but opening it says so rather than appearing to be an empty
  // directory, which is the one reading that would be a lie.
  const proj = await makeProject({
    "src/cache.ts": "export {};\n",
    "src/node_modules/dep/index.js": "module.exports = {};\n",
  });
  try {
    await daemon.seed({ cwd: proj.dir, plan: "# Refs\n\nThe tree under `src` matters.\n" });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();
    await expect(page.locator('[data-file-ref="directory"]')).toHaveCount(1);
    await page.locator('[data-file-ref="directory"]').click();
    await expect(page.locator(card)).toBeVisible();

    // It is a row like any other, and it carries no report until it is opened.
    await expect(page.locator(row("node_modules/"))).toBeVisible();
    await expect(page.locator(card)).not.toContainText("not listed");

    await page.locator(row("node_modules/")).click();
    await expect(page.locator(row("node_modules/"))).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(card)).toContainText("not listed");
    // Opened, and still exactly the two rows it started with: nothing under it
    // was enumerated.
    await expect(page.locator(rows)).toHaveCount(2);
  } finally {
    await proj.cleanup();
  }
});

test("a level wider than the daemon's cap says how many rows it elided", async ({
  daemon,
  page,
}) => {
  // The route caps a level at MAX_DIR_ENTRIES with no page-past, so the tail is
  // unreachable through the card at all. Saying how much is missing is the only
  // honest thing left to do — and it must read as a statement, never as a
  // control offering the rest.
  const OVER = 12;
  const files = Object.fromEntries(
    Array.from({ length: MAX_DIR_ENTRIES + OVER }, (_, i) => [
      `wide/f${String(i).padStart(4, "0")}.ts`,
      "export {};\n",
    ]),
  );
  const proj = await makeProject(files);
  try {
    await daemon.seed({ cwd: proj.dir, plan: "# Refs\n\nEverything sits in `wide`.\n" });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();
    await expect(page.locator('[data-file-ref="directory"]')).toHaveCount(1);
    await page.locator('[data-file-ref="directory"]').click();
    await expect(page.locator(card)).toBeVisible();

    await expect(page.locator(`${card} .ft-elided`)).toHaveText(`${OVER} more not shown`);
    // And it is inert text, not a button offering to fetch the rest.
    await expect(page.locator(`${card} button.ft-elided`)).toHaveCount(0);
  } finally {
    await proj.cleanup();
  }
});

// A directory cited as a markdown LINK is a folder reference too (EXC-956). The
// link collapses to its label and the label becomes the click target, exactly as
// a file-targeted one does since EXC-954 — and which surface opens is still the
// daemon's answer rather than the syntax's, so the two kinds sort themselves out
// on the same plan.
test("a linked directory opens the tree and a linked file opens the preview", async ({
  daemon,
  page,
}) => {
  const proj = await makeProject(NESTED);
  try {
    await daemon.seed({
      cwd: proj.dir,
      // Backticked labels, the citation shape caret's own plans use: the label
      // keeps a token of its own, so the glyph lands on it. The directory carries
      // a trailing slash and the file does not — a difference neither the link
      // layer nor the resolve is allowed to read anything into, and the slash
      // has to reach the daemon intact, since the response is keyed by the
      // string that was requested.
      plan: "# Refs\n\nRead [`src/lib/`](src/lib/) and then [`src/cache.ts`](src/cache.ts).\n",
    });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();

    // The `[]()` is gone; both labels survive and carry their kind.
    await expect(page.locator(".diffview").getByText("](src/lib/)")).toHaveCount(0);
    await expect(page.locator('[data-file-ref="directory"]')).toHaveText("src/lib/");
    await expect(page.locator('[data-file-ref=""]')).toHaveText("src/cache.ts");

    await page.locator('[data-file-ref="directory"]').click();
    await expect(page.locator(card)).toBeVisible();
    await expect(page.locator(row("util.ts"))).toBeVisible();

    // The file link on the same plan opens the excerpt instead, and the card
    // gives way to it — one click, because a reference click is let through.
    await page.locator('[data-file-ref=""]').click();
    await expect(page.locator("[data-file-preview]")).toBeVisible();
    await expect(page.locator(card)).toHaveCount(0);
  } finally {
    await proj.cleanup();
  }
});

test("a prose-labelled directory link collapses and still opens the tree", async ({
  daemon,
  page,
}) => {
  // Only the link layer can produce this reference: the target is gone from the
  // display text by the time the inline-code scan reads it, so a card opening
  // here is proof the emitted span survived the merge and the resolve.
  const proj = await makeProject(NESTED);
  try {
    await daemon.seed({ cwd: proj.dir, plan: "# Refs\n\n[the library tree](src/lib)\n" });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();

    // The label survives verbatim — it is never rewritten to the path — and the
    // markup around it is gone. The glyph lands because the label is the whole
    // line and so is its own token; put prose beside it and the line becomes one
    // coarse run that tagFileRefTokens refuses, which is the documented shape a
    // prose label usually has (see links.ts).
    await expect(page.locator(".diffview").getByText("](src/lib)")).toHaveCount(0);
    await expect(page.locator('[data-file-ref="directory"]')).toHaveText("the library tree");

    // The path is nowhere in the display text, so hover is the only place it can
    // appear. It reads the LINK's target, which the span carries for exactly this.
    await page.locator('[data-file-ref="directory"]').hover();
    await expect(page.locator("[data-link-tooltip]")).toHaveText("src/lib");

    await page.locator(".diffview").getByText("the library tree").click();
    await expect(page.locator(card)).toBeVisible();
    await expect(page.locator(`${card} .ft-path`)).toHaveText("src/lib");
  } finally {
    await proj.cleanup();
  }
});

test("an unresolved directory link collapses its markup but gets no affordance", async ({
  daemon,
  page,
}) => {
  // Collapsing is decided on shape, before anything resolves, so the markup goes
  // either way; the existence gate is what decides there is nothing to click.
  const proj = await makeProject(NESTED);
  try {
    await daemon.seed({
      // The second line carries a reference that DOES resolve, so waiting for its
      // tag is a real sync point for the resolve round trip. Without one, the
      // count-zero assertion below is true before the response even lands and
      // would pass whether or not the gate works.
      cwd: proj.dir,
      plan: "# Refs\n\n[a folder that moved](src/nowhere)\n\nThe tree under `src` matters.\n",
    });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();
    await expect(page.locator('[data-file-ref="directory"]')).toHaveCount(1);

    await expect(page.locator(".diffview").getByText("a folder that moved")).toBeVisible();
    await expect(page.locator(".diffview").getByText("](src/nowhere)")).toHaveCount(0);
    // Exactly the one from `src` — the collapsed label added none.
    await expect(page.locator("[data-file-ref]")).toHaveCount(1);

    await page.locator(".diffview").getByText("a folder that moved").click();
    // The label consumed nothing, so the row's own handler ran and opened the
    // composer. That is both a claim worth making and the ordered beat the two
    // negative assertions need — a fixed wait would race the state it rules out.
    await expect(page.getByRole("dialog", { name: "Add a comment" })).toBeVisible();
    await expect(page.locator(card)).toHaveCount(0);
    await expect(page.locator("[data-file-preview]")).toHaveCount(0);
  } finally {
    await proj.cleanup();
  }
});

test("an empty directory says so rather than opening a blank card", async ({ daemon, page }) => {
  const proj = await makeProject({ "keep.ts": "export {};\n" });
  try {
    await mkdir(join(proj.dir, "hollow"));
    await daemon.seed({ cwd: proj.dir, plan: "# Refs\n\nNothing lives in `hollow` yet.\n" });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();
    await expect(page.locator('[data-file-ref="directory"]')).toHaveCount(1);
    await page.locator('[data-file-ref="directory"]').click();

    await expect(page.locator(card)).toBeVisible();
    await expect(page.locator(`${card} [data-folder-state="empty"]`)).toContainText(
      "This folder is empty.",
    );
  } finally {
    await proj.cleanup();
  }
});
