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
// The preview adds a third thing only a browser has: WHERE the panel lands. It is
// a fixed element in <body>, placed against the list's own rect by a measure pass,
// and the reason it is not CodeMirror's own `Completion.info` is that the composers
// inside a scrolling dialog clipped that away — a failure no unit can see, because
// it is entirely a matter of layout. Reading the two rects back off the live page
// is what proves it lands beside the list rather than under or behind it.
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

import type { Locator, Page } from "@playwright/test";

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

/** Enough files under one directory that the list hits its own `max-height` —
 * which is what puts its foot near the bottom of the window, the shape the
 * flip-above rule exists for. A two-row list fits under any cursor and is
 * supposed to stay where it is. */
const CROWDED_PROJECT = Object.fromEntries(
  Array.from({ length: 24 }, (_, i) => [`src/lib/f${i}.ts`, `const f${i} = ${i};\n`]),
);

const list = ".cm-tooltip-autocomplete";
// Rows publish the listbox role, so the spec asserts the semantics the
// completion actually exposes rather than a class shape.
const rowsIn = (page: Page) => page.locator(list).getByRole("option");
const header = `${list} completion-section`;
// CodeMirror's own panel element, and caret's own parts inside it. No role and no
// accessible name — it is a description CodeMirror wires to the selected row
// through aria-describedby, not a landmark — so a class selector is what reaches
// it (browser-testing.md § Locators).
// The preview panel is caret's own element in <body>, NOT CodeMirror's
// `Completion.info` — which renders inside the list and was clipped away entirely
// in the two composers that sit in a scrolling dialog. So it is reached from the
// page, not from the list.
const panel = ".caret-preview";
const markedLine = `${panel} .caret-preview-marked`;
const hint = `${list} .caret-completion-hint`;

/** The list's box, the panel's, and the viewport's, read off the live page —
 * every placement assertion here is about how those three sit against each
 * other, and none of them is visible from the test body. */
async function rects(page: Page): Promise<{
  list: { left: number; right: number; top: number; bottom: number };
  win: { left: number; right: number; top: number; bottom: number; width: number; height: number };
  viewport: { w: number; h: number };
}> {
  const boxes = await page.evaluate(
    ([listSel, panelSel]) => {
      const l = document.querySelector(listSel as string)?.getBoundingClientRect();
      const p = document.querySelector(panelSel as string)?.getBoundingClientRect();
      if (!l || !p) return null;
      return {
        list: { left: l.left, right: l.right, top: l.top, bottom: l.bottom },
        win: {
          left: p.left,
          right: p.right,
          top: p.top,
          bottom: p.bottom,
          width: p.width,
          height: p.height,
        },
        viewport: { w: window.innerWidth, h: window.innerHeight },
      };
    },
    [list, panel],
  );
  if (boxes === null) throw new Error("expected both the list and the panel on screen");
  return boxes;
}

/** How much vertical space the panel shares with the list. Positive is what
 * "beside" MEANS — and it is the assertion a panel placed against an unplaced
 * tooltip fails, because that one lands at the top of the viewport with the list
 * far below it. */
