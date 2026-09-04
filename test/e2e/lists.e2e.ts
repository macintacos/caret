// The plan's list markers (EXC-861). What needs a real browser here is everything
// the decoration is: the bullet is a pseudo-element overdrawn on the dash's own
// character cell, so the only questions worth asking are geometric and
// platform-level — that the glyph is actually painted, that drawing it moves no
// column on the monospace grid, that the row track and its gutter number still
// pair up one-for-one, and that the glyph stays out of the clipboard. happy-dom
// answers none of those: it reports zero for every layout metric, renders no
// generated content, and has no clipboard.
//
// The clipboard case is the one worth naming, and it is the reason this spec
// exists at all. Blink emits generated content into the plain-text flavour of a
// copied selection the same way EXC-870 found it emitting an image's alt text — a
// bullet leaking there would make a copied plan read `•- item` and corrupt the
// markdown the epic exists to keep honest. Selection.toString() takes a different
// path through Blink and cannot show it, so only navigator.clipboard can say which
// way it goes.
//
// One case here is about neither geometry nor the clipboard: the settle test asserts
// that the repaint STOPS, which needs the real MutationObserver loop SourceView runs
// the decoration passes from — a loop that only exists in a mounted browser view.
//
// The pure halves stay units. Which characters are a marker, and which look like
// one and are not, is inlineSpans.test.ts; the attribute landing on the right
// token is inlineDecorate.test.ts; the declarations' presence and shape is
// coreStyles.test.ts. What only a browser can say is that those declarations
// resolve across the shadow boundary and produce the right boxes.

import { expect, test } from "@test/e2e/support/fixtures.ts";
import {
  awaitTagged,
  cellWidth,
  copyRows,
  firstGlyphX,
  gridCounts,
  lineOf,
  openPlan,
  revealGutterPlus,
  settledMutations,
  taggedRowTexts,
  taggedRuns,
} from "@test/e2e/support/source-view.ts";

// Bullets three deep, an ordered list with a nested ordered level, a task list, a
// quoted list, and every shape that looks like a marker and is not — a thematic
// break, a spaced break, emphasis opening a line, and a fenced list. Prose rows
// sit above and below the bullets so a glyph position has an ordinary row to be
// compared against.
const LIST_PLAN = `# List Plan

Prose above the list, on a row with no marker at all.

- A top-level item carrying **emphasis**
  - A second-level item carrying \`inline code\`
    - A third-level item carrying more text
- A second top-level item, back at the outer margin
  1. An ordered step nested inside a bullet

Prose below the list, also unmarked.

1. First step
2. Second step
   1. A nested ordered step
3. Third step

- [x] A finished task
- [ ] An unfinished task

> - A quoted bullet
> 1. A quoted number

*emphasis opening the line, which is not a marker*

---

- - -

\`\`\`md
- fenced and literal
1. also literal
\`\`\`

Trailing prose.
`;

// Rows are addressed by their TEXT rather than by a line number counted off the
// string above. The daemon reflows a plan through rumdl on ingest, so the stored
// text is not the seeded text line-for-line — a quoted bullet list followed by a
// quoted ordered list gains a blank quote row between them, and every constant
// below it would be off by one. Resolving at runtime is also what makes these
// assertions survive the next reflow rule.
const PROSE_ABOVE = "Prose above the list, on a row with no marker at all.";
const BULLET = "- A top-level item carrying **emphasis**";
const BULLET_DEEP = "    - A third-level item carrying more text";
const PROSE_BELOW = "Prose below the list, also unmarked.";
const ORDERED = "1. First step";
const TASK = "- [x] A finished task";
const EMPHASIS_LINE = "*emphasis opening the line, which is not a marker*";
const BREAK = "---";
const FENCED_BULLET = "- fenced and literal";

