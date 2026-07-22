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
