import "@ui/support/mount.ts";
import { describe, expect, test } from "bun:test";

import { capture, render } from "@ui/support/mount.ts";
import { versions } from "@ui/support/plan-versions.ts";
import VersionComparePicker from "@/components/VersionComparePicker.svelte";

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

/** A single-version review: nothing to compare, so the toggle is shown but
 * disabled. Shared by every test asserting that disabled shape. */
const disabledSingleVersionProps = {
  ...baseProps,
  versions: versions(1),
  comparing: false,
  canCompare: false,
};

// The segmented controls are shadcn ToggleGroups: each option is a
// role="radio" whose accessible name is its visible label, and the active one
// carries data-state="on". Find one by its label.
function radio(target: Element, name: string): HTMLButtonElement {
  const el = findRadio(target, name);
  if (!el) throw new Error(`no radio labelled "${name}"`);
  return el;
}

// Like `radio`, but returns null instead of throwing when the option is absent —
// for asserting a toggle group is gone entirely (EXC-811 layoutLocked).
function findRadio(target: Element, name: string): HTMLButtonElement | null {
  return (
    [...target.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (r) => r.textContent?.trim() === name,
    ) ?? null
  );
}

// Presence as a boolean, so a failing assertion prints `true`/`false` rather than
// a whole happy-dom node (whose circular getters serialize pathologically slowly).
function hasRadio(target: Element, name: string): boolean {
  return findRadio(target, name) != null;
}

// The toggle's own label text, with the count badge's digits subtracted. The badge
// is separate chrome (EXC-804), so stripping it keeps the label assertion able to
// catch a stray `label=` on the Icon — which a substring check would not.
function labelOf(toggle: Element): string {
  const badge = toggle.querySelector('[data-slot="badge"]');
  return (toggle.textContent ?? "").replace(badge?.textContent ?? "", "").trim();
}

// The count badge on the toggle, or null when it isn't rendered.
function countBadge(target: Element): HTMLElement | null {
  return target.querySelector<HTMLElement>('.compare-toggle [data-slot="badge"]');
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
    const { target } = render(VersionComparePicker, disabledSingleVersionProps);
    const toggle = target.querySelector<HTMLButtonElement>(".compare-toggle");
    expect(toggle).not.toBeNull();
    expect(toggle!.disabled).toBe(true);
    // Nothing to compare yet, so the base/target pickers stay hidden.
    expect(target.querySelector(".vpick")).toBeNull();
  });

  test("a disabled toggle does not enter compare mode on click", () => {
    const onSetComparing = capture<boolean>();
    const { target } = render(VersionComparePicker, {
      ...disabledSingleVersionProps,
      onSetComparing: onSetComparing.cb,
    });
    target.querySelector<HTMLButtonElement>(".compare-toggle")!.click();
    expect(onSetComparing.last()).toBeUndefined();
  });
});

describe("VersionComparePicker compare icon", () => {
  // EXC-808: the toggle carries a leading git-compare glyph so it reads as a
  // compare affordance. Icon.svelte wraps the vendored SVG in a decorative
  // (aria-hidden) .icon span, so it contributes nothing to the button's name.
  test("the enabled toggle renders the compare icon, leading the label", () => {
    const { target } = render(VersionComparePicker, baseProps);
    const toggle = target.querySelector<HTMLButtonElement>(".compare-toggle");
    expect(toggle!.querySelector(".icon svg")).not.toBeNull();
    // The icon is decorative, so it adds no text: the visible label stays exactly
    // "Versions". The EXC-804 count badge is subtracted — chrome beside the label.
    expect(labelOf(toggle!)).toBe("Versions");
    // EXC-808: the icon leads the label (sits to its left), so it precedes the
    // "Versions" text in DOM order.
    const kids = [...toggle!.childNodes];
    const iconIdx = kids.findIndex(
      (n) => n.nodeType === 1 && (n as Element).classList.contains("icon"),
    );
    const labelIdx = kids.findIndex((n) => n.textContent?.includes("Versions"));
    expect(iconIdx).toBeGreaterThanOrEqual(0);
    expect(iconIdx).toBeLessThan(labelIdx);
  });

  test("shows the `d` shortcut cap on the enabled toggle when hints are on", () => {
    const { target } = render(VersionComparePicker, { ...baseProps, showShortcutHints: true });
    const toggle = target.querySelector<HTMLButtonElement>(".compare-toggle");
    const cap = [...toggle!.querySelectorAll("kbd")].find((k) => k.textContent === "d");
    expect(cap != null).toBe(true);
    // The cap is aria-hidden, so its glyph never lands in the button's name (which
    // the "every accessible name begins with the visible label" test below pins).
    expect(cap?.getAttribute("aria-hidden")).toBe("true");
  });

  test("hides the `d` shortcut cap when hints are off", () => {
    const { target } = render(VersionComparePicker, baseProps);
    const toggle = target.querySelector<HTMLButtonElement>(".compare-toggle");
    const hasCap = [...toggle!.querySelectorAll("kbd")].some((k) => k.textContent === "d");
    expect(hasCap).toBe(false);
  });

  test("the disabled toggle also renders the compare icon", () => {
    const { target } = render(VersionComparePicker, disabledSingleVersionProps);
    const toggle = target.querySelector<HTMLButtonElement>(".compare-toggle");
    expect(toggle!.querySelector(".icon svg")).not.toBeNull();
  });
});

