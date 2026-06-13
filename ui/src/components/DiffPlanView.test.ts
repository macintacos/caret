import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import { until } from "../../../test/support/poll.ts";
import { render } from "../../test-mount.ts";
import { reactiveProps } from "../../test-props.svelte.ts";
import type { ClientReview } from "@core/types";
import DiffPlanView from "./DiffPlanView.svelte";

// Default props: a no-op create handler, so the rendering tests below need only
// override `review`.
function props(over: Record<string, unknown> = {}) {
  return {
    review: reviewFixture(),
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
