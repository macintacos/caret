// The plan's task-list checkboxes (EXC-860). What needs a real browser here is the
// same short list the sibling marker spec names, because the decoration is the same
// mechanism one cell wider: the box is a pseudo-element overdrawn on the bracket
// run's own character cells, so the questions worth asking are geometric and
// platform-level. happy-dom answers none of them — it reports zero for every layout
// metric, renders no generated content, and has no clipboard.
//
// Three of these cases are load-bearing rather than routine.
//
// The ONE-BOX-PER-RUN case is a regression test for a defect this ticket hit and fixed.
// A bullet is one character and its run can never be cut; a three-character run can be,
// and shiki really does cut it — an uppercase bracket run arrives as three tokens, as
// does a lowercase one on a row carrying other inline markup. inlineDecorate tags every
// token a run covers, so the sheet drew three boxes side by side until the suppression
// rule landed. Only a browser can say how shiki tokenized a row.
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
// The settle case asserts that the repaint STOPS, which needs the real
// MutationObserver loop SourceView runs the decoration passes from. It is cheap
// insurance rather than a known bug: EXC-865 established that caret's annotation
// machinery adds a SIBLING row rather than a child of a row, so tables.ts's
// child-count settle check is not tripped by it — and generated content is invisible
// to a child count anyway. The expectation here is zero, not a hunt for a workaround.
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
  taggedRuns,
} from "@test/e2e/support/source-view.ts";

// Checked, uppercase-checked and unchecked; a task nested under a task; a task
// carrying inline chips; a quoted task. Prose rows sit above and below so a glyph
// position has an ordinary row to be compared against, and the two shapes that only
// look like a checkbox close the negative half.
const TASK_PLAN = `# Task Plan

Prose above the tasks, on a row with no checkbox at all.

- [x] A finished task
- [X] An uppercase finished task
- [ ] An unfinished task
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
      transform: glyph.transform,
      // Resolved across the shadow boundary: a token that failed to resolve would come
      // back as the initial color rather than the palette's faint ink.
      glyphColor: glyph.color,
      width:
        Math.round(
          (Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left))) * 100,
        ) / 100,
      tabIndex: (first as HTMLElement).tabIndex,
      tag: first.tagName.toLowerCase(),
    };
  }, line);
}

/** Every checkbox run on the page, one entry per ROW rather than one per tagged token.
 * Built on the shared `taggedRuns` helper and folded here, for the reason `drawnRun`
 * gives: what the emitter promises is a run over the bracket characters, and how many
 * tokens shiki happened to cut that run into is not part of the promise. A row whose
 * pieces disagreed about their state would surface as `MIXED` rather than quietly
 * reporting the first piece's. */
async function checkboxRuns(
  page: import("@playwright/test").Page,
): Promise<{ row: string; value: string; text: string }[]> {
  const byRow = new Map<string, { row: string; value: string; text: string }>();
  for (const run of await taggedRuns(page, "data-md-checkbox")) {
    const open = byRow.get(run.row);
    if (open === undefined) byRow.set(run.row, { ...run });
    else {
      open.text += run.text;
      if (open.value !== run.value) open.value = "MIXED";
    }
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
  const box = await drawnRun(page, await lineOf(page, CHECKED));
  expect(box?.text).toBe("[x]");
  expect(box?.color).toBe("rgba(0, 0, 0, 0)");
  expect(box?.content).toContain("☑");
  expect(box?.position).toBe("absolute");
  expect(box?.glyphColor).not.toBe(box?.color);
  // Exactly THREE character cells wide, measured against a prose row rather than
  // asserted to be merely positive. Paired with the `position` assertion above, this
  // is what holds the zero-advance claim: a glyph in flow would make this run a
  // fourth cell wider, and the left-edge probe in the grid test below cannot see it.
  expect(box?.width).toBeCloseTo(3 * (await cellWidth(page, PROSE_ABOVE)), 0);
  // The centring is a transform rather than an inset, so it is a matrix here and not
  // a used inset value — a non-none transform is what proves the declaration resolved
  // across the shadow boundary at all.
  expect(box?.transform).not.toBe("none");
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
  for (const text of [CHECKED, UPPER, UNCHECKED, NESTED, CHIPPED, QUOTED]) {
    const run = await drawnRun(page, await lineOf(page, text));
    const boxes = (run?.glyphs ?? []).filter((content) => content !== "none");
    expect(`${text} draws ${boxes.length} box(es) across ${run?.tokens} token(s)`).toBe(
      `${text} draws 1 box(es) across ${run?.tokens} token(s)`,
    );
    // And the run still covers exactly its three characters however it was cut.
    expect(run?.width).toBeCloseTo(3 * (await cellWidth(page, PROSE_ABOVE)), 0);
  }
  // The uppercase row is the one that proves the loop above is not vacuous: if shiki
  // ever stops splitting it, this drops to one token and the suppression rule is no
  // longer under test here.
  expect((await drawnRun(page, await lineOf(page, UPPER)))?.tokens).toBeGreaterThan(1);
});

test("checked and unchecked differ in shape, not in colour", async ({ page, daemon }) => {
  await open(page, daemon, TASK_PLAN);
  await decorated(page);
  const [checked, unchecked] = await Promise.all([
    drawnRun(page, await lineOf(page, CHECKED)),
    drawnRun(page, await lineOf(page, UNCHECKED)),
  ]);
  // The accessibility claim of this ticket, read off the rendered page rather than
  // inferred from the sheet. A state indicator separated only by a hue or an opacity
  // step fails for a colour-blind reader whatever the contrast maths says, so the two
  // states are one ink and two glyphs.
  expect(checked?.content).not.toBe(unchecked?.content);
  expect(unchecked?.content).toContain("☐");
  expect(checked?.glyphColor).toBe(unchecked?.glyphColor);
  // And both really resolved the theme token rather than falling back to initial ink.
  expect(checked?.glyphColor).not.toBe(checked?.color);
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
        nested: await read(lines.nested),
        quoted: await read(lines.quoted),
      };
    },
    {
      checked: await lineOf(page, CHECKED),
      unchecked: await lineOf(page, UNCHECKED),
      nested: await lineOf(page, NESTED),
      quoted: await lineOf(page, QUOTED),
    },
  );
  expect(copied.checked.clipboard).toBe(CHECKED);
  expect(copied.checked.selection).toBe(copied.checked.clipboard);
  expect(copied.unchecked.clipboard).toBe(UNCHECKED);
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

test("the monospace grid does not move on a task row or its neighbours", async ({
  page,
  daemon,
}) => {
  await open(page, daemon, TASK_PLAN);
  await decorated(page);
  const [above, checked, unchecked, chipped, below] = await Promise.all(
    [PROSE_ABOVE, CHECKED, UNCHECKED, CHIPPED, PROSE_BELOW].map(async (text) =>
      firstGlyphX(page, await lineOf(page, text)),
    ),
  );
  // Rows render white-space: pre, so a glyph drawn in flow would push everything after
  // it and the source columns vim motions, drag-range selection and the search
  // highlights resolve against would stop matching. The pseudo-element is out of flow
  // precisely so these stay equal.
  expect(checked).toBe(above);
  expect(unchecked).toBe(above);
  expect(chipped).toBe(above);
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

test("the repaint settles over a quoted task list and a table", async ({ page, daemon }) => {
  // A regression test for a hang, not for a look. tables.ts (EXC-864) decides a row is
  // settled by comparing its child count to its cell count, so a pass that added a
  // child to a celled row made every repaint rebuild it — ~10,800 childList mutations
  // in two seconds when EXC-870 hit it with an image. This decoration appends nothing,
  // and EXC-865 established that the annotation machinery adds a sibling row rather
  // than a child, so zero is the expectation rather than the hope.
  await open(
    page,
    daemon,
    `# Settle Plan

