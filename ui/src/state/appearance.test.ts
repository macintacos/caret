import "@ui/support/setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import { fakeMediaQuery } from "@ui/support/media-query.ts";
import { type AppearanceDeps, createAppearance } from "@/state/appearance.svelte.ts";
import { DARK_SLOT_KEY, LIGHT_SLOT_KEY, MODE_KEY } from "$lib/appearance.ts";
import { THEMES } from "$lib/theme.ts";

afterEach(() => {
  localStorage.clear();
  // Strip any inline vars/attrs a prior paint wrote onto the root.
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-theme");
});

/** An instance whose OS probe and wipe are both injected — so no test touches
 * matchMedia — plus a count of the wipes it actually ran. The count is the
 * repaint assertion: a wipe means the resolved theme moved. */
function harness(prefersDark = false, over: AppearanceDeps = {}) {
  let wipes = 0;
  const appearance = createAppearance({
    prefersDark: () => prefersDark,
    wipe: {
      startViewTransition: (update) => {
        wipes++;
        update();
        return undefined;
      },
      prefersReducedMotion: () => false,
    },
    ...over,
  });
  return { appearance, wipes: () => wipes };
}

describe("the resolved read", () => {
  test("resolves the persisted mode and slots against the OS preference", () => {
    localStorage.setItem(MODE_KEY, "dark");
    expect(harness(false).appearance.themeId).toBe("caret-dark");
    expect(harness(true).appearance.themeId).toBe("caret-dark");

    localStorage.setItem(MODE_KEY, "system");
    expect(harness(true).appearance.themeId).toBe("caret-dark");
    expect(harness(false).appearance.themeId).toBe("caret-light");
  });

  test("scheme and slots expose the same resolution the theme id came from", () => {
    const { appearance } = harness(true);
    expect(appearance.mode).toBe("system");
    expect(appearance.scheme).toBe("dark");
    expect(appearance.slots).toEqual({ light: "caret-light", dark: "caret-dark" });
  });
});

