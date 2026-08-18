// The plan's task-list checkboxes (EXC-860). What needs a real browser here is the
// same short list the sibling marker spec names, because the decoration is the same
// mechanism one cell wider: the box is a pseudo-element overdrawn on the bracket
// run's own character cells, so the questions worth asking are geometric and
// platform-level. happy-dom answers none of them — it reports zero for every layout
// metric, renders no generated content, and has no clipboard.
//
// Three of these cases are load-bearing rather than routine.
//
// The ONE-BOX-PER-RUN case is a regression test for a defect this ticket hit and fixed:
// shiki does not always hand a three-character run over as one token, and every token a
// run covers gets tagged. Only a browser can say how shiki tokenized a row, which is what
// puts the case here rather than in coreStyles.test.ts — that suite can see the
// suppression rule exists, not that it was needed. The rule's own block in coreStyles.ts
// carries the reasoning.
//
// The WIDTH case is this ticket's own. A bullet overdraws one cell and a checkbox
// overdraws three, so the run is the first place a glyph that took inline advance
// would show up — and it would show up as the run being four cells rather than
// three, which no left-edge probe can see, because the run is the row's first child
// and an inline box's left edge does not move when content is added inside it. So
// the width is measured against a character cell taken off a real prose row, never
// asserted to be merely positive.
//
// The CLIPBOARD case is the epic's copy contract. Blink emits generated content into
// the plain-text flavour of a copied selection the same way EXC-870 found it emitting
// an image's alt text — a box leaking there would make a copied plan read
// `☐- [ ] item` and corrupt the markdown the epic exists to keep honest.
// Selection.toString() takes a different path through Blink and cannot show it, so
// only navigator.clipboard can say which way it goes.
//
// The settle case is cheap insurance rather than a known bug: this decoration appends
// nothing, and EXC-865 established that caret's annotation machinery adds a SIBLING row
// rather than a child of a row. Zero is the expectation, not a hunt for a workaround.
//
// The pure halves stay units. Which characters are a task marker, and which merely
// look like one, is inlineSpans.test.ts; the attribute landing on the right token is
// inlineDecorate.test.ts; the declarations' presence and shape is coreStyles.test.ts.
// What only a browser can say is that those declarations resolve across the shadow
// boundary and produce the right boxes.

import { expect, test } from "@test/e2e/support/fixtures.ts";
import {
  cellWidth,
  firstGlyphX,
  gridCounts,
  lineOf,
  planSurface,
  revealGutterPlus,
  settledMutations,
  taggedRuns,
} from "@test/e2e/support/source-view.ts";

// Checked, uppercase-checked, unchecked and in-progress; a task nested under a task; a
// task carrying inline chips; a quoted task. Prose rows sit above and below so a glyph
// position has an ordinary row to be compared against, and the two shapes that only
// look like a checkbox close the negative half.
const TASK_PLAN = `# Task Plan

Prose above the tasks, on a row with no checkbox at all.

- [x] A finished task
- [X] An uppercase finished task
- [ ] An unfinished task
- [/] A task still in progress
  - [ ] A nested task under a task
- [x] A task carrying \`inline code\` and a [link](#task-plan)

Prose below the tasks, also unmarked.

> - [ ] A quoted task

A bracketed [note] in prose, which opens no task.

Leave [ ] alone here, in the middle of a sentence.
`;

// Rows are addressed by their TEXT rather than by a line number counted off the
// string above, because the daemon reflows a plan through rumdl on ingest — see
// `lineOf` in the shared helpers.
const PROSE_ABOVE = "Prose above the tasks, on a row with no checkbox at all.";
const CHECKED = "- [x] A finished task";
const UPPER = "- [X] An uppercase finished task";
const UNCHECKED = "- [ ] An unfinished task";
// `[/]` is not CommonMark's checkbox — it is what the agents caret reads plans from
// write for work that is underway, and it takes a glyph of its own rather than passing
// for done or for not-started.
const SLASHED = "- [/] A task still in progress";
const NESTED = "  - [ ] A nested task under a task";
// The link markup is COLLAPSED to its label by the time it renders (EXC-859), so the
// row's text carries `a link` rather than the `[link](#task-plan)` the plan was seeded
// with — which is also why this row is worth having: it is a checkbox sharing a row
// with two other decorations that both rewrite what the row says.
const CHIPPED = "- [x] A task carrying `inline code` and a link";
const PROSE_BELOW = "Prose below the tasks, also unmarked.";
const QUOTED = "> - [ ] A quoted task";
const BRACKETED = "A bracketed [note] in prose, which opens no task.";
const MID_SENTENCE = "Leave [ ] alone here, in the middle of a sentence.";