async function verticalOverlap(page: Page): Promise<number> {
  const { list: l, win } = await rects(page);
  return Math.min(win.bottom, l.bottom) - Math.max(win.top, l.top);
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

/** Open the composer, resolve `@src/lib/alpha` to its one row, and press
 * Control+Space to open its preview. */
async function openAlphaPreview(page: Page): Promise<void> {
  await composer(page);
  await page.keyboard.type("@src/lib/alpha");
  await expect(rowsIn(page)).toHaveText(["src/lib/alpha.ts"]);
  await page.keyboard.press("Control+Space");
}

/** Open the composer, resolve `@src/lib/` to its two rows, and open the
 * preview on the first. */
async function openLibPreview(page: Page): Promise<void> {
  await composer(page);
  await page.keyboard.type("@src/lib/");
  await expect(rowsIn(page)).toHaveText(["src/lib/alpha.ts", "src/lib/beta.ts"]);
  await page.keyboard.press("Control+Space");
  await expect(page.locator(panel)).toBeVisible();
}

/** Set up the crowded-list placement scenario: a narrow, short viewport, the
 * completion-preview pref pre-set, and CROWDED_PROJECT's 24-row list typed
 * from the composer opened on `line` — then hand its input to `run` for the
 * caller's own placement assertions. */
async function withCrowdedList(
  daemon: Daemon,
  page: Page,
  line: number,
  run: (input: Locator) => Promise<void>,
): Promise<void> {
  await page.setViewportSize({ width: 760, height: 900 });
  await page.addInitScript(() => localStorage.setItem("caret.completionPreview", "on"));
  await withProject(daemon, page, CROWDED_PROJECT, async () => {
    const input = await composer(page, line);
    await page.keyboard.type("@src/lib/f");
    await expect(rowsIn(page)).toHaveCount(24);
    await expect(page.locator(panel)).toBeVisible();
    await run(input);
  });
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
    // And the list says the preview is there to be opened, in the chrome's own
    // keycaps — the reason the strip is a real element rather than the `::before`
    // it started as, since generated content cannot hold a <kbd>.
    await expect(page.locator(hint)).toContainText("to preview");
    await expect(page.locator(`${hint} kbd`)).toHaveText(["Ctrl", "Space"]);
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

test("choosing a row inserts the cwd-relative path, @ and all", async ({ daemon, page }) => {
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

    // The `@` stays: it is part of the reference the reviewer is writing, and the
    // chip in the composer is drawn over `@path` as one run.
    await expect(input).toContainText("look at @src/lib/foo.ts");
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
    await openLibPreview(page);
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
    await expect(page.locator(hint)).toContainText("close");

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
    // The panel is centred on the citation rather than starting at the file's head.
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
    await expect(page.locator(hint)).toHaveCount(0);

    // The preference hides the affordance, never the shortcut.
    await page.keyboard.press("Control+Space");
    await expect(page.locator(panel)).toBeVisible();
    await expect(page.locator(hint)).toHaveCount(0);
  });
});

test("the preview panel lands beside the list, not inside it", async ({ daemon, page }) => {
  // The whole reason the panel is caret's own rather than CodeMirror's
  // `Completion.info`: this is a matter of layout, and layout is the one thing no
  // unit can see. Both rects come off the live page.
  await withProject(daemon, page, PREVIEW_PROJECT, async () => {
    await openLibPreview(page);

    const boxes = await rects(page);

    // It has real size — the failure mode it replaced was a panel parked at
    // `top: -1e6px`, which is present, styled, and invisible.
    expect(boxes.win.width).toBeGreaterThan(0);
    expect(boxes.win.height).toBeGreaterThan(0);
    // Beside the list rather than over it: on one side or the other, never
    // overlapping, and never off the edge of the viewport.
    const beside = boxes.win.left >= boxes.list.right || boxes.win.right <= boxes.list.left;
    expect(beside).toBe(true);
    expect(boxes.win.left).toBeGreaterThanOrEqual(0);
    expect(boxes.win.right).toBeLessThanOrEqual(boxes.viewport.w);
  });
});

