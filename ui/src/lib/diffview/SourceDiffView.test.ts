import "../../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import { until } from "../../../../test/support/poll.ts";
import { render } from "../../../test-mount.ts";
import { reactiveProps } from "../../../test-props.svelte.ts";
import SourceDiffView from "./SourceDiffView.svelte";
import type { SourceDiffViewOptions, SourceDocument } from "./types.ts";

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
