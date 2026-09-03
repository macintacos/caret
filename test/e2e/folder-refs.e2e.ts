// Folder references in the plan (EXC-918). A path-shaped token the daemon
// resolves to a DIRECTORY gets a folder glyph rather than a file one, and
// clicking it opens an interactive tree rooted at that path: its immediate
// children collapsed, each deeper level fetched only when the reader opens the
// folder above it.
//
// The card coexists with the file preview's docked lane (EXC-1129) rather than
// evicting it, which makes it usable as a navigation aid: the rules that keep
// that safe live here too — which clicks the card's capture-phase handler lets
// through, and which of the two capture-phase Escape handlers owns the key. It
// is also what makes a file row an opener rather than a label (EXC-1137):
// activating one opens that file in the lane and leaves the card standing.
//
// Everything here needs a real browser. The tree is @pierre/trees mounted
// through its web-components entry, so every row lives behind a custom element's
// own shadow root and is virtualized against a layout happy-dom does not do —
// and the affordances under test (a level arriving on expand, a file row opening
// its file while a directory row only expands, arrow keys moving focus without
// opening anything, Escape and outside-click dismissal, a click inside NOT
// dismissing, two capture-phase handlers dividing one keypress) are real
// hit-testing and real key handling. The pure halves stay units: the path
// arithmetic and card placement math in folderTree.test.ts, the card's own
// loading / empty / error / elision framing in FolderTree.test.ts. Where the card
// LANDS relative to the open lane is geometry over both surfaces, so it belongs
// to file-drawer.e2e.ts — including where a card-OPENED lane leaves it.
//
// The daemon is a real subprocess reading the local filesystem, so each test
// writes a synthetic project dir and seeds a review whose cwd points at it. The
// content is throwaway, non-identifying scaffolding — never a real plan.

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Locator, Page } from "@playwright/test";

import { cursor, expectCursorLine, readCursorLine } from "@test/e2e/support/cursor.ts";
import { makeProject, settleDrawer } from "@test/e2e/support/file-refs.ts";
import type { Daemon } from "@test/e2e/support/fixtures.ts";
import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { PLAN_SURFACE, planSurface } from "@test/e2e/support/source-view.ts";
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
const preview = "[data-file-preview]";
const lane = "[data-file-drawer]";

/** A plan citing both a directory and a file under it — the shape the coexistence
 * tests below need, and the one a reader following a plan actually meets. */
const BOTH_REFS =
  "# Refs\n\nThe tree under `src` matters, and `src/cache.ts` holds it.\n\nJust some plain prose here.\n";

/** Seed BOTH_REFS against a NESTED project and wait until both tokens resolved,
 * so a click below lands on a tagged reference rather than plain prose. */
async function seedBothRefs(daemon: Daemon, page: Page, dir: string): Promise<void> {
  await daemon.seed({ cwd: dir, plan: BOTH_REFS });
  await page.goto("/");
  await planSurface(page);
  await expect(page.locator('[data-file-ref="directory"]')).toHaveCount(1);
  await expect(page.locator('[data-file-ref=""]')).toHaveCount(1);
}

/**
 * Open the excerpt lane, then the folder card, and leave both standing.
 *
 * `settleDrawer` before the second assertion is what makes this a claim rather
 * than a snapshot: a lane being evicted is still visible for the length of its
 * closing wipe, so asserting straight after the card opens would pass against the
 * very behaviour these tests exist to forbid.
 */
async function openBoth(page: Page): Promise<void> {
  await page.locator('[data-file-ref=""]').click();
  await expect(page.locator(preview)).toBeVisible();
  await page.locator('[data-file-ref="directory"]').click();
  await expect(page.locator(card)).toBeVisible();
  await settleDrawer(page);
  await expect(page.locator(preview)).toBeVisible();
}

/**
 * Press Escape until the card is gone.
 *
 * Retried because Safe Mode swallows keystrokes for a short window right after
 * the view gains focus, so one immediate press can be eaten — the same shape the
 * file preview's Escape spec uses.
 */
