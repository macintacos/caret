import "@ui/support/mount.ts";
import { afterEach, describe, expect, test } from "bun:test";

import { EditorView } from "@codemirror/view";

import type { ClientReview, PlanVersion } from "@core/lib/types";
import { until } from "@test/support/poll.ts";
import { expectViewRecreated } from "@ui/support/diffview.ts";
import { logCapture, typeInto } from "@ui/support/helpers.ts";
import { capture, render } from "@ui/support/mount.ts";
import { reactiveProps } from "@ui/support/props.svelte.ts";
import { selectText } from "@ui/support/selection.ts";
import DiffPlanView from "@/components/DiffPlanView.svelte";
import {
  type ComposerScratch,
  createSourceCommenting,
  type SourceCommentingDeps,
  scratchKey,
} from "$lib/diffview/commenting.ts";
import { shortcuts } from "$lib/shortcuts/index.ts";

// Default props: no-op handlers and an empty annotation set, so the rendering
// tests below need only override `review` (or `annotations`).
function props(over: Record<string, unknown> = {}) {
  return {
    review: reviewFixture(),
    onCopyCwd: () => {},
    commenting: createSourceCommenting({ onCreate: () => {} }),
    annotations: [],
    focusedAnnotation: null,
    onEditAnnotation: () => {},
    onDeleteAnnotation: () => {},
    onFocusAnnotation: () => {},
    ...over,
  };
}

// DiffPlanView is a thin shell over the diffview SourceView wrapper: it renders
// the active plan's stored text as line-numbered markdown source. The library
// paints into a shadow root behind the shared highlighter init, so assertions
// await it via until(), reading the .diffview container's shadowRoot.

