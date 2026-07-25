import "@ui/test-mount.ts";
import { describe, expect, test } from "bun:test";

import { until } from "@test/support/poll.ts";
import { render } from "@ui/test-mount.ts";
import { buildLinkLayer } from "$lib/diffview/links.ts";
import SourceView from "$lib/diffview/SourceView.svelte";

// Component-level wiring for the opt-in link layer on SourceView. The pointer
// pipeline that turns a real token click into onTokenClick lives in the
// @pierre/diffs InteractionManager and only runs in a real browser (it relies
// on per-token data-char rendering that happy-dom does not produce) — so
// click-through is exercised by linkInteractions.test.ts at the pure-logic
// level (per browser-testing.md, pure hit-test logic is a unit). These tests
// confirm the wrapper accepts the link layer, renders the simplified display
// text, and stays inert when the prop is omitted.

function shadow(target: HTMLElement): ShadowRoot | null {
  return target.querySelector(".diffview")?.shadowRoot ?? null;
}

describe("SourceView link layer wiring", () => {
  test("renders the simplified display text when given a link layer", async () => {
    const { text, spans } = buildLinkLayer("See [the docs](https://example.com/docs) here.");
    const { target } = render(SourceView, {
      doc: { name: "plan.md", text },
      contentKey: "r1:v1",
      links: spans,
      openUrl: () => {},
    });
    const painted = await until(
      () => shadow(target)?.textContent?.includes("See the docs here.") ?? false,
    );
    expect(painted).toBe(true);
    // The raw markdown syntax is gone — only the label shows.
    expect(shadow(target)?.textContent).not.toContain("](https://example.com/docs)");
  });

  test("mounts without an openUrl override (defaults to a safe new-tab opener)", async () => {
    const { text, spans } = buildLinkLayer("[go](https://go.test)");
    const { target } = render(SourceView, {
      doc: { name: "plan.md", text },
      contentKey: "r2:v1",
      links: spans,
    });
    const painted = await until(() => shadow(target)?.textContent?.includes("go") ?? false);
    expect(painted).toBe(true);
  });

  test("renders normally with the link prop omitted", async () => {
    const { target } = render(SourceView, {
      doc: { name: "plan.md", text: "plain line\nsecond line" },
      contentKey: "r3:v1",
    });
    const painted = await until(
      () => shadow(target)?.textContent?.includes("second line") ?? false,
    );
    expect(painted).toBe(true);
  });
});