/** One row's checkbox RUN — every token tagged `data-md-checkbox`, taken together —
 * and what the sheet draws over it, read across the shadow boundary.
 *
 * The run is read as a group rather than as one element because shiki does not always
 * hand it over as one token: an uppercase bracket run comes back cut into three, as
 * does a lowercase one on a row carrying other inline markup, and inlineDecorate tags
 * each piece. So the geometry claims are about the union of the pieces, and `glyphs`
 * carries every piece's own generated content — which is what makes "one box per run"
 * a measurement rather than an assumption. */
function drawnRun(page: import("@playwright/test").Page, line: number) {
  return page.evaluate((ln: number) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const row = sh?.querySelector(`[data-content] [data-line="${ln}"]`);
    const els = [...(row?.querySelectorAll("[data-md-checkbox]") ?? [])];
    const first = els[0];
    if (row == null || first === undefined) return null;
    const rects = els.map((el) => el.getBoundingClientRect());
    const glyph = getComputedStyle(first, "::before");
    // A token on the same row that the run does not cover — the ordinary text the
    // checkbox has to be indistinguishable from for the "no cursor change" criterion.
    const prose = [...row.children].find((el) => !el.hasAttribute("data-md-checkbox"));
    return {
      text: els.map((el) => el.textContent).join(""),
      tokens: els.length,
      glyphs: els.map((el) => getComputedStyle(el, "::before").content),
      // The brackets are invisible rather than removed — that is the whole
      // transform-in-place stance, and it is what keeps the columns and the copy.
      color: getComputedStyle(first).color,
      cursor: getComputedStyle(first).cursor,
      proseCursor: prose == null ? null : getComputedStyle(prose).cursor,
      content: glyph.content,
      position: glyph.position,
      // The box is a masked Lucide square, so what carries it is the mask (which glyph)
      // and the background it paints through that mask (what ink). Resolved across the
      // shadow boundary: a token that failed to resolve would come back as the initial
      // color rather than the palette's ink.
      boxMask: glyph.maskImage,
      boxFill: glyph.backgroundColor,
      boxWidth: Number.parseFloat(glyph.width),
      boxInsetStart: Number.parseFloat(glyph.insetInlineStart),
      width:
        Math.round(
          (Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left))) * 100,
        ) / 100,
      left: Math.round(Math.min(...rects.map((r) => r.left)) * 100) / 100,
      tabIndex: (first as HTMLElement).tabIndex,
      tag: first.tagName.toLowerCase(),
    };
  }, line);
}

/** Every checkbox run on the page, one entry per ROW rather than one per tagged token.
 * Built on the shared `taggedRuns` helper and folded here, for the reason `drawnRun`
 * gives: what the emitter promises is a run over the bracket characters, and how many
 * tokens shiki happened to cut that run into is not part of the promise. Every piece of
 * one run carries the same state — tagRow writes the single covering run's value to each
 * — so the first piece's value is the run's. */
async function checkboxRuns(
  page: import("@playwright/test").Page,
): Promise<{ row: string; value: string; text: string }[]> {
  const byRow = new Map<string, { row: string; value: string; text: string }>();
  for (const run of await taggedRuns(page, "data-md-checkbox")) {
    const open = byRow.get(run.row);
    if (open === undefined) byRow.set(run.row, { ...run });
    else open.text += run.text;
  }
  return [...byRow.values()];
}

/** Seed `plan` and open it. */
async function open(
  page: import("@playwright/test").Page,
  daemon: { seed: (input: { plan: string }) => Promise<string> },
  plan: string,
): Promise<void> {
  await daemon.seed({ plan });
  await page.goto("/");
  await planSurface(page);
}

/** Resolve once the decoration pass has tagged at least one checkbox. The passes run
 * from a MutationObserver a frame behind the rows, so every read waits for one to
 * exist rather than racing the paint. */
async function decorated(page: import("@playwright/test").Page): Promise<void> {
  await expect
    .poll(async () => (await taggedRuns(page, "data-md-checkbox")).length)
    .toBeGreaterThan(0);
}