| Case | Content     |
| ---- | ----------- |
| cell | - [x] cell  |

> - [ ] a quoted task

- [x] a plain task

Trailing prose.
`,
  );
  await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const w = window as unknown as { __mutations: number };
    w.__mutations = 0;
    new MutationObserver((records) => {
      w.__mutations += records.length;
    }).observe(sh as unknown as Node, { childList: true, subtree: true });
  });
  // Polled for the counter to STOP moving rather than sampled over a fixed window:
  // auto-retrying is the suite's timing discipline, and it is the stronger claim of the
  // two — a loop never yields two equal readings, so this fails on churn of any rate
  // rather than only on churn above some threshold.
  let previous = -1;
  await expect
    .poll(async () => {
      const now = await page.evaluate(
        () => (window as unknown as { __mutations: number }).__mutations,
      );
      const unchanged = now === previous;
      previous = now;
      return unchanged;
    })
    .toBe(true);
  const settled = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const rows = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])];
    return {
      mutations: (window as unknown as { __mutations: number }).__mutations,
      tagged: rows
        .filter((r) => r.querySelector("[data-md-checkbox]"))
        .map((r) => r.textContent ?? ""),
      celled: rows.filter((r) => r.querySelector(":scope > [data-table-cell]") !== null).length,
      celledTagged: rows.some(
        (r) =>
          r.querySelector(":scope > [data-table-cell]") !== null &&
          r.querySelector("[data-md-checkbox]") !== null,
      ),
    };
  });
  expect(settled.mutations).toBe(0);
  // The quoted task and the plain task are tagged; the bracket run inside the table
  // cell is not, because a task marker is only a task marker at the start of a line and
  // a table row starts with its pipe. So the celled row this could have looped on never
  // carries the decoration in the first place — asserted alongside the cell count, so a
  // table that stopped being carded cannot make this pass by vacuum.
  expect(settled.tagged).toEqual(["> - [ ] a quoted task", "- [x] a plain task"]);
  expect(settled.celled).toBeGreaterThan(0);
  expect(settled.celledTagged).toBe(false);
});
