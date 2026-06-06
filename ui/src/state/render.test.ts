import "../../test-setup.ts";
import { describe, expect, test } from "bun:test";
import type { ClientReview } from "@core/types";
import { createRenderMemo } from "./render.svelte.ts";

function review(id: string, version: number, plan: string): ClientReview {
  return { id, version, currentPlan: plan } as ClientReview;
}

describe("createRenderMemo", () => {
  test("returns an empty result when nothing is active", () => {
    const memo = createRenderMemo();
    const out = memo.render(null);
    expect(out).toEqual({ html: "", headings: [] });
  });

  test("renders a plan to html with headings", () => {
    const memo = createRenderMemo();
    const out = memo.render(review("r1", 1, "# Title\n\nbody"));
    expect(out.html).toContain("Title");
    expect(out.headings.map((h) => h.text)).toEqual(["Title"]);
  });

  test("reuses the cached result for an unchanged id:version", () => {
    const memo = createRenderMemo();
    const first = memo.render(review("r1", 1, "# Title"));
    // A fresh object with the same id:version (the 2s poll churns objects).
    const second = memo.render(review("r1", 1, "# Title"));
    expect(second).toBe(first); // same reference: not re-parsed
  });

  test("re-renders when the version bumps (a revision)", () => {
    const memo = createRenderMemo();
    const first = memo.render(review("r1", 1, "# One"));
    const second = memo.render(review("r1", 2, "# Two"));
    expect(second).not.toBe(first);
    expect(second.headings.map((h) => h.text)).toEqual(["Two"]);
  });

  test("re-renders when the id changes", () => {
    const memo = createRenderMemo();
    const first = memo.render(review("r1", 1, "# A"));
    const second = memo.render(review("r2", 1, "# B"));
    expect(second).not.toBe(first);
  });
});