test("each checkbox is tagged with its state, over its own three characters", async ({
  page,
  daemon,
}) => {
  await open(page, daemon, TASK_PLAN);
  await decorated(page);
  expect(await checkboxRuns(page)).toEqual([
    { row: CHECKED, value: "checked", text: "[x]" },
    // Uppercase reads exactly as lowercase does — an acceptance criterion, and the
    // one the emitter could most easily have spelled with a case-sensitive class.
    { row: UPPER, value: "checked", text: "[X]" },
    { row: UNCHECKED, value: "unchecked", text: "[ ]" },
    { row: SLASHED, value: "slashed", text: "[/]" },
    // Nested under a task rather than under a bullet: the run's columns come off the
    // item's own indentation, so a nested item is where an offset counted from column
    // zero would land on the wrong characters.
    { row: NESTED, value: "unchecked", text: "[ ]" },
    { row: CHIPPED, value: "checked", text: "[x]" },
    // Inside a quote the run's columns come off the content start, not column zero —
    // the offset EXC-866 recorded the task scan getting wrong.
    { row: QUOTED, value: "unchecked", text: "[ ]" },
  ]);
});

test("the box is painted over the brackets, which are still in the row", async ({
  page,
  daemon,
}) => {
  await open(page, daemon, TASK_PLAN);
  await decorated(page);
  const cell = await cellWidth(page, PROSE_ABOVE);
  const box = await drawnRun(page, await lineOf(page, CHECKED));
  expect(box?.text).toBe("[x]");
  expect(box?.color).toBe("rgba(0, 0, 0, 0)");
  expect(box?.position).toBe("absolute");
  // AN ICON rather than a typed glyph: the pseudo-element carries no character at all,
  // and what makes it a checkbox is the vendored Lucide SVG masked into it — painted in
  // the row's ink through background-color, which is also what proves the theme token
  // resolved across the shadow boundary rather than falling back to the initial color.
  expect(box?.content).toBe('""');
  expect(box?.boxMask).toContain("data:image/svg+xml");
  expect(box?.boxFill).not.toBe("rgba(0, 0, 0, 0)");
  expect(box?.boxWidth).toBeGreaterThan(0);
  // Exactly THREE character cells wide, measured against a prose row rather than
  // asserted to be merely positive. Paired with the `position` assertion above, this
  // is what holds the zero-advance claim: a box in flow would make this run a fourth
  // cell wider, and the left-edge probe in the grid test below cannot see it.
  expect(box?.width).toBeCloseTo(3 * cell, 0);
  // And the drawn box is centred in those three cells rather than merely present, which
  // is the half of the placement no sheet assertion can see: the inset plus half the
  // box's own width has to land on the run's middle.
  expect((box?.boxInsetStart ?? 0) + (box?.boxWidth ?? 0) / 2).toBeCloseTo(1.5 * cell, 0);
  await expect(page.locator(".diffview")).toContainText(CHECKED);
});

test("one box is drawn per run, however many tokens shiki cut the run into", async ({
  page,
  daemon,
}) => {
  await open(page, daemon, TASK_PLAN);
  await decorated(page);
  // The defect this ticket had to fix, and the reason it could not simply copy the
  // one-cell bullet: shiki hands an uppercase bracket run over as THREE tokens, and
  // inlineDecorate tags every token a run covers, so the sheet drew three boxes side by
  // side until the suppression rule landed. Read off the rendered page per token, so a
  // regression names the row and the token rather than showing up as a puzzling
  // screenshot.
  for (const text of [CHECKED, UPPER, UNCHECKED, SLASHED, NESTED, CHIPPED, QUOTED]) {
    const run = await drawnRun(page, await lineOf(page, text));
    const boxes = (run?.glyphs ?? []).filter((content) => content !== "none");
    expect(boxes.length, `${text} — ${run?.tokens} tagged token(s)`).toBe(1);
    // And the run still covers exactly its three characters however it was cut.
    expect(run?.width).toBeCloseTo(3 * (await cellWidth(page, PROSE_ABOVE)), 0);
  }
  // The uppercase row is the one that proves the loop above is not vacuous: if shiki
  // ever stops splitting it, this drops to one token and the suppression rule is no
  // longer under test here.
  expect((await drawnRun(page, await lineOf(page, UPPER)))?.tokens).toBeGreaterThan(1);
});

