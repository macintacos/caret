import "@ui/test-mount.ts";

import { afterEach, describe, expect, test } from "bun:test";

import { render } from "@ui/test-mount.ts";
import ThemeSection from "@/components/ThemeSection.svelte";
import { appearance } from "@/state/appearance.svelte.ts";
import {
  isStagedField,
  SETTINGS_REGISTRY,
  type StagedField,
  THEME_FIELD,
  THEME_SECTION,
} from "$lib/settingsRegistry.ts";

// The section reads the live appearance singleton, so a seeded mode/slot must be
// wound back or it leaks into the next test — clear storage, then boot() re-seeds
// the module from the now-empty origin.
afterEach(() => {
  localStorage.clear();
  appearance.boot();
});

// The theme block renders three registry fields as one composite: a segmented mode
// control and both slot selectors, with the IN USE marker on whichever slot the
// mode currently resolves to. Render output, the marker's placement, the summary
// copy, and callback wiring are what a mounted component exposes — the dropdown's
// open/pick, the segmented control's real keyboard roving, and a live OS flip are
// real-browser behavior and live in test/e2e/settings.e2e.ts (browser-testing.md).
const THEME_FIELDS: StagedField[] = SETTINGS_REGISTRY.filter(isStagedField).filter(
  (field) => field.section === THEME_SECTION,
);

function props(over: Record<string, unknown> = {}) {
  return {
    fields: THEME_FIELDS,
    values: {
      [THEME_FIELD.mode]: "dark",
      [THEME_FIELD.light]: "caret-light",
      [THEME_FIELD.dark]: "caret-dark",
    },
    onApply: () => {},
    ...over,
  };
}

const q = (sel: string) => document.body.querySelector(sel);
const has = (sel: string) => q(sel) !== null;
const text = (sel: string) => q(sel)?.textContent?.trim() ?? "";

describe("ThemeSection layout", () => {
  test("renders all three rows — both slots stay visible regardless of mode", () => {
    render(ThemeSection, props());
    expect(has(`[data-field='${THEME_FIELD.mode}']`)).toBe(true);
    expect(has(`[data-field='${THEME_FIELD.light}']`)).toBe(true);
    expect(has(`[data-field='${THEME_FIELD.dark}']`)).toBe(true);
  });

  test("the mode row is a segmented radio group, the slots are dropdowns", () => {
    render(ThemeSection, props());
    expect(has("[data-slot='toggle-group']")).toBe(true);
    expect(has(`button#setting-${THEME_FIELD.light}`)).toBe(true);
    expect(has(`button#setting-${THEME_FIELD.dark}`)).toBe(true);
  });

  test("each mode is a segment, all three visible at once", () => {
    render(ThemeSection, props());
    const labels = [...document.body.querySelectorAll("[data-slot='toggle-group-item']")].map(
      (el) => el.textContent?.trim(),
    );
    expect(labels).toEqual(["Light", "Dark", "System"]);
  });

  test("a search-filtered section renders only the fields it was handed", () => {
    const darkOnly = THEME_FIELDS.filter((f) => f.key === THEME_FIELD.dark);
    render(ThemeSection, props({ fields: darkOnly }));
    expect(has(`[data-field='${THEME_FIELD.dark}']`)).toBe(true);
    expect(has(`[data-field='${THEME_FIELD.mode}']`)).toBe(false);
    expect(has(`[data-field='${THEME_FIELD.light}']`)).toBe(false);
  });
});

describe("ThemeSection label association (EXC-1112)", () => {
  // Both slot rows are named natively: their control is a <button>, which IS a
  // labelable element, so `for`/`id` carries both the name and the click-to-focus.
  test("each slot row's visible text is a <label> wired to its trigger by for/id", () => {
    render(ThemeSection, props());
    for (const key of [THEME_FIELD.light, THEME_FIELD.dark]) {
      const label = q(`[data-field='${key}'] label[data-slot='field-label']`);
      expect(label?.getAttribute("for")).toBe(`setting-${key}`);
      expect(has(`button#setting-${key}`)).toBe(true);
    }
  });

  // The mode row is the exception, and deliberately so: a toggle group renders a
  // <div role="group">, which is not a labelable element, so `for` would be inert
  // on it. aria-labelledby pointing at the same real <label> is the association
  // ARIA gives a composite widget.
  test("the mode row's group is named by aria-labelledby, not for/id", () => {
    render(ThemeSection, props());
    const label = q(`[data-field='${THEME_FIELD.mode}'] label[data-slot='field-label']`);
    expect(label?.hasAttribute("for")).toBe(false);
    expect(label?.id).toBe(`setting-${THEME_FIELD.mode}-label`);
    expect(q("[data-slot='toggle-group']")?.getAttribute("aria-labelledby")).toBe(label?.id);
  });
});

describe("the IN USE marker", () => {
  test("lands on the dark slot under a manual dark mode", () => {
    appearance.setMode("dark");
    render(ThemeSection, props());
    expect(q(`[data-field='${THEME_FIELD.dark}']`)?.textContent).toContain("In use");
    expect(q(`[data-field='${THEME_FIELD.light}']`)?.textContent).not.toContain("In use");
  });

  test("lands on the light slot under a manual light mode", () => {
    appearance.setMode("light");
    render(ThemeSection, props({ values: { ...props().values, [THEME_FIELD.mode]: "light" } }));
    expect(q(`[data-field='${THEME_FIELD.light}']`)?.textContent).toContain("In use");
    expect(q(`[data-field='${THEME_FIELD.dark}']`)?.textContent).not.toContain("In use");
  });

  test("marks exactly one slot — never both, never neither", () => {
    appearance.setMode("dark");
    render(ThemeSection, props());
    expect(document.body.querySelectorAll(".in-use").length).toBe(1);
  });
});

describe("the resolved-state line", () => {
  test("a manual mode says the scheme is pinned and names the live theme", () => {
    appearance.setMode("dark");
    render(ThemeSection, props());
    const copy = text("[data-theme-summary]");
    expect(copy).toContain("dark");
    expect(copy).toContain("caret dark");
    expect(copy).not.toContain("system");
  });

  test("system mode explains that it is following the system", () => {
    appearance.setMode("system");
    render(ThemeSection, props({ values: { ...props().values, [THEME_FIELD.mode]: "system" } }));
    expect(text("[data-theme-summary]")).toContain("system");
  });
});

describe("ThemeSection apply wiring", () => {
  test("picking a mode segment calls onApply with the mode field and its value", () => {
    const calls: Array<{ key: string; value: unknown }> = [];
    const { flush } = render(
      ThemeSection,
      props({ onApply: (f: StagedField, v: unknown) => calls.push({ key: f.key, value: v }) }),
    );
    const light = document.body.querySelector<HTMLButtonElement>(
      "[data-slot='toggle-group-item'][data-setting-option='light']",
    );
    if (!light) throw new Error("light mode segment not found");
    light.click();
    flush();
    expect(calls).toEqual([{ key: THEME_FIELD.mode, value: "light" }]);
  });
});
