// SettingSelect composes the vendored Select tree (EXC-1111), so this suite asserts
// through `data-slot` and the component's own `data-setting-option` hook — never the
// registry's `cn-*` marker classes, which are inert here (doc/agents/shadcn-rules.md
// § Where the test goes).
//
// Three harness facts are inherited from ui/src/lib/shadcn-select.test.ts and are what
// keep this suite from being silently inert:
//
//   * The content PORTALS to document.body on a deferred tick, so every open is polled
//     with `flushUntil` and queried off `document.body`, not the mount target.
//   * The trigger toggles on `pointerdown` — `SelectTriggerState.onclick` only calls
//     `focus()` — so `.click()` neither opens nor closes it.
//   * An open panel left behind at unmount keeps its effects alive into the next test
//     (bits-ui's portal presence waits for an `animationend` happy-dom never fires), so
//     each test closes what it opened.
//
// Two more are specific to Select.Item and have no DropdownMenu counterpart: a row
// COMMITS on `pointerup` (`SelectItemState.onpointerup`), and the highlight MOVES on
// `pointermove` (`SelectItemState.onpointermove`). A suite carried over from the menu's
// `.click()` / `pointerenter` idioms would pass vacuously.
import "@ui/test-mount.ts";

import { describe, expect, test } from "bun:test";

import { capture, flushUntil, render } from "@ui/test-mount.ts";
import SettingSelect from "@/components/SettingSelect.svelte";
import { THEMES } from "$lib/theme.ts";

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

const trigger = () => document.body.querySelector<HTMLElement>("[data-slot='select-trigger']");
const content = () => document.body.querySelector<HTMLElement>("[data-slot='select-content']");
const option = (value: string) =>
  document.body.querySelector<HTMLElement>(`[data-setting-option='${value}']`);

function pointer(el: Element | null, type: string): void {
  el?.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerType: "mouse" }),
  );
}

/** Open the panel and wait for the portalled content to land. */
async function open(flush: () => void): Promise<void> {
  pointer(trigger(), "pointerdown");
  await flushUntil(flush, () => content() !== null);
  expect(content()).not.toBeNull();
}

/** Dismiss before the test ends — load-bearing rather than tidy, see the header. The
 * closing assertion is what keeps this from silently stopping to guard anything, since
 * `flushUntil` exhausts its budget without throwing. Guarded, so it no-ops if a test
 * never opened. */
async function close(flush: () => void): Promise<void> {
  if (content() === null) return;
  pointer(trigger(), "pointerdown");
  await flushUntil(flush, () => content() === null);
  expect(content()).toBeNull();
}

