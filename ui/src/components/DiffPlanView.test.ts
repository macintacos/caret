import "@ui/test-mount.ts";
import { afterEach, describe, expect, test } from "bun:test";

import type { ClientReview, PlanVersion } from "@core/lib/types";
import { until } from "@test/support/poll.ts";
import { logCapture } from "@ui/test-helpers.ts";
import { capture, render } from "@ui/test-mount.ts";
import { reactiveProps } from "@ui/test-props.svelte.ts";
import DiffPlanView from "@/components/DiffPlanView.svelte";
import { createSourceCommenting, scratchKey } from "$lib/diffview/commenting.ts";
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
    planEpoch: 0,
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

// EXC-946's heading breadcrumbs bar has no unit test here on purpose: it renders
// only once a heading is in the reading zone, and that tracking is measured with
// getBoundingClientRect, which happy-dom reports as all zeros. The bar's own trail
// logic is unit-tested in PlanBreadcrumbs.test.ts; its mounting, scroll tracking,
// and compare-mode absence are covered by test/e2e/plan-breadcrumbs.e2e.ts.

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

  // EXC-807: the working-directory path lives in the compare row now, shown
  // right-aligned while not comparing and dropped once compare mode is on.
  // EXC-850 made it a click-to-copy button (no hover tooltip).
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

  test("the focused annotation renders expanded, the rest collapsed", async () => {
    const annotations = [
      lineAnn({ id: "a", startLine: 2, endLine: 2, comment: "first" }),
      lineAnn({ id: "b", startLine: 4, endLine: 4, comment: "second" }),
    ];
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
        return Promise.resolve(jsonResponse({ resolved: ["src/foo.ts"] }));
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

  test("re-resolves when the plan text actually changes", async () => {
    let fileRefCalls = 0;
    const cap = logCapture((url) => {
      if (url.includes("/file-refs")) {
        fileRefCalls++;
        return Promise.resolve(jsonResponse({ resolved: [] }));
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
  test("seeds the controller from the review's persisted scratches on mount", async () => {
    const commenting = createSourceCommenting({ onCreate: () => {} });
    render(
      DiffPlanView,
      props({
        commenting,
        review: reviewFixture({
          composerScratches: [{ startLine: 3, endLine: 3, text: "resume me" }],
        }),
      }),
    );
    await until(() => commenting.scratches().length > 0);
    expect(commenting.scratches()).toEqual([
      { key: scratchKey(3, 3), startLine: 3, endLine: 3, text: "resume me" },
    ]);
  });

  test("wipes the prior version's scratches when a new plan version arrives", async () => {
    const commenting = createSourceCommenting({ onCreate: () => {} });
    const p = reactiveProps(
      props({
        commenting,
        review: reviewFixture({
          composerScratches: [{ startLine: 3, endLine: 3, text: "v1 scratch" }],
        }),
      }),
    );
    const { flush } = render(DiffPlanView, p);
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
    const commenting = createSourceCommenting({ onCreate: () => {} });
    const p = reactiveProps(
      props({
        commenting,
        review: reviewFixture({
          composerScratches: [{ startLine: 3, endLine: 3, text: "live scratch" }],
        }),
      }),
    );
    const { flush } = render(DiffPlanView, p);
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

  test("/ owns search, and the focus-filter binding is gone", async () => {
    const { target } = render(DiffPlanView, props());
    await openSearch(target);
    expect(target.querySelector(".plan-search")).not.toBeNull();
    expect(shortcuts.list().some((e) => e.id === "actions.focusFilter")).toBe(false);
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
