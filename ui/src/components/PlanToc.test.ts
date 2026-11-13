import "@ui/support/mount.ts";
import { describe, expect, test } from "bun:test";

import type { ComponentProps } from "svelte";

import { capture, flushUntil, render } from "@ui/support/mount.ts";
import { HEADINGS, releaseKey } from "@ui/support/plan-nav.ts";
import { reactiveProps } from "@ui/support/props.svelte.ts";
import PlanToc from "@/components/PlanToc.svelte";
import type { CommentIndexEntry } from "$lib/feedback.ts";
import type { TocHeading } from "$lib/toc.ts";

// EXC-1103's own worked example, and the shape test/e2e/plan-toc.e2e.ts fixtures:
// filtering on "notes" leaves one match under Setup and TWO under Rollout, which
// is the arrangement a per-path header has to collapse and a shared header has to
// survive. "Setup notes" sits a level deeper than "Deploy notes" so the flush-left
// assertion has two different levels to flatten.
const BRANCHED: TocHeading[] = [
  { level: 1, text: "Plan", line: 1 },
  { level: 2, text: "Setup", line: 5 },
  { level: 3, text: "Setup notes", line: 9 },
  { level: 2, text: "Rollout", line: 13 },
  { level: 3, text: "Rollout notes", line: 17 },
  { level: 3, text: "Deploy notes", line: 21 },
];

// A plan whose shallowest heading is `##` — the shape the ToC's absolute indent
// renders one step in, with nothing at depth zero (EXC-1106). Deliberately has no
// level-1 heading at all, which is what makes it the guide count's own fixture.
const SHALLOW: TocHeading[] = [
  { level: 2, text: "Setup", line: 1 },
  { level: 3, text: "Prereqs", line: 5 },
  { level: 2, text: "Rollout", line: 9 },
];

function hideKey(target: HTMLElement): HTMLButtonElement | null {
  return target.querySelector<HTMLButtonElement>("button[aria-label='Outline']");
}

/** The keycaps a key, or the field's head, wears when shortcut hints are on. */
function caps(key: HTMLElement | null): HTMLElement[] {
  return [...(key?.querySelectorAll<HTMLElement>("[data-slot='kbd']") ?? [])];
}

/** The filter field's head: the field, its match count and its cap. */
function fieldHead(): HTMLElement | null {
  return field()?.closest<HTMLElement>(".toc-head") ?? null;
}

function panel(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(".plan-toc");
}

function listbox(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>("[data-slot='command-list']");
}

function options(): HTMLElement[] {
  return [...(listbox()?.querySelectorAll<HTMLElement>("[role='option']") ?? [])];
}

/** Text sitting DIRECTLY in the list's viewport rather than inside an option or a
 * group — which a listbox may not own, and which is the constraint the whole
 * Command.Group choice rests on.
 *
 * Asserted structurally because nothing else here can see it: every other locator
 * queries by role or by `data-*`, and a stray text node answers to neither. A
 * mis-terminated markup comment put six lines of source prose in exactly this
 * position while all 28 tests stayed green, so this is the guard for that whole
 * class of defect rather than for one typo. */
