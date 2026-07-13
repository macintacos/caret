import "../../test-mount.ts";

import { describe, expect, test } from "bun:test";
import { render } from "../../test-mount.ts";
import { THEME_IDS, THEMES } from "../lib/theme.ts";
import SettingsDialog from "./SettingsDialog.svelte";

const baseProps = {
  current: "caret-dark" as const,
  onSelect: () => {},
  onClose: () => {},
};

function select(target: HTMLElement) {
  return target.querySelector(".theme-select") as HTMLSelectElement;
}

describe("SettingsDialog render", () => {
  test("lists every theme with its human label", () => {
    const { target } = render(SettingsDialog, baseProps);
    const options = [...select(target).querySelectorAll("option")];
    expect(options.map((o) => o.value)).toEqual([...THEME_IDS]);
    expect(options.map((o) => o.textContent?.trim())).toEqual(
      THEME_IDS.map((id) => THEMES[id].label),
    );
  });

  test("selects the current theme", () => {
    const { target } = render(SettingsDialog, { ...baseProps, current: "caret-light" });
    expect(select(target).value).toBe("caret-light");
  });

  test("is a labelled modal dialog", () => {
    const { target } = render(SettingsDialog, baseProps);
    const dialog = target.querySelector(".dialog") as HTMLElement;
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Settings");
  });
});

describe("SettingsDialog wiring", () => {
  test("changing the dropdown fires onSelect with the chosen id", () => {
    let picked: string | undefined;
    const { target } = render(SettingsDialog, {
      ...baseProps,
      onSelect: (id: string) => {
        picked = id;
      },
    });
    const el = select(target);
    el.value = "caret-light";
    el.dispatchEvent(new Event("change", { bubbles: true }));
    expect(picked).toBe("caret-light");
  });

  test("clicking Done fires onClose", () => {
    let closed = false;
    const { target } = render(SettingsDialog, {
      ...baseProps,
      onClose: () => {
        closed = true;
      },
    });
    (target.querySelector(".done") as HTMLElement).click();
    expect(closed).toBe(true);
  });

  test("clicking the scrim backdrop closes", () => {
    let closed = false;
    const { target } = render(SettingsDialog, {
      ...baseProps,
      onClose: () => {
        closed = true;
      },
    });
    (target.querySelector(".scrim") as HTMLElement).click();
    expect(closed).toBe(true);
  });
});

describe("SettingsDialog keyboard", () => {
  test("Escape closes", () => {
    let closed = false;
    const { target } = render(SettingsDialog, {
      ...baseProps,
      onClose: () => {
        closed = true;
      },
    });
    (target.querySelector(".dialog") as HTMLElement).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(closed).toBe(true);
  });
});