test("the three states differ in shape, not in colour", async ({ page, daemon }) => {
  await open(page, daemon, TASK_PLAN);
  await decorated(page);
  const [checked, unchecked, slashed] = await Promise.all(
    [CHECKED, UNCHECKED, SLASHED].map(async (text) => drawnRun(page, await lineOf(page, text))),
  );
  // The accessibility claim of this ticket, read off the rendered page rather than
  // inferred from the sheet. A state indicator separated only by a hue or an opacity
  // step fails for a colour-blind reader whatever the contrast maths says, so the three
  // states are one ink and three glyphs: an empty square, a square with a check, a
  // square with a slash.
  expect(checked?.boxFill).toBe(unchecked?.boxFill);
  expect(slashed?.boxFill).toBe(unchecked?.boxFill);
  expect(new Set([checked?.boxMask, unchecked?.boxMask, slashed?.boxMask]).size).toBe(3);
  // And the ink really resolved the theme token rather than falling back to initial ink
  // — which is also what the brackets under it are NOT wearing, since they are hidden.
  expect(checked?.boxFill).not.toBe(checked?.color);
});

test("the checkbox is not interactive", async ({ page, daemon }) => {
  await open(page, daemon, TASK_PLAN);
  await decorated(page);
  const line = await lineOf(page, UNCHECKED);
  const before = await drawnRun(page, line);
  // An acceptance criterion in its own right: this is a RENDER of the source text, not
  // a control. It must not advertise itself as clickable, must not take focus, and
  // must not change state when clicked — a plan is reviewed, not edited, here.
  expect(before?.tag).toBe("span");
  expect(before?.tabIndex).toBe(-1);
  // "No cursor change" is a claim about the checkbox against the text beside it, not
  // about a literal value: every row on this surface already carries a pointer for its
  // own comment affordance, so asserting `not pointer` here would be asserting that the
  // checkbox breaks the row rather than that it joins it.
  expect(before?.cursor).toBe(before?.proseCursor);
  // Dispatched from inside the page rather than through Playwright's own click, which
  // would hit-test to the row and open the comment composer over the assertion — the
  // row's drag-to-comment affordance owns that gesture. What is under test here is
  // narrower: that the element carries no handler that would toggle the state.
  await page.evaluate((ln: number) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    (
      sh?.querySelector(`[data-content] [data-line="${ln}"] [data-md-checkbox]`) as HTMLElement
    )?.click();
  }, line);
  const after = await drawnRun(page, line);
  expect(after?.content).toBe(before?.content);
  expect(after?.text).toBe("[ ]");
});

test("copying a task row yields the source brackets, not the box", async ({
  page,
  context,
  daemon,
}) => {
  await open(page, daemon, TASK_PLAN);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await decorated(page);
  const copied = await page.evaluate(
    async (lines) => {
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot as
        | (ShadowRoot & { getSelection?: () => Selection | null })
        | null;
      const read = async (ln: number) => {
        const row = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])].find(
          (r) => r.getAttribute("data-line") === String(ln),
        );
        if (sh == null || row == null) return { selection: "", clipboard: "<no row>" };
        const range = document.createRange();
        range.selectNodeContents(row);
        const sel = sh.getSelection?.() ?? getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        // execCommand rather than a Ctrl+C keypress, because it drives the copy from
        // inside the page with no dependency on which element the harness left focused
        // — and it runs the SAME serialization the keypress would, which is the whole
        // question. Selection.toString() is NOT that serialization.
        document.execCommand("copy");
        return {
          selection: sel?.toString() ?? "",
          clipboard: await navigator.clipboard.readText(),
        };
      };
      return {
        checked: await read(lines.checked),
        unchecked: await read(lines.unchecked),
        slashed: await read(lines.slashed),
        nested: await read(lines.nested),
        quoted: await read(lines.quoted),
      };
    },
    {
      checked: await lineOf(page, CHECKED),
      unchecked: await lineOf(page, UNCHECKED),
      slashed: await lineOf(page, SLASHED),
      nested: await lineOf(page, NESTED),
      quoted: await lineOf(page, QUOTED),
    },
  );
  expect(copied.checked.clipboard).toBe(CHECKED);
  expect(copied.checked.selection).toBe(copied.checked.clipboard);
  expect(copied.unchecked.clipboard).toBe(UNCHECKED);
  expect(copied.slashed.clipboard).toBe(SLASHED);
  // The indentation is the nesting and the `>` is the quoting, so both have to survive
  // the copy verbatim as well.
  expect(copied.nested.clipboard).toBe(NESTED);
  expect(copied.quoted.clipboard).toBe(QUOTED);
  // Said once more as a flat claim about the whole copied text, so a future engine
  // that starts emitting generated content fails here by name rather than by diff.
  for (const got of Object.values(copied)) {
    expect(got.clipboard).not.toContain("☑");
    expect(got.clipboard).not.toContain("☐");
  }
});