async function dismissCard(page: Page): Promise<void> {
  await expect(async () => {
    await page.keyboard.press("Escape");
    await expect(page.locator(card)).toHaveCount(0, { timeout: 500 });
  }).toPass();
}

/** Press Escape twice past safe mode's grace, asserting the card closes on
 * the first press and the lane on the second — the precedence both
 * coexistence specs pin, whichever order the two surfaces were opened in. */
async function expectEscapeClosesCardThenLane(page: Page): Promise<void> {
  await waitPastSafeModeGrace(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(card)).toHaveCount(0);
  await expect(page.locator(lane)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(lane)).toHaveCount(0);
}

/** Seed `plan` (a single directory reference to `src` by default) against
 * `dir`, open it, and click the directory reference — the arrange nearly
 * every folder-card spec opens with, with no lane standing. */
async function openCard(
  daemon: Daemon,
  page: Page,
  dir: string,
  plan = "# Refs\n\nThe tree under `src` matters.\n",
): Promise<void> {
  await daemon.seed({ cwd: dir, plan });
  await page.goto("/");
  await planSurface(page);
  await expect(page.locator('[data-file-ref="directory"]')).toHaveCount(1);
  await page.locator('[data-file-ref="directory"]').click();
  await expect(page.locator(card)).toBeVisible();
}

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
    await planSurface(page);

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
    await openCard(daemon, page, proj.dir);
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
    await openCard(daemon, page, proj.dir);

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
    await openCard(daemon, page, proj.dir, "# Refs\n\nA chain lives under `src`.\n");

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
    await openCard(daemon, page, proj.dir);

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

/** Drill into `lib/` then `lib/deep/`, leaving both expanded — the two-level
 * dig every restore/refresh spec starts from before it dismisses or
 * refreshes the card. */
async function expandLibDeep(page: Page): Promise<void> {
  await page.locator(row("lib/")).click();
  await expect(page.locator(row("lib/deep/"))).toBeVisible();
  await page.locator(row("lib/deep/")).click();
  await expect(page.locator(row("lib/deep/leaf.ts"))).toBeVisible();
}

/** A project with 40 files under `wide/` — wide enough that its folder
 * card's virtualized list actually scrolls. */
function makeWideProject(): ReturnType<typeof makeProject> {
  return makeProject(
    Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [
        `wide/f${String(i).padStart(3, "0")}.ts`,
        "export {};\n",
      ]),
    ),
  );
}

/** Open the card on a `makeWideProject` project and scroll its virtualized
 * list to row 10 (220px, an exact multiple of the card's 22px row).
 * Returns the scroller locator for the caller's own assertions. */
async function openCardScrolledDown(daemon: Daemon, page: Page, dir: string): Promise<Locator> {
  await openCard(daemon, page, dir, "# Refs\n\nEverything sits in `wide`.\n");

  const scroller = page.locator(`${card} [data-file-tree-virtualized-scroll]`);
  await scroller.evaluate((el) => {
    el.scrollTop = 220;
  });
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(220);
  return scroller;
}

test("clicking a file row opens that file in the excerpt lane", async ({ daemon, page }) => {
  // The card is a place the reader navigates FROM (EXC-1137): a file row opens
  // its file in the same lane a filename reference opens. The path asserted is
  // the CWD-relative one — the row's own path is "cache.ts", relative to the
  // directory the card is rooted at, so `src/cache.ts` is the conversion landing.
  const proj = await makeProject(NESTED);
  try {
    await openCard(daemon, page, proj.dir);
    await expect(page.locator(rows)).toHaveCount(2);

    await page.locator(row("cache.ts")).click();

    await expect(page.locator(preview)).toBeVisible();
    await expect(page.locator(`${preview} .fp-path`)).toHaveText("src/cache.ts");
    // A tree row carries no `:line`, so the excerpt is framed on the file's head
    // rather than on a range the row never named.
    await expect(page.locator(`${preview} .fp-row`).first().locator(".fp-lnum")).toHaveText("1");

    // Not a one-shot picker: the card stays open, with its tree intact, so the
    // next file is one more click.
    await expect(page.locator(card)).toBeVisible();
    await expect(page.locator(rows)).toHaveCount(2);
  } finally {
    await proj.cleanup();
  }
});

