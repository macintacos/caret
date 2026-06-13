import "../../test-mount.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { until } from "../../../test/support/poll.ts";
import { render } from "../../test-mount.ts";
import { reactiveProps } from "../../test-props.svelte.ts";
import type { ClientReview, PlanVersion } from "@core/types";
import DiffPlanView from "./DiffPlanView.svelte";

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
    const { target } = render(DiffPlanView, { review: reviewFixture() });
    const painted = await until(
      () => shadow(target)?.textContent?.includes("hello world") ?? false,
    );
    expect(painted).toBe(true);
  });

  test("simplifies markdown links via the link layer (label shown, syntax gone)", async () => {
    const review = reviewFixture({
      currentPlan: "See [the docs](https://caret.test/docs) for details.\n",
    });
    const { target } = render(DiffPlanView, { review });
    await until(() => shadow(target)?.textContent?.includes("the docs") ?? false);
    const text = shadow(target)?.textContent ?? "";
    expect(text).toContain("the docs");
    // The raw inline-link syntax is collapsed to the label.
    expect(text).not.toContain("](https://caret.test/docs)");
  });
});

describe("DiffPlanView instance preservation across the poll", () => {
  test("a same-version prop tick keeps the same rendered pre — no remount", async () => {
    // The 2s poll re-delivers the active review object; an unchanged id:version
    // must update the instance in place so scroll/DOM state survives.
    const props = reactiveProps({ review: reviewFixture() });
    const { target, flush } = render(DiffPlanView, props);
    await until(() => shadow(target)?.textContent?.includes("hello world") ?? false);
    const pre = shadow(target)?.querySelector("pre");
    expect(pre).not.toBeNull();

    // A fresh object with the SAME id and version (what a poll tick produces).
    props.review = reviewFixture();
    flush();
    await until(() => shadow(target)?.querySelector("pre") != null);
    expect(shadow(target)?.querySelector("pre")).toBe(pre as HTMLPreElement);
  });

  test("a new version recreates the view with the new text", async () => {
    const props = reactiveProps({ review: reviewFixture() });
    const { target, flush } = render(DiffPlanView, props);
    await until(() => shadow(target)?.textContent?.includes("hello world") ?? false);
    const pre = shadow(target)?.querySelector("pre");

    props.review = reviewFixture({ version: 2, currentPlan: "# Title\n\nrevised text\n" });
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
    const { target } = render(DiffPlanView, { review: reviewFixture() });
    expect(target.querySelector(".compare-picker")).toBeNull();
  });

  test("offers the compare control when the review has multiple versions", () => {
    const { target } = render(DiffPlanView, { review: multiVersionFixture(3) });
    expect(target.querySelector(".compare-picker")).not.toBeNull();
    // The mode is off by default, so the single-version source view shows.
    expect(target.querySelector(".pair")).toBeNull();
  });

  test("entering compare mode renders a diff between the default version pair", async () => {
    const { target } = render(DiffPlanView, { review: multiVersionFixture(3) });
    target.querySelector<HTMLButtonElement>(".compare-toggle")!.click();
    // Default pair is base=v3 (current), target=v2 (previous): both bodies show.
    const painted = await until(() => {
      const text = shadow(target)?.textContent ?? "";
      return text.includes("body revision 3") && text.includes("body revision 2");
    });
    expect(painted).toBe(true);
  });

  test("the persisted layout preference drives the initial diff style", async () => {
    localStorage.setItem("caret.diffStyle", "unified");
    const { target } = render(DiffPlanView, { review: multiVersionFixture(3) });
    target.querySelector<HTMLButtonElement>(".compare-toggle")!.click();
    await until(() => shadow(target)?.querySelector("pre") != null);
    // The library renders unified layout as data-diff-type="single".
    const applied = await until(
      () => shadow(target)?.querySelector("pre")?.getAttribute("data-diff-type") === "single",
    );
    expect(applied).toBe(true);
  });
});
