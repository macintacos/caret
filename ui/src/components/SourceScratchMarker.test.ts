import "@ui/support/mount.ts";
import { describe, expect, test } from "bun:test";

import { render } from "@ui/support/mount.ts";
import SourceScratchMarker from "@/components/SourceScratchMarker.svelte";

function mount(over: Record<string, unknown> = {}) {
  let resumed = 0;
  const { target } = render(SourceScratchMarker, {
    text: "half a thought about this line",
    onResume: () => resumed++,
    ...over,
  });
  return {
    target,
    button: target.querySelector("button") as HTMLButtonElement,
    resumed: () => resumed,
  };
}

describe("SourceScratchMarker", () => {
  test("renders a Resume badge, the action word, not the Draft state label", () => {
    const { target } = mount();
    const text = target.textContent ?? "";
    expect(text).toContain("Resume");
    // A scratch is not a "Draft" (a created, pending annotation in
    // commentState.ts). The two must never read identically.
    expect(text).not.toContain("Draft");
  });

  test("shows a preview of the retained text", () => {
    const { target } = mount({ text: "quantify the cold cost here" });
    expect(target.textContent).toContain("quantify the cold cost here");
  });

  test("clicking the marker resumes the composer", () => {
    const { button, resumed } = mount();
    button.click();
    expect(resumed()).toBe(1);
  });

  test("the control is a button so it is keyboard-focusable", () => {
    const { button } = mount();
    expect(button).not.toBeNull();
    expect(button.tagName).toBe("BUTTON");
  });
});