test("each marker is tagged with its kind, over its own characters", async ({ page, daemon }) => {
  await openPlan(page, daemon, LIST_PLAN);
  await awaitTagged(page, "data-md-list");
  expect(await taggedRuns(page, "data-md-list")).toEqual([
    { row: BULLET, value: "bullet", text: "-" },
    { row: "  - A second-level item carrying `inline code`", value: "bullet", text: "-" },
    { row: BULLET_DEEP, value: "bullet", text: "-" },
    { row: "- A second top-level item, back at the outer margin", value: "bullet", text: "-" },
    // An ordered list nested inside an unordered one — the shape the issue names
    // for its screenshot, and the one where a marker's kind and its indent could
    // disagree.
    { row: "  1. An ordered step nested inside a bullet", value: "ordered", text: "1." },
    { row: ORDERED, value: "ordered", text: "1." },
    { row: "2. Second step", value: "ordered", text: "2." },
    { row: "   1. A nested ordered step", value: "ordered", text: "1." },
    { row: "3. Third step", value: "ordered", text: "3." },
    // A task item's marker is a task, never a bullet: the checkbox EXC-860 draws is
    // the item's marker, so the dash beside it is collapsed rather than drawn over —
    // and the run reaches to the checkbox, gap included, because that is the width
    // the row stops spending. Shiki hands that run over as two tokens, the dash and
    // the gap, and every token a run covers is tagged; the sheet collapses each, so
    // what matters is that between them they cover exactly `- `.
    { row: "- [x] A finished task", value: "task", text: "-" },
    { row: "- [x] A finished task", value: "task", text: " " },
    { row: "- [ ] An unfinished task", value: "task", text: "-" },
    { row: "- [ ] An unfinished task", value: "task", text: " " },
    // Inside a quote the marker's columns come off the content start, not column
    // zero — the offset EXC-866 recorded the task scan getting wrong.
    { row: "> - A quoted bullet", value: "bullet", text: "-" },
    { row: "> 1. A quoted number", value: "ordered", text: "1." },
  ]);
});

test("the bullet is painted over the dash, which is still in the row", async ({ page, daemon }) => {
  await openPlan(page, daemon, LIST_PLAN);
  await awaitTagged(page, "data-md-list");
  const drawn = await page.evaluate(
    (ln: number) => {
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
      const el = sh?.querySelector(`[data-content] [data-line="${ln}"] [data-md-list]`);
      if (el == null) return null;
      const glyph = getComputedStyle(el, "::before");
      return {
        text: el.textContent,
        // The dash is invisible rather than removed — that is the whole
        // transform-in-place stance, and it is what keeps the column and the copy.
        color: getComputedStyle(el).color,
        content: glyph.content,
        position: glyph.position,
        // Resolved across the shadow boundary: a token that failed to resolve would
        // come back as the initial color rather than the palette's soft ink. The bullet
        // REPLACES the dash it draws over, so it spends --ink-soft rather than the
        // --ink-faint the markers that survive take (EXC-871).
        glyphColor: glyph.color,
        width: Math.round(el.getBoundingClientRect().width * 100) / 100,
      };
    },
    await lineOf(page, BULLET),
  );
  expect(drawn?.text).toBe("-");
  expect(drawn?.color).toBe("rgba(0, 0, 0, 0)");
  expect(drawn?.content).toBe('"•"');
  expect(drawn?.position).toBe("absolute");
  expect(drawn?.glyphColor).not.toBe(drawn?.color);
  // Exactly one character cell wide, measured against a prose row rather than
  // asserted to be merely positive, which would pass on any box at all. Paired with
  // the `position` assertion above it, that is what holds the zero-advance claim:
  // an in-flow glyph would make this box two cells,
  // and the left-edge probe in the grid test below cannot see it, because the
  // marker IS the row's first child and an inline box's left edge does not move
  // when content is added inside it.
  expect(drawn?.width).toBeCloseTo(await cellWidth(page, PROSE_ABOVE), 0);
  await expect(page.locator(".diffview")).toContainText(BULLET);
});

test("an ordered marker takes the ink and a task marker takes no room", async ({
  page,
  daemon,
}) => {
  await openPlan(page, daemon, LIST_PLAN);
  await awaitTagged(page, "data-md-list");
  const kinds = await page.evaluate(
    (lines) => {
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
      const read = (ln: number) => {
        const el = sh?.querySelector(`[data-content] [data-line="${ln}"] [data-md-list]`);
        if (el == null) return null;
        return {
          color: getComputedStyle(el).color,
          glyph: getComputedStyle(el, "::before").content,
          width: el.getBoundingClientRect().width,
        };
      };
      return { bullet: read(lines.bullet), ordered: read(lines.ordered), task: read(lines.task) };
    },
    {
      bullet: await lineOf(page, BULLET),
      ordered: await lineOf(page, ORDERED),
      task: await lineOf(page, TASK),
    },
  );
  // The "not double-styled" criterion, read off the rendered page rather than
  // inferred from the absence of a rule. Neither kind draws a glyph: an ordered
  // marker keeps its own characters, and a task item's dash is collapsed away
  // entirely, so the checkbox EXC-860 draws over the brackets is the row's only
  // mark; if this ever grows a bullet, that ticket's first screenshot is two
  // markers arguing.
  expect(kinds.ordered?.glyph).toBe("none");
  expect(kinds.task?.glyph).toBe("none");
  // The ordered marker wears the marker ink the bullet's glyph does — one family,
  // and not the transparent the bullet's own character takes. The task marker is
  // the one that spends nothing at all: no ink to compare, because it has no room.
  // tasks.e2e.ts owns where the box lands once the room is gone.
  expect(kinds.ordered?.color).not.toBe(kinds.bullet?.color);
  expect(kinds.bullet?.width).toBeGreaterThan(0);
  expect(kinds.task?.width).toBe(0);
});