function looseText(): string[] {
  const viewport = listbox()?.querySelector("[data-slot='command-viewport']");
  return [...(viewport?.childNodes ?? [])]
    .filter((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "")
    .map((n) => n.textContent?.trim() ?? "");
}

/** The breadcrumb groups the filtered view renders (EXC-1103), in document order.
 * `role="group"` is bits-ui's on Command.Group's items wrapper — the element that
 * carries `aria-labelledby`, so it is the one the header actually names. */
function groups(): HTMLElement[] {
  return [...(listbox()?.querySelectorAll<HTMLElement>("[role='group']") ?? [])];
}

/** Each group's breadcrumb header. bits-ui stamps `data-command-group-heading` on
 * it; the `cmdk-group-heading` the vendored component's Tailwind variant names is
 * a cmdk-era selector that matches nothing in bits-ui 2.x. */
function groupHeadings(): HTMLElement[] {
  return [...(listbox()?.querySelectorAll<HTMLElement>("[data-command-group-heading]") ?? [])];
}

/** The helper text, which is a sibling of the listbox rather than a row in it. */
function helper(): HTMLElement | null {
  return panel()?.querySelector<HTMLElement>(".toc-empty") ?? null;
}

function field(): HTMLInputElement | null {
  return document.body.querySelector<HTMLInputElement>("[data-slot='command-input']");
}

function label(row: HTMLElement): string {
  return row.textContent?.trim() ?? "";
}

/** The marked runs inside an element — the characters the query matched (EXC-1104).
 * Queried by class rather than by role or `data-*`: highlighting is presentational and
 * deliberately adds nothing to the accessibility tree, so a role locator cannot see it. */
function hits(el: HTMLElement): string[] {
  return [...el.querySelectorAll<HTMLElement>(".toc-hit")].map((s) => s.textContent ?? "");
}

/** The rows the roving selection is on. `aria-selected` rather than `data-selected`
 * because it is the half a screen reader reads; the two move together. */
function selectedLabels(): string[] {
  return options()
    .filter((o) => o.getAttribute("aria-selected") === "true")
    .map(label);
}

/** Press Tab on the filter field and settle. Returns the event so a caller can read
 * `defaultPrevented` — dispatchEvent leaves the same object it was handed. The key
 * is dispatched at the FIELD, which is where focus sits, so it reaches the command
 * root the way a real keypress does: by bubbling. */
function pressTab(flush: () => void, { shift = false, repeat = false } = {}): KeyboardEvent {
  const el = field();
  if (el === null) throw new Error("filter field not mounted");
  const event = new KeyboardEvent("keydown", {
    key: "Tab",
    shiftKey: shift,
    repeat,
    bubbles: true,
    cancelable: true,
  });
  el.dispatchEvent(event);
  releaseKey("Tab");
  flush();
  return event;
}

/** Press an arrow on the filter field and settle. A synthetic arrow is untrusted, so
 * the component's own handler lets it past — which is what makes this a question
 * about the primitive's `loop` rather than about the app's claim on the key. */
function pressArrow(flush: () => void, key: "ArrowUp" | "ArrowDown"): void {
  const el = field();
  if (el === null) throw new Error("filter field not mounted");
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  releaseKey(key);
  flush();
}

/** Click into the column's filter field: the press, then the focus it brings. The flush
 * BEFORE the click is load-bearing: render() leaves the mount's effects pending. */
function open(flush: () => void): void {
  flush();
  field()?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  field()?.focus();
  flush();
}

/** Press Escape in the filter field and settle. */
function pressEscape(flush: () => void): void {
  field()?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  flush();
}

type TocProps = ComponentProps<typeof PlanToc>;

/** Mount the column against the shared three-level fixture, its field unfocused. Every
 * prop can be overridden; the defaults are the shape most tests read against. */
function mountToc(props: Partial<TocProps> = {}): { target: HTMLElement; flush: () => void } {
  return render(PlanToc, {
    headings: HEADINGS,
    activeLine: 9,
    plan: "",
    comments: [],
    previous: null,
    onJump: () => {},
    placement: "column",
    ...props,
  });
}

/** Mount the column and focus its filter field. */
async function openToc(props: Partial<TocProps> = {}): Promise<{
  target: HTMLElement;
  flush: () => void;
}> {
  const { target, flush } = mountToc(props);
  open(flush);
  return { target, flush };
}

/** Mount, focus the field, and wait for the reading position to seed the roving selection —
 * the state every Tab/arrow-walk test starts from. */
async function openTocSelected(props: Partial<TocProps> = {}): Promise<{
  target: HTMLElement;
  flush: () => void;
}> {
  const { target, flush } = await openToc(props);
  // bits-ui selects the list's first row as it mounts; wait for the focus's seed to move
  // the selection to the row being read.
  await flushUntil(flush, () =>
    options().some(
      (o) => o.hasAttribute("data-selected") && o.getAttribute("aria-current") === "location",
    ),
  );
  return { target, flush };
}

/** Mount with an `onExposeFilter` capture wired in, flushed so the exposed action
 * is armed. */
function renderExposedToc(props: Partial<TocProps> = {}): {
  target: HTMLElement;
  flush: () => void;
  expose: ReturnType<typeof capture<() => void>>;
} {
  const expose = capture<() => void>();
  const { target, flush } = mountToc({ onExposeFilter: expose.cb, ...props });
  flush();
  return { target, flush, expose };
}

/** Open BRANCHED and filter to "notes" — the three-match state ("Setup notes",
 * "Rollout notes", "Deploy notes") several tests read against. */
async function openBranchedNotes(): Promise<{ target: HTMLElement; flush: () => void }> {
  const { target, flush } = await openToc({ headings: BRANCHED, activeLine: null });
  await typeQuery("notes", flush, () => options().length === 3);
  return { target, flush };
}

/** Type into the filter field the way a reviewer would, so the bound query — and
 * with it the filtered tree — updates. `done` says what settling looks like for
 * this query: a query that matches nothing never grows the option set, so polling
 * on that alone would burn every try and return silently green. */
async function typeQuery(
  value: string,
  flush: () => void,
  done: () => boolean = () => options().length > 0,
): Promise<void> {
  const el = field();
  if (el === null) throw new Error("filter field not mounted");
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await flushUntil(flush, done);
}

/** The unfiltered outline's labels and indent — the baseline both the initial
 * render and a cleared filter return to. */
function expectUnfilteredOutline(): void {
  expect(options().map(label)).toEqual(["Overview", "Approach", "Details", "Verification"]);
  expect(options().map((r) => r.style.getPropertyValue("--toc-depth"))).toEqual([
    "0",
    "1",
    "2",
    "1",
  ]);
}

describe("PlanToc surface", () => {
  // The column is the outline in view: its rows are there to read without a press, and
  // its filter field stands in its head, waiting for a click or `\`.
  test("renders the labelled listbox and its named filter field at once", () => {
    const { flush } = mountToc();
    flush();
    expect(listbox()?.getAttribute("role")).toBe("listbox");
    expect(listbox()?.getAttribute("aria-label")).toBe("Plan headings");
    expect(options().map(label)).toEqual(["Overview", "Approach", "Details", "Verification"]);
    // The field is named here rather than by the command's own label element,
    // which the vendored primitive leaves empty — so the name is worth pinning.
    expect(field()?.getAttribute("aria-label")).toBe("Filter headings");
    expect(document.activeElement === field()).toBe(false);
  });

  test("the float opens on its filter", () => {
    const { flush } = mountToc({ placement: "float" });
    flush();
    expect(field()?.getAttribute("aria-label")).toBe("Filter headings");
  });

  // A click into the field lands the walk where the reviewer already is, as `\` does.
  test("focusing the field starts the walk on the heading being read", async () => {
    const p = reactiveProps({
      headings: HEADINGS,
      activeLine: 5,
      plan: "",
      comments: [],
      previous: null,
      onJump: () => {},
      placement: "column" as const,
    });
    const { flush } = render(PlanToc, p);
    flush();
    p.activeLine = 9;
    open(flush);
    await flushUntil(flush, () => selectedLabels()[0] === "Details");
    expect(selectedLabels()).toEqual(["Details"]);
  });

  test("renders every heading in document order, indented by level", async () => {
    await openToc();
    expectUnfilteredOutline();
    // One guide column per level between the plan's own root and the row (EXC-1106).
    // Read beside the indent it has to agree with, rather than in a test of its own.
    expect(options().map((r) => r.style.getPropertyValue("--toc-guides"))).toEqual([
      "0",
      "1",
      "2",
      "1",
    ]);
    // Every heading is a destination while nothing is filtered.
    expect(options().length).toBe(4);
  });

  // The guide count is the indent measured from the PLAN's root rather than from
  // level 1, and this is the fixture where the two part company. --toc-depth is the
  // heading's own level minus one, so a plan opening at `##` renders every row one
  // step in with nothing at zero — deliberate, and documented on the indent rule. A
  // guide drawn in that empty column would claim a parent the plan does not have.
  test("draws no guide for a root the plan does not have", async () => {
    await openToc({ headings: SHALLOW, activeLine: null });
    expect(options().map(label)).toEqual(["Setup", "Prereqs", "Rollout"]);
    expect(options().map((r) => r.style.getPropertyValue("--toc-depth"))).toEqual(["1", "2", "1"]);
    expect(options().map((r) => r.style.getPropertyValue("--toc-guides"))).toEqual(["0", "1", "0"]);
  });

  // Driven by the activeLine prop — the same value the breadcrumbs bar receives —
  // rather than by any scroll tracking of its own.
  test("marks the heading being read, and only that one", async () => {
    await openToc();
    const marked = options().filter((r) => r.getAttribute("aria-current") === "location");
    expect(marked.map(label)).toEqual(["Details"]);
  });

  // Opening scrolled to the current heading rests on seeding the command's value,
  // and the scroll itself is real-browser. The SELECTION that triggers it is not —
  // it is an attribute, and it is the half a bits-ui bump could silently break
  // while leaving every other assertion here green.
  test("opens with the heading being read pre-selected", async () => {
    await openTocSelected();
    const chosen = options().filter((o) => o.getAttribute("aria-selected") === "true");
    expect(chosen.map(label)).toEqual(["Details"]);
  });

  // EXC-1103: filtering collapses a match's ancestors into ONE header rather than
  // spending a row per ancestor per match.
  test("collapses a match's ancestors into a single breadcrumb header", async () => {
    const { flush } = await openToc();
    await typeQuery("details", flush);
    expect(groupHeadings().map(label)).toEqual(["Overview › Approach"]);
    expect(options().map(label)).toEqual(["Details"]);
    // The listbox owns options and groups, and nothing else.
    expect(looseText()).toEqual([]);
  });

  test("gathers two matching siblings under one shared header", async () => {
    await openBranchedNotes();
    // "Setup notes" and "Deploy notes" share the Rollout path, so one header
    // carries both; "Setup" holds the other. Groups, and the rows inside them,
    // in document order — no score reordering.
    expect(groupHeadings().map(label)).toEqual(["Plan › Setup", "Plan › Rollout"]);
    expect(options().map(label)).toEqual(["Setup notes", "Rollout notes", "Deploy notes"]);
    expect(groups().length).toBe(2);
  });

  // A `# ` line with nothing after it is a real heading with empty text, so a
  // trail can be non-empty and still have nothing to SAY. The group renders on
  // whether it has a breadcrumb, never on how many ancestors it has: the two
  // disagree exactly here, and disagreeing leaves an unlabelled `role="group"` —
  // a level of structure naming nothing, which is what AC11 rules out.
  test("renders no header when every ancestor's text is empty", async () => {
    const { flush } = await openToc({
      headings: [
        { level: 1, text: "", line: 1 },
        { level: 2, text: "Setup notes", line: 5 },
      ],
      activeLine: null,
    });
    await typeQuery("notes", flush);
    expect(options().map(label)).toEqual(["Setup notes"]);
    expect(groups()).toEqual([]);
    expect(groupHeadings()).toEqual([]);
  });

  test("drops an empty ancestor from the breadcrumb rather than trailing a separator", async () => {
    const { flush } = await openToc({
      headings: [
        { level: 1, text: "", line: 1 },
        { level: 2, text: "Setup", line: 5 },
        { level: 3, text: "Setup notes", line: 9 },
      ],
      activeLine: null,
    });
    await typeQuery("notes", flush);
    expect(groupHeadings().map(label)).toEqual(["Setup"]);
  });

  test("renders a top-level match with no header above it", async () => {
    const { flush } = await openToc({ activeLine: 1 });
    await typeQuery("overview", flush);
    expect(options().map(label)).toEqual(["Overview"]);
    // No trail means no group at all, rather than an unlabelled one wrapping the row.
    expect(groupHeadings()).toEqual([]);
    expect(groups()).toEqual([]);
  });

  test("renders every filtered match row flush left, whatever its heading level", async () => {
    await openBranchedNotes();
    // The header carries the hierarchy, so the rows no longer have to: a level-3
    // match sits at the same indent as a level-2 one.
    expect(options().map((r) => r.style.getPropertyValue("--toc-depth"))).toEqual(["0", "0", "0"]);
    // And no guides either (EXC-1106): the hierarchy is in the header, so a column
    // drawn beside a flush-left row would mark a nesting this view does not show.
    expect(options().map((r) => r.style.getPropertyValue("--toc-guides"))).toEqual(["0", "0", "0"]);
  });

  // AC11, and the whole reason this is Command.Group rather than hand-rolled
  // markup: the header is the group's accessible NAME. It is neither an
  // aria-hidden row (EXC-1096's shape, which this replaces) nor loose text a
  // listbox may not own.
  test("exposes each header as its group's label, not as an inert row", async () => {
    const { flush } = await openToc();
    await typeQuery("details", flush);

    const group = groups()[0];
    const named = document.getElementById(group?.getAttribute("aria-labelledby") ?? "");
    expect(named?.textContent?.trim()).toBe("Overview › Approach");
    expect(named?.hasAttribute("aria-hidden")).toBe(false);
    // A header is not a destination: it joins neither the roving walk nor the
    // primitive's item set, which is what keeps the walk on match rows alone.
    expect(named?.getAttribute("role")).toBeNull();
    expect(named?.getAttribute("data-slot")).not.toBe("command-item");
  });

  // The header wears caret's shared section-label atom rather than a treatment of its
  // own. Pinned because the class reaches it through a `headingClass` prop added to the
  // vendored command-group.svelte, which a registry re-sync reverts silently
  // (docs/agents/shadcn-rules.md § Edits a re-sync will silently undo).
  test("dresses the header in the shared section-label atom", async () => {
    const { flush } = await openToc();
    await typeQuery("details", flush);
    expect(groupHeadings()[0]?.classList.contains("form-label")).toBe(true);
  });

  // The breadcrumb form is a search affordance only. Clearing the query puts the
  // nested tree back, with no group headers.
  test("returns to the nested tree when the query is cleared", async () => {
    const { flush } = await openToc();
    await typeQuery("details", flush);
    expect(groupHeadings().length).toBe(1);

    await typeQuery("", flush, () => options().length === 4);
    expect(groupHeadings()).toEqual([]);
    expectUnfilteredOutline();
    // Holds either side of the `{#key search === ""}` boundary, not just once.
    expect(looseText()).toEqual([]);
  });

  test("shows helper text when the plan has no headings", async () => {
    await openToc({ headings: [], activeLine: null });
    expect(options().length).toBe(0);
    expect(helper()?.textContent?.trim()).toBe("No headings in plan");
    // A status message about the list, not a row in it.
    expect(listbox()?.contains(helper())).toBe(false);
  });

  // A query that hits nothing is a different message from a plan that has no
  // headings, and only the second is a property of the plan.
  test("shows helper text when a query matches nothing", async () => {
    const { flush } = await openToc();
    await typeQuery("nothing matches this", flush, () => options().length === 0);
    expect(options().length).toBe(0);
    expect(helper()?.textContent?.trim()).toBe("No headings match");
    // Narrowing to nothing is the one case aria-activedescendant cannot narrate —
    // there is no active option left to name — so the message says it out loud.
    expect(helper()?.getAttribute("role")).toBe("status");
  });

  // EXC-1096's narration contract: the field names the row the roving walk is on, so
  // the reviewer hears the list narrow without focus ever leaving the field. This is
  // the whole reason the epic vendored `command` over reusing the breadcrumbs bar's
  // dropdown, and it rests on the Viewport that command-list.svelte renders — see
  // ui/src/lib/shadcn-command-popover.test.ts for the primitive-level pin.
  test("the filter field narrates the row the selection is on", async () => {
    const { flush } = await openToc();
    await flushUntil(flush, () => field()?.getAttribute("aria-activedescendant") != null);

    expect(field()?.getAttribute("role")).toBe("combobox");
    // Controls the list it narrows, and names the row inside it.
    const controls = document.getElementById(field()?.getAttribute("aria-controls") ?? "");
    expect(listbox()?.contains(controls)).toBe(true);

    const active = document.getElementById(field()?.getAttribute("aria-activedescendant") ?? "");
    expect(active?.getAttribute("role")).toBe("option");
    expect(active?.textContent?.trim()).toBe("Details");
  });

  // A pick hands the reviewer to the plan: it reports the line, and the field empties and
  // lets go of focus.
  test("a pick from the filter reports the heading's source line and empties the field", async () => {
    const jump = capture<number>();
    const { flush } = await openToc({ activeLine: 1, onJump: jump.cb });
    await typeQuery("verification", flush, () => options().length === 1);
    options()[0]?.click();
    await flushUntil(flush, () => options().length === 4);
    expect(jump.last()).toBe(20);
    expect(field()?.value).toBe("");
    expect(document.activeElement === field()).toBe(false);
  });

  // Escape is one step out: the query, then focus, which goes back to the plan.
  test("Escape clears the query, then lets go of the field", async () => {
    const { flush } = await openToc();
    await typeQuery("details", flush, () => options().length === 1);
    pressEscape(flush);
    await flushUntil(flush, () => options().length === 4);
    expect(field()?.value).toBe("");
    expect(document.activeElement === field()).toBe(true);

    pressEscape(flush);
    expect(document.activeElement === field()).toBe(false);
    expect(field()?.getAttribute("aria-label")).toBe("Filter headings");
    expect(options().length).toBe(4);
  });
});

// EXC-1104: a filtered row says WHY it survived, by marking the characters the query
// matched inside its own label. The marking is presentational — it adds no node the
// accessibility tree can see and no character to the row's text — so every assertion
// here is structural or on raw text. Whether the mark is legible against the row's own
// two fills is a computed colour in a real browser, not a mount.
describe("PlanToc match highlighting", () => {
  test("marks the characters the query matched inside the row's label", async () => {
    const { flush } = await openToc();
    await typeQuery("det", flush, () => options().length === 1);
    const row = options()[0];
    if (row === undefined) throw new Error("no match row rendered");
    expect(hits(row)).toEqual(["Det"]);
  });

  // AC6. The row's name comes from its contents, so whitespace leaked between the runs a
  // template `{#each}` emits would silently rename every option. Asserted UNTRIMMED for
  // exactly that reason — `label()` would launder it away — and on `.toc-label` rather
  // than on the row, because the vendored Command.Item pads its own check indicator with
  // whitespace this change neither adds nor can remove.
  test("adds no character to the label, so the row's accessible name is unchanged", async () => {
    const { flush } = await openToc();
    await typeQuery("det", flush, () => options().length === 1);
    expect(options()[0]?.querySelector(".toc-label")?.textContent).toBe("Details");
  });

  // AC7, and the reason one matcher can serve both views: the unfiltered view's query is
  // empty, so it renders through the same row snippet with nothing marked.
  test("marks nothing while the query is empty", async () => {
    await openToc();
    expect(options().length).toBe(4);
    expect(options().flatMap(hits)).toEqual([]);
  });

  // Clearing the query crosses bits-ui's `{#key search === ""}` boundary, which destroys
  // and rebuilds the whole viewport — so the marks going away is a claim about the
  // rebuilt view, not about the one that was marked.
  test("clears every mark when the query is cleared", async () => {
    const { flush } = await openToc();
    await typeQuery("det", flush, () => options().length === 1);
    expect(options().flatMap(hits)).toEqual(["Det"]);

    await typeQuery("", flush, () => options().length === 4);
    expect(options().flatMap(hits)).toEqual([]);
  });

  // A group is a set rather than a run, so a heading that both matches and encloses a
  // match appears TWICE — once as a row, once as text inside the header naming its
  // children's path. Only the row is marked; the header is wayfinding, not a result.
  test("leaves a breadcrumb header unmarked even when the query matches its text", async () => {
    const { flush } = await openToc({ headings: BRANCHED, activeLine: null });
    await typeQuery("setup", flush, () => options().length === 2);
    expect(options().map(label)).toEqual(["Setup", "Setup notes"]);
    expect(groupHeadings().map(label)).toEqual(["Plan", "Plan › Setup"]);
    expect(options().flatMap(hits)).toEqual(["Setup", "Setup"]);
    expect(groupHeadings().flatMap(hits)).toEqual([]);
  });

  // Splitting a label into several spans is precisely the edit that could drop a text
  // node where a listbox may not own one, so the structural guard is re-asserted with
  // highlighting on rather than assumed to still hold from the unfiltered case.
  test("keeps the listbox free of loose text while marks are rendered", async () => {
    const { flush } = await openToc();
    await typeQuery("det", flush, () => options().length === 1);
    expect(looseText()).toEqual([]);
  });
});

describe("PlanToc view marker", () => {
  test("publishes which view the list is rendering", async () => {
    const { flush } = await openToc({ headings: BRANCHED, activeLine: 5 });
    // Asserted here rather than only inside a poll condition: flushUntil gives up
    // silently after its tries, so a claim made only in the predicate passes vacuously.
    expect(listbox()?.getAttribute("data-toc-view")).toBe("outline");

    await typeQuery("notes", flush, () => options().length === 3);
    expect(options()).toHaveLength(3);
    expect(listbox()?.getAttribute("data-toc-view")).toBe("matches");

    // Back to the outline, which is the direction the viewport's own animation
    // carries — and the one the marker has to swing back for.
    await typeQuery("", flush, () => options().length === BRANCHED.length);
    expect(options()).toHaveLength(BRANCHED.length);
    expect(listbox()?.getAttribute("data-toc-view")).toBe("outline");
  });

  test("reads the trimmed query, so whitespace alone is still the outline", async () => {
    // The marker is `query.trim() !== ""` while bits-ui remounts on `search === ""`,
    // and a whitespace-only query is where the two disagree. It must land on the view
    // that is actually rendered — the outline — or the filtered view's row animation
    // would fire over a list of several hundred outline rows.
    const { flush } = await openToc({ headings: BRANCHED, activeLine: 5 });
    // Into the matches view FIRST, so the swing back to "outline" is what this test
    // observes. Going straight to whitespace from an empty field would leave the poll
    // predicate already true on entry and the assertion true before the keystroke —
    // falsifiable only by accident, which is not falsifiable.
    await typeQuery("notes", flush, () => options().length === 3);
    expect(listbox()?.getAttribute("data-toc-view")).toBe("matches");

    await typeQuery("   ", flush, () => options().length === BRANCHED.length);
    expect(options()).toHaveLength(BRANCHED.length);
    expect(listbox()?.getAttribute("data-toc-view")).toBe("outline");
  });
});

// The outline's keys: the column head teaches `\` and ⇧`\`, and `\` reaches the filter
// through a handle the component hands up. What a real keydown does with that handle is
// e2e (test/e2e/plan-toc.e2e.ts); what belongs here is the wiring either side of it.
describe("PlanToc entry points", () => {
  // Derived from the reservations rather than typed here, so the advertised hints
  // cannot drift from the keys the dispatcher fires on.
  test("the filter field advertises \\ and the outline key ⇧\\", () => {
    const { target, flush } = mountToc();
    flush();
    expect(field()?.getAttribute("aria-keyshortcuts")).toBe("\\");
    expect(hideKey(target)?.getAttribute("aria-keyshortcuts")).toBe("|");
  });

  test("teaches both keys with caps when shortcut hints are on", () => {
    const { target, flush } = mountToc({ showShortcutHints: true });
    flush();
    // aria-hidden, so a glyph never lands in the field's or the key's accessible name.
    expect(caps(fieldHead()).map((c) => c.textContent?.trim())).toEqual(["\\"]);
    const hide = caps(hideKey(target));
    expect(hide.map((c) => c.textContent?.trim())).toEqual(["\\"]);
    expect(hide[0]?.querySelector("[data-icon='arrow-big-up']")).not.toBeNull();
    expect(
      [...caps(fieldHead()), ...hide].every((c) => c.getAttribute("aria-hidden") === "true"),
    ).toBe(true);
  });

  test("hides the caps when shortcut hints are off", () => {
    const { target, flush } = mountToc();
    flush();
    expect([...caps(fieldHead()), ...caps(hideKey(target))]).toEqual([]);
  });

  // The cap says how to reach the field from elsewhere, whatever it holds. In the field it
  // has nothing to teach.
  test("the field's cap stands while the field is unfocused, empty or holding a query", async () => {
    const { flush } = mountToc({ showShortcutHints: true });
    flush();
    expect(caps(fieldHead()).length).toBe(1);

    open(flush);
    expect(caps(fieldHead()).length).toBe(0);

    await typeQuery("details", flush, () => options().length === 1);
    expect(caps(fieldHead()).length).toBe(0);
    field()?.blur();
    flush();
    expect(caps(fieldHead()).length).toBe(1);
  });

  test("the outline key hides the column", () => {
    let hidden = 0;
    const { target } = mountToc({ onHide: () => hidden++ });
    hideKey(target)?.click();
    expect(hidden).toBe(1);
  });

  test("hands up an action that focuses the filter", async () => {
    const { flush, expose } = renderExposedToc();
    const openAction = expose.last();
    if (openAction === undefined) throw new Error("PlanToc never exposed its filter action");
    openAction();
    await flushUntil(flush, () => document.activeElement === field() && field() !== null);
    expect(document.activeElement).toBe(field());
  });

  // `\` and a click into the field have to start the SAME walk. The test below asserts
  // the seeded SELECTION rather than aria-current — that attribute is derived from the
  // activeLine prop and reads the same whether the seeding ran or not, which is exactly
  // how an unseeded open looks correct.
  test("the exposed open seeds the heading being read, as a click into the field does", async () => {
    const { flush, expose } = renderExposedToc();
    expose.last()?.();
    await flushUntil(flush, () => field() !== null);
    await flushUntil(flush, () => selectedLabels()[0] === "Details");
    expect(selectedLabels()).toEqual(["Details"]);
  });

  // The field's `\` cap stands beside a held query, promising `\` comes back to it. Selected,
  // the query goes as soon as the reader types; the × still empties it.
  test("the exposed open comes back to a held query, selected", async () => {
    const { flush, expose } = renderExposedToc();
    open(flush);
    await typeQuery("details", flush);
    field()?.blur();
    flush();

    expose.last()?.();
    await flushUntil(flush, () => document.activeElement === field());
    const el = field();
    expect(el?.value).toBe("details");
    expect([el?.selectionStart, el?.selectionEnd]).toEqual([0, "details".length]);
    expect(options().map(label)).toEqual(["Details"]);
  });

  // Tab walks the list (EXC-1102). The primitive ignores Tab outright — its own
  // keydown maps only the arrows and the vim chords — so untouched the key would move
  // focus out of the field and lose the walk.
  // These pin the walk itself; that the newly selected row is SCROLLED into view is
  // real-browser and lives in the e2e.
  test("Tab walks the selection to the next row", async () => {
    const { flush } = await openTocSelected();
    expect(selectedLabels()).toEqual(["Details"]);

    pressTab(flush);
    await flushUntil(flush, () => selectedLabels()[0] === "Verification");
    expect(selectedLabels()).toEqual(["Verification"]);
  });

  test("Shift+Tab walks the selection to the previous row", async () => {
    const { flush } = await openTocSelected();
    expect(selectedLabels()).toEqual(["Details"]);

    pressTab(flush, { shift: true });
    await flushUntil(flush, () => selectedLabels()[0] === "Approach");
    expect(selectedLabels()).toEqual(["Approach"]);
  });

  // The whole point of walking from the field rather than moving focus row to row:
  // `aria-activedescendant` on the field is what narrates the walk, and it only
  // does that while the field is the focused element (EXC-1096).
  test("the Tab walk leaves focus in the filter field", async () => {
    const { flush } = await openTocSelected();

    pressTab(flush);
    await flushUntil(flush, () => selectedLabels()[0] === "Verification");
    // Asserted, not merely polled for: flushUntil gives up SILENTLY after its
    // tries elapse, so a walk that never happened would leave the focus check
    // below passing on its own — focus does not move when nothing moves it.
    expect(selectedLabels()).toEqual(["Verification"]);
    expect(document.activeElement).toBe(field());
  });

  // A Tab that reached the browser's default would move focus out of the field,
  // losing the walk silently.
  test("the Tab walk suppresses the browser's own tab move", async () => {
    const { flush } = await openTocSelected();

    const event = pressTab(flush);
    expect(event.defaultPrevented).toBe(true);
  });

  // The field stands in the page's Tab order, so a Tab that only passes through it must
  // move on rather than start a walk it would take Escape to leave.
  test("Tab moves on from the field until the reader engages it", async () => {
    const { flush } = mountToc();
    flush();
    field()?.focus();
    flush();
    expect(pressTab(flush).defaultPrevented).toBe(false);

    pressArrow(flush, "ArrowDown");
    expect(pressTab(flush).defaultPrevented).toBe(true);
  });

  // The command defaults `loop` OFF where menu content defaults it on (bits-ui
  // command.svelte vs. menu-content.svelte), so until EXC-1122 set the prop this
  // list stopped dead at its ends while the breadcrumbs bar's two views both
  // wrapped. Setting it wraps every one of the command's navigation keys, not only
  // the Tab below — which is the point: Tab wrapping while the arrows stopped in
  // the same list would read as a bug.
  test("the Tab walk wraps at both ends of the list", async () => {
    const { flush } = await openTocSelected();
    expect(selectedLabels()).toEqual(["Details"]);

    // Forwards off the last row and back to the first.
    pressTab(flush);
    await flushUntil(flush, () => selectedLabels()[0] === "Verification");
    pressTab(flush);
    await flushUntil(flush, () => selectedLabels()[0] === "Overview");
    expect(selectedLabels()).toEqual(["Overview"]);

    // And backwards off the first row to the last.
    pressTab(flush, { shift: true });
    await flushUntil(flush, () => selectedLabels()[0] === "Verification");
    expect(selectedLabels()).toEqual(["Verification"]);
  });

  // The arrows wrap on the same prop, which is the half of it that matters: `loop`
  // is set for the list, not for one key, and Tab wrapping while the arrows stopped
  // dead in the same list would read as a bug.
  test("the arrows wrap at both ends of the list", async () => {
    const { flush } = await openTocSelected();
    expect(selectedLabels()).toEqual(["Details"]);

    pressArrow(flush, "ArrowUp");
    await flushUntil(flush, () => selectedLabels()[0] === "Approach");
    pressArrow(flush, "ArrowUp");
    await flushUntil(flush, () => selectedLabels()[0] === "Overview");
    pressArrow(flush, "ArrowUp");
    await flushUntil(flush, () => selectedLabels()[0] === "Verification");
    expect(selectedLabels()).toEqual(["Verification"]);

    pressArrow(flush, "ArrowDown");
    await flushUntil(flush, () => selectedLabels()[0] === "Overview");
    expect(selectedLabels()).toEqual(["Overview"]);
  });

  // EXC-1122: while a key is held the OS keeps emitting keydowns, and preventDefault
  // does not stop it — so a held Tab would be walked by the native repeat AND by the
  // hold-to-repeat timer, at two different rates, and every hold would double-step.
  // The repeat is dropped here; the timer owns the cadence.
  test("an OS repeat of a held Tab walks no further", async () => {
    const { flush } = await openTocSelected();
    expect(selectedLabels()).toEqual(["Details"]);

    // A press, then its repeat — the order a held key really arrives in. The OS
    // emits no repeat without a press before it, so a bare repeat would be driving
    // a state the browser never produces.
    pressTab(flush);
    await flushUntil(flush, () => selectedLabels()[0] === "Verification");
    const event = pressTab(flush, { repeat: true });
    expect(selectedLabels()).toEqual(["Verification"]);
    // Still claimed while held, so the browser's own tab move stays suppressed for
    // as long as the key is down rather than only on its first press.
    expect(event.defaultPrevented).toBe(true);
  });
});

// HEADINGS' own source, with prose under each heading, so the per-section props have a
// plan whose lines agree with the fixture's.
const PLAN = [
  "# Overview", //                     1
  "", //                               2
  "The whole plan.", //                3
  "", //                               4
  "## Approach", //                    5
  "", //                               6
  "How it goes.", //                   7
  "", //                               8
  "### Details", //                    9
  "", //                              10
  "Read the **frames** first.", //    11
  "Then decode them.", //             12
  ...Array.from({ length: 7 }, () => ""), // 13–19
  "## Verification", //               20
  "", //                              21
  "Run the suite.", //                22
].join("\n");

function note(line: number, text: string, draft = false): CommentIndexEntry {
  return { id: `${line}:${text}`, line, label: `Line ${line}`, text, draft, linkable: true };
}

/** The row whose label is `text`. */
function row(text: string): HTMLElement {
  const found = options().find((o) => o.querySelector(".toc-label")?.textContent === text);
  if (found === undefined) throw new Error(`no row labelled ${text}`);
  return found;
}

describe("PlanToc section notes", () => {
  test("describes a row's comments, unsent ones and change apart from its name", async () => {
    await openToc({
      plan: PLAN,
      comments: [note(11, "Which frames?"), note(12, "Say how.", true)],
      previous: { version: 3, plan: PLAN.replace("Then decode them.", "Then parse them.") },
    });
    const details = row("Details");
    const described = document.getElementById(details.getAttribute("aria-describedby") ?? "");
    expect(described?.textContent?.trim()).toBe("1 comment, 1 unsent, edited since v3");
    // The stamps a sighted reviewer reads carry the same facts, so they stay out of the
    // name the option is announced by.
    expect(details.querySelector(".toc-meta")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("PlanToc filter states", () => {
  test("the float counts the rows a query leaves, and nothing while the query is empty", async () => {
    const { flush } = await openToc({ headings: BRANCHED, activeLine: null, placement: "float" });
    expect(panel()?.querySelector(".toc-match-count")?.textContent?.trim() ?? "").toBe("");
    await typeQuery("notes", flush, () => options().length === 3);
    expect(panel()?.querySelector(".toc-match-count")?.textContent?.trim()).toBe("3");
  });
});

// The latch follows the reading position. Moved by the plan scrolling under it, it snaps:
// motion on a constant, scroll-driven change reads as lag. Moved by the reader's own jump,
// it fades across.
describe("PlanToc latch", () => {
  const root = (target: HTMLElement) => target.querySelector(".plan-toc");
  const column = (over: Partial<TocProps>) =>
    reactiveProps({
      headings: HEADINGS,
      activeLine: 5,
      plan: "",
      comments: [],
      previous: null,
      onJump: () => {},
      placement: "column" as const,
      ...over,
    });

  test("snaps when the plan scrolls it to another heading", () => {
    const p = column({});
    const { target, flush } = render(PlanToc, p);
    flush();
    p.activeLine = 9;
    flush();
    expect(root(target)?.hasAttribute("data-latch-snap")).toBe(true);
  });

  test("fades across when the reader jumps to another heading", () => {
    const p = column({ latchGlides: false });
    const { target, flush } = render(PlanToc, p);
    flush();
    p.latchGlides = true;
    p.activeLine = 9;
    flush();
    expect(root(target)?.hasAttribute("data-latch-snap")).toBe(false);
  });
});
