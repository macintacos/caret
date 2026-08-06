import "@ui/test-mount.ts";
import { describe, expect, test } from "bun:test";

import { until } from "@test/support/poll.ts";
import { capture, render } from "@ui/test-mount.ts";
import { reactiveProps } from "@ui/test-props.svelte.ts";
import SourceDiffView from "$lib/diffview/SourceDiffView.svelte";
import type {
  SourceDiffViewApi,
  SourceDiffViewOptions,
  SourceDocument,
} from "$lib/diffview/types.ts";

// Real-library diff rendering under happy-dom; see SourceView.test.ts for the
// shadow-root + async-paint conventions these assertions follow.

const oldDoc: SourceDocument = { name: "plan.md", text: "line one\nline two\n" };
const newDoc: SourceDocument = { name: "plan.md", text: "line one\nline three\n" };

function shadow(target: HTMLElement): ShadowRoot | null {
  return target.querySelector(".diffview")?.shadowRoot ?? null;
}

describe("SourceDiffView rendering", () => {
  test("renders both sides of the diff into the view's shadow DOM", async () => {
    const { target } = render(SourceDiffView, { oldDoc, newDoc, contentKey: "r1:v1:v2" });
    const painted = await until(() => {
      const text = shadow(target)?.textContent ?? "";
      return text.includes("line two") && text.includes("line three");
    });
    expect(painted).toBe(true);
  });
});

describe("SourceDiffView onReady", () => {
  test("hands the parent an api that resolves a line on either side of the diff", async () => {
    const ready = capture<SourceDiffViewApi>();
    const { target } = render(SourceDiffView, {
      oldDoc,
      newDoc,
      contentKey: "r1:v1:v2",
      onReady: ready.cb,
    });
    await until(() => shadow(target)?.textContent?.includes("line three") ?? false);

    // Line 2 changed: "line two" on the before side, "line three" on the after.
    expect(ready.last()?.scrollToLine(2, "after")).toBe(true);
    expect(ready.last()?.scrollToLine(2, "before")).toBe(true);
    expect(ready.last()?.scrollToLine(99, "after")).toBe(false);
  });
});

describe("SourceDiffView instance preservation", () => {
  test("a diff-style flip applies in place — the rendered pre keeps its identity", async () => {
    const props = reactiveProps({
      oldDoc,
      newDoc,
      contentKey: "r1:v1:v2",
      options: { diffStyle: "split" } as SourceDiffViewOptions,
    });
    const { target, flush } = render(SourceDiffView, props);
    await until(() => shadow(target)?.textContent?.includes("line three") ?? false);
    const pre = shadow(target)?.querySelector("pre");
    expect(pre?.getAttribute("data-diff-type")).toBe("split");

    props.options = { diffStyle: "unified" };
    flush();
    // The library renders unified layout as data-diff-type="single".
    const applied = await until(() => pre?.getAttribute("data-diff-type") === "single");
    expect(applied).toBe(true);
    expect(shadow(target)?.querySelector("pre")).toBe(pre as HTMLPreElement);
  });

  test("the classic indicators flip applies in place via data-indicators", async () => {
    const props = reactiveProps({
      oldDoc,
      newDoc,
      contentKey: "r1:v1:v2",
      options: {} as SourceDiffViewOptions,
    });
    const { target, flush } = render(SourceDiffView, props);
    await until(() => shadow(target)?.textContent?.includes("line three") ?? false);
    const pre = shadow(target)?.querySelector("pre");
    // Default (no indicators set) is the library's "bars".
    expect(pre?.getAttribute("data-indicators")).toBe("bars");

    props.options = { diffIndicators: "classic" };
    flush();
    // The library marks the pre so its CSS renders the +/- glyphs.
    const applied = await until(() => pre?.getAttribute("data-indicators") === "classic");
    expect(applied).toBe(true);
    expect(shadow(target)?.querySelector("pre")).toBe(pre as HTMLPreElement);
  });

  test("a content-key change recreates the view", async () => {
    const props = reactiveProps({ oldDoc, newDoc, contentKey: "r1:v1:v2" });
    const { target, flush } = render(SourceDiffView, props);
    await until(() => shadow(target)?.textContent?.includes("line three") ?? false);
    const pre = shadow(target)?.querySelector("pre");

    props.newDoc = { name: "plan.md", text: "line one\nline four\n" };
    props.contentKey = "r1:v1:v3";
    flush();
    const repainted = await until(
      () => shadow(target)?.textContent?.includes("line four") ?? false,
    );
    expect(repainted).toBe(true);
    expect(shadow(target)?.querySelector("pre")).not.toBe(pre as HTMLPreElement);
    // The old instance's DOM is gone — no stale content or duplicate views.
    // ("line three" was the old diff's addition; the new diff has no line
    // containing it, while "line two" legitimately remains as the deletion.)
    expect(shadow(target)?.textContent).not.toContain("line three");
    expect(shadow(target)?.querySelectorAll("pre")).toHaveLength(1);
  });
});

describe("SourceDiffView compare header", () => {
  // The compare surface feeds the two sides version names ("v3" / "v5"), so the
  // library's default header surfaces the pair, pins it (stickyHeader), and shows
  // the +N/-N change tallies. These render in the library's shadow root; caret
  // tightens nothing here beyond the mapper's stickyHeader and the version names.
  const v3: SourceDocument = { name: "v3", text: "line one\nline two\nline extra\n" };
  const v5: SourceDocument = { name: "v5", text: "line one\nline three\n" };

  test("renders the version pair, pins it sticky, and surfaces the change counts", async () => {
    const { target } = render(SourceDiffView, { oldDoc: v3, newDoc: v5, contentKey: "r1:v5:v3" });
    await until(() => shadow(target)?.textContent?.includes("line three") ?? false);

    const header = shadow(target)?.querySelector("[data-diffs-header]");
    expect(header).not.toBeNull();
    // The before side (v3) is the rename "from", the after side (v5) the title.
    expect(header?.querySelector("[data-prev-name]")?.textContent).toBe("v3");
    expect(header?.querySelector("[data-title]")?.textContent).toBe("v5");
    // Pinned to the top of the scroll viewport so the pair and counts stay in view.
    expect(header?.hasAttribute("data-sticky")).toBe(true);
    // The library-computed change tallies: v5 adds "line three", drops "line two"
    // and "line extra".
    expect(header?.querySelector("[data-additions-count]")?.textContent).toBe("+1");
    expect(header?.querySelector("[data-deletions-count]")?.textContent).toBe("-2");
  });
});
