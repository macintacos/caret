import "../../test-mount.ts";

import { describe, expect, test } from "bun:test";

import SettingSelect from "@/components/SettingSelect.svelte";

import { capture, flushUntil, render } from "../../test-mount.ts";

const OPTIONS = [
  { value: "split", label: "Split" },
  { value: "unified", label: "Unified" },
] as const;

const baseProps = {
  value: "split",
  options: OPTIONS,
  onSelect: () => {},
  ariaLabel: "Layout",
};

describe("SettingSelect trigger", () => {
  test("shows the current option's label and carries the aria-label", () => {
    const { flush } = render(SettingSelect, { ...baseProps, value: "unified" });
    flush();
    const trigger = document.body.querySelector("button[aria-label='Layout']");
    expect(trigger?.textContent).toContain("Unified");
  });

  test("falls back to the raw value when no option matches", () => {
    const { flush } = render(SettingSelect, { ...baseProps, value: "mystery" });
    flush();
    const trigger = document.body.querySelector("button[aria-label='Layout']");
    expect(trigger?.textContent).toContain("mystery");
  });
});

describe("SettingSelect swatches", () => {
  test("renders a color dot per swatch entry, and none on an option without one", async () => {
    const withSwatch = [
      { value: "a", label: "A", swatch: ["#000000", "#111111", "#ffffff"] },
      { value: "b", label: "B" },
    ] as const;
    const { flush } = render(SettingSelect, { ...baseProps, options: withSwatch, value: "a" });
    flush();
    document.body.querySelector<HTMLButtonElement>("button[aria-label='Layout']")?.click();
    await flushUntil(
      flush,
      () => document.body.querySelector("[data-setting-option='a']") !== null,
    );
    expect(document.body.querySelectorAll("[data-setting-option='a'] .chip-dot").length).toBe(3);
    expect(document.body.querySelectorAll("[data-setting-option='b'] .chip-dot").length).toBe(0);
  });
});

describe("SettingSelect commit", () => {
  // The trigger mounts in the light DOM; the menu content portals to document.body
  // after an effect+timer flush (the shadcn-foundation verdict). A committing pick
  // is a click on a portalled radio option, so it flushes-until the option appears.
  test("picking an option fires onSelect with its value", async () => {
    const picked = capture<string>();
    const { flush } = render(SettingSelect, { ...baseProps, onSelect: picked.cb });
    flush();
    const trigger = document.body.querySelector<HTMLButtonElement>("button[aria-label='Layout']");
    trigger?.click();
    const option = () =>
      document.body.querySelector<HTMLElement>("[data-setting-option='unified']");
    await flushUntil(flush, () => option() !== null);
    option()?.click();
    flush();
    expect(picked.last()).toBe("unified");
  });
});

describe("SettingSelect theme preview (EXC-753)", () => {
  const PREVIEW_A = { "--paper": "#123456", "--ink": "#eeeeee", "--accent": "#ff8800" };
  const PREVIEW_C = { "--paper": "#654321", "--ink": "#111111", "--accent": "#00ccff" };
  const themeOptions = [
    { value: "a", label: "Theme A", preview: PREVIEW_A },
    { value: "b", label: "Theme B" },
    { value: "c", label: "Theme C", preview: PREVIEW_C },
  ] as const;

  const previewProps = { ...baseProps, options: themeOptions, value: "a" };

  const card = () => document.body.querySelector<HTMLElement>("[data-slot='theme-preview']");

  async function openMenu(flush: () => void) {
    document.body.querySelector<HTMLButtonElement>("button[aria-label='Layout']")?.click();
    await flushUntil(
      flush,
      () => document.body.querySelector("[data-setting-option='a']") !== null,
    );
  }

  // bits-ui highlights an item on pointer/keyboard; the component tracks that highlight.
  function highlight(value: string) {
    document.body
      .querySelector<HTMLElement>(`[data-setting-option='${value}']`)
      ?.dispatchEvent(new Event("pointerenter", { bubbles: true }));
  }

  test("highlighting a theme option surfaces a preview card tinted by that option", async () => {
    const { flush } = render(SettingSelect, previewProps);
    flush();
    await openMenu(flush);
    highlight("a");
    await flushUntil(flush, () => card() !== null);
    expect(card()?.style.getPropertyValue("--accent")).toBe("#ff8800");
  });

  test("keyboard-highlighting an option (focus) surfaces its preview too", async () => {
    const { flush } = render(SettingSelect, previewProps);
    flush();
    await openMenu(flush);
    // bits-ui moves real focus onto the highlighted item as you arrow through the
    // menu; the component's onfocus mirrors onpointerenter, so keyboard roving previews.
    document.body
      .querySelector<HTMLElement>("[data-setting-option='c']")
      ?.dispatchEvent(new FocusEvent("focus"));
    await flushUntil(flush, () => card() !== null);
    expect(card()?.style.getPropertyValue("--accent")).toBe("#00ccff");
  });

  test("an option without a preview surfaces no card", async () => {
    const { flush } = render(SettingSelect, previewProps);
    flush();
    await openMenu(flush);
    highlight("b");
    flush();
    expect(card() === null).toBe(true);
  });

  test("highlighting never retints the document root", async () => {
    const before = document.documentElement.style.getPropertyValue("--accent");
    const { flush } = render(SettingSelect, previewProps);
    flush();
    await openMenu(flush);
    highlight("a");
    await flushUntil(flush, () => card() !== null);
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe(before);
  });

  test("exactly one preview shows at a time — moving between options swaps it", async () => {
    const { flush } = render(SettingSelect, previewProps);
    flush();
    await openMenu(flush);
    highlight("a");
    await flushUntil(flush, () => card()?.style.getPropertyValue("--accent") === "#ff8800");
    highlight("c");
    await flushUntil(flush, () => card()?.style.getPropertyValue("--accent") === "#00ccff");
    expect(document.body.querySelectorAll("[data-slot='theme-preview']").length).toBe(1);
  });
});