// EXC-804: the toggle carries a badge counting the OTHER versions the current one
// can be diffed against — N-1, not N, matching the disabled tooltip's "No other
// versions to compare yet". It's a visual tally, so it persists whether or not
// compare mode is on.
describe("VersionComparePicker version count badge", () => {
  test("counts the other versions, not the total, on the enabled toggle", () => {
    const { target } = render(VersionComparePicker, baseProps);
    expect(countBadge(target)?.textContent?.trim()).toBe("2");
  });

  test("counts one other version for a two-version review", () => {
    const { target } = render(VersionComparePicker, {
      ...baseProps,
      versions: versions(2),
      baseVersion: 2,
      targetVersion: 1,
    });
    expect(countBadge(target)?.textContent?.trim()).toBe("1");
  });

  // ARIA prohibits a name on a <span> (role=generic), so the badge is aria-hidden
  // and the count rides the button's own label — the TopBar .overflow-count split.
  test("keeps the badge out of the accessibility tree", () => {
    const { target } = render(VersionComparePicker, baseProps);
    expect(countBadge(target)?.getAttribute("aria-hidden")).toBe("true");
    expect(countBadge(target)?.hasAttribute("aria-label")).toBe(false);
  });

  test("singularizes the toggle's accessible name at one other version", () => {
    const { target } = render(VersionComparePicker, {
      ...baseProps,
      versions: versions(2),
      baseVersion: 2,
      targetVersion: 1,
    });
    expect(target.querySelector(".compare-toggle")?.getAttribute("aria-label")).toBe(
      "Versions, 1 other version",
    );
  });

  test("pluralizes the toggle's accessible name beyond one", () => {
    const { target } = render(VersionComparePicker, baseProps);
    expect(target.querySelector(".compare-toggle")?.getAttribute("aria-label")).toBe(
      "Versions, 2 other versions",
    );
  });

  // Every accessible name this toggle can take still STARTS with the visible label,
  // which is what keeps the e2e `getByRole("button", { name: "Versions" })` locators
  // resolving (Playwright matches a substring) and satisfies WCAG 2.5.3 Label in
  // Name. Pinned here so a reworded label fails fast.
  test("every accessible name begins with the visible label", () => {
    for (const n of [1, 2, 3]) {
      const { target } = render(VersionComparePicker, {
        ...baseProps,
        versions: versions(n),
        canCompare: n >= 2,
        baseVersion: n,
        targetVersion: Math.max(1, n - 1),
      });
      const toggle = target.querySelector(".compare-toggle");
      const name = toggle?.getAttribute("aria-label") ?? labelOf(toggle!);
      expect(name.startsWith("Versions")).toBe(true);
    }
  });

  // Nothing to compare means nothing to count: the disabled toggle stays a bare
  // affordance, and its Tooltip already explains why.
  test("renders no badge on the disabled single-version toggle", () => {
    const { target } = render(VersionComparePicker, disabledSingleVersionProps);
    expect(countBadge(target) != null).toBe(false);
  });

  // The tally is true in both views, and keeping it mounted means entering compare
  // mode never reflows the toggle's width.
  test("stays on the toggle while compare mode is off", () => {
    const { target } = render(VersionComparePicker, { ...baseProps, comparing: false });
    expect(countBadge(target)?.textContent?.trim()).toBe("2");
  });

  // `canCompare` is a parent-owned prop, so it can disagree with `versions`. The
  // count's own guard — not canCompare — is what keeps a meaningless "0" off the
  // toggle, so drive that disagreement directly.
  test("renders no badge when canCompare disagrees with a single-version set", () => {
    const { target } = render(VersionComparePicker, {
      ...baseProps,
      versions: versions(1),
      canCompare: true,
      baseVersion: 1,
      targetVersion: 1,
    });
    expect(countBadge(target) != null).toBe(false);
  });
});

// The "(current)" annotation on the newest picker row is asserted in
// test/e2e/version-compare.e2e.ts, not here: opening a bits-ui DropdownMenu is
// trigger-driven interaction happy-dom cannot carry — a synthetic .click() flips the
// trigger's aria-expanded but renders zero rows. That is a different case from the
// flushUntil dialogs (ShortcutsHelp, UnsentCommentsDialog), which mount already-open
// through a prop and so never need the interaction.

describe("VersionComparePicker pair selection", () => {
  // The trigger (.vpick) shows the current version and carries an accessible label;
  // choosing one from the portalled radio menu is covered in the e2e spec.
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

// EXC-811: below --w-narrow the parent forces the diff to unified (split's two
// columns can't fit), so it locks the Split/Unified choice off — there's nothing
// to pick. The layout toggle is removed entirely; the Bars/+−/Both marker toggle
// stays, since markers still make sense in a unified diff.
describe("VersionComparePicker layoutLocked", () => {
  test("removes the layout toggle but keeps the marker toggle when locked", () => {
    const { target } = render(VersionComparePicker, { ...baseProps, layoutLocked: true });
    expect(hasRadio(target, "Split")).toBe(false);
    expect(hasRadio(target, "Unified")).toBe(false);
    // The gutter-marker toggle is unaffected — it works in a unified diff.
    expect(hasRadio(target, "Bars")).toBe(true);
    expect(hasRadio(target, "+/−")).toBe(true);
    expect(hasRadio(target, "Both")).toBe(true);
  });

  test("shows the layout toggle by default (unlocked)", () => {
    const { target } = render(VersionComparePicker, baseProps);
    expect(hasRadio(target, "Split")).toBe(true);
    expect(hasRadio(target, "Unified")).toBe(true);
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
