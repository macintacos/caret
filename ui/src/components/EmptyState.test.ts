import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import { render } from "../../test-mount.ts";
import EmptyState from "./EmptyState.svelte";

describe("EmptyState", () => {
  test("connected (default): shows the listening copy, no warning", () => {
    const { target } = render(EmptyState, {});
    expect(target.textContent).toContain("No plans awaiting review");
    expect(target.textContent).toContain("This window stays open and listening");
    expect(target.querySelector(".warn")).toBeNull();
  });

  test("disconnected: shows the not-connected warning with the unplug icon", () => {
    const { target } = render(EmptyState, { connected: false });
    const warn = target.querySelector(".warn");
    expect(warn).not.toBeNull();
    expect(warn!.textContent).toContain("Not connected to the caret daemon");
    expect(warn!.querySelector(".icon svg")).not.toBeNull();
  });

  test("always shows the brand glyph and the status hint", () => {
    const { target } = render(EmptyState, { connected: true });
    expect(target.querySelector(".glyph")!.textContent).toBe("^");
    expect(target.querySelector(".hint")!.textContent).toContain("polling /api/reviews");
  });
});
