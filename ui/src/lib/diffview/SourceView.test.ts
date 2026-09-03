import "@ui/support/mount.ts";
import { describe, expect, test } from "bun:test";

import { until } from "@test/support/poll.ts";
import { expectViewRecreated } from "@ui/support/diffview.ts";
import { render } from "@ui/support/mount.ts";
import { reactiveProps } from "@ui/support/props.svelte.ts";
import SourceView from "$lib/diffview/SourceView.svelte";
import type { SourceDocument, SourceViewOptions } from "$lib/diffview/types.ts";

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

  test("renders one row per source line, and none for the terminating newline", async () => {
    // `doc` is three lines plus a terminating newline. The library splits on "\n" and
    // would render the empty tail as a fourth row — unreachable by the keyboard cursor
    // and one more than the gutter should number — so libraryContents strips it. Pinned
    // against the real library because the row model is the library's, not caret's, and
    // that is exactly the shape a version bump changes without failing anything.
    const { target } = render(SourceView, { doc, contentKey: "rows:v1" });
    await until(() => shadow(target)?.textContent?.includes("hello world") ?? false);
    expect(shadow(target)?.querySelectorAll("[data-line]").length).toBe(3);
  });

  test("highlights with caret's registered Shiki theme", async () => {
    // The theme/font bridge registers caret's own palettes as Shiki themes and
    // selects them through the view options, so the library highlights with
    // caret's palette rather than its own. A keyword token must carry caret's
    // keyword hue in both color schemes (light #9a2f22 / dark #dd7a6c, the red ochre
    // ui/src/lib/themes/caret.ts names) — proof the registration reached the renderer.
    const code: SourceDocument = { name: "code.ts", text: "const x = 1\n" };
    const { target } = render(SourceView, { doc: code, contentKey: "c1:v1" });
    await until(() => shadow(target)?.textContent?.includes("const") ?? false);
    const tokenStyles = [...(shadow(target)?.querySelectorAll("[style*='--diffs-token']") ?? [])]
      .map((el) => el.getAttribute("style") ?? "")
      .join(" ")
      .toLowerCase();
    expect(tokenStyles).toContain("--diffs-token-light:#9a2f22");
    expect(tokenStyles).toContain("--diffs-token-dark:#dd7a6c");
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
    // The old instance's DOM is gone — no stale content or duplicate views.
    await expectViewRecreated(() => shadow(target), pre, "revised text", "hello world");
    expect(shadow(target)?.querySelectorAll("pre")).toHaveLength(1);
  });
});