test("clicking a directory row expands it and opens nothing", async ({ daemon, page }) => {
  // The half of the activation rule that says which rows are openers. A directory
  // row's click is the library's own expand and nothing else — the card must not
  // turn every row into a link on the way to making file rows one.
  const proj = await makeProject(NESTED);
  try {
    await openCard(daemon, page, proj.dir);

    await page.locator(row("lib/")).click();
    await expect(page.locator(row("lib/"))).toHaveAttribute("aria-expanded", "true");
    // The level arriving is a network round trip, and a preview would have mounted
    // synchronously off the same click — so this ordering is what makes the
    // negative below a claim, with no timing beat of its own to add.
    await expect(page.locator(row("lib/util.ts"))).toBeVisible();
    await expect(page.locator(preview)).toHaveCount(0);
  } finally {
    await proj.cleanup();
  }
});

test("arrow keys move the focus ring without opening, Enter opens", async ({ daemon, page }) => {
  // Why the library's `onSelectionChange` is the wrong hook: it fires on focus
  // movement, so a walk down the tree would open one preview per keystroke. Only
  // an activation opens — and the keyboard's activation is the row <button>'s own,
  // which the card takes as an ordinary click rather than handling any key itself.
  const proj = await makeProject(NESTED);
  try {
    await openCard(daemon, page, proj.dir);

    // `lib/` is first, `cache.ts` second: one step down lands the ring on a FILE
    // row, which is the row a focus-driven opener would have opened. The focus
    // attribute landing IS that opener's trigger, so awaiting it orders the
    // negative below without a timing beat.
    //
    // Three waits before the key, each load-bearing. The tab stop is the
    // library's own signal that `focusFirstItem` has run — it happens in the
    // effect that mounts the tree, so a key pressed before it lands goes nowhere.
    // `toBeFocused` confirms the DOM caught up with the model. And focusing can
    // re-arm Safe Mode, whose grace window turns the very next keystroke into a
    // swallowed one — 2s of eaten input, which reads exactly like a ring that
    // refused to move.
    await expect(page.locator(row("lib/"))).toHaveAttribute("tabindex", "0");
    await page.locator(row("lib/")).focus();
    await expect(page.locator(row("lib/"))).toBeFocused();
    await waitPastSafeModeGrace(page);
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(row("cache.ts"))).toHaveAttribute("data-item-focused", "true");
    await expect(page.locator(preview)).toHaveCount(0);

    await page.keyboard.press("Enter");
    await expect(page.locator(preview)).toBeVisible();
    await expect(page.locator(`${preview} .fp-path`)).toHaveText("src/cache.ts");
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
    await openCard(
      daemon,
      page,
      proj.dir,
      "# Refs\n\nThe tree under `src` matters.\n\nJust some plain prose here.\n",
    );

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
    await openCard(daemon, page, proj.dir);

    await dismissCard(page);
  } finally {
    await proj.cleanup();
  }
});

test("compare mode leaves the card's key and click handlers behind with it", async ({
  daemon,
  page,
}) => {
  // The card renders on `!showDiff`, so compare mode takes it off screen while the
  // reference that opened it is still in state. Its dismissal handlers are
  // capture-phase listeners on window that `preventDefault` and swallow, so left
  // registered they eat one Escape and one click from the compare view the reader
  // is actually looking at — with no visible cause, which is the hardest kind of
  // bug to report. The lane's own effect carries the matching `showDiff` guard.
  //
  // Read through the card's survival: a swallowed Escape also CLEARS the card, so
  // a card still standing on the way back is the same claim as a key that reached
  // the compare view. That matches the lane, which likewise survives a round trip.
  const proj = await makeProject(NESTED);
  const plan = (n: number) => `# Refs v${n}\n\nThe tree under \`src\` matters.\n`;
  try {
    await daemon.seedVersions(2, [plan(1), plan(2)], proj.dir);
    await page.goto("/");
    await planSurface(page);
    await expect(page.locator('[data-file-ref="directory"]')).toHaveCount(1);
    await page.locator('[data-file-ref="directory"]').click();
    await expect(page.locator(card)).toBeVisible();
    await waitPastSafeModeGrace(page);

    // `d` toggles compare, which unrenders the card without clearing its state.
    await page.keyboard.press("d");
    await expect(page.locator(card)).toHaveCount(0);

    // Neither press belongs to the card: it is not on screen to receive them.
    await page.keyboard.press("Escape");
    await page.locator(PLAN_SURFACE).click();

    await page.keyboard.press("d");
    await expect(page.locator(card)).toBeVisible();
  } finally {
    await proj.cleanup();
  }
});

