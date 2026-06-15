import "../../test-mount.ts";
import { afterEach, describe, expect, test } from "bun:test";
import type { ClientReview, PlanVersion } from "@core/types";
import { until } from "../../../test/support/poll.ts";
import { render } from "../../test-mount.ts";
import { reactiveProps } from "../../test-props.svelte.ts";
import DiffPlanView from "./DiffPlanView.svelte";

// Default props: no-op handlers and an empty annotation set, so the rendering
// tests below need only override `review` (or `annotations`).
function props(over: Record<string, unknown> = {}) {
  return {
    review: reviewFixture(),
    onCreateLineAnnotation: () => {},
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
    planEpoch: 0,
    version: 1,
    currentPlan: "# Title\n\nhello world\n",
    annotations: [],
    versions: [],
    generalCommentDraft: "",
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

afterEach(() => localStorage.clear());

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
    // The raw inline-link syntax is collapsed to the label.
    expect(text).not.toContain("](https://caret.test/docs)");
  });
});

describe("DiffPlanView contents pane", () => {
  test("shows the ToC pane with a row per heading for a multi-heading plan", async () => {
    const review = reviewFixture({
      currentPlan: "# Context\n\nintro\n\n## Approach\n\nbody\n\n## Verification\n\nv\n",
    });
    const { target } = render(DiffPlanView, props({ review }));
    const pane = await until(() => target.querySelector(".source-toc") != null);
    expect(pane).toBe(true);
    expect(target.querySelectorAll(".source-toc .toc-row")).toHaveLength(3);
    const labels = [...target.querySelectorAll(".source-toc .toc-row")].map((r) =>
      r.textContent?.trim(),
    );
    expect(labels).toEqual(["Context", "Approach", "Verification"]);
  });

  test("suppresses the ToC pane for a single-heading plan", async () => {
    const review = reviewFixture({ currentPlan: "# Only\n\njust one heading\n" });
    const { target } = render(DiffPlanView, props({ review }));
    // Wait for the source view to paint, then assert the pane is absent.
    await until(() => shadow(target)?.textContent?.includes("just one heading") ?? false);
    expect(target.querySelector(".source-toc")).toBeNull();
  });
});

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
});

describe("DiffPlanView instance preservation across the poll", () => {
  test("a same-version prop tick keeps the same rendered pre — no remount", async () => {
    // The 2s poll re-delivers the active review object; an unchanged id:version
    // must update the instance in place so scroll/DOM state survives.
    const p = reactiveProps(props());
    const { target, flush } = render(DiffPlanView, p);
    await until(() => shadow(target)?.textContent?.includes("hello world") ?? false);
    const pre = shadow(target)?.querySelector("pre");
    expect(pre).not.toBeNull();

    // A fresh object with the SAME id and version (what a poll tick produces).
    p.review = reviewFixture();
    flush();
    await until(() => shadow(target)?.querySelector("pre") != null);
    expect(shadow(target)?.querySelector("pre")).toBe(pre as HTMLPreElement);
  });

  test("a new version recreates the view with the new text", async () => {
    const p = reactiveProps(props());
    const { target, flush } = render(DiffPlanView, p);
    await until(() => shadow(target)?.textContent?.includes("hello world") ?? false);
    const pre = shadow(target)?.querySelector("pre");

    p.review = reviewFixture({ version: 2, currentPlan: "# Title\n\nrevised text\n" });
    flush();
    const repainted = await until(
      () => shadow(target)?.textContent?.includes("revised text") ?? false,
    );
    expect(repainted).toBe(true);
    expect(shadow(target)?.querySelector("pre")).not.toBe(pre as HTMLPreElement);
    expect(shadow(target)?.textContent).not.toContain("hello world");
  });
});

describe("DiffPlanView version compare", () => {
  test("shows no compare control for a single-version review", () => {
    const { target } = render(DiffPlanView, props({ review: reviewFixture() }));
    expect(target.querySelector(".compare-picker")).toBeNull();
  });

  test("offers the compare control when the review has multiple versions", () => {
    const { target } = render(DiffPlanView, props({ review: multiVersionFixture(3) }));
    expect(target.querySelector(".compare-picker")).not.toBeNull();
    // The mode is off by default, so the single-version source view shows.
    expect(target.querySelector(".pair")).toBeNull();
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

  test("renders an inline card for a line annotation", async () => {
    const { target } = render(DiffPlanView, props({ annotations: [lineAnn()] }));
    const card = await until(() => target.querySelector('[data-annotation-card="ln1"]') != null);
    expect(card).toBe(true);
  });

  test("the focused annotation expands while others collapse", async () => {
    const annotations = [
      lineAnn({ id: "a", startLine: 2, endLine: 2, comment: "first" }),
      lineAnn({ id: "b", startLine: 4, endLine: 4, comment: "second" }),
    ];
    const { target } = render(DiffPlanView, props({ annotations, focusedAnnotation: "a" }));
    await until(() => target.querySelector('[data-annotation-card="a"]') != null);
    const a = target.querySelector('[data-annotation-card="a"]')!;
    const b = target.querySelector('[data-annotation-card="b"]')!;
    expect(a.querySelector(".body")).not.toBeNull();
    expect(b.querySelector(".body")).toBeNull();
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
    const annotations = [
      lineAnn({ id: "a", startLine: 2, endLine: 2, comment: "first" }),
      lineAnn({ id: "b", startLine: 4, endLine: 4, comment: "second" }),
    ];
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
    const review = multiVersionFixture(3);
    const { target } = render(DiffPlanView, props({ review, annotations: [lineAnn()] }));
    await until(() => target.querySelector('[data-annotation-card="ln1"]') != null);
    target.querySelector<HTMLButtonElement>(".compare-toggle")!.click();
    await until(() => (shadow(target)?.textContent ?? "").includes("body revision 2"));
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
    const review = multiVersionFixture(3);
    const { target } = render(DiffPlanView, props({ review, annotations: [lineAnn()] }));
    await until(() => target.querySelector('[data-annotation-card="ln1"]') != null);
    target.querySelector<HTMLButtonElement>(".compare-toggle")!.click();
    await until(() => (shadow(target)?.textContent ?? "").includes("body revision 2"));
    expect(layer(target)).toBeNull();
  });
});

// The Request Changes dialog (a sibling) surfaces the source view's retained
// scratches with per-scratch Save/Discard. DiffPlanView owns the controller and
// hands its Save/Discard actions up once on mount, so the dialog can act on a
// scratch without owning the controller (EXC-635).
describe("DiffPlanView scratch hand-off to the host", () => {
  test("exposes the controller's save and discard actions on mount", async () => {
    let actions: { save: (key: string) => void; discard: (key: string) => void } | undefined;
    render(DiffPlanView, props({ onExposeScratchActions: (a: typeof actions) => (actions = a) }));
    await until(() => actions != null);
    expect(typeof actions?.save).toBe("function");
    expect(typeof actions?.discard).toBe("function");
  });
});