describe("setMode", () => {
  test("persists the mode, moves the resolved read, and repaints", () => {
    const { appearance, wipes } = harness(false);
    appearance.setMode("dark");
    expect(localStorage.getItem(MODE_KEY)).toBe("dark");
    expect(appearance.mode).toBe("dark");
    expect(appearance.themeId).toBe("caret-dark");
    expect(appearance.scheme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(wipes()).toBe(1);
  });

  // The repaint is gated on the resolved id, not on the command: pinning light
  // while the system is already light is a wipe between two identical frames.
  test("a mode resolving to the live theme persists without repainting", () => {
    const { appearance, wipes } = harness(false);
    appearance.setMode("light");
    expect(localStorage.getItem(MODE_KEY)).toBe("light");
    expect(appearance.mode).toBe("light");
    expect(wipes()).toBe(0);
  });

  test("still paints when the wipe is unavailable", () => {
    const { appearance } = harness(false, {
      wipe: { startViewTransition: undefined, prefersReducedMotion: () => false },
    });
    appearance.setMode("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("setSlot", () => {
  test("persists the slot, moves the resolved read, and repaints", () => {
    const { appearance, wipes } = harness(false);
    appearance.setSlot("light", "github-light");
    expect(localStorage.getItem(LIGHT_SLOT_KEY)).toBe("github-light");
    expect(appearance.slots.light).toBe("github-light");
    expect(appearance.themeId).toBe("github-light");
    expect(document.documentElement.style.getPropertyValue("--paper")).toBe(
      THEMES["github-light"].tokens["--paper"],
    );
    expect(wipes()).toBe(1);
  });

  test("the off-scheme slot persists without repainting", () => {
    const { appearance, wipes } = harness(false);
    appearance.setSlot("dark", "dracula");
    expect(localStorage.getItem(DARK_SLOT_KEY)).toBe("dracula");
    expect(appearance.slots.dark).toBe("dracula");
    expect(appearance.themeId).toBe("caret-light");
    expect(wipes()).toBe(0);
  });
});

/** Arm a fake OS media query on `appearance` and flip it to dark. */
function flipToDark(appearance: ReturnType<typeof harness>["appearance"]): void {
  const media = fakeMediaQuery(false);
  appearance.watch(media.mql);
  media.flip(true);
}

describe("the OS flip", () => {
  test("under system it moves the resolution, the summary, and repaints", () => {
    const { appearance, wipes } = harness(false);
    flipToDark(appearance);
    expect(appearance.scheme).toBe("dark");
    expect(appearance.themeId).toBe("caret-dark");
    expect(appearance.summary).toContain(THEMES["caret-dark"].label);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(wipes()).toBe(1);
  });

  test("under a pinned mode it leaves the resolved id untouched and never repaints", () => {
    const { appearance, wipes } = harness(false);
    appearance.setMode("dark");
    expect(wipes()).toBe(1);

    flipToDark(appearance);
    expect(appearance.scheme).toBe("dark");
    expect(appearance.themeId).toBe("caret-dark");
    expect(wipes()).toBe(1);
  });
});

describe("watch", () => {
  test("the returned disposer detaches the listener", () => {
    const { appearance, wipes } = harness(false);
    const media = fakeMediaQuery(false);
    const stop = appearance.watch(media.mql);
    stop();
    expect(media.listenerCount()).toBe(0);
    media.flip(true);
    expect(appearance.themeId).toBe("caret-light");
    expect(wipes()).toBe(0);
  });

  test("degrades to a no-op disposer where no media query is available", () => {
    const { appearance } = harness(false);
    const original = Object.getOwnPropertyDescriptor(globalThis, "matchMedia");
    Object.defineProperty(globalThis, "matchMedia", { configurable: true, value: undefined });
    try {
      const stop = appearance.watch();
      expect(() => stop()).not.toThrow();
    } finally {
      if (original) Object.defineProperty(globalThis, "matchMedia", original);
    }
  });
});

describe("boot", () => {
  // ES imports are hoisted, so the singleton is constructed before main.ts runs
  // migrateLegacyTheme — boot re-seeds rather than trusting that snapshot.
  test("re-seeds mode and slots from storage and paints without a wipe", () => {
    const { appearance, wipes } = harness(false);
    localStorage.setItem(MODE_KEY, "dark");
    localStorage.setItem(DARK_SLOT_KEY, "dracula");
    appearance.boot();
    expect(appearance.mode).toBe("dark");
    expect(appearance.themeId).toBe("dracula");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(wipes()).toBe(0);
  });

  // The dev --fresh reset: prefs are cleared, then boot repaints the defaults.
  test("a cleared origin falls back to the system default", () => {
    const { appearance } = harness(false);
    appearance.setMode("dark");
    localStorage.clear();
    appearance.boot();
    expect(appearance.mode).toBe("system");
    expect(appearance.themeId).toBe("caret-light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  test("persists nothing of its own — it only reads and paints", () => {
    localStorage.setItem(MODE_KEY, "dark");
    const { appearance } = harness(false);
    appearance.boot();
    expect(localStorage.getItem(MODE_KEY)).toBe("dark");
    expect(localStorage.getItem(LIGHT_SLOT_KEY)).toBeNull();
    expect(localStorage.getItem(DARK_SLOT_KEY)).toBeNull();
  });
});

describe("summary", () => {
  test("names the live palette's label and the system it is following", () => {
    const { appearance } = harness(false);
    appearance.setSlot("light", "github-light");
    expect(appearance.summary).toContain(THEMES["github-light"].label);
    expect(appearance.summary).toContain("system");
  });

  test("a pinned mode never claims to be following the system", () => {
    const { appearance } = harness(false);
    appearance.setMode("dark");
    expect(appearance.summary).toContain(THEMES["caret-dark"].label);
    expect(appearance.summary).not.toContain("system");
  });
});