// EXC-1129. The card and the excerpt lane used to evict one another, so following
// a plan that cites a folder and the files under it cost the reader whichever
// surface they were already using — and the card was unusable as the navigation
// aid it exists to be. The tests below are the contract that replaced it.
test("a directory reference opens the card beside an open preview", async ({ daemon, page }) => {
  const proj = await makeProject(NESTED);
  try {
    await seedBothRefs(daemon, page, proj.dir);

    await page.locator('[data-file-ref=""]').click();
    await expect(page.locator(preview)).toBeVisible();

    await page.locator('[data-file-ref="directory"]').click();
    await expect(page.locator(card)).toBeVisible();
    // Settled before the lane is asserted: an evicted lane stays visible for the
    // length of its closing wipe, so a bare check would pass against the old
    // behaviour. `openBoth` below carries the same guard for the tests that only
    // need the state, not the claim.
    await settleDrawer(page);
    await expect(page.locator(preview)).toBeVisible();
  } finally {
    await proj.cleanup();
  }
});

test("a file reference opens the preview beside an open card", async ({ daemon, page }) => {
  // The reverse direction, and the one that only holds because the card's own
  // click handler lets a reference token through WITHOUT dismissing the card.
  const proj = await makeProject(NESTED);
  try {
    await seedBothRefs(daemon, page, proj.dir);

    await page.locator('[data-file-ref="directory"]').click();
    await expect(page.locator(card)).toBeVisible();

    await page.locator('[data-file-ref=""]').click();
    await expect(page.locator(preview)).toBeVisible();
    await expect(page.locator(card)).toBeVisible();
  } finally {
    await proj.cleanup();
  }
});

test("with both open, the preview's close circle closes it on the first press", async ({
  daemon,
  page,
}) => {
  // The lane is a coexisting surface, not the "outside" the card is dismissed by,
  // so a click in it is neither swallowed nor a dismissal — which is what makes
  // the close circle work on one press rather than two.
  const proj = await makeProject(NESTED);
  try {
    await seedBothRefs(daemon, page, proj.dir);

    await openBoth(page);

    await page.locator(".fp-close").click();
    await expect(page.locator(preview)).toHaveCount(0);
    await expect(page.locator(card)).toBeVisible();
  } finally {
    await proj.cleanup();
  }
});

test("with both open, Escape closes the card first and the lane second", async ({
  daemon,
  page,
}) => {
  // Both dismissals are capture-phase keydown listeners on window, where
  // stopPropagation says nothing to a sibling — so precedence is state, not
  // ordering: the lane does not listen at all while a card is stacked over it.
  const proj = await makeProject(NESTED);
  try {
    await seedBothRefs(daemon, page, proj.dir);

    await openBoth(page);
    // Deterministic presses rather than retried ones: a retry would re-press
    // after the card closed and take the lane with it, hiding the ordering.
    await expectEscapeClosesCardThenLane(page);
  } finally {
    await proj.cleanup();
  }
});

test("a lane opened from the card yields Escape to the card just the same", async ({
  daemon,
  page,
}) => {
  // Escape's meaning must not depend on how the lane was opened. Opening from a
  // row (EXC-1137) is the one path that leaves the card standing over a lane it
  // created, so it is the path where an order keyed on anything other than "is a
  // card open" would diverge — and the two surfaces would close on one press.
  const proj = await makeProject(NESTED);
  try {
    await openCard(daemon, page, proj.dir);

    await page.locator(row("cache.ts")).click();
    await expect(page.locator(preview)).toBeVisible();
    await settleDrawer(page);

    await expectEscapeClosesCardThenLane(page);
  } finally {
    await proj.cleanup();
  }
});

