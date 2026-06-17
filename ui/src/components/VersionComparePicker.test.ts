import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import type { PlanVersion } from "@core/types";
import { capture, render } from "../../test-mount.ts";

import VersionComparePicker from "./VersionComparePicker.svelte";

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
    });
    const toggle = target.querySelector<HTMLButtonElement>(".compare-toggle");
    expect(toggle).not.toBeNull();
    expect(toggle!.disabled).toBe(true);
    // Nothing to compare yet, so the base/target pickers stay hidden.
    expect(target.querySelector(".pair")).toBeNull();
  });

  test("a disabled toggle does not enter compare mode on click", () => {
    const onSetComparing = capture<boolean>();
    const { target } = render(VersionComparePicker, {
      ...baseProps,
      versions: versions(1),
      comparing: false,
      onSetComparing: onSetComparing.cb,
    });
    target.querySelector<HTMLButtonElement>(".compare-toggle")!.click();
    expect(onSetComparing.last()).toBeUndefined();
  });
});

describe("VersionComparePicker pair selection", () => {
  test("lists every version in both selects", () => {
    const { target } = render(VersionComparePicker, baseProps);
    const base = target.querySelector<HTMLSelectElement>(".base-select")!;
    const tgt = target.querySelector<HTMLSelectElement>(".target-select")!;
    expect(base.querySelectorAll("option")).toHaveLength(3);
    expect(tgt.querySelectorAll("option")).toHaveLength(3);
  });

  test("reflects the selected pair", () => {
    const { target } = render(VersionComparePicker, baseProps);
    expect(target.querySelector<HTMLSelectElement>(".base-select")!.value).toBe("3");
    expect(target.querySelector<HTMLSelectElement>(".target-select")!.value).toBe("2");
  });

  test("selecting a base version reports the chosen number", () => {
    const onSelectBase = capture<number>();
    const { target } = render(VersionComparePicker, {
      ...baseProps,
      onSelectBase: onSelectBase.cb,
    });
    const base = target.querySelector<HTMLSelectElement>(".base-select")!;
    base.value = "1";
    base.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onSelectBase.last()).toBe(1);
  });

  test("selecting a target version reports the chosen number", () => {
    const onSelectTarget = capture<number>();
    const { target } = render(VersionComparePicker, {
      ...baseProps,
      onSelectTarget: onSelectTarget.cb,
    });
    const tgt = target.querySelector<HTMLSelectElement>(".target-select")!;
    tgt.value = "1";
    tgt.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onSelectTarget.last()).toBe(1);
  });
});

describe("VersionComparePicker layout toggle", () => {
  test("marks the active diff style", () => {
    const { target } = render(VersionComparePicker, baseProps);
    const split = target.querySelector<HTMLButtonElement>('[data-style="split"]')!;
    const unified = target.querySelector<HTMLButtonElement>('[data-style="unified"]')!;
    expect(split.getAttribute("aria-pressed")).toBe("true");
    expect(unified.getAttribute("aria-pressed")).toBe("false");
  });

  test("clicking a layout reports it", () => {
    const onSetDiffStyle = capture<"split" | "unified">();
    const { target } = render(VersionComparePicker, {
      ...baseProps,
      onSetDiffStyle: onSetDiffStyle.cb,
    });
    target.querySelector<HTMLButtonElement>('[data-style="unified"]')!.click();
    expect(onSetDiffStyle.last()).toBe("unified");
  });
});

describe("VersionComparePicker indicators toggle", () => {
  test("marks the active gutter indicators", () => {
    const { target } = render(VersionComparePicker, baseProps);
    const bars = target.querySelector<HTMLButtonElement>('[data-indicators="bars"]')!;
    const classic = target.querySelector<HTMLButtonElement>('[data-indicators="classic"]')!;
    expect(bars.getAttribute("aria-pressed")).toBe("true");
    expect(classic.getAttribute("aria-pressed")).toBe("false");
  });

  test("clicking an indicators option reports it", () => {
    const onSetDiffIndicators = capture<"bars" | "classic">();
    const { target } = render(VersionComparePicker, {
      ...baseProps,
      onSetDiffIndicators: onSetDiffIndicators.cb,
    });
    target.querySelector<HTMLButtonElement>('[data-indicators="classic"]')!.click();
    expect(onSetDiffIndicators.last()).toBe("classic");
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
