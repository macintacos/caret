// The guard for caret's two edits to the vendored Slider (EXC-1101). Both are the
// kind doc/agents/shadcn-rules.md § Edits a re-sync will silently undo warns about:
// re-running `shadcn-svelte add slider` reverts the file wholesale, and neither loss
// changes the markup enough for anything else to notice.
//
//   * The ARIA forward. bits-ui puts role="slider" and the aria-value* trio on the
//     THUMB; the root is a bare <span> with no role (SliderBaseRootState.props). The
//     registry spreads restProps onto the root, so an aria-labelledby passed to
//     <Slider> names a role-less element and the slider announces as unnamed.
//   * The raw color. The registry ships `bg-white` on the thumb, which § Token-bridge
//     discipline forbids outright and which paints an invisible thumb on a light
//     theme. `bg-background` bridges to --paper, the same fill the Switch thumb wears.
//
// bits-ui Slider is plain (non-portalled) like Switch, so it mounts into the render
// target and needs no document.body query. Assertions go through `data-slot` and real
// ARIA, never the registry's `cn-*` marker classes — those live in a CSS layer caret
// does not import and are renamed upstream freely (§ Where the test goes).
import "@ui/test-mount.ts";

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Slider } from "$lib/components/ui/slider/index.js";

import { flushUntil, render } from "@ui/test-mount.ts";

const thumb = (target: HTMLElement) => target.querySelector("[data-slot='slider-thumb']");

const baseProps = { type: "single" as const, value: 40, min: 0, max: 100, step: 5 };

describe("vendored Slider", () => {
  test("puts role=slider and the value trio on the thumb, not the root", async () => {
    const { target, flush } = render(Slider, baseProps);
    await flushUntil(flush, () => thumb(target) !== null);

    // The root really does carry no role — which is the whole reason the forward below
    // has to exist. If a bits-ui upgrade gives it one, this reds and the patch can go.
    expect(target.querySelector("[data-slot='slider']")?.hasAttribute("role")).toBe(false);

    expect(thumb(target)?.getAttribute("role")).toBe("slider");
    expect(thumb(target)?.getAttribute("aria-valuenow")).toBe("40");
    expect(thumb(target)?.getAttribute("aria-valuemin")).toBe("0");
    expect(thumb(target)?.getAttribute("aria-valuemax")).toBe("100");
  });

  test("forwards aria-labelledby and aria-valuetext through to the thumb", async () => {
    const { target, flush } = render(Slider, {
      ...baseProps,
      "aria-labelledby": "some-label",
      "aria-valuetext": "40%",
    });
    await flushUntil(flush, () => thumb(target) !== null);

    expect(thumb(target)?.getAttribute("aria-labelledby")).toBe("some-label");
    expect(thumb(target)?.getAttribute("aria-valuetext")).toBe("40%");
    // And they did NOT also land on the role-less root, where they would describe
    // nothing — proving they were pulled out of restProps rather than merely copied.
    const root = target.querySelector("[data-slot='slider']");
    expect(root?.hasAttribute("aria-labelledby")).toBe(false);
    expect(root?.hasAttribute("aria-valuetext")).toBe(false);
  });

  test("carries the keyboard affordance the settings row relies on", async () => {
    const { target, flush } = render(Slider, baseProps);
    await flushUntil(flush, () => thumb(target) !== null);
    // A thumb out of the tab order is a slider no keyboard reaches, whatever its ARIA.
    expect(thumb(target)?.getAttribute("tabindex")).toBe("0");
  });

  test("holds no raw color literal", () => {
    const source = readFileSync(
      join(import.meta.dir, "slider.svelte"),
      "utf8",
    );
    // `bg-white` is what the registry ships and what a re-sync puts back.
    expect(source).not.toContain("bg-white");
    expect(source).toContain("bg-background");
    // The broader bridge rule, in the form shadcn-bridge.test.ts pins for the CSS.
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b|oklch\(/);
  });
});