test("copying a marked row yields the source markers, not the glyph", async ({
  page,
  context,
  daemon,
}) => {
  await openPlan(page, daemon, LIST_PLAN);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await awaitTagged(page, "data-md-list");
  const copied = await copyRows(page, {
    bullet: await lineOf(page, BULLET),
    deep: await lineOf(page, BULLET_DEEP),
    ordered: await lineOf(page, ORDERED),
  });
  expect(copied.bullet.clipboard).toBe(BULLET);
  expect(copied.bullet.selection).toBe(copied.bullet.clipboard);
  // The indentation is the nesting, so it has to survive the copy verbatim too.
  expect(copied.deep.clipboard).toBe(BULLET_DEEP);
  expect(copied.ordered.clipboard).toBe(ORDERED);
});

test("the monospace grid does not move on a marked row or its neighbours", async ({
  page,
  daemon,
}) => {
  await openPlan(page, daemon, LIST_PLAN);
  await awaitTagged(page, "data-md-list");
  const [above, bullet, deep, ordered, below] = await Promise.all(
    [PROSE_ABOVE, BULLET, BULLET_DEEP, ORDERED, PROSE_BELOW].map(async (text) =>
      firstGlyphX(page, await lineOf(page, text)),
    ),
  );
  // Rows render white-space: pre, so a glyph drawn in flow would push everything
  // after it and the source columns vim motions, drag-range selection and the
  // search highlights resolve against would stop matching. The pseudo-element is
  // out of flow precisely so these stay equal.
  expect(bullet).toBe(above);
  expect(deep).toBe(above);
  expect(ordered).toBe(above);
  expect(below).toBe(above);
});

test("every row still has exactly one gutter number", async ({ page, daemon }) => {
  await openPlan(page, daemon, LIST_PLAN);
  await awaitTagged(page, "data-md-list");
  const counts = await gridCounts(page);
  expect(counts.numbers).toBe(counts.rows);
  expect(counts.rows).toBe(counts.highestLine);
});

test("a marked row still opens the comment composer from its gutter", async ({ page, daemon }) => {
  // An acceptance criterion of its own: the marker must not cost the row its hover
  // affordance or its reachability. Nothing here appends a node or changes a row's
  // height, so the risk is low — but the sibling image pass asserted the same thing
  // on its affected row.
  await openPlan(page, daemon, LIST_PLAN);
  await awaitTagged(page, "data-md-list");
  const plus = await revealGutterPlus(page, await lineOf(page, BULLET));
  await plus.click();
  await expect(page.getByRole("dialog", { name: "Add a comment" })).toBeVisible();
  await expect(page.locator(".diffview")).toContainText(BULLET);
});

test("nothing that merely looks like a marker draws one", async ({ page, daemon }) => {
  await openPlan(page, daemon, LIST_PLAN);
  await awaitTagged(page, "data-md-list");
  const marked = new Set((await taggedRuns(page, "data-md-list")).map((m) => m.row));
  // A thematic break belongs to EXC-862 and takes no marker here; emphasis opening
  // a line is not a marker at all; and a fenced list stays literal, since links.ts
  // passes fenced lines through with no layers. Each row is resolved first, so a row
  // that stopped rendering fails as a missing row rather than passing as a missing
  // marker.
  //
  // The SPACED break is the one negative that cannot be armed from a plan: the
  // ingest reflow normalises `- - -` to `---`, so the shape never reaches the view
  // and its refusal is pinned in inlineSpans.test.ts instead — the same reason the
  // showcase names an untagged fence rather than arming one.
  for (const text of [EMPHASIS_LINE, BREAK, FENCED_BULLET]) {
    await lineOf(page, text);
    expect(marked.has(text)).toBe(false);
  }
});

test("the repaint settles over a quoted list", async ({ page, daemon }) => {
  // A regression test for a hang, not for a look. A pass that adds a child to a row a
  // settle check counts makes every repaint rebuild it — ~10,800 childList mutations in
  // two seconds when EXC-870 hit that with an image. This decoration appends nothing,
  // but it does put rows the pass never visited into its working set, so the claim is
  // worth holding rather than assuming.
  await openPlan(
    page,
    daemon,
    `# Settle Plan

> - a quoted bullet
> 1. a quoted number

- a plain bullet

Trailing prose.
`,
  );
  const mutations = await settledMutations(page);
  const marked = await taggedRowTexts(page, "data-md-list");
  expect(mutations).toBe(0);
  expect(marked).toEqual(["> - a quoted bullet", "> 1. a quoted number", "- a plain bullet"]);
});