test("the box lands where the item begins, and only a task row moves", async ({ page, daemon }) => {
  await open(page, daemon, TASK_PLAN);
  await decorated(page);
  const cell = await cellWidth(page, PROSE_ABOVE);
  const [above, below] = await Promise.all(
    [PROSE_ABOVE, PROSE_BELOW].map(async (text) => firstGlyphX(page, await lineOf(page, text))),
  );
  const [checked, unchecked, chipped, nested] = await Promise.all(
    [CHECKED, UNCHECKED, CHIPPED, NESTED].map(async (text) =>
      drawnRun(page, await lineOf(page, text)),
    ),
  );
  // The marker run is collapsed rather than overdrawn, so the box slides onto the columns
  // the `- ` was spending and starts flush with the prose above it. This is the criterion
  // in one number: a box two cells in reads as a stray indent on a surface where nothing
  // else indents, and that is what the collapse buys.
  expect(checked?.left).toBeCloseTo(above ?? 0, 0);
  expect(unchecked?.left).toBeCloseTo(above ?? 0, 0);
  expect(chipped?.left).toBeCloseTo(above ?? 0, 0);
  // Indentation is NOT part of the run, so nesting survives the collapse intact: this row
  // is indented two spaces in the source and lands exactly two cells in.
  expect((nested?.left ?? 0) - (checked?.left ?? 0)).toBeCloseTo(2 * cell, 0);
  // The pull is the row's own. Rows render white-space: pre and every OTHER decoration on
  // this surface is drawn out of flow precisely so no column moves, so a neighbour that
  // shifted would mean the collapse had escaped the run it belongs to.
  expect(below).toBe(above);
});

test("every row still has exactly one gutter number", async ({ page, daemon }) => {
  await open(page, daemon, TASK_PLAN);
  await decorated(page);
  const counts = await gridCounts(page);
  expect(counts.numbers).toBe(counts.rows);
  expect(counts.rows).toBe(counts.highestLine);
});

test("a task row still opens the comment composer from its gutter", async ({ page, daemon }) => {
  // An acceptance criterion of its own: the checkbox must not cost the row its hover
  // affordance or its reachability.
  await open(page, daemon, TASK_PLAN);
  await decorated(page);
  const plus = await revealGutterPlus(page, await lineOf(page, CHECKED));
  await plus.click();
  await expect(page.getByRole("dialog", { name: "Add a comment" })).toBeVisible();
  await expect(page.locator(".diffview")).toContainText(CHECKED);
});

test("nothing that merely looks like a checkbox draws one", async ({ page, daemon }) => {
  await open(page, daemon, TASK_PLAN);
  await decorated(page);
  const tagged = new Set((await taggedRuns(page, "data-md-checkbox")).map((run) => run.row));
  // A bracketed word in prose and a bracket run mid-sentence are both left alone: a
  // task marker is only a task marker at the start of a list item. Each row is
  // resolved first, so a row that stopped rendering fails as a missing row rather than
  // passing as a missing checkbox.
  //
  // `- [x]done` — brackets with no space after them — is the third negative and cannot
  // be armed from a plan here: the ingest reflow rewrites it, so its refusal is pinned
  // in inlineSpans.test.ts instead, the same reason the sibling marker spec pins the
  // spaced thematic break there.
  for (const text of [BRACKETED, MID_SENTENCE]) {
    await lineOf(page, text);
    expect(tagged.has(text)).toBe(false);
  }
});

test("the repaint settles over a quoted task list", async ({ page, daemon }) => {
  // A regression test for a hang, not for a look. A pass that adds a child to a row a
  // settle check counts makes every repaint rebuild it — ~10,800 childList mutations in
  // two seconds when EXC-870 hit that with an image. This decoration appends nothing,
  // and EXC-865 established that the annotation machinery adds a sibling row rather
  // than a child, so zero is the expectation rather than the hope.
  await open(
    page,
    daemon,
    `# Settle Plan

> - [ ] a quoted task

- [x] a plain task

Trailing prose.
`,
  );
  const mutations = await settledMutations(page);
  const settled = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const rows = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])];
    return {
      tagged: rows
        .filter((r) => r.querySelector("[data-md-checkbox]"))
        .map((r) => r.textContent ?? ""),
    };
  });
  expect(mutations).toBe(0);
  expect(settled.tagged).toEqual(["> - [ ] a quoted task", "- [x] a plain task"]);
});