test("with both open, plan prose dismisses only the card", async ({ daemon, page }) => {
  // Only the lane half is asserted here. Plan prose matches nothing on
  // CARD_EXEMPT, so it falls through the same swallow branch it always did —
  // which the outside-click test above already pins, and which coexistence never
  // put at risk. Re-asserting it would need a wait on an event that must not
  // happen, and the honest form of that is not a clock the app holds no deadline
  // on (doc/agents/browser-testing.md § Timing discipline).
  const proj = await makeProject(NESTED);
  try {
    await seedBothRefs(daemon, page, proj.dir);

    await openBoth(page);

    await page.locator(".diffview").getByText("Just some plain prose here.").click();
    await expect(page.locator(card)).toHaveCount(0);
    await expect(page.locator(preview)).toBeVisible();
  } finally {
    await proj.cleanup();
  }
});

test("with both open, the plan's own line cursor still moves", async ({ daemon, page }) => {
  // The card swallows outside CLICKS; it was never entitled to the plan's keys.
  // With a second surface now able to sit open indefinitely, that stays true.
  const proj = await makeProject(NESTED);
  try {
    await seedBothRefs(daemon, page, proj.dir);

    await openBoth(page);
    await waitPastSafeModeGrace(page);

    await page.keyboard.press("j");
    await expect(cursor(page)).toHaveCount(1);
    const start = await readCursorLine(page);
    await page.keyboard.press("j");
    await expectCursorLine(page, start + 1);
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
    await openCard(daemon, page, proj.dir);

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
    await openCard(daemon, page, proj.dir, "# Refs\n\nEverything sits in `wide`.\n");

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
    await planSurface(page);

    // The `[]()` is gone; both labels survive and carry their kind.
    await expect(page.locator(".diffview").getByText("](src/lib/)")).toHaveCount(0);
    await expect(page.locator('[data-file-ref="directory"]')).toHaveText("src/lib/");
    await expect(page.locator('[data-file-ref=""]')).toHaveText("src/cache.ts");

    await page.locator('[data-file-ref="directory"]').click();
    await expect(page.locator(card)).toBeVisible();
    await expect(page.locator(row("util.ts"))).toBeVisible();

    // The file link on the same plan opens the excerpt beside it — one click,
    // because a reference click is let through, and the card stays (EXC-1129).
    await page.locator('[data-file-ref=""]').click();
    await expect(page.locator(preview)).toBeVisible();
    await expect(page.locator(card)).toBeVisible();
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
    await planSurface(page);

    // The label survives verbatim — it is never rewritten to the path — and the
    // markup around it is gone. The glyph lands on the label wherever it sits:
    // the decoration pass cuts each row at the reference's own columns, so prose
    // beside the label no longer costs it the icon (EXC-867, see links.ts). The
    // label being the whole line here is a convenience of the fixture, not a
    // condition the glyph depends on.
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
    await planSurface(page);
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
    await openCard(daemon, page, proj.dir, "# Refs\n\nNothing lives in `hollow` yet.\n");

    await expect(page.locator(`${card} [data-folder-state="empty"]`)).toContainText(
      "This folder is empty.",
    );
  } finally {
    await proj.cleanup();
  }
});

// Reopening a card the reader has already been in (EXC-1138). Which folders come
// back open is the tree's own model behind the shadow root, and it is restored
// through a construction-time expansion set rather than by replaying clicks — so
// only a real tree can say whether it worked. The pure halves stay units: the
// snapshot round-trip and the top-row arithmetic in folderTree.test.ts, and the
// request a restored card does NOT make in FolderTree.test.ts.

