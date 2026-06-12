import "../../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import { until } from "../../../../test/support/poll.ts";
import { render } from "../../../test-mount.ts";
import { reactiveProps } from "../../../test-props.svelte.ts";
import SourceView from "./SourceView.svelte";
import type { SourceDocument, SourceViewOptions } from "./types.ts";

// Mounts the real library under happy-dom: @pierre/diffs renders into a
// shadow root attached to the wrapper's container div, so these assertions
// read target.querySelector(".diffview").shadowRoot. Painting is async behind
// the shared highlighter init — assertions await it via until().

const doc: SourceDocument = { name: "plan.md", text: "# Title\n\nhello world\n" };

function shadow(target: HTMLElement): ShadowRoot | null {
  return target.querySelector(".diffview")?.shadowRoot ?? null;
}

describe("SourceView rendering", () => {
  test("renders the document text into the view's shadow DOM", async () => {
    const { target } = render(SourceView, { doc, contentKey: "r1:v1" });
    const painted = await until(
      () => shadow(target)?.textContent?.includes("hello world") ?? false,
    );
    expect(painted).toBe(true);
  });
});

describe("SourceView instance preservation", () => {
  test("an option update applies in place — the rendered pre keeps its identity", async () => {
    const props = reactiveProps({
      doc,
      contentKey: "r1:v1",
      options: { overflow: "scroll" } as SourceViewOptions,
    });
    const { target, flush } = render(SourceView, props);
    await until(() => shadow(target)?.textContent?.includes("hello world") ?? false);
    const pre = shadow(target)?.querySelector("pre");
    expect(pre).not.toBeNull();

    props.options = { overflow: "wrap" };
    flush();
    const applied = await until(() => pre?.getAttribute("data-overflow") === "wrap");
    expect(applied).toBe(true);
    // Same element — the instance was updated, not recreated.
    expect(shadow(target)?.querySelector("pre")).toBe(pre as HTMLPreElement);
  });

  test("a content-key change recreates the view", async () => {
    const props = reactiveProps({ doc, contentKey: "r1:v1" });
    const { target, flush } = render(SourceView, props);
    await until(() => shadow(target)?.textContent?.includes("hello world") ?? false);
    const pre = shadow(target)?.querySelector("pre");

    props.doc = { name: "plan.md", text: "# Title\n\nrevised text\n" };
    props.contentKey = "r1:v2";
    flush();
    const repainted = await until(
      () => shadow(target)?.textContent?.includes("revised text") ?? false,
    );
    expect(repainted).toBe(true);
    expect(shadow(target)?.querySelector("pre")).not.toBe(pre as HTMLPreElement);
    // The old instance's DOM is gone — no stale content or duplicate views.
    expect(shadow(target)?.textContent).not.toContain("hello world");
    expect(shadow(target)?.querySelectorAll("pre")).toHaveLength(1);
  });
});
