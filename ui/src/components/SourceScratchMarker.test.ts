import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";

import SourceScratchMarker from "@/components/SourceScratchMarker.svelte";

import { render } from "../../test-mount.ts";

// SourceScratchMarker is the quiet, pre-card line affordance for a retained but
// unsubmitted composer draft (a "scratch"). Clicking it resumes the composer
// with the text restored. Its badge reads "Resume" — an action — kept
// deliberately distinct from SourceAnnotationCard's "Draft" state label, so an
// unsent scratch never reads as a created comment.

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
    // The vocabulary guard: a scratch is not a "Draft" (that is a created,
    // pending annotation in commentState.ts). They must never read identically.
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