describe("SettingSelect trigger", () => {
  test("shows the current option's label and carries the aria-label", () => {
    const { flush } = render(SettingSelect, { ...baseProps, value: "unified" });
    flush();
    expect(trigger()?.getAttribute("aria-label")).toBe("Layout");
    expect(trigger()?.textContent).toContain("Unified");
  });

  test("falls back to the raw value when no option matches", () => {
    const { flush } = render(SettingSelect, { ...baseProps, value: "mystery" });
    flush();
    expect(trigger()?.textContent).toContain("mystery");
  });

  test("announces the listbox it opens rather than a menu", () => {
    // The whole point of the ticket: a combobox trigger, not a menu button. bits-ui
    // stamps these off the Select primitive, so they red if the tree is swapped back.
    const { flush } = render(SettingSelect, baseProps);
    flush();
    expect(trigger()?.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger()?.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("SettingSelect panel", () => {
  test("opens a listbox of options, one per choice", async () => {
    const { flush } = render(SettingSelect, baseProps);
    flush();
    await open(flush);

    expect(trigger()?.getAttribute("aria-expanded")).toBe("true");
    expect(content()?.getAttribute("role")).toBe("listbox");
    const rows = [...document.body.querySelectorAll("[data-slot='select-item']")];
    expect(rows.map((r) => r.getAttribute("role"))).toEqual(["option", "option"]);
    expect(rows.map((r) => r.getAttribute("data-setting-option"))).toEqual(["split", "unified"]);
    await close(flush);
  });

  test("gives every row the text typeahead searches on", async () => {
    // bits-ui matches typed characters against each candidate row's trimmed
    // `textContent` (DOMTypeahead in bits-ui/internal/dom-typeahead.svelte.js), NOT
    // against the `label` prop — the vendored select-item.svelte destructures `label`
    // out and never forwards it, so `data-label` is never set. So what a reader types
    // has to match the label they can see, which means the row's text must be exactly
    // that label and nothing else: a swatch dot or an indicator that contributed text
    // would break the match. Typing itself is a real-browser behaviour and stays e2e;
    // this pins the input it depends on.
    const withSwatch = [
      { value: "caret-dark", label: "caret dark", swatch: ["#000000", "#111111"] },
      { value: "caret-light", label: "caret light" },
    ] as const;
    const { flush } = render(SettingSelect, {
      ...baseProps,
      options: withSwatch,
      value: "caret-dark",
    });
    flush();
    await open(flush);

    expect(option("caret-dark")?.textContent?.trim()).toBe("caret dark");
    expect(option("caret-light")?.textContent?.trim()).toBe("caret light");
    await close(flush);
  });

  test("marks the current value as the selected option", async () => {
    const { flush } = render(SettingSelect, baseProps);
    flush();
    await open(flush);

    expect(option("split")?.getAttribute("aria-selected")).toBe("true");
    expect(option("unified")?.getAttribute("aria-selected")).toBeNull();
    await close(flush);
  });

  test("renders a color dot per swatch entry, and none on an option without one", async () => {
    const withSwatch = [
      { value: "a", label: "A", swatch: ["#000000", "#111111", "#ffffff"] },
      { value: "b", label: "B" },
    ] as const;
    const { flush } = render(SettingSelect, { ...baseProps, options: withSwatch, value: "a" });
    flush();
    await open(flush);

    expect(document.body.querySelectorAll("[data-setting-option='a'] .chip-dot").length).toBe(3);
    expect(document.body.querySelectorAll("[data-setting-option='b'] .chip-dot").length).toBe(0);
    await close(flush);
  });
});

describe("SettingSelect commit", () => {
  test("picking an option fires onSelect with its value, and closes", async () => {
    const picked = capture<string>();
    const { flush } = render(SettingSelect, { ...baseProps, onSelect: picked.cb });
    flush();
    await open(flush);

    pointer(option("unified"), "pointerup");
    await flushUntil(flush, () => content() === null);
    expect(picked.last()).toBe("unified");
    expect(content()).toBeNull();
  });

  test("re-picking the value already selected commits nothing", async () => {
    // A listbox is not a menu: bits-ui defaults `allowDeselect` to false, so
    // SelectItemState.handleSelect early-returns to handleClose() when the picked value
    // is already current — the same silence a native <select> keeps when you re-pick an
    // option. The DropdownMenu this replaced re-fired onSelect for an unchanged value,
    // and one e2e case depended on that.
    const picked = capture<string>();
    const { flush } = render(SettingSelect, { ...baseProps, onSelect: picked.cb });
    flush();
    await open(flush);

    pointer(option("split"), "pointerup");
    await flushUntil(flush, () => content() === null);
    expect(picked.last()).toBeUndefined();
    expect(content()).toBeNull();
  });
});

describe("SettingSelect theme preview (EXC-753)", () => {
  // Real theme ids: the card paints straight from the registry (EXC-884), so the
  // expected accents come from THEMES too and cannot drift from it.
  const LIGHT_ACCENT = THEMES["caret-light"].tokens["--accent"];
  const DARK_ACCENT = THEMES["caret-dark"].tokens["--accent"];
  const themeOptions = [
    { value: "caret-light", label: "caret light", preview: "caret-light" },
    { value: "b", label: "Theme B" },
    { value: "caret-dark", label: "caret dark", preview: "caret-dark" },
  ] as const;

  const previewProps = { ...baseProps, options: themeOptions, value: "caret-light" };

  const card = () => document.body.querySelector<HTMLElement>("[data-slot='theme-preview']");

  /** Move the highlight onto a row. bits-ui highlights on `pointermove`, not
   * `pointerenter` — and on arrow keys, which route through the same
   * `setHighlightedNode` and so the same `onHighlight` this component listens to. */
  const highlight = (value: string) => pointer(option(value), "pointermove");

  test("a listbox always has an active option, so opening previews the current one", async () => {
    // Not a carried-over behaviour: `SelectSingleRootState.setInitialHighlightedNode`
    // highlights the selected row as the content mounts, where the old menu highlighted
    // nothing until a hover. There is no "nothing highlighted" state to preserve under
    // aria-activedescendant, and the preview following the highlight is the feature.
    const { flush } = render(SettingSelect, previewProps);
    flush();
    await open(flush);

    await flushUntil(flush, () => card() !== null);
    expect(card()?.style.getPropertyValue("--accent")).toBe(LIGHT_ACCENT);
    await close(flush);
  });

  test("highlighting a theme option surfaces a preview card tinted by that option", async () => {
    const { flush } = render(SettingSelect, previewProps);
    flush();
    await open(flush);

    highlight("caret-dark");
    await flushUntil(flush, () => card()?.style.getPropertyValue("--accent") === DARK_ACCENT);
    expect(card()?.style.getPropertyValue("--accent")).toBe(DARK_ACCENT);
    await close(flush);
  });

  test("an option without a preview surfaces no card", async () => {
    const { flush } = render(SettingSelect, previewProps);
    flush();
    await open(flush);
    await flushUntil(flush, () => card() !== null);

    highlight("b");
    await flushUntil(flush, () => card() === null);
    expect(card()).toBeNull();
    await close(flush);
  });

  test("highlighting never retints the document root", async () => {
    const before = document.documentElement.style.getPropertyValue("--accent");
    const { flush } = render(SettingSelect, previewProps);
    flush();
    await open(flush);

    highlight("caret-dark");
    await flushUntil(flush, () => card()?.style.getPropertyValue("--accent") === DARK_ACCENT);
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe(before);
    await close(flush);
  });

  test("exactly one preview shows at a time — moving between options swaps it", async () => {
    const { flush } = render(SettingSelect, previewProps);
    flush();
    await open(flush);

    highlight("caret-light");
    await flushUntil(flush, () => card()?.style.getPropertyValue("--accent") === LIGHT_ACCENT);
    highlight("caret-dark");
    await flushUntil(flush, () => card()?.style.getPropertyValue("--accent") === DARK_ACCENT);
    expect(document.body.querySelectorAll("[data-slot='theme-preview']").length).toBe(1);
    await close(flush);
  });
});
