import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";

import type { PlanVersion } from "@core/lib/types";
import VersionComparePicker from "@/components/VersionComparePicker.svelte";

import { capture, render } from "../../test-mount.ts";

function versions(n: number): PlanVersion[] {
  return Array.from({ length: n }, (_, i) => ({
    version: i + 1,
    plan: `plan v${i + 1}`,
    annotations: [],
    createdAt: i,
  }));
}

const baseProps = {
  versions: versions(3),
  comparing: true,
  canCompare: true,
  baseVersion: 3,
  targetVersion: 2,
  diffStyle: "split" as const,
  diffIndicators: "bars" as const,
  onSetComparing: () => {},
  onSelectBase: () => {},
  onSelectTarget: () => {},
  onSetDiffStyle: () => {},
  onSetDiffIndicators: () => {},
};

// The segmented controls are now shadcn ToggleGroups: each option is a
// role="radio" whose accessible name is its visible label, and the active one
// carries data-state="on". Find one by its label.
function radio(target: Element, name: string): HTMLButtonElement {
  const el = [...target.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (r) => r.textContent?.trim() === name,
  );
  if (!el) throw new Error(`no radio labelled "${name}"`);
  return el;
}

describe("VersionComparePicker visibility", () => {
  test("renders the toggle enabled with two or more versions", () => {
    const { target } = render(VersionComparePicker, baseProps);
    const toggle = target.querySelector<HTMLButtonElement>(".compare-toggle");
    expect(toggle).not.toBeNull();
    expect(toggle!.disabled).toBe(false);
  });

  // EXC-664: with nothing to compare the toggle is shown-but-disabled (greyed
  // out) rather than hidden, so the affordance is discoverable.
  test("always renders the toggle, disabled, with a single version", () => {
    const { target } = render(VersionComparePicker, {
      ...baseProps,
      versions: versions(1),
      comparing: false,
      canCompare: false,
    });
    const toggle = target.querySelector<HTMLButtonElement>(".compare-toggle");
    expect(toggle).not.toBeNull();
    expect(toggle!.disabled).toBe(true);
    // Nothing to compare yet, so the base/target pickers stay hidden.
    expect(target.querySelector(".vpick")).toBeNull();
  });

  test("a disabled toggle does not enter compare mode on click", () => {
    const onSetComparing = capture<boolean>();
    const { target } = render(VersionComparePicker, {
      ...baseProps,
      versions: versions(1),
      comparing: false,
      canCompare: false,
      onSetComparing: onSetComparing.cb,
    });
    target.querySelector<HTMLButtonElement>(".compare-toggle")!.click();
    expect(onSetComparing.last()).toBeUndefined();
  });
});

describe("VersionComparePicker compare icon", () => {
  // EXC-808: the toggle carries a trailing git-compare glyph so it reads as a
  // compare affordance. Icon.svelte wraps the vendored SVG in a decorative
  // (aria-hidden) .icon span, so the button's accessible name is unchanged.
  test("the enabled toggle renders the compare icon", () => {
    const { target } = render(VersionComparePicker, baseProps);
    const toggle = target.querySelector<HTMLButtonElement>(".compare-toggle");
    expect(toggle!.querySelector(".icon svg")).not.toBeNull();
  });

  test("the disabled toggle also renders the compare icon", () => {
    const { target } = render(VersionComparePicker, {
      ...baseProps,
      versions: versions(1),
      comparing: false,
      canCompare: false,
    });
    const toggle = target.querySelector<HTMLButtonElement>(".compare-toggle");
    expect(toggle!.querySelector(".icon svg")).not.toBeNull();
  });
});

describe("VersionComparePicker pair selection", () => {
  // The base/target pickers reuse the ThemePicker's DropdownMenu; the trigger
  // (.vpick) shows the current version and carries an accessible label. The
  // portalled radio menu is a bits-ui overlay, so choosing a version is covered
  // in the e2e spec.
  test("shows a labelled trigger for each side reflecting the selected pair", () => {
    const { target } = render(VersionComparePicker, baseProps);
    const base = target.querySelector<HTMLElement>('[aria-label="Base version"]');
    const tgt = target.querySelector<HTMLElement>('[aria-label="Target version"]');
    expect(base?.classList.contains("vpick")).toBe(true);
    expect(tgt?.classList.contains("vpick")).toBe(true);
    expect(base!.textContent).toContain("v3");
    expect(tgt!.textContent).toContain("v2");
  });
});

describe("VersionComparePicker layout toggle", () => {
  test("marks the active diff style", () => {
    const { target } = render(VersionComparePicker, baseProps);
    expect(radio(target, "Split").getAttribute("data-state")).toBe("on");
    expect(radio(target, "Unified").getAttribute("data-state")).toBe("off");
  });

  test("clicking a layout reports it", () => {
    const onSetDiffStyle = capture<"split" | "unified">();
    const { target } = render(VersionComparePicker, {
      ...baseProps,
      onSetDiffStyle: onSetDiffStyle.cb,
    });
    radio(target, "Unified").click();
    expect(onSetDiffStyle.last()).toBe("unified");
  });
});

describe("VersionComparePicker indicators toggle", () => {
  test("marks the active gutter indicators", () => {
    const { target } = render(VersionComparePicker, baseProps);
    expect(radio(target, "Bars").getAttribute("data-state")).toBe("on");
    expect(radio(target, "+/−").getAttribute("data-state")).toBe("off");
  });

  test("clicking an indicators option reports it", () => {
    const onSetDiffIndicators = capture<"bars" | "classic" | "both">();
    const { target } = render(VersionComparePicker, {
      ...baseProps,
      onSetDiffIndicators: onSetDiffIndicators.cb,
    });
    radio(target, "+/−").click();
    expect(onSetDiffIndicators.last()).toBe("classic");
  });

  // The combined bars+glyphs option (EXC-764 follow-up).
  test("clicking Both reports the combined mode", () => {
    const onSetDiffIndicators = capture<"bars" | "classic" | "both">();
    const { target } = render(VersionComparePicker, {
      ...baseProps,
      onSetDiffIndicators: onSetDiffIndicators.cb,
    });
    radio(target, "Both").click();
    expect(onSetDiffIndicators.last()).toBe("both");
  });
});

describe("VersionComparePicker mode toggle", () => {
  test("reports entering compare mode", () => {
    const onSetComparing = capture<boolean>();
    const { target } = render(VersionComparePicker, {
      ...baseProps,
      comparing: false,
      onSetComparing: onSetComparing.cb,
    });
    target.querySelector<HTMLButtonElement>(".compare-toggle")!.click();
    expect(onSetComparing.last()).toBe(true);
  });

  test("reports leaving compare mode", () => {
    const onSetComparing = capture<boolean>();
    const { target } = render(VersionComparePicker, {
      ...baseProps,
      comparing: true,
      onSetComparing: onSetComparing.cb,
    });
    target.querySelector<HTMLButtonElement>(".compare-toggle")!.click();
    expect(onSetComparing.last()).toBe(false);
  });
});