test("the preview survives a composer inside a scrolling dialog", async ({ daemon, page }) => {
  // The bug that moved the panel out of the completion list. The request-changes
  // dialog scrolls its body, and a CSS `overflow-y: auto` forces the other axis to
  // clip — so a panel anchored at `left: 100%` INSIDE the list was cut away
  // entirely there, while the same feature worked on the plan surface.
  await withProject(daemon, page, PREVIEW_PROJECT, async () => {
    await page.getByRole("button", { name: "Request changes" }).click();
    const dialog = page.getByRole("dialog", { name: "Send the plan back for revision" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox", { name: "General comment" }).click();

    await page.keyboard.type("@src/lib/alpha");
    await expect(rowsIn(page)).toHaveText(["src/lib/alpha.ts"]);
    await page.keyboard.press("Control+Space");

    await expect(page.locator(panel)).toBeVisible();
    await expect(page.locator(panel)).toContainText("const alpha1 = 1;");
    // Visible to Playwright is not enough on its own here — the panel it replaced
    // was "visible" too, just clipped to nothing by an ancestor. Ask the page what
    // is actually painted at the panel's own centre.
    const onTop = await page.locator(panel).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return el.contains(hit);
    });
    expect(onTop).toBe(true);
  });
});

test("the panel stays beside the list across a resize", async ({ daemon, page }) => {
  // A fixed element does not ride a window resize, so the panel is re-placed by
  // hand — and the list under it has moved by then. The rects have to agree
  // afterwards, which is a browser question end to end.
  await withProject(daemon, page, PREVIEW_PROJECT, async () => {
    await openLibPreview(page);
    expect(await verticalOverlap(page)).toBeGreaterThan(0);

    await page.setViewportSize({ width: 1180, height: 820 });
    await expect(page.locator(panel)).toBeVisible();
    expect(await verticalOverlap(page)).toBeGreaterThan(0);
  });
});

test("a window too narrow for both puts the preview below the list", async ({ daemon, page }) => {
  // Beside is the answer whenever it fits; when it does not, half a panel clipped
  // at the viewport's edge is worse than a whole one under the list.
  await page.setViewportSize({ width: 760, height: 900 });
  await withProject(daemon, page, PREVIEW_PROJECT, async () => {
    await openLibPreview(page);

    const boxes = await rects(page);
    // Under the list, not beside it, and still whole.
    expect(boxes.win.top).toBeGreaterThanOrEqual(boxes.list.bottom);
    expect(boxes.win.left).toBeGreaterThanOrEqual(0);
    expect(boxes.win.right).toBeLessThanOrEqual(boxes.viewport.w);
    expect(boxes.win.height).toBeGreaterThan(0);
  });
});

test("a list near the foot of the window rises above the line being typed", async ({
  daemon,
  page,
}) => {
  // With no room below the list for a stacked panel, the only place left was the
  // top of the screen — the panel stranded a long way from the row it describes.
  // Instead the list itself gets out of the way: caret reserves the panel's floor
  // out of the space CodeMirror lays tooltips in, so the list flips above the
  // cursor and the panel stacks over it. Narrow, so a side placement is off the
  // table; short, so the composer sits near the bottom.
  await withCrowdedList(
    daemon,
    page,
    // A line well down the plan, so the cursor sits below the middle of the window
    // and the room is decisively above it — the shape the whole rule is about.
    // Line 3 (the other test's line) is near the top of any window and is
    // supposed to keep its list below.
    20,
    async (input) => {
      // `cm-tooltip-above` is CodeMirror's own statement that it put the list on the
      // far side of the line being typed — the decision the reserved space provokes,
      // read back from the element it stamps it on rather than re-derived from rects
      // (the tooltip anchors to the CURSOR, which sits inside the composer's box,
      // not to the box's own edges).
      await expect(page.locator(list)).toHaveClass(/cm-tooltip-above/);

      // Polled, not read once: the flip lands on CodeMirror's own 50ms resize
      // debounce and the panel follows it a frame later, so the class arriving is
      // not yet the two having settled against each other.
      await expect
        .poll(async () => {
          const { list: l, win } = await rects(page);
          return win.bottom <= l.top + 1;
        })
        .toBe(true);

      const boxes = await rects(page);
      // All of it on screen, which is the whole point.
      expect(boxes.win.top).toBeGreaterThanOrEqual(0);
      expect(boxes.win.height).toBeGreaterThan(0);
      expect(boxes.list.top).toBeLessThan(
        await input.evaluate((el) => el.getBoundingClientRect().top),
      );
    },
  );
});