function reviewFixture(over: Partial<ClientReview> = {}): ClientReview {
  return {
    id: "r1",
    sessionId: "S",
    cwd: "/tmp/p",
    title: "Plan",
    status: "pending",
    version: 1,
    currentPlan: "# Title\n\nhello world\n",
    annotations: [],
    versions: [],
    generalCommentDraft: "",
    composerScratches: [],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

/** A review carrying n versions; the current plan is the last version's text. */
function multiVersionFixture(n: number): ClientReview {
  const versions: PlanVersion[] = Array.from({ length: n }, (_, i) => ({
    version: i + 1,
    plan: `# Title\n\nbody revision ${i + 1}\n`,
    annotations: [],
    createdAt: i,
  }));
  return reviewFixture({
    version: n,
    currentPlan: versions[n - 1]!.plan,
    versions,
  });
}

function shadow(target: HTMLElement): ShadowRoot | null {
  return target.querySelector(".diffview")?.shadowRoot ?? null;
}

/** Mount with `annotations`, wait for the card, then switch into compare mode
 * and wait for the second version's text to land — the shared arrange behind
 * "X is absent/hidden in compare mode" assertions. */
async function enterCompareMode(annotations: unknown[]): Promise<{ target: HTMLElement }> {
  const review = multiVersionFixture(3);
  const { target } = render(DiffPlanView, props({ review, annotations }));
  await until(() => target.querySelector('[data-annotation-card="ln1"]') != null);
  target.querySelector<HTMLButtonElement>(".compare-toggle")!.click();
  await until(() => (shadow(target)?.textContent ?? "").includes("body revision 2"));
  return { target };
}

/** Mount with reactive props and wait for the initial paint — the common
 * opening of the instance-preservation tests below, which then mutate `p`. */
async function renderAndWaitForPre(
  p: ReturnType<typeof props>,
): Promise<{ target: HTMLElement; flush: () => void; pre: Element | null | undefined }> {
  const { target, flush } = render(DiffPlanView, p);
  await until(() => shadow(target)?.textContent?.includes("hello world") ?? false);
  return { target, flush, pre: shadow(target)?.querySelector("pre") };
}

afterEach(() => localStorage.clear());

afterEach(() => document.documentElement.style.removeProperty("--caret-test-repaint"));
/** A theme paint that moves `els`, as a rewrap would; happy-dom has no layout of its
 * own. */
function repaintMoving(els: Iterable<HTMLElement>): void {
  for (const el of els) el.getBoundingClientRect = () => new DOMRect(0, 40, 100, 20);
  document.documentElement.style.setProperty("--caret-test-repaint", "1");
}

describe("DiffPlanView rendering", () => {
  test("renders the plan source text into the source view", async () => {
    const { target } = render(DiffPlanView, props());
    const painted = await until(
      () => shadow(target)?.textContent?.includes("hello world") ?? false,
    );
    expect(painted).toBe(true);
  });

  test("simplifies markdown links via the link layer (label shown, syntax gone)", async () => {
    const review = reviewFixture({
      currentPlan: "See [the docs](https://caret.test/docs) for details.\n",
    });
    const { target } = render(DiffPlanView, props({ review }));
    await until(() => shadow(target)?.textContent?.includes("the docs") ?? false);
    const text = shadow(target)?.textContent ?? "";
    expect(text).toContain("the docs");
    expect(text).not.toContain("](https://caret.test/docs)");
  });
});

// The control row carries two heading-navigation surfaces, and they are covered in
// different places — deliberately, because only one of them is unit-reachable.
//
// EXC-946's breadcrumbs bar has no unit test here on purpose: it renders only once
// a heading is in the reading zone, and that tracking is measured with
// getBoundingClientRect, which happy-dom reports as all zeros. The bar's own trail
// logic is unit-tested in PlanBreadcrumbs.test.ts; its mounting, scroll tracking,
// and compare-mode absence are covered by test/e2e/plan-breadcrumbs.e2e.ts.
//
// EXC-1095's ToC popup has no such gate — it renders whenever the view is not
// comparing, including with no active heading at all — so its mount and its
// compare-mode absence are a plain conditional branch, and belong here. Its own
// panel structure and ARIA are unit-tested in PlanToc.test.ts.
describe("DiffPlanView contents popup", () => {
  test("mounts the contents trigger in the control row", () => {
    const { target } = render(DiffPlanView, props());
    const toc = target.querySelector<HTMLElement>(".control-row [data-slot='popover-trigger']");
    expect(toc).not.toBeNull();
    // Contains rather than equals: the trigger also holds the `\` keycap
    // (EXC-1097), which this view renders because showShortcutHints defaults on.
    // Whether that cap tracks the setting is PlanToc.test.ts's subject, not this
    // one's — the claim here is only that the trigger mounts, labelled.
    expect(toc?.textContent).toContain("Contents");
  });

  // Compare mode tracks no heading, so a contents popup there would open on a
  // stale plan. Dropped on the same condition the breadcrumbs bar is.
  test("drops the contents trigger in compare mode", async () => {
    const { target } = render(DiffPlanView, props({ review: multiVersionFixture(3) }));
    expect(target.querySelector(".control-row [data-slot='popover-trigger']")).not.toBeNull();
    target.querySelector<HTMLButtonElement>(".compare-toggle")!.click();
    await until(() => target.querySelector(".control-row [data-slot='popover-trigger']") == null);
    expect(target.querySelector(".control-row [data-slot='popover-trigger']")).toBeNull();
  });
});

/** Mount the view with a composer open on line 2 seeded with `text`, over a
 * controller whose injected sound dep records what the view asks it to play. The
 * controller is opened AFTER the mount, since the view's contentKey effect reseeds
 * it on the way in and would drop an earlier open. Returns the recorder and a getter
 * for the composer's Discard button, found by label — it wears the chip classes
 * rather than a name of its own. */
async function openComposer(text: string) {
  const sounds: string[] = [];
  const commenting = createSourceCommenting({
    onCreate: () => {},
    sound: (event) => sounds.push(event),
  });
  const { target, flush } = render(
    DiffPlanView,
    props({ commenting, pending: { startLine: 2, endLine: 2 }, pendingText: text }),
  );
  const find = () =>
    [...target.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent?.trim() === "Discard",
    );
  await until(() => find() !== undefined);
  // render() does not flush, and the text case clicks open a ConfirmPopover — the
  // overlay case the mount harness says to flush for.
  flush();
  commenting.open({ start: 2, end: 2 });
  return { target, commenting, sounds, discard: () => find() as HTMLButtonElement };
}

describe("DiffPlanView gutter composer", () => {
  // The gutter `+` reveal, line-offset positioning, and the persisted create are
  // real-browser behavior covered by the Playwright e2e (diff-surface.e2e.ts).
  // Here we assert the composer is mounted only when the gutter callback opens
  // it — the closed/open render branch, which is component-unit territory.
  test("renders no composer until the gutter opens one", async () => {
    const { target } = render(DiffPlanView, props());
    await until(() => shadow(target)?.textContent?.includes("hello world") ?? false);
    expect(target.querySelector('[role="dialog"]')).toBeNull();
  });

  // Discard hands the controller the composer's live text, which is what picks the
  // cue apart: words thrown away are discarded, an empty box is merely dropped. The
  // controller is a prop, so its injected sound dep is the seam that observes it —
  // the singleton the other surfaces read has none.
  test("discarding an empty composer drops it rather than discarding it", async () => {
    const { sounds, discard } = await openComposer("");
    discard().click();
    expect(sounds).toEqual(["commentOpen", "commentDropped"]);
  });

  test("discarding a composer holding text reports it as a discard", async () => {
    const { sounds, discard } = await openComposer("a draft");
    discard().click(); // routes through the confirmation, per EXC-749
    await until(() => document.querySelector(".confirm") !== null);
    document.querySelector<HTMLButtonElement>(".confirm")?.click();
    expect(sounds).toEqual(["commentOpen", "commentDiscarded"]);
  });
});

describe("DiffPlanView instance preservation across the poll", () => {
  test("a same-version prop tick keeps the same rendered pre — no remount", async () => {
    // The 2s poll re-delivers the active review object; an unchanged id:version
    // must update the instance in place so scroll/DOM state survives.
    const p = reactiveProps(props());
    const { target, flush, pre } = await renderAndWaitForPre(p);
    expect(pre).not.toBeNull();

    // A fresh object with the SAME id and version (what a poll tick produces).
    p.review = reviewFixture();
    flush();
    await until(() => shadow(target)?.querySelector("pre") != null);
    expect(shadow(target)?.querySelector("pre")).toBe(pre as HTMLPreElement);
  });

  test("a new version recreates the view with the new text", async () => {
    const p = reactiveProps(props());
    const { target, flush, pre } = await renderAndWaitForPre(p);

    p.review = reviewFixture({ version: 2, currentPlan: "# Title\n\nrevised text\n" });
    flush();
    await expectViewRecreated(() => shadow(target), pre, "revised text", "hello world");
  });
});

describe("DiffPlanView version compare", () => {
  test("shows a disabled compare control for a single-version review", () => {
    const { target } = render(DiffPlanView, props({ review: reviewFixture() }));
    // EXC-664: the control is always present; with nothing to compare its toggle
    // is disabled (greyed out) rather than hidden, and the pickers stay closed.
    const toggle = target.querySelector<HTMLButtonElement>(".compare-toggle");
    expect(toggle).not.toBeNull();
    expect(toggle!.disabled).toBe(true);
    expect(target.querySelector(".pair")).toBeNull();
  });

  test("offers the compare control when the review has multiple versions", () => {
    const { target } = render(DiffPlanView, props({ review: multiVersionFixture(3) }));
    expect(target.querySelector(".compare-picker")).not.toBeNull();
    // The mode is off by default, so the single-version source view shows.
    expect(target.querySelector(".pair")).toBeNull();
  });

  // The working-directory path sits in the compare row (EXC-807), right-aligned
  // while not comparing and dropped once compare mode is on. It is a click-to-copy
  // button, with no hover tooltip (EXC-850).
  test("shows the working-directory path in the compare row when not comparing", () => {
    const { target } = render(DiffPlanView, props({ review: reviewFixture() }));
    const cwd = target.querySelector(".control-row .cwd");
    expect(cwd).not.toBeNull();
    expect(cwd!.textContent).toContain("/tmp/p");
  });

  test("clicking the working-directory path copies the full absolute path", () => {
    // Deep enough that the display abbreviates (…/Play/caret) while the copy is
    // the whole path — proving the two differ (EXC-850).
    const copied = capture<string>();
    const deep = "/Users/dev/GitLocal/Play/caret";
    const { target } = render(
      DiffPlanView,
      props({ review: reviewFixture({ cwd: deep }), onCopyCwd: copied.cb }),
    );
    const cwd = target.querySelector<HTMLButtonElement>(".control-row button.cwd");
    expect(cwd?.textContent?.trim()).toBe("…/Play/caret");
    cwd?.click();
    expect(copied.last()).toBe(deep);
  });

  test("hides the working-directory path in compare mode", async () => {
    const { target } = render(DiffPlanView, props({ review: multiVersionFixture(3) }));
    expect(target.querySelector(".control-row .cwd")).not.toBeNull();
    target.querySelector<HTMLButtonElement>(".compare-toggle")!.click();
    await until(() => target.querySelector(".control-row .cwd") == null);
    expect(target.querySelector(".control-row .cwd")).toBeNull();
  });

  test("entering compare mode renders a diff between the default version pair", async () => {
    const { target } = render(DiffPlanView, props({ review: multiVersionFixture(3) }));
    target.querySelector<HTMLButtonElement>(".compare-toggle")!.click();
    // Default pair is base=v3 (current), target=v2 (previous): both bodies show.
    const painted = await until(() => {
      const text = shadow(target)?.textContent ?? "";
      return text.includes("body revision 3") && text.includes("body revision 2");
    });
    expect(painted).toBe(true);
  });

  test("the compare header surfaces the selected version pair", async () => {
    const { target } = render(DiffPlanView, props({ review: multiVersionFixture(3) }));
    target.querySelector<HTMLButtonElement>(".compare-toggle")!.click();
    // Default pair is base=v3 (after), target=v2 (before), so the header reads the
    // pair v2 → v3 — naming what is compared, not a placeholder filename.
    await until(() => shadow(target)?.querySelector("[data-diffs-header]") != null);
    const header = shadow(target)?.querySelector("[data-diffs-header]");
    expect(header).not.toBeNull();
    expect(header?.querySelector("[data-prev-name]")?.textContent).toBe("v2");
    expect(header?.querySelector("[data-title]")?.textContent).toBe("v3");
    // Pinned so the pair and the change counts stay in view on a long diff.
    expect(header?.hasAttribute("data-sticky")).toBe(true);
  });

  // EXC-872: compare state lives here, but the comment panel is a root sibling of
  // .shell — so the compared versions are reported upward for App to point the panel
  // at. EXC-1041: reported as the two documents the diff renders, not as a sorted
  // range, so the panel knows which side each version's comments jump to.
  /** Mount recording every `onCompareChange` call — the shared arrange for the
   * two tests below, which then drive the toggle differently. */
  function mountCompareChange(): {
    target: HTMLElement;
    calls: Array<{ before: number; after: number } | null>;
  } {
    const calls: Array<{ before: number; after: number } | null> = [];
    const { target } = render(
      DiffPlanView,
      props({
        review: multiVersionFixture(3),
        onCompareChange: (r: { before: number; after: number } | null) => calls.push(r),
      }),
    );
    return { target, calls };
  }

  test("reports the compared versions on entering compare mode, before and after", async () => {
    const { target, calls } = mountCompareChange();
    await until(() => calls.length > 0);
    expect(calls.at(-1)).toBeNull();

    target.querySelector<HTMLButtonElement>(".compare-toggle")!.click();
    await until(() => calls.at(-1) != null);
    // Default pair is base=v3, target=v2, and the diff renders oldDoc=target /
    // newDoc=base — so v2 is the before side and v3 the after.
    expect(calls.at(-1)).toEqual({ before: 2, after: 3 });
  });

  test("reports null once compare mode is left", async () => {
    const { target, calls } = mountCompareChange();
    const toggle = target.querySelector<HTMLButtonElement>(".compare-toggle")!;
    toggle.click();
    await until(() => calls.at(-1) != null);
    const entered = calls.length;
    toggle.click();
    await until(() => calls.length > entered);
    expect(calls.at(-1)).toBeNull();
  });

  test("the persisted layout preference drives the initial diff style", async () => {
    localStorage.setItem("caret.diffStyle", "unified");
    const { target } = render(DiffPlanView, props({ review: multiVersionFixture(3) }));
    target.querySelector<HTMLButtonElement>(".compare-toggle")!.click();
    await until(() => shadow(target)?.querySelector("pre") != null);
    // The library renders unified layout as data-diff-type="single".
    const applied = await until(
      () => shadow(target)?.querySelector("pre")?.getAttribute("data-diff-type") === "single",
    );
    expect(applied).toBe(true);
  });
});

describe("DiffPlanView annotation display", () => {
  const lineAnn = (over: Record<string, unknown> = {}) => ({
    id: "ln1",
    startLine: 3,
    endLine: 3,
    comment: "fix this line",
    ...over,
  });

  const twoLineAnnotations = () => [
    lineAnn({ id: "a", startLine: 2, endLine: 2, comment: "first" }),
    lineAnn({ id: "b", startLine: 4, endLine: 4, comment: "second" }),
  ];

  test("renders an inline card for a line annotation", async () => {
    const { target } = render(DiffPlanView, props({ annotations: [lineAnn()] }));
    const card = await until(() => target.querySelector('[data-annotation-card="ln1"]') != null);
    expect(card).toBe(true);
  });

  test("the focused annotation renders expanded, the rest collapsed", async () => {
    const annotations = twoLineAnnotations();
    const { target } = render(DiffPlanView, props({ annotations, focusedAnnotation: "a" }));
    await until(() => target.querySelector('[data-annotation-card="a"]') != null);
    const a = target.querySelector('[data-annotation-card="a"]')!;
    const b = target.querySelector('[data-annotation-card="b"]')!;
    // Expansion is per-card and independent (EXC-765): focusing "a" expands it
    // without collapsing "b" — but "b" was never focused, so it starts a chip. The
    // body stays mounted for the grid reveal, so expansion is the .expanded class.
    expect(a.classList.contains("expanded")).toBe(true);
    expect(b.classList.contains("expanded")).toBe(false);
    expect(b.querySelector(".chip")).not.toBeNull();
  });

  test("clicking a collapsed card focuses its annotation", async () => {
    let focused: string | undefined;
    const { target } = render(
      DiffPlanView,
      props({ annotations: [lineAnn()], onFocusAnnotation: (id: string) => (focused = id) }),
    );
    await until(() => target.querySelector('[data-annotation-card="ln1"] .chip') != null);
    target.querySelector<HTMLElement>('[data-annotation-card="ln1"] .chip')!.click();
    expect(focused).toBe("ln1");
  });

  test("two comments on one line render as a single ordered thread", async () => {
    const annotations = [
      lineAnn({ id: "first", startLine: 3, endLine: 3, comment: "earlier note" }),
      lineAnn({ id: "second", startLine: 3, endLine: 3, comment: "later note" }),
    ];
    const { target } = render(DiffPlanView, props({ annotations }));
    await until(() => target.querySelector(".thread") != null);
    // One shared container, not two disconnected chips.
    expect(target.querySelectorAll(".thread")).toHaveLength(1);
    const thread = target.querySelector(".thread")!;
    expect(thread.querySelectorAll("[data-annotation-card]")).toHaveLength(2);
    // It carries a count and an order cue per card.
    expect(thread.querySelector(".thread-count")?.textContent).toContain("2");
    expect(
      [...thread.querySelectorAll(".thread-ordinal")].map((o) => o.textContent?.trim()),
    ).toEqual(["1", "2"]);
  });

  test("comments on different lines each get their own (unthreaded) card", async () => {
    const annotations = twoLineAnnotations();
    const { target } = render(DiffPlanView, props({ annotations }));
    await until(() => target.querySelector('[data-annotation-card="a"]') != null);
    // Distinct lines: no thread container, two standalone cards.
    expect(target.querySelector(".thread")).toBeNull();
    expect(target.querySelectorAll("[data-annotation-card]")).toHaveLength(2);
  });

  test("legacy annotations render in the read-only list, not as cards", async () => {
    const legacy = {
      id: "g1",
      blockId: "b0",
      startOffset: 0,
      endOffset: 5,
      quote: "Title",
      comment: "legacy note",
    };
    const { target } = render(DiffPlanView, props({ annotations: [legacy] }));
    const listed = await until(() => target.querySelector(".legacy-list") != null);
    expect(listed).toBe(true);
    expect(target.querySelector(".legacy-list")?.textContent).toContain("legacy note");
    expect(target.querySelector('[data-annotation-card="g1"]')).toBeNull();
  });

  test("shows no annotation cards in compare mode", async () => {
    const { target } = await enterCompareMode([lineAnn()]);
    expect(target.querySelector('[data-annotation-card="ln1"]')).toBeNull();
  });
});

describe("DiffPlanView comment-span brackets", () => {
  const lineAnn = (over: Record<string, unknown> = {}) => ({
    id: "ln1",
    startLine: 3,
    endLine: 6,
    comment: "fix this range",
    ...over,
  });

  // The bracket's pixel geometry (rail top/height, scroll/resize re-measure) is
  // real layout, owned by bracketBox's unit tests and the Playwright e2e — happy-
  // dom has no layout. Here we assert the host-side wiring: the overlay mounts in
  // the .diff-plan scroll container and reconciles one rail per drawn span (saved
  // comments plus the open composer), so a multi-line comment gets its bracket.

  function layer(target: HTMLElement): Element | null {
    return target.querySelector(".diff-plan [data-comment-bracket-layer]");
  }

  test("mounts the bracket overlay in the scroll container", async () => {
    const { target } = render(DiffPlanView, props({ annotations: [lineAnn()] }));
    const placed = await until(() => layer(target) != null);
    expect(placed).toBe(true);
  });

  test("draws one rail per saved comment span", async () => {
    const annotations = [
      lineAnn({ id: "a", startLine: 2, endLine: 5 }),
      lineAnn({ id: "b", startLine: 8, endLine: 8 }),
    ];
    const { target } = render(DiffPlanView, props({ annotations }));
    await until(
      () => (layer(target)?.querySelectorAll("[data-comment-bracket]").length ?? 0) === 2,
    );
    expect(layer(target)?.querySelectorAll("[data-comment-bracket]")).toHaveLength(2);
  });

  test("the bracket layer is absent in compare mode", async () => {
    const { target } = await enterCompareMode([lineAnn()]);
    expect(layer(target)).toBeNull();
  });
});

const toggle = (target: HTMLElement) =>
  target.querySelector<HTMLButtonElement>(".control-row .preview-toggle");

async function renderOnPreview(over = {}) {
  const mounted = render(DiffPlanView, props(over));
  await until(() => toggle(mounted.target) != null);
  toggle(mounted.target)!.click();
  await until(() => mounted.target.querySelector(".plan-preview") != null);
  return mounted;
}

describe("DiffPlanView code-block chrome", () => {
  // The chrome's pixel geometry is real layout, owned by codeChrome.ts's unit tests and
  // the Playwright e2e — happy-dom has none. Here: the host-side wiring — what re-anchors
  // the boxes, and that they do not outlive their document.
  const planWithBlock = (body: string, lead = "") =>
    `# Title\n\n${lead}\`\`\`ts\n${body}\n\`\`\`\n`;

  function chromeBoxes(target: HTMLElement): NodeListOf<Element> {
    return target.querySelectorAll(".diff-plan .code-chrome");
  }

  test("a new version drops the prior document's boxes", async () => {
    const p = reactiveProps(props({ review: reviewFixture({ currentPlan: planWithBlock("a") }) }));
    const { target, flush } = render(DiffPlanView, p);
    await until(() => chromeBoxes(target).length === 1);

    p.review = reviewFixture({ version: 2, currentPlan: planWithBlock("b", "prose\n\n") });
    flush();
    expect(chromeBoxes(target)).toHaveLength(0);
  });

  // Fences open on lines 3 and 7.
  const twoBlocks = "# Title\n\n```ts\na\n```\n\n```\nb\n```\n";
  const copyLabels = (target: HTMLElement) =>
    [...chromeBoxes(target)].map(
      (box) => box.querySelector("button")?.getAttribute("aria-label") ?? "",
    );
  const renderBlocksOnPreview = () =>
    renderOnPreview({ review: reviewFixture({ currentPlan: twoBlocks }) });

  test("the preview mounts one box per block, keyed by its fence line", async () => {
    const { target } = await renderBlocksOnPreview();
    await until(() => chromeBoxes(target).length === 2);
    expect(copyLabels(target)).toEqual(["Copy code from line 3", "Copy code from line 7"]);
  });

  test("the preview's chrome follows its block when the theme repaints", async () => {
    const { target } = await renderOnPreview({
      review: reviewFixture({ currentPlan: planWithBlock("a") }),
    });
    await until(() => chromeBoxes(target).length === 1);
    const top = () => (chromeBoxes(target)[0] as HTMLElement).style.top;
    const before = top();
    repaintMoving(target.querySelectorAll<HTMLElement>(".plan-preview pre"));
    expect(await until(() => top() !== before)).toBe(true);
  });

  test("a block hovered on one surface is not lit on the other after a flip", async () => {
    const { target } = render(
      DiffPlanView,
      props({ review: reviewFixture({ currentPlan: twoBlocks }) }),
    );
    await until(() => chromeBoxes(target).length === 2);
    const lit = () => target.querySelectorAll(".code-chrome[data-lit]").length;
    // happy-dom rects are all zero, so the origin falls inside the first block.
    target
      .querySelector(".diff-plan")!
      .dispatchEvent(new PointerEvent("pointermove", { clientX: 0, clientY: 0 }));
    await until(() => lit() === 1);
    toggle(target)!.click();
    await until(() => target.querySelector(".plan-preview") != null);
    await until(() => chromeBoxes(target).length === 2);
    expect(lit()).toBe(0);
  });

  test("flipping back to source re-mounts the source boxes and no preview box", async () => {
    const { target, flush } = await renderBlocksOnPreview();
    await until(() => chromeBoxes(target).length === 2);
    toggle(target)!.click();
    flush();
    expect(chromeBoxes(target).length).toBe(0);
    await until(() => chromeBoxes(target).length === 2);
    expect(copyLabels(target)).toEqual(["Copy code from line 3", "Copy code from line 7"]);
  });
});

// File-reference resolution (EXC-687) is keyed off the plan text, not the review
// object identity: the 2s poll re-delivers a fresh review object every tick, but
// the referenced files don't change underneath the reader, so the daemon must be
// asked to resolve them once per plan — not on every tick. A per-tick re-resolve
// briefly clears the resolved set, which flickers the icons and the open hover
// preview. This pins that the resolve round-trip fires once across many ticks.
describe("DiffPlanView file-reference resolution", () => {
  function jsonResponse(value: unknown): Response {
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  test("resolves file refs once per plan, not on every poll tick", async () => {
    let fileRefCalls = 0;
    const cap = logCapture((url) => {
      if (url.includes("/file-refs")) {
        fileRefCalls++;
        return Promise.resolve(jsonResponse({ resolved: { "src/foo.ts": "file" } }));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    try {
      const plan = "# Title\n\nSee `src/foo.ts` for the cache.\n";
      const p = reactiveProps(props({ review: reviewFixture({ currentPlan: plan }) }));
      const { flush } = render(DiffPlanView, p);
      // The initial mount resolves the one candidate exactly once.
      await until(() => fileRefCalls === 1);

      // Five poll ticks re-deliver a fresh review object with identical content;
      // none of them should re-hit the resolver.
      for (let i = 0; i < 5; i++) {
        p.review = reviewFixture({ currentPlan: plan });
        flush();
      }
      await Promise.resolve();
      expect(fileRefCalls).toBe(1);
    } finally {
      cap.restore();
    }
  });

  function stubResolve(): { calls: () => number; restore: () => void } {
    let n = 0;
    const cap = logCapture((url) => {
      if (url.includes("/file-refs")) {
        n++;
        return Promise.resolve(jsonResponse({ resolved: { "src/foo.ts": "file" } }));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    return { calls: () => n, restore: cap.restore };
  }
  const PREVIEW_PLAN = "# Title\n\nSee `src/foo.ts` for the cache.\n";
  const previewRef = (target: HTMLElement) =>
    target.querySelector<HTMLElement>(".plan-preview [data-file-ref]");

  test("on the preview, the resolved references are tagged", async () => {
    const stub = stubResolve();
    try {
      const { target } = await renderOnPreview({
        review: reviewFixture({ currentPlan: PREVIEW_PLAN }),
      });
      expect(await until(() => previewRef(target) != null)).toBe(true);
      expect(previewRef(target)?.textContent).toBe("src/foo.ts");
    } finally {
      stub.restore();
    }
  });

  test("flipping to the preview issues no further resolve", async () => {
    const stub = stubResolve();
    try {
      const { target } = await renderOnPreview({
        review: reviewFixture({ currentPlan: PREVIEW_PLAN }),
      });
      await until(() => previewRef(target) != null);
      expect(stub.calls()).toBe(1);
    } finally {
      stub.restore();
    }
  });

  test("clicking a preview reference opens the file lane", async () => {
    const stub = stubResolve();
    try {
      const { target, flush } = await renderOnPreview({
        review: reviewFixture({ currentPlan: PREVIEW_PLAN }),
      });
      await until(() => previewRef(target) != null);

      previewRef(target)?.click();
      flush();

      expect(await until(() => target.querySelector("[data-file-drawer]") != null)).toBe(true);
    } finally {
      stub.restore();
    }
  });

  test("re-resolves when the plan text actually changes", async () => {
    let fileRefCalls = 0;
    const cap = logCapture((url) => {
      if (url.includes("/file-refs")) {
        fileRefCalls++;
        return Promise.resolve(jsonResponse({ resolved: {} }));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    try {
      const p = reactiveProps(
        props({ review: reviewFixture({ currentPlan: "# T\n\nSee `src/foo.ts`.\n" }) }),
      );
      const { flush } = render(DiffPlanView, p);
      await until(() => fileRefCalls === 1);

      // A genuinely new plan (a revision) with a different reference re-resolves.
      p.review = reviewFixture({ version: 2, currentPlan: "# T\n\nNow `src/bar.ts`.\n" });
      flush();
      await until(() => fileRefCalls === 2);
      expect(fileRefCalls).toBe(2);
    } finally {
      cap.restore();
    }
  });
});

// On load, and whenever the rendered content changes, DiffPlanView reseeds the
// injected controller from the review's persisted scratches, so a reload restores
// the reviewer's "Resume" markers instead of starting empty (EXC-744). The
// controller is owned by App (EXC-877); these tests inject one and observe it directly.
describe("DiffPlanView scratch rehydration", () => {
  /** Mount with one persisted scratch on line 3 — the common seed the tests
   * below start from before driving a further review update. */
  function mountWithScratch(text: string): {
    commenting: ReturnType<typeof createSourceCommenting>;
    p: ReturnType<typeof props>;
    flush: () => void;
  } {
    const commenting = createSourceCommenting({ onCreate: () => {} });
    const p = reactiveProps(
      props({
        commenting,
        review: reviewFixture({ composerScratches: [{ startLine: 3, endLine: 3, text }] }),
      }),
    );
    const { flush } = render(DiffPlanView, p);
    return { commenting, p, flush };
  }

  test("seeds the controller from the review's persisted scratches on mount", async () => {
    const { commenting } = mountWithScratch("resume me");
    await until(() => commenting.scratches().length > 0);
    expect(commenting.scratches()).toEqual([
      { key: scratchKey(3, 3), startLine: 3, endLine: 3, text: "resume me" },
    ]);
  });

  test("wipes the prior version's scratches when a new plan version arrives", async () => {
    const { commenting, p, flush } = mountWithScratch("v1 scratch");
    await until(() => commenting.scratches().length > 0);
    // A revision (new version) is served with its own — empty — scratch set.
    p.review = reviewFixture({
      version: 2,
      currentPlan: "# Title\n\nrevised\n",
      composerScratches: [],
    });
    flush();
    await until(() => commenting.scratches().length === 0);
    expect(commenting.scratches()).toEqual([]);
  });

  test("does not reseed when a poll re-delivers the same id:version", async () => {
    const { commenting, p, flush } = mountWithScratch("live scratch");
    await until(() => commenting.scratches().length > 0);
    // The 2s poll re-delivers the SAME id:version as a fresh object carrying a
    // different server-side set; the source view must NOT reseed over the
    // reviewer's in-progress scratch (contentKey is unchanged, read untracked).
    p.review = reviewFixture({
      composerScratches: [{ startLine: 9, endLine: 9, text: "stale server copy" }],
    });
    flush();
    expect(commenting.scratches()).toEqual([
      { key: scratchKey(3, 3), startLine: 3, endLine: 3, text: "live scratch" },
    ]);
  });
});

describe("DiffPlanView plan search (EXC-832)", () => {
  // The registered `/` entry opens the pill; the dispatcher (App.svelte-wired) is
  // not mounted here, so drive the action directly off the registry, the same way
  // the real keydown path would. The highlight paint + cursor jump are real-browser
  // behavior covered by the e2e; here we assert the light-DOM wiring: the pill
  // opens, the query drives the counter, and closing removes it.
  async function openSearch(target: HTMLElement) {
    await until(() => shortcuts.list().some((e) => e.id === "actions.search"));
    shortcuts
      .list()
      .find((e) => e.id === "actions.search")
      ?.run?.();
    await until(() => target.querySelector(".plan-search") != null);
  }

  test("/ owns search", async () => {
    const { target } = render(DiffPlanView, props());
    await openSearch(target);
    expect(target.querySelector(".plan-search")).not.toBeNull();
  });

  test("typing a query drives the match counter", async () => {
    const review = reviewFixture({ currentPlan: "# Title\n\nalpha beta alpha\n\nalpha gamma\n" });
    const { target } = render(DiffPlanView, props({ review }));
    await openSearch(target);
    const field = target.querySelector<HTMLInputElement>("input[aria-label='Search plan']")!;
    field.value = "alpha";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    const counted = await until(
      () => target.querySelector(".search-count")?.textContent?.replace(/\s+/g, "") === "1/3",
    );
    expect(counted).toBe(true);
  });

  test("closing the pill removes it", async () => {
    const { target } = render(DiffPlanView, props());
    await openSearch(target);
    target.querySelector<HTMLButtonElement>("[aria-label='Close search']")?.click();
    const gone = await until(() => target.querySelector(".plan-search") == null);
    expect(gone).toBe(true);
  });
});

describe("DiffPlanView plan view toggle", () => {
  test("a fresh mount reads the source view with the toggle unpressed", async () => {
    const { target } = render(DiffPlanView, props());
    await until(() => shadow(target)?.textContent?.includes("hello world") ?? false);
    expect(toggle(target)?.getAttribute("aria-pressed")).toBe("false");
    expect(target.querySelector(".plan-preview") != null).toBe(false);
  });

  test("the toggle switches to the preview and remembers it", async () => {
    const { target } = await renderOnPreview();
    expect(target.querySelector(".plan-preview")?.textContent).toContain("hello world");
    expect(toggle(target)?.getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("caret.planView")).toBe("preview");
  });

  const enabled = (id: string) =>
    shortcuts
      .list()
      .find((e) => e.id === id)
      ?.enabled?.();
  const togglePreview = () =>
    shortcuts
      .list()
      .find((e) => e.id === "actions.togglePreview")
      ?.run?.();

  test("p flips to the preview and back", async () => {
    const { target } = render(DiffPlanView, props());
    await until(() => toggle(target) != null);
    togglePreview();
    await until(() => target.querySelector(".plan-preview") != null);
    expect(toggle(target)?.getAttribute("aria-pressed")).toBe("true");
    togglePreview();
    await until(() => target.querySelector(".plan-preview") == null);
    expect(toggle(target)?.getAttribute("aria-pressed")).toBe("false");
  });

  test("the toggle advertises p with a cap", async () => {
    const { target } = render(DiffPlanView, props());
    await until(() => toggle(target) != null);
    expect(toggle(target)?.getAttribute("aria-keyshortcuts")).toBe("p");
    expect(toggle(target)?.querySelector("[data-slot='kbd']")?.textContent).toBe("p");
  });

  test("p is off while comparing", async () => {
    const { target } = render(DiffPlanView, props({ review: multiVersionFixture(3) }));
    await until(() => toggle(target) != null);
    target.querySelector<HTMLButtonElement>(".compare-toggle")!.click();
    await until(() => toggle(target) == null);
    expect(enabled("actions.togglePreview")).toBe(false);
  });

  test("the preview keeps the search dock and its shortcut", async () => {
    const { target } = render(DiffPlanView, props());
    await until(() => target.querySelector(".search-dock") != null);
    toggle(target)!.click();
    await until(() => target.querySelector(".plan-preview") != null);
    expect(target.querySelector(".search-dock") != null).toBe(true);
    expect(enabled("actions.search")).toBe(true);
  });

  test("the preview keeps the contents trigger and the heading shortcuts", async () => {
    const { target } = await renderOnPreview();
    const shown = await until(
      () => target.querySelector(".control-row [data-slot='popover-trigger']") != null,
    );
    expect(shown).toBe(true);
    expect(enabled("actions.contents")).toBe(true);
    expect(enabled("actions.headingNav")).toBe(true);
  });

  test("hovering the preview does not arm the drag hint for the source view", async () => {
    const { target } = await renderOnPreview();
    target.querySelector(".diff-plan")!.dispatchEvent(new MouseEvent("mouseenter"));
    toggle(target)!.click();
    await until(() => shadow(target)?.textContent?.includes("hello world") ?? false);
    expect(target.querySelector(".drag-hint") != null).toBe(false);
  });

  test("a remembered preview opens on the preview", async () => {
    localStorage.setItem("caret.planView", "preview");
    const { target } = render(DiffPlanView, props());
    const opened = await until(() => target.querySelector(".plan-preview") != null);
    expect(opened).toBe(true);
  });

  test("compare mode hides the toggle and leaving it restores the preview", async () => {
    localStorage.setItem("caret.planView", "preview");
    const { target } = render(DiffPlanView, props({ review: multiVersionFixture(3) }));
    await until(() => target.querySelector(".plan-preview") != null);
    target.querySelector<HTMLButtonElement>(".compare-toggle")!.click();
    await until(() => toggle(target) == null);
    expect(target.querySelector(".plan-preview") != null).toBe(false);
    target.querySelector<HTMLButtonElement>(".compare-toggle")!.click();
    const restored = await until(() => target.querySelector(".plan-preview") != null);
    expect(restored).toBe(true);
  });

  test("flipping with a typed composer open keeps the text as a scratch", async () => {
    const { target, commenting } = await openComposer("half a thought");
    toggle(target)!.click();
    expect(commenting.scratches().map((s) => s.text)).toEqual(["half a thought"]);
  });
});

/** Mount `plan` on the preview with App's mirror of the controller wired as props, so an
 * open or a resume renders the composer as it does in the app. */
async function renderSlots(
  plan: string,
  {
    onCreate = () => {},
    ...over
  }: Record<string, unknown> & { onCreate?: SourceCommentingDeps["onCreate"] } = {},
) {
  localStorage.setItem("caret.planView", "preview");
  const p = reactiveProps({
    ...props({ review: reviewFixture({ currentPlan: plan }), ...over }),
    pending: undefined as { startLine: number; endLine: number } | undefined,
    pendingText: "",
    scratches: [] as ComposerScratch[],
  });
  const commenting = createSourceCommenting({
    onCreate,
    onChange: () => {
      p.pending = commenting.pending();
      p.pendingText = commenting.pendingText();
      p.scratches = commenting.scratches();
    },
  });
  p.commenting = commenting;
  const mounted = render(DiffPlanView, p);
  await until(() => mounted.target.querySelector(".plan-preview") != null);
  return { ...mounted, p, commenting };
}

describe("DiffPlanView preview comment slots", () => {
  // Blocks: heading [1,1], paragraph [3,4], paragraph [6,6]; line 5 is a gap.
  const plan = "# Title\n\nalpha one\nalpha two\n\nbeta\n";
  const ann = (id: string, line: number, comment = id) => ({
    id,
    startLine: line,
    endLine: line,
    comment,
  });
  const slot = (target: HTMLElement, block: number) =>
    target.querySelector(`[data-preview-slot="${block}"]`);

  test("a thread renders in the slot of the block holding its end line", async () => {
    const { target } = await renderSlots(plan, { annotations: [ann("a", 4, "on alpha")] });
    const found = await until(() => slot(target, 1)?.textContent?.includes("on alpha") ?? false);
    expect(found).toBe(true);
  });

  test("a thread ending on a gap line renders in the previous block's slot", async () => {
    const { target } = await renderSlots(plan, { annotations: [ann("a", 5, "in the gap")] });
    const found = await until(() => slot(target, 1)?.textContent?.includes("in the gap") ?? false);
    expect(found).toBe(true);
  });

  test("two comments in one block share its slot, in line order", async () => {
    const { target } = await renderSlots(plan, { annotations: [ann("b", 4), ann("a", 3)] });
    await until(() => slot(target, 1)?.querySelectorAll("[data-slot-line]").length === 2);
    const lines = [...slot(target, 1)!.querySelectorAll("[data-slot-line]")].map((el) =>
      el.getAttribute("data-slot-line"),
    );
    expect(lines).toEqual(["3", "4"]);
    expect(target.querySelectorAll("[data-preview-slot]").length).toBe(1);
  });

  test("resuming a draft's marker opens the composer in the preview with its text", async () => {
    const { target } = await renderSlots(plan, {
      review: reviewFixture({
        currentPlan: plan,
        composerScratches: [{ startLine: 6, endLine: 6, text: "kept draft" }],
      }),
    });
    const resume = () =>
      [...(slot(target, 2)?.querySelectorAll("button") ?? [])].find((b) =>
        b.textContent?.includes("Resume"),
      );
    expect(await until(() => resume() !== undefined)).toBe(true);
    resume()!.click();
    const opened = await until(
      () => slot(target, 2)?.querySelector(".cm-content")?.textContent === "kept draft",
    );
    expect(opened).toBe(true);
  });

  test("a block followed by a slot is padded open, and closes when the comment goes", async () => {
    const { target, p } = await renderSlots(plan, { annotations: [ann("a", 3)] });
    const wrapper = () =>
      target.querySelector<HTMLElement>(".plan-preview")!.children[1] as HTMLElement;
    const padded = await until(() => wrapper().style.paddingBlockEnd !== "");
    expect(padded).toBe(true);
    p.annotations = [];
    const released = await until(() => wrapper().style.paddingBlockEnd === "");
    expect(released).toBe(true);
  });

  test("a slot follows its block when the theme repaints", async () => {
    const { target } = await renderSlots(plan, { annotations: [ann("a", 3)] });
    const el = () => slot(target, 1) as HTMLElement | null;
    await until(
      () => el() != null && !el()!.hasAttribute("data-unmeasured") && el()!.style.top !== "",
    );
    const before = el()!.style.top;
    repaintMoving(target.querySelectorAll<HTMLElement>(".plan-preview > *"));
    expect(await until(() => el()!.style.top !== before)).toBe(true);
  });

  test("a switch to a review of the same plan text measures its slot again", async () => {
    const { target, p, flush } = await renderSlots(plan, { annotations: [ann("a", 3)] });
    const measured = () => {
      const el = slot(target, 1);
      return el != null && !el.hasAttribute("data-unmeasured");
    };
    await until(measured);
    p.review = reviewFixture({ id: "other-review", currentPlan: plan });
    flush();
    expect(await until(measured)).toBe(true);
  });

  test("flipping to source with the preview's composer open keeps it as a draft", async () => {
    const { target, commenting } = await renderSlots(plan, {
      review: reviewFixture({
        currentPlan: plan,
        composerScratches: [{ startLine: 3, endLine: 4, text: "mid flip" }],
      }),
    });
    await until(() => commenting.scratches().length > 0);
    commenting.resume(scratchKey(3, 4));
    await until(() => slot(target, 1)?.querySelector(".cm-content") != null);
    toggle(target)!.click();
    expect(commenting.scratches()).toEqual([
      { key: scratchKey(3, 4), startLine: 3, endLine: 4, text: "mid flip" },
    ]);
  });
});

describe("DiffPlanView preview cursor", () => {
  const live = (id: string): boolean =>
    shortcuts.list().find((e) => e.id === id)?.run !== undefined;
  const run = (id: string) =>
    shortcuts
      .list()
      .find((e) => e.id === id)
      ?.run?.();
  const enabled = (id: string) =>
    shortcuts
      .list()
      .find((e) => e.id === id)
      ?.enabled?.();
  const band = (target: HTMLElement) => target.querySelector("[data-caret-preview-cursor]");

  // happy-dom has no layout: every text range reads as one 20px line.
  const realRects = Range.prototype.getClientRects;
  afterEach(() => {
    Range.prototype.getClientRects = realRects;
  });
  function stubLayout(): void {
    Range.prototype.getClientRects = () =>
      [{ top: 0, bottom: 20, left: 0, right: 100 }] as unknown as DOMRectList;
  }

  test("the preview runs the motions and the keyboard comments", async () => {
    await renderOnPreview();
    await until(() => live("motion.down"));
    expect(["motion.down", "commenting.comment", "commenting.visualLine"].map(live)).toEqual([
      true,
      true,
      true,
    ]);
  });

  test("Esc closes the preview's search pill", async () => {
    await renderOnPreview();
    await until(() => live("actions.search"));
    run("actions.search");
    expect(await until(() => enabled("commenting.clear") === true)).toBe(true);
    run("commenting.clear");
    expect(await until(() => enabled("commenting.clear") === false)).toBe(true);
  });

  // A heading [1,1] and a paragraph stored over lines 3–4; under stubLayout each block
  // renders as one visual line.
  const twoBlocks = "# H\n\nalpha one\nalpha two\n";
  const label = (target: HTMLElement) => target.querySelector(".composer .label")?.textContent;

  test("c on the preview comments on the lines the cursor's visual line covers", async () => {
    stubLayout();
    const { target } = await renderSlots(twoBlocks);
    await until(() => live("commenting.comment"));
    run("motion.top");
    run("motion.down");
    run("commenting.comment");
    expect(await until(() => label(target) === "Lines 3–4")).toBe(true);
  });

  test("V, j, c on the preview comments across the selected visual lines", async () => {
    stubLayout();
    const { target } = await renderSlots(twoBlocks);
    await until(() => live("commenting.visualLine"));
    run("motion.top");
    run("commenting.visualLine");
    run("motion.down");
    run("commenting.comment");
    expect(await until(() => label(target) === "Lines 1–4")).toBe(true);
    expect(enabled("commenting.clear")).toBe(false);
  });

  test("V on the preview shows the visual hint chip", async () => {
    stubLayout();
    const { target } = await renderOnPreview();
    await until(() => live("commenting.visualLine"));
    run("motion.top");
    run("commenting.visualLine");
    expect(await until(() => target.querySelector(".visual-hint") != null)).toBe(true);
    run("commenting.clear");
    expect(await until(() => target.querySelector(".visual-hint") == null)).toBe(true);
  });

  test("the source view runs the motions and the line comments", async () => {
    render(DiffPlanView, props());
    await until(() => live("commenting.comment"));
    expect(["motion.down", "commenting.comment", "commenting.visualLine"].map(live)).toEqual([
      true,
      true,
      true,
    ]);
  });

  test("gg paints the cursor band on the preview's first line", async () => {
    stubLayout();
    const { target } = await renderOnPreview();
    await until(() => live("motion.top"));
    run("motion.top");
    await until(() => band(target) != null);
    expect(band(target)?.getAttribute("data-line")).toBe("1");
  });

  async function paintedBand(): Promise<HTMLElement> {
    stubLayout();
    const { target } = await renderOnPreview();
    await until(() => live("motion.top"));
    run("motion.top");
    await until(() => band(target) != null);
    return target;
  }
  function moveLayout(): void {
    Range.prototype.getClientRects = () =>
      [{ top: 40, bottom: 60, left: 0, right: 100 }] as unknown as DOMRectList;
  }
  const bandTop = (target: HTMLElement) => (band(target) as HTMLElement | null)?.style.top;

  test("the band follows a repaint of the theme's properties", async () => {
    const target = await paintedBand();
    const before = bandTop(target);
    moveLayout();
    document.documentElement.style.setProperty("--caret-test-repaint", "1");
    expect(await until(() => bandTop(target) !== before)).toBe(true);
    document.documentElement.style.removeProperty("--caret-test-repaint");
  });

  test("the band follows a rewrite of the preview's text", async () => {
    const target = await paintedBand();
    const before = bandTop(target);
    moveLayout();
    target.querySelector(".plan-preview p")?.append(" more");
    expect(await until(() => bandTop(target) !== before)).toBe(true);
  });

  test("a flip ends visual mode in either direction", async () => {
    stubLayout();
    const { target } = render(DiffPlanView, props());
    await until(() => live("commenting.visualLine"));
    run("motion.top");
    run("commenting.visualLine");
    expect(enabled("commenting.clear")).toBe(true);
    toggle(target)!.click();
    await until(() => target.querySelector(".plan-preview") != null);
    expect(enabled("commenting.clear")).toBe(false);
    run("motion.top");
    run("commenting.visualLine");
    expect(enabled("commenting.clear")).toBe(true);
    toggle(target)!.click();
    await until(() => target.querySelector(".plan-preview") == null);
    expect(enabled("commenting.clear")).toBe(false);
  });

  test("a content switch clears the preview cursor", async () => {
    stubLayout();
    const p = reactiveProps(props());
    const { target, flush } = render(DiffPlanView, p);
    await until(() => toggle(target) != null);
    toggle(target)!.click();
    await until(() => live("motion.top"));
    run("motion.top");
    expect(await until(() => band(target) != null)).toBe(true);
    p.review = reviewFixture({ version: 2, currentPlan: "# Other\n\nnew text\n" });
    flush();
    const cleared = await until(() => band(target) == null);
    expect(cleared).toBe(true);
  });

  async function search(target: HTMLElement, query: string): Promise<void> {
    await until(() => live("actions.search"));
    run("actions.search");
    await until(() => target.querySelector("input[aria-label='Search plan']") != null);
    const field = target.querySelector<HTMLInputElement>("input[aria-label='Search plan']")!;
    field.value = query;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  }

  test("a search committed across a version switch lands on the new version's text", async () => {
    stubLayout();
    const p = reactiveProps(props({ review: reviewFixture({ currentPlan: "# A\n\ngadget\n" }) }));
    const { target, flush } = render(DiffPlanView, p);
    await until(() => toggle(target) != null);
    toggle(target)!.click();
    await until(() => target.querySelector(".plan-preview") != null);
    await search(target, "gadget");
    await until(() => band(target) != null);
    p.review = reviewFixture({
      version: 2,
      currentPlan: "# B\n\nalpha\n\ngamma\n\nbeta\n",
    });
    flush();
    await until(
      () => target.querySelector(".plan-preview")?.textContent?.includes("beta") === true,
    );
    await search(target, "beta");
    await until(() => band(target)?.getAttribute("data-line") === "7");
    expect(band(target)?.getAttribute("data-line")).toBe("7");
  });
});

describe("DiffPlanView preview text comments", () => {
  // The paragraph "alpha one" / "alpha two" spans stored lines 3–4 and renders as one <p>.
  const plan = "# Title\n\nalpha one\nalpha two\n";

  afterEach(() => {
    document.getSelection()?.removeAllRanges();
  });

  /** The text node and offset where `word` starts in the preview. */
  function pointAt(root: HTMLElement, word: string): [Text, number] {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null)
      if (node.data.includes(word)) return [node, node.data.indexOf(word)];
    throw new Error(`no text "${word}" in the preview`);
  }

  async function renderParagraph(created: unknown[] = []) {
    const mounted = await renderSlots(plan, { onCreate: (anchor) => created.push(anchor) });
    const root = mounted.target.querySelector<HTMLElement>(".plan-preview")!;
    await until(() => root.querySelector("p") != null);
    return { ...mounted, root };
  }

  const label = (target: HTMLElement) => target.querySelector(".composer .label")?.textContent;

  /** Drag from line 3's last word to line 4's first. */
  function dragAcrossLines(root: HTMLElement): void {
    root.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    const [two, at] = pointAt(root, "alpha two");
    selectText(pointAt(root, "one"), [two, at + "alpha".length]);
    window.dispatchEvent(new PointerEvent("pointerup", { button: 0 }));
  }

  test("a click on the second stored line's text comments on that line", async () => {
    const { target, root } = await renderParagraph();
    selectText(pointAt(root, "two"));
    root.querySelector("p")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(await until(() => label(target) === "Line 4")).toBe(true);
  });

  test("a selection across the paragraph's line break comments on both lines", async () => {
    const { target, root } = await renderParagraph();
    dragAcrossLines(root);
    expect(await until(() => label(target) === "Lines 3–4")).toBe(true);
  });

  test("submitting a selection's composer creates a comment on its source lines", async () => {
    const created: unknown[] = [];
    const { target, root } = await renderParagraph(created);
    dragAcrossLines(root);
    await until(() => label(target) === "Lines 3–4");
    typeInto(
      EditorView.findFromDOM(target.querySelector(".composer .cm-editor")!)!,
      "tighten this",
    );
    [...target.querySelectorAll<HTMLButtonElement>(".composer button")]
      .find((b) => b.textContent?.includes("Comment"))!
      .click();
    expect(created).toEqual([{ startLine: 3, endLine: 4, comment: "tighten this" }]);
  });
});
