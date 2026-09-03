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
import { join } from "node:path";

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
  id: "setting-layout",
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
  // EXC-1112: the trigger takes the id the row's `<label for>` points at, so its
  // accessible name comes from that visible label rather than a parallel aria-label.
  // The naming contract therefore belongs to the COMPOSING component — mounted bare,
  // as here, the trigger falls back to being named by its own contents. That is
  // expected; don't "fix" it by re-adding an aria-label. SettingsDialog.test.ts and
  // ThemeSection.test.ts pin the wiring, settings.e2e.ts pins the resulting names.
  test("shows the current option's label and carries the label-target id", () => {
    const { flush } = render(SettingSelect, { ...baseProps, value: "unified" });
    flush();
    expect(trigger()?.id).toBe("setting-layout");
    expect(trigger()?.hasAttribute("aria-label")).toBe(false);
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

// Asserted against the source, not a computed style: happy-dom applies no stylesheet, so
// a mount cannot see which rule won. The same route shadcn-select.test.ts takes for
// select-content's animation keys, and for the same reason — the DOM cannot tell the two
// orderings apart, while the reader can.
const componentSource = await Bun.file(join(import.meta.dir, "SettingSelect.svelte")).text();

describe("SettingSelect row states", () => {
  // Anchored on the opening brace so a rule is matched rather than any prose above it
  // that happens to spell the same selector — the guard shadcn-select.test.ts gets from
  // stripping comments first, which cannot work here (this file's are `/* */`).
  const at = (selector: string) => componentSource.indexOf(`${selector} {`);

  test("selection wins the fill over the highlight, not the other way round", () => {
    // A listbox parks its highlight on the selected row as soon as it opens (bits-ui's
    // setInitialHighlightedNode), so unlike a DropdownMenu — where the highlight only ever
    // greys a row transiently under the cursor — losing to the highlight here would leave
    // the resting panel with no amber selection mark at all.
    const highlighted = at(".setting-item[data-highlighted])");
    const selected = at(".setting-item[data-selected])");
    expect(highlighted).toBeGreaterThan(-1);
    expect(selected).toBeGreaterThan(highlighted);
  });

  test("the row carrying both still shows the keyboard cursor", () => {
    // [data-highlighted] is this listbox's keyboard cursor — bits-ui focuses no row — so
    // it needs a mark of its own on the row selection has already filled.
    expect(at(".setting-item[data-selected][data-highlighted])")).toBeGreaterThan(-1);
    expect(componentSource).toMatch(/\[data-selected\]\[data-highlighted\]\)\s*\{\s*box-shadow:/);
  });
});

describe("SettingSelect commit", () => {
  /** Render with an onSelect capture and open the listbox — the common
   * opening both commit tests below then pick a row from. */
  async function openWithSelectCapture(): Promise<{
    flush: () => void;
    picked: ReturnType<typeof capture<string>>;
  }> {
    const picked = capture<string>();
    const { flush } = render(SettingSelect, { ...baseProps, onSelect: picked.cb });
    flush();
    await open(flush);
    return { flush, picked };
  }

  test("picking an option fires onSelect with its value, and closes", async () => {
    const { flush, picked } = await openWithSelectCapture();
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
    const { flush, picked } = await openWithSelectCapture();
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

  /** Render with the theme preview options, open the listbox, and highlight
   * caret-dark until its preview card lands — the common opening the tests
   * below that start from "dark is now highlighted" share. */
  async function openWithDarkHighlighted(): Promise<{ flush: () => void }> {
    const { flush } = render(SettingSelect, previewProps);
    flush();
    await open(flush);
    highlight("caret-dark");
    await flushUntil(flush, () => card()?.style.getPropertyValue("--accent") === DARK_ACCENT);
    return { flush };
  }

  test("a listbox always has an active option, so opening previews the current one", async () => {
    // `SelectSingleRootState.setInitialHighlightedNode` highlights the selected row as the
    // content mounts: under aria-activedescendant there is no "nothing highlighted" state,
    // and the preview follows the highlight.
    const { flush } = render(SettingSelect, previewProps);
    flush();
    await open(flush);

    await flushUntil(flush, () => card() !== null);
    expect(card()?.style.getPropertyValue("--accent")).toBe(LIGHT_ACCENT);
    await close(flush);
  });

  test("highlighting a theme option surfaces a preview card tinted by that option", async () => {
    const { flush } = await openWithDarkHighlighted();
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
    const { flush } = await openWithDarkHighlighted();
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe(before);
    await close(flush);
  });

  // Opening a listbox scrolls — the trigger's reveal and bits-ui's own
  // scrollHighlightedNodeIntoView — so a scroll must re-place the card, never drop it
  // (SettingSelect.svelte's placement effect says why). Both origins are covered because
  // they fail differently: the ancestor one is what e2e caught, the in-panel one is what
  // a taller slot would hit.
  for (const [origin, dispatch] of [
    ["an ancestor of the panel", () => document.dispatchEvent(new Event("scroll"))],
    ["inside the panel", () => content()?.dispatchEvent(new Event("scroll"))],
  ] as const) {
    test(`a scroll from ${origin} keeps the preview up`, async () => {
      const { flush } = await openWithDarkHighlighted();

      dispatch();
      flush();
      expect(card()?.style.getPropertyValue("--accent")).toBe(DARK_ACCENT);
      await close(flush);
    });
  }

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