test("reopening a folder reference brings back the folders that were open", async ({
  daemon,
  page,
}) => {
  const proj = await makeProject(NESTED);
  try {
    await openCard(daemon, page, proj.dir);
    await expandLibDeep(page);

    await dismissCard(page);

    // Count only what the REOPEN asks for. A restored card is constructed from
    // the levels it was already served, so the answer is none — the assertions
    // below would otherwise pass just as well against a card that refetched
    // every level and happened to settle before they ran.
    let dirRequests = 0;
    page.on("request", (req) => {
      if (req.url().includes("/dir?")) dirRequests += 1;
    });

    await page.locator('[data-file-ref="directory"]').click();
    await expect(page.locator(card)).toBeVisible();
    await expect(page.locator(row("lib/"))).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(row("lib/deep/"))).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(row("lib/deep/leaf.ts"))).toBeVisible();
    expect(dirRequests).toBe(0);
  } finally {
    await proj.cleanup();
  }
});

test("two folder references in one review each keep their own state", async ({ daemon, page }) => {
  // The memory is keyed on the pair, so opening the second reference must not
  // hand it the first one's tree — nor cost the first one its own.
  const proj = await makeProject(NESTED);
  try {
    await daemon.seed({
      cwd: proj.dir,
      plan: "# Refs\n\nThe tree under `src` matters, and so does `src/lib`.\n",
    });
    await page.goto("/");
    await planSurface(page);
    await expect(page.locator('[data-file-ref="directory"]')).toHaveCount(2);
    const outer = page.locator('[data-file-ref="directory"]').first();
    const inner = page.locator('[data-file-ref="directory"]').last();

    await outer.click();
    await page.locator(row("lib/")).click();
    await expect(page.locator(row("lib/util.ts"))).toBeVisible();
    await dismissCard(page);

    // A card rooted one level down: its own rows, with nothing carried over
    // from the reference above it.
    await inner.click();
    await expect(page.locator(`${card} .ft-path`)).toHaveText("src/lib");
    await expect(page.locator(row("deep/"))).toHaveAttribute("aria-expanded", "false");
    await page.locator(row("deep/")).click();
    await expect(page.locator(row("deep/leaf.ts"))).toBeVisible();
    await dismissCard(page);

    // Each comes back as the reader left it.
    await outer.click();
    await expect(page.locator(row("lib/"))).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(row("lib/deep/"))).toHaveAttribute("aria-expanded", "false");
    await dismissCard(page);

    await inner.click();
    await expect(page.locator(row("deep/"))).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(row("deep/leaf.ts"))).toBeVisible();
  } finally {
    await proj.cleanup();
  }
});

test("reopening a folder reference comes back to the same place in the list", async ({
  daemon,
  page,
}) => {
  // The scroll half of the restore, and it can only be pinned here. The offset
  // lives on an element inside @pierre/trees' own shadow root, virtualized
  // against a layout happy-dom does not do — and the card is read while it is
  // still attached, which a unit that injects `scrollTop` as a literal cannot
  // tell apart from one that reads it too late and gets 0.
  const proj = await makeWideProject();
  try {
    const scroller = await openCardScrolledDown(daemon, page, proj.dir);

    await dismissCard(page);
    await page.locator('[data-file-ref="directory"]').click();
    await expect(page.locator(card)).toBeVisible();

    // Back on the row the reader was on, rather than at the top of the list.
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(220);
  } finally {
    await proj.cleanup();
  }
});

// Refreshing a cached tree (EXC-1139). Once levels are cached, a dismiss and
// reopen no longer re-reads the filesystem — and a caret review runs while an
// agent edits the working copy. Only a real browser can say whether the repaint
// keeps what the reader had: the expansion set survives a `resetPaths` in the
// library's own model, the scroll offset lives on an element inside its shadow
// root, and a directory can only actually be deleted underneath a daemon that
// is really reading a disk. The pure halves stay units — what the answers make
// of the card in folderTree.test.ts, and the control's framing and requests in
// FolderTree.test.ts.

/** The header's refresh control, by the role and name a reader actually depends
 * on — the class is caret's own and would break these tests for a rename that
 * changes nothing they care about (browser-testing.md § Locators). */
const refreshControl = (page: Page) =>
  page.locator(card).getByRole("button", { name: "Re-read this folder" });

