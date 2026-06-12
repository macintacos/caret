import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import { until } from "../../../test/support/poll.ts";
import { render } from "../../test-mount.ts";
import { reactiveProps } from "../../test-props.svelte.ts";
import type { Annotation, ClientReview } from "@core/types";
import DiffPlanView from "./DiffPlanView.svelte";

// Default props: a no-op create handler and an empty annotation list, so the
// rendering tests below need only override `review`.
function props(over: Record<string, unknown> = {}) {
  return {
    review: reviewFixture(),
    annotations: [] as Annotation[],
    onCreateLineAnnotation: () => {},
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

function shadow(target: HTMLElement): ShadowRoot | null {
  return target.querySelector(".diffview")?.shadowRoot ?? null;
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
    // The raw inline-link syntax is collapsed to the label.
    expect(text).not.toContain("](https://caret.test/docs)");
  });
});

describe("DiffPlanView annotation/gutter wiring", () => {
  // The library only invokes renderAnnotation under real layout, so the inline
  // composer/card rendering and the gutter `+` create flow are covered by the
  // Playwright e2e (diff-surface.e2e.ts). Here we assert only that mounting with
  // line-anchored and legacy annotations paints the plan and does not throw —
  // the annotation list maps without disturbing the source render.
  test("mounts with line-anchored and legacy annotations and still paints the plan", async () => {
    const annotations: Annotation[] = [
      { id: "a1", startLine: 3, endLine: 3, comment: "tighten this" },
      { id: "L1", blockId: "b0", startOffset: 0, endOffset: 1, quote: "q", comment: "legacy" },
    ];
    const { target } = render(DiffPlanView, props({ annotations }));
    const painted = await until(
      () => shadow(target)?.textContent?.includes("hello world") ?? false,
    );
    expect(painted).toBe(true);
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
