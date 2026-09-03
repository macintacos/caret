import "@ui/test-mount.ts";
import { describe, expect, test } from "bun:test";

import type { ComponentProps } from "svelte";

import { capture, flushUntil, render } from "@ui/test-mount.ts";
import { HEADINGS, releaseKey } from "@ui/test-plan-nav.ts";
import PlanToc from "@/components/PlanToc.svelte";
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

function trigger(target: HTMLElement): HTMLButtonElement | null {
  return target.querySelector<HTMLButtonElement>("[data-slot='popover-trigger']");
}

/** The `\` keycap the trigger wears when shortcut hints are on (EXC-1097). */
function cap(target: HTMLElement): HTMLElement | null {
  return target.querySelector<HTMLElement>("[data-slot='kbd']");
}

/** The portalled panel. bits-ui teleports popover content to document.body. */
function panel(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>("[data-slot='popover-content']");
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

/** The heading-level marker a row wears (EXC-1105). Queried on `data-icon` — the handle
 * Icon.svelte stamps with the glyph's registry name — because the marker is aria-hidden by
 * construction and publishes no role a role locator could find, and because the inlined SVG
 * is otherwise indistinguishable from any other glyph without matching path data. The
 * `heading-` prefix is what separates it from the vendored Command.Item's own check
 * indicator, which is an Icon too. */
function levelGlyph(row: HTMLElement): HTMLElement | null {
  return row.querySelector<HTMLElement>("[data-icon^='heading-']");
}

/** Each row's marker by registry name, in document order. `null` for a row wearing none,
 * so a missing marker reds as a value rather than throwing somewhere else. */
function levelNames(): (string | null)[] {
  return options().map((o) => levelGlyph(o)?.getAttribute("data-icon") ?? null);
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

/** Open the popup and wait for its portalled content. The flush BEFORE the click
 * is load-bearing: render() leaves the mount's effects pending, and a click landing
 * on that unsettled graph flips the trigger's aria-expanded while bits-ui's portal
 * presence misses the transition entirely (the order PlanBreadcrumbs.test.ts uses). */
async function open(target: HTMLElement, flush: () => void): Promise<void> {
  flush();
  trigger(target)?.click();
  await flushUntil(flush, () => listbox() !== null);
}

/** Dismiss the popup before the test ends. Load-bearing rather than tidy: bits-ui's
 * portal presence waits for an `animationend` that never fires under happy-dom, so
 * content left open at unmount keeps its effects alive into the NEXT test file,
 * where they read deriveds whose owner is already destroyed and svelte warns
 * `derived_inert` — the effect half of the same leak ui/test-mount.ts purges the DOM
 * half of. Guarded, so it is a no-op in the test whose pick already closed it. */
async function close(target: HTMLElement, flush: () => void): Promise<void> {
  if (listbox() === null) return;
  trigger(target)?.click();
  await flushUntil(flush, () => listbox() === null);
}

type TocProps = ComponentProps<typeof PlanToc>;

/** Mount PlanToc against the shared three-level fixture, closed. Every prop can
 * be overridden; the defaults are the shape most tests read against. */
function mountToc(props: Partial<TocProps> = {}): { target: HTMLElement; flush: () => void } {
  return render(PlanToc, { headings: HEADINGS, activeLine: 9, onJump: () => {}, ...props });
}

/** Mount and open the popup via its trigger. */
async function openToc(props: Partial<TocProps> = {}): Promise<{
  target: HTMLElement;
  flush: () => void;
}> {
  const { target, flush } = mountToc(props);
  await open(target, flush);
  return { target, flush };
}

/** Mount, open, and wait for the reading position to seed the roving selection —
 * the state every Tab/arrow-walk test starts from. */
async function openTocSelected(props: Partial<TocProps> = {}): Promise<{
  target: HTMLElement;
  flush: () => void;
}> {
  const { target, flush } = await openToc(props);
  await flushUntil(flush, () => options().some((o) => o.hasAttribute("data-selected")));
  return { target, flush };
}

/** Mount with an `onExposeOpen` capture wired in, flushed so the exposed action
 * is armed. */
function renderExposedToc(props: Partial<TocProps> = {}): {
  target: HTMLElement;
  flush: () => void;
  expose: ReturnType<typeof capture<() => void>>;
} {
  const expose = capture<() => void>();
  const { target, flush } = mountToc({ onExposeOpen: expose.cb, ...props });
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
  test("renders a trigger and nothing else until it is opened", () => {
    const { target } = mountToc();
    expect(trigger(target)?.textContent?.trim()).toBe("Contents");
    expect(panel()).toBeNull();
  });

  // A popover anchored to its trigger, not a centered overlay: bits-ui's popover
  // content is what carries the anchoring, so its slot is the contract.
  test("opens a popover holding a labelled listbox", async () => {
    const { target, flush } = await openToc();
    expect(panel()).not.toBeNull();
    expect(listbox()?.getAttribute("role")).toBe("listbox");
    expect(listbox()?.getAttribute("aria-label")).toBe("Plan headings");
    // The field is named here rather than by the command's own label element,
    // which the vendored primitive leaves empty — so the name is worth pinning.
    expect(field()?.getAttribute("aria-label")).toBe("Filter headings");
    await close(target, flush);
  });

  test("renders every heading in document order, indented by level", async () => {
    const { target, flush } = await openToc();
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
    await close(target, flush);
  });

  // The guide count is the indent measured from the PLAN's root rather than from
  // level 1, and this is the fixture where the two part company. --toc-depth is the
  // heading's own level minus one, so a plan opening at `##` renders every row one
  // step in with nothing at zero — deliberate, and documented on the indent rule. A
  // guide drawn in that empty column would claim a parent the plan does not have.
  test("draws no guide for a root the plan does not have", async () => {
    const { target, flush } = await openToc({ headings: SHALLOW, activeLine: null });
    expect(options().map(label)).toEqual(["Setup", "Prereqs", "Rollout"]);
    expect(options().map((r) => r.style.getPropertyValue("--toc-depth"))).toEqual(["1", "2", "1"]);
    expect(options().map((r) => r.style.getPropertyValue("--toc-guides"))).toEqual(["0", "1", "0"]);
    await close(target, flush);
  });

  // Driven by the activeLine prop — the same value the breadcrumbs bar receives —
  // rather than by any scroll tracking of its own.
  test("marks the heading being read, and only that one", async () => {
    const { target, flush } = await openToc();
    const marked = options().filter((r) => r.getAttribute("aria-current") === "location");
    expect(marked.map(label)).toEqual(["Details"]);
    await close(target, flush);
  });

  // Opening scrolled to the current heading rests on seeding the command's value,
  // and the scroll itself is real-browser. The SELECTION that triggers it is not —
  // it is an attribute, and it is the half a bits-ui bump could silently break
  // while leaving every other assertion here green.
  test("opens with the heading being read pre-selected", async () => {
    const { target, flush } = await openTocSelected();
    const chosen = options().filter((o) => o.getAttribute("aria-selected") === "true");
    expect(chosen.map(label)).toEqual(["Details"]);
    await close(target, flush);
  });

  // EXC-1103: filtering collapses a match's ancestors into ONE header rather than
  // spending a row per ancestor per match.
  test("collapses a match's ancestors into a single breadcrumb header", async () => {
    const { target, flush } = await openToc();
    await typeQuery("details", flush);
    expect(groupHeadings().map(label)).toEqual(["Overview › Approach"]);
    expect(options().map(label)).toEqual(["Details"]);
    // The listbox owns options and groups, and nothing else.
    expect(looseText()).toEqual([]);
    await close(target, flush);
  });

  test("gathers two matching siblings under one shared header", async () => {
    const { target, flush } = await openBranchedNotes();
    // "Setup notes" and "Deploy notes" share the Rollout path, so one header
    // carries both; "Setup" holds the other. Groups, and the rows inside them,
    // in document order — no score reordering.
    expect(groupHeadings().map(label)).toEqual(["Plan › Setup", "Plan › Rollout"]);
    expect(options().map(label)).toEqual(["Setup notes", "Rollout notes", "Deploy notes"]);
    expect(groups().length).toBe(2);
    await close(target, flush);
  });

  // A `# ` line with nothing after it is a real heading with empty text, so a
  // trail can be non-empty and still have nothing to SAY. The group renders on
  // whether it has a breadcrumb, never on how many ancestors it has: the two
  // disagree exactly here, and disagreeing leaves an unlabelled `role="group"` —
  // a level of structure naming nothing, which is what AC11 rules out.
  test("renders no header when every ancestor's text is empty", async () => {
    const { target, flush } = await openToc({
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
    await close(target, flush);
  });

  test("drops an empty ancestor from the breadcrumb rather than trailing a separator", async () => {
    const { target, flush } = await openToc({
      headings: [
        { level: 1, text: "", line: 1 },
        { level: 2, text: "Setup", line: 5 },
        { level: 3, text: "Setup notes", line: 9 },
      ],
      activeLine: null,
    });
    await typeQuery("notes", flush);
    expect(groupHeadings().map(label)).toEqual(["Setup"]);
    await close(target, flush);
  });

  test("renders a top-level match with no header above it", async () => {
    const { target, flush } = await openToc({ activeLine: 1 });
    await typeQuery("overview", flush);
    expect(options().map(label)).toEqual(["Overview"]);
    // No trail means no group at all, rather than an unlabelled one wrapping the row.
    expect(groupHeadings()).toEqual([]);
    expect(groups()).toEqual([]);
    await close(target, flush);
  });

  test("renders every filtered match row flush left, whatever its heading level", async () => {
    const { target, flush } = await openBranchedNotes();
    // The header carries the hierarchy, so the rows no longer have to: a level-3
    // match sits at the same indent as a level-2 one.
    expect(options().map((r) => r.style.getPropertyValue("--toc-depth"))).toEqual(["0", "0", "0"]);
    // And no guides either (EXC-1106): the hierarchy is in the header, so a column
    // drawn beside a flush-left row would mark a nesting this view does not show.
    expect(options().map((r) => r.style.getPropertyValue("--toc-guides"))).toEqual(["0", "0", "0"]);
    await close(target, flush);
  });

  // AC11, and the whole reason this is Command.Group rather than hand-rolled
  // markup: the header is the group's accessible NAME. It is neither an
  // aria-hidden row (EXC-1096's shape, which this replaces) nor loose text a
  // listbox may not own.
  test("exposes each header as its group's label, not as an inert row", async () => {
    const { target, flush } = await openToc();
    await typeQuery("details", flush);

    const group = groups()[0];
    const named = document.getElementById(group?.getAttribute("aria-labelledby") ?? "");
    expect(named?.textContent?.trim()).toBe("Overview › Approach");
    expect(named?.hasAttribute("aria-hidden")).toBe(false);
    // A header is not a destination: it joins neither the roving walk nor the
    // primitive's item set, which is what keeps the walk on match rows alone.
    expect(named?.getAttribute("role")).toBeNull();
    expect(named?.getAttribute("data-slot")).not.toBe("command-item");
    // The dimmed context rows this view used to render are gone entirely.
    expect(listbox()?.querySelector(".toc-context")).toBeNull();
    await close(target, flush);
  });

  // The header wears caret's shared uppercase-label atom rather than a treatment
  // of its own. Pinned because the class reaches it through a `headingClass` prop
  // added to the vendored command-group.svelte, which a registry re-sync reverts
  // silently (doc/agents/shadcn-rules.md § Edits a re-sync will silently undo).
  test("dresses the header in the shared eyebrow atom", async () => {
    const { target, flush } = await openToc();
    await typeQuery("details", flush);
    expect(groupHeadings()[0]?.classList.contains("eyebrow")).toBe(true);
    await close(target, flush);
  });

  // AC8: the breadcrumb form is a search affordance only. Clearing the query puts
  // the nested tree back, headers and all gone.
  test("returns to the nested tree when the query is cleared", async () => {
    const { target, flush } = await openToc();
    await typeQuery("details", flush);
    expect(groupHeadings().length).toBe(1);

    await typeQuery("", flush, () => options().length === 4);
    expect(groupHeadings()).toEqual([]);
    expectUnfilteredOutline();
    // Holds either side of the `{#key search === ""}` boundary, not just once.
    expect(looseText()).toEqual([]);
    await close(target, flush);
  });

  test("shows helper text when the plan has no headings", async () => {
    const { target, flush } = await openToc({ headings: [], activeLine: null });
    expect(options().length).toBe(0);
    expect(helper()?.textContent?.trim()).toBe("No headings in plan");
    // A status message about the list, not a row in it.
    expect(listbox()?.contains(helper())).toBe(false);
    await close(target, flush);
  });

  // A query that hits nothing is a different message from a plan that has no
  // headings, and only the second is a property of the plan.
  test("shows helper text when a query matches nothing", async () => {
    const { target, flush } = await openToc();
    await typeQuery("nothing matches this", flush, () => options().length === 0);
    expect(options().length).toBe(0);
    expect(helper()?.textContent?.trim()).toBe("No headings match");
    // Narrowing to nothing is the one case aria-activedescendant cannot narrate —
    // there is no active option left to name — so the message says it out loud.
    expect(helper()?.getAttribute("role")).toBe("status");
    await close(target, flush);
  });

  // EXC-1096's narration contract: the field names the row the roving walk is on, so
  // the reviewer hears the list narrow without focus ever leaving the field. This is
  // the whole reason the epic vendored `command` over reusing the breadcrumbs bar's
  // dropdown, and it rests on the Viewport that command-list.svelte renders — see
  // ui/src/lib/shadcn-command-popover.test.ts for the primitive-level pin.
  test("the filter field narrates the row the selection is on", async () => {
    const { target, flush } = await openToc();
    await flushUntil(flush, () => field()?.getAttribute("aria-activedescendant") != null);

    expect(field()?.getAttribute("role")).toBe("combobox");
    // Controls the list it narrows, and names the row inside it.
    const controls = document.getElementById(field()?.getAttribute("aria-controls") ?? "");
    expect(listbox()?.contains(controls)).toBe(true);

    const active = document.getElementById(field()?.getAttribute("aria-activedescendant") ?? "");
    expect(active?.getAttribute("role")).toBe("option");
    expect(active?.textContent?.trim()).toBe("Details");
    await close(target, flush);
  });

  // A pick hands the reviewer to the plan, so it reports the line AND leaves.
  test("reports the picked heading's source line and dismisses", async () => {
    const jump = capture<number>();
    const { flush } = await openToc({ activeLine: 1, onJump: jump.cb });
    options()[3]?.click();
    await flushUntil(flush, () => listbox() === null);
    expect(jump.last()).toBe(20);
    expect(listbox()).toBeNull();
  });
});

// EXC-1104: a filtered row says WHY it survived, by marking the characters the query
// matched inside its own label. The marking is presentational — it adds no node the
// accessibility tree can see and no character to the row's text — so every assertion
// here is structural or on raw text. Whether the mark is legible against the row's own
// two fills is a computed colour in a real browser, not a mount.
describe("PlanToc match highlighting", () => {
  test("marks the characters the query matched inside the row's label", async () => {
    const { target, flush } = await openToc();
    await typeQuery("det", flush, () => options().length === 1);
    const row = options()[0];
    if (row === undefined) throw new Error("no match row rendered");
    expect(hits(row)).toEqual(["Det"]);
    await close(target, flush);
  });

  // AC6. The row's name comes from its contents, so whitespace leaked between the runs a
  // template `{#each}` emits would silently rename every option. Asserted UNTRIMMED for
  // exactly that reason — `label()` would launder it away — and on `.toc-label` rather
  // than on the row, because the vendored Command.Item pads its own check indicator with
  // whitespace this change neither adds nor can remove.
  test("adds no character to the label, so the row's accessible name is unchanged", async () => {
    const { target, flush } = await openToc();
    await typeQuery("det", flush, () => options().length === 1);
    expect(options()[0]?.querySelector(".toc-label")?.textContent).toBe("Details");
    await close(target, flush);
  });

  // AC7, and the reason one matcher can serve both views: the unfiltered view's query is
  // empty, so it renders through the same row snippet with nothing marked.
  test("marks nothing while the query is empty", async () => {
    const { target, flush } = await openToc();
    expect(options().length).toBe(4);
    expect(options().flatMap(hits)).toEqual([]);
    await close(target, flush);
  });

  // Clearing the query crosses bits-ui's `{#key search === ""}` boundary, which destroys
  // and rebuilds the whole viewport — so the marks going away is a claim about the
  // rebuilt view, not about the one that was marked.
  test("clears every mark when the query is cleared", async () => {
    const { target, flush } = await openToc();
    await typeQuery("det", flush, () => options().length === 1);
    expect(options().flatMap(hits)).toEqual(["Det"]);

    await typeQuery("", flush, () => options().length === 4);
    expect(options().flatMap(hits)).toEqual([]);
    await close(target, flush);
  });

  // A group is a set rather than a run, so a heading that both matches and encloses a
  // match appears TWICE — once as a row, once as text inside the header naming its
  // children's path. Only the row is marked; the header is wayfinding, not a result.
  test("leaves a breadcrumb header unmarked even when the query matches its text", async () => {
    const { target, flush } = await openToc({ headings: BRANCHED, activeLine: null });
    await typeQuery("setup", flush, () => options().length === 2);
    expect(options().map(label)).toEqual(["Setup", "Setup notes"]);
    expect(groupHeadings().map(label)).toEqual(["Plan", "Plan › Setup"]);
    expect(options().flatMap(hits)).toEqual(["Setup", "Setup"]);
    expect(groupHeadings().flatMap(hits)).toEqual([]);
    await close(target, flush);
  });

  // Splitting a label into several spans is precisely the edit that could drop a text
  // node where a listbox may not own one, so the structural guard is re-asserted with
  // highlighting on rather than assumed to still hold from the unfiltered case.
  test("keeps the listbox free of loose text while marks are rendered", async () => {
    const { target, flush } = await openToc();
    await typeQuery("det", flush, () => options().length === 1);
    expect(looseText()).toEqual([]);
    await close(target, flush);
  });
});

// EXC-1105: every row says what LEVEL its heading is, with a vendored lucide heading-N
// glyph. The nested view already implies it in the indent; the filtered view passes
// --toc-depth 0 for every row by design (EXC-1103), so there the marker is the only thing
// carrying it. Which glyph a row wears, and that the marker stays out of the row's text and
// out of the accessibility tree, are structural — the dimming and the alignment are painted
// pixels and laid-out boxes, so they are pinned in test/e2e/plan-toc.e2e.ts instead.
describe("PlanToc level markers", () => {
  test("gives every row the glyph for its own heading level", async () => {
    const { target, flush } = await openToc();
    expect(options().map(label)).toEqual(["Overview", "Approach", "Details", "Verification"]);
    expect(levelNames()).toEqual(["heading-1", "heading-2", "heading-3", "heading-2"]);
    await close(target, flush);
  });

  // The view the issue exists for: the breadcrumb header carries the hierarchy and every row
  // is flush left, so nothing but the marker says how deep a match sits. Asserted beside the
  // depths to keep the two claims in one place — a marker that survived while the indent
  // came back would not be evidence of anything.
  test("keeps the glyph on every filtered row, where the indent no longer says it", async () => {
    const { target, flush } = await openBranchedNotes();
    expect(options().map(label)).toEqual(["Setup notes", "Rollout notes", "Deploy notes"]);
    expect(options().map((r) => r.style.getPropertyValue("--toc-depth"))).toEqual(["0", "0", "0"]);
    expect(levelNames()).toEqual(["heading-3", "heading-3", "heading-3"]);
    await close(target, flush);
  });

  // Lucide ships six heading glyphs and the ATX extractor cannot produce a seventh, so this
  // is a floor under a level arriving from a future caller rather than a case markdown
  // reaches. What it rules out is asking Icon.svelte for a name the registry has no SVG for,
  // which renders an empty box — hence the non-null assertions beside the names.
  //
  // NaN is the third fixture because it is the ONLY input that reaches the `??` fallback:
  // every finite level leaves through the Math.min/Math.max pair, while NaN survives both
  // and indexes the tuple out of range. Without it that branch goes unexercised and reads
  // as dead code to the next person.
  test("falls back to the nearest glyph for a level outside 1–6", async () => {
    const { target, flush } = await openToc({
      headings: [
        { level: 0, text: "Below one", line: 1 },
        { level: 9, text: "Past six", line: 5 },
        { level: Number.NaN, text: "Not a number", line: 9 },
      ],
      activeLine: null,
    });
    expect(options().map(label)).toEqual(["Below one", "Past six", "Not a number"]);
    expect(options().every((o) => levelGlyph(o) !== null)).toBe(true);
    expect(levelNames()).toEqual(["heading-1", "heading-6", "heading-1"]);
    await close(target, flush);
  });

  // AC7. A screen reader must not hear "heading 2" prepended to every row. Two independent
  // halves, and the first is what actually carries it: `aria-hidden` takes the marker's
  // whole subtree out of the name computation. The second is that it contributes no
  // CHARACTER either — trimmed, because Icon.svelte inlines the vendored SVG verbatim and
  // that file's own indentation lands as whitespace text nodes. Whitespace is the one thing
  // that cannot rename an option (accessible names are whitespace-normalized, and the file's
  // own `label` helper trims), so the claim worth pinning is that nothing else got in.
  // Whether the name really computes to the heading alone is a role-engine question and is
  // asserted in test/e2e/plan-toc.e2e.ts.
  test("keeps the marker out of the accessibility tree and out of the row's text", async () => {
    const { target, flush } = await openToc();
    const row = options()[2];
    if (row === undefined) throw new Error("no rows rendered");
    expect(levelGlyph(row)?.getAttribute("aria-hidden")).toBe("true");
    expect(levelGlyph(row)?.textContent?.trim()).toBe("");
    expect(row.querySelector(".toc-label")?.textContent).toBe("Details");
    expect(label(row)).toBe("Details");
    await close(target, flush);
  });

  // No `looseText()` guard here, deliberately, and the reason generalises: that helper
  // counts TEXT nodes sitting in the viewport, and the marker is an element — hoisting it
  // clean out of its Command.Item leaves the guard green. Every test above queries the
  // marker THROUGH its row, so an escape reds four of them; a fifth assertion that cannot
  // fail for any edit this change could make would only look like coverage.
});

// The hook the motion pass hangs on (EXC-1107). The animation itself is CSS on a
// portalled element and belongs to the browser suite; what belongs HERE is the one
// thing a mount can answer — that the list really publishes which of its two views is
// on screen, and that bits-ui's Command.List forwards the attribute to the DOM rather
// than swallowing it. Every rule in the stylesheet keys on it, so a silently dropped
// attribute would leave the whole pass inert with nothing else reding.
describe("PlanToc view marker", () => {
  test("publishes which view the list is rendering", async () => {
    const { target, flush } = await openToc({ headings: BRANCHED, activeLine: 5 });
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

    await close(target, flush);
  });

  test("reads the trimmed query, so whitespace alone is still the outline", async () => {
    // The marker is `query.trim() !== ""` while bits-ui remounts on `search === ""`,
    // and a whitespace-only query is where the two disagree. It must land on the view
    // that is actually rendered — the outline — or the filtered view's row animation
    // would fire over a list of several hundred outline rows.
    const { target, flush } = await openToc({ headings: BRANCHED, activeLine: 5 });
    // Into the matches view FIRST, so the swing back to "outline" is what this test
    // observes. Going straight to whitespace from an empty field would leave the poll
    // predicate already true on entry and the assertion true before the keystroke —
    // falsifiable only by accident, which is not falsifiable.
    await typeQuery("notes", flush, () => options().length === 3);
    expect(listbox()?.getAttribute("data-toc-view")).toBe("matches");

    await typeQuery("   ", flush, () => options().length === BRANCHED.length);
    expect(options()).toHaveLength(BRANCHED.length);
    expect(listbox()?.getAttribute("data-toc-view")).toBe("outline");
    await close(target, flush);
  });
});

// The popup's two entry points (EXC-1097): the trigger teaches its key, and the
// key reaches the popup through a handle the component hands up. What a real
// keydown does with that handle is e2e (test/e2e/plan-toc.e2e.ts); what belongs
// here is the wiring either side of it.
describe("PlanToc entry points", () => {
  test("advertises the contents shortcut on the trigger", () => {
    const { target } = mountToc();
    // Derived from the reservation rather than typed here, so the advertised hint
    // cannot drift from the key the dispatcher fires on.
    expect(trigger(target)?.getAttribute("aria-keyshortcuts")).toBe("\\");
  });

  test("teaches the \\ key with a cap when shortcut hints are on", () => {
    const { target } = mountToc({ showShortcutHints: true });
    // aria-hidden, so the glyph never lands in the trigger's accessible name —
    // the same split the compare toggle's `d` cap takes.
    expect(cap(target)?.textContent?.trim()).toBe("\\");
    expect(cap(target)?.getAttribute("aria-hidden")).toBe("true");
    expect(trigger(target)?.textContent?.trim()).toContain("Contents");
  });

  test("hides the cap when shortcut hints are off", () => {
    const { target } = mountToc();
    expect(cap(target)).toBeNull();
  });

  test("hands up an open action that summons the popup", async () => {
    const { target, flush, expose } = renderExposedToc();
    const openAction = expose.last();
    if (openAction === undefined) throw new Error("PlanToc never exposed its open action");
    openAction();
    await flushUntil(flush, () => listbox() !== null);
    expect(panel()).not.toBeNull();
    await close(target, flush);
  });

  // The key and the trigger have to open the SAME popup, and that is not free:
  // bits-ui fires its onOpenChange from its own setter only (a trigger click,
  // Escape, an outside click), so an open driven from outside the primitive
  // receives none of the seeding the trigger path receives. Both tests below
  // assert the seeded SELECTION and the cleared query rather than aria-current —
  // that attribute is derived from the activeLine prop and reads the same whether
  // the seeding ran or not, which is exactly how an unseeded open looks correct.
  test("the exposed open seeds the heading being read, as the trigger does", async () => {
    const { target, flush, expose } = renderExposedToc();
    expose.last()?.();
    await flushUntil(flush, () => listbox() !== null);
    await flushUntil(flush, () => options().some((o) => o.hasAttribute("data-selected")));
    expect(
      options()
        .filter((o) => o.getAttribute("aria-selected") === "true")
        .map(label),
    ).toEqual(["Details"]);
    await close(target, flush);
  });

  test("the exposed open clears a query left by the previous session", async () => {
    const { target, flush, expose } = renderExposedToc();
    await open(target, flush);
    await typeQuery("details", flush);
    expect(options().length).toBe(1);
    await close(target, flush);

    expose.last()?.();
    await flushUntil(flush, () => listbox() !== null);
    expect(field()?.value).toBe("");
    await flushUntil(flush, () => options().length === 4);
    expect(options().map(label)).toEqual(["Overview", "Approach", "Details", "Verification"]);
    await close(target, flush);
  });

  // Tab walks the list (EXC-1102). The primitive ignores Tab outright — its own
  // keydown maps only the arrows and the vim chords — and the popover traps focus
  // with a single tabbable inside, so before this the key did nothing at all.
  // These pin the walk itself; that the newly selected row is SCROLLED into view is
  // real-browser and lives in the e2e.
  test("Tab walks the selection to the next row", async () => {
    const { target, flush } = await openTocSelected();
    expect(selectedLabels()).toEqual(["Details"]);

    pressTab(flush);
    await flushUntil(flush, () => selectedLabels()[0] === "Verification");
    expect(selectedLabels()).toEqual(["Verification"]);
    await close(target, flush);
  });

  test("Shift+Tab walks the selection to the previous row", async () => {
    const { target, flush } = await openTocSelected();
    expect(selectedLabels()).toEqual(["Details"]);

    pressTab(flush, { shift: true });
    await flushUntil(flush, () => selectedLabels()[0] === "Approach");
    expect(selectedLabels()).toEqual(["Approach"]);
    await close(target, flush);
  });

  // The whole point of walking from the field rather than moving focus row to row:
  // `aria-activedescendant` on the field is what narrates the walk, and it only
  // does that while the field is the focused element (EXC-1096).
  test("the Tab walk leaves focus in the filter field", async () => {
    const { target, flush } = await openTocSelected();

    pressTab(flush);
    await flushUntil(flush, () => selectedLabels()[0] === "Verification");
    // Asserted, not merely polled for: flushUntil gives up SILENTLY after its
    // tries elapse, so a walk that never happened would leave the focus check
    // below passing on its own — focus does not move when nothing moves it.
    expect(selectedLabels()).toEqual(["Verification"]);
    expect(document.activeElement).toBe(field());
    await close(target, flush);
  });

  // A Tab that reached the browser's default would move focus out of the field and,
  // with one tabbable in the trap, straight back to it — losing the walk silently.
  test("the Tab walk suppresses the browser's own tab move", async () => {
    const { target, flush } = await openTocSelected();

    const event = pressTab(flush);
    expect(event.defaultPrevented).toBe(true);
    await close(target, flush);
  });

  // The command defaults `loop` OFF where menu content defaults it on (bits-ui
  // command.svelte vs. menu-content.svelte), so until EXC-1122 set the prop this
  // list stopped dead at its ends while the breadcrumbs bar's two views both
  // wrapped. Setting it wraps every one of the command's navigation keys, not only
  // the Tab below — which is the point: Tab wrapping while the arrows stopped in
  // the same list would read as a bug.
  test("the Tab walk wraps at both ends of the list", async () => {
    const { target, flush } = await openTocSelected();
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
    await close(target, flush);
  });

  // The arrows wrap on the same prop, which is the half of it that matters: `loop`
  // is set for the list, not for one key, and Tab wrapping while the arrows stopped
  // dead in the same list would read as a bug.
  test("the arrows wrap at both ends of the list", async () => {
    const { target, flush } = await openTocSelected();
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
    await close(target, flush);
  });

  // EXC-1122: while a key is held the OS keeps emitting keydowns, and preventDefault
  // does not stop it — so a held Tab would be walked by the native repeat AND by the
  // hold-to-repeat timer, at two different rates, and every hold would double-step.
  // The repeat is dropped here; the timer owns the cadence.
  test("an OS repeat of a held Tab walks no further", async () => {
    const { target, flush } = await openTocSelected();
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
    await close(target, flush);
  });
});