test("refreshing a folder card keeps the folders that were open", async ({ daemon, page }) => {
  const proj = await makeProject(NESTED);
  try {
    await openCard(daemon, page, proj.dir);
    await expandLibDeep(page);

    // Count only what the REFRESH asks for. Three levels are open — the card's
    // own root, `lib/` and `lib/deep/` — and re-reading is the whole point, so
    // the assertions below would pass just as well against a control that
    // repainted the cache without touching the daemon.
    let dirRequests = 0;
    page.on("request", (req) => {
      if (req.url().includes("/dir?")) dirRequests += 1;
    });

    await refreshControl(page).click();
    await expect.poll(() => dirRequests).toBe(3);
    await expect(page.locator(row("lib/"))).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(row("lib/deep/"))).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(row("lib/deep/leaf.ts"))).toBeVisible();
  } finally {
    await proj.cleanup();
  }
});

test("refreshing a folder card comes back to the same place in the list", async ({
  daemon,
  page,
}) => {
  // A refresh that scrolled the reader back to the top would undo the issue
  // before this one as surely as one that collapsed the tree.
  const proj = await makeWideProject();
  try {
    const scroller = await openCardScrolledDown(daemon, page, proj.dir);

    await refreshControl(page).click();
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(220);
  } finally {
    await proj.cleanup();
  }
});

test("a directory that has gone leaves the card instead of standing open and empty", async ({
  daemon,
  page,
}) => {
  const proj = await makeProject(NESTED);
  try {
    await openCard(daemon, page, proj.dir);
    await expandLibDeep(page);

    // The agent the reader is reviewing deletes the directory they have open.
    await rm(join(proj.dir, "src/lib/deep"), { recursive: true, force: true });

    await refreshControl(page).click();
    await expect(page.locator(row("lib/deep/"))).toHaveCount(0);
    await expect(page.locator(row("lib/"))).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(row("lib/util.ts"))).toBeVisible();
  } finally {
    await proj.cleanup();
  }
});

test("the refresh control keeps focus when it is pressed from the keyboard", async ({
  daemon,
  page,
}) => {
  // The card focuses a tree row on open and a restore scrolls to one, so the
  // refresh is the one repaint that must NOT move focus: it is the only one the
  // reader asked for by pressing something.
  const proj = await makeProject(NESTED);
  try {
    await openCard(daemon, page, proj.dir);

    await writeFile(join(proj.dir, "src/added.ts"), "export {};\n");
    // Past safe mode's grace before any keypress: the guard swallows keystrokes
    // inside it, in the capture phase, so an Enter sent earlier never reaches the
    // control at all.
    await waitPastSafeModeGrace(page);
    await refreshControl(page).focus();
    await page.keyboard.press("Enter");

    await expect(page.locator(row("added.ts"))).toBeVisible();
    await expect(refreshControl(page)).toBeFocused();
  } finally {
    await proj.cleanup();
  }
});

test("a folder that empties says so, and comes back when it refills", async ({ daemon, page }) => {
  // The one case where a refresh changes what the card IS rather than what is in
  // it. The lane is hidden rather than unmounted so the tree object — and the
  // control that would bring the folder back — survives an empty round trip;
  // only a real virtualizer can say that the rows return afterwards.
  const proj = await makeProject({ "src/only.ts": "export {};\n" });
  try {
    await openCard(daemon, page, proj.dir);
    await expect(page.locator(row("only.ts"))).toBeVisible();

    await rm(join(proj.dir, "src/only.ts"));
    await refreshControl(page).click();
    await expect(page.locator(`${card} [data-folder-state="empty"]`)).toContainText(
      "This folder is empty.",
    );
    await expect(refreshControl(page)).toBeVisible();

    await writeFile(join(proj.dir, "src/again.ts"), "export {};\n");
    await refreshControl(page).click();
    await expect(page.locator(row("again.ts"))).toBeVisible();
    await expect(page.locator(`${card} [data-folder-state="empty"]`)).toHaveCount(0);
  } finally {
    await proj.cleanup();
  }
});