test("a list with room below it keeps its place under the line", async ({ daemon, page }) => {
  // The other half of the rule, and the one that keeps it from being a blanket
  // "always go up": a composer near the TOP of the window has its room below, so
  // the list stays there and the panel stacks under it.
  await withCrowdedList(daemon, page, 3, async (input) => {
    await expect(page.locator(list)).not.toHaveClass(/cm-tooltip-above/);

    await expect
      .poll(async () => {
        const { list: l, win } = await rects(page);
        return win.top >= l.bottom - 1;
      })
      .toBe(true);

    const boxes = await rects(page);
    expect(boxes.win.bottom).toBeLessThanOrEqual(boxes.viewport.h);
    expect(boxes.list.top).toBeGreaterThan(
      await input.evaluate((el) => el.getBoundingClientRect().top),
    );
  });
});

test("a file's lines are coloured the way the plan view colours them", async ({ daemon, page }) => {
  await withProject(daemon, page, PREVIEW_PROJECT, async () => {
    await openAlphaPreview(page);
    await expect(page.locator(panel)).toContainText("const alpha1 = 1;");

    // The grammar loads off disk after the lines are already up — that is the
    // point of the second pass — so the colour is awaited rather than assumed.
    const tokens = page.locator(`${panel} .caret-preview-code span`);
    await expect(tokens.first()).toBeAttached();
    // Coloured, and by more than one hue: a `const` keyword and the number after
    // it are different tokens, so one colour throughout would mean the theme never
    // reached the markup.
    await expect
      .poll(async () =>
        tokens.evaluateAll((els) => new Set(els.map((el) => getComputedStyle(el).color)).size),
      )
      .toBeGreaterThan(1);
  });
});

// The panel is a mode the reviewer is in, not a property of one list, so it
// outlives the tab. The round trip is two halves, one test each — the write, and
// then a fresh origin's read of what it wrote. Split rather than driven through a
// `page.reload()` because each half needs the gutter composer opened, and every
// test here pays for that once; a reload test pays twice.
test("turning the preview on is remembered", async ({ daemon, page }) => {
  await withProject(daemon, page, PREVIEW_PROJECT, async () => {
    await openAlphaPreview(page);
    await expect(page.locator(panel)).toBeVisible();

    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("caret.completionPreview")))
      .toBe("on");

    // And closing it is remembered just as much — the reviewer who turned it off
    // meant that too.
    await page.keyboard.press("Control+Space");
    await expect(page.locator(panel)).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("caret.completionPreview")))
      .toBe("off");
  });
});

test("a preview left on opens with the next list, with no chord", async ({ daemon, page }) => {
  // Seeded before the origin loads, the same route the shortcut-hints test above
  // takes to its pref — this is what a reviewer who turned it on yesterday has.
  await page.addInitScript(() => localStorage.setItem("caret.completionPreview", "on"));
  await withProject(daemon, page, PREVIEW_PROJECT, async () => {
    await composer(page);
    await page.keyboard.type("@src/lib/alpha");
    await expect(rowsIn(page)).toHaveText(["src/lib/alpha.ts"]);

    await expect(page.locator(panel)).toBeVisible();
    await expect(page.locator(panel)).toContainText("const alpha1 = 1;");
    // The strip opens on the way back OUT, because that is where the reviewer is.
    await expect(page.locator(hint)).toContainText("close");
    // This is the path the placement bug lived on — the list is CREATED with the
    // panel already open, so the panel's first read of it is of a tooltip
    // CodeMirror has not placed yet. What that read DECIDES is pinned in
    // ui/src/lib/completionPreview.test.ts, over a stubbed rect: by the time a
    // browser test can look, the answer has landed and re-placed the panel
    // anyway. This only says the end state is right on the persisted path too.
    expect(await verticalOverlap(page)).toBeGreaterThan(0);
  });
});
