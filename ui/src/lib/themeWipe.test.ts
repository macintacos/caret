import { describe, expect, test } from "bun:test";

import type { ThemeId } from "$lib/theme.ts";
import { changeTheme } from "$lib/themeWipe.ts";

// changeTheme decides whether to wrap the theme swap in a View Transitions
// "wipe" or apply it instantly. The decision is unit-testable through injected
// deps — no real browser, no real matchMedia — following browser-testing.md's
// "inject, don't wait" rule; the wipe's visual output is exercised in the e2e.
describe("changeTheme", () => {
  test("applies instantly when the View Transitions API is unavailable", () => {
    const applied: ThemeId[] = [];
    changeTheme("caret-light", {
      startViewTransition: undefined,
      prefersReducedMotion: () => false,
      apply: (id) => applied.push(id),
    });
    expect(applied).toEqual(["caret-light"]);
  });

  test("applies instantly (no wipe) when reduced motion is requested", () => {
    const applied: ThemeId[] = [];
    let started = false;
    changeTheme("caret-dark", {
      startViewTransition: (update) => {
        started = true;
        update();
        return undefined;
      },
      prefersReducedMotion: () => true,
      apply: (id) => applied.push(id),
    });
    expect(started).toBe(false);
    expect(applied).toEqual(["caret-dark"]);
  });

  test("wraps the swap in a view transition when supported and motion is allowed", () => {
    const applied: ThemeId[] = [];
    let started = false;
    changeTheme("caret-light", {
      startViewTransition: (update) => {
        started = true;
        // The transition runs the DOM update inside the wipe; running it here
        // mirrors that the caller's apply is the transition's update callback.
        update();
        return undefined;
      },
      prefersReducedMotion: () => false,
      apply: (id) => applied.push(id),
    });
    expect(started).toBe(true);
    expect(applied).toEqual(["caret-light"]);
  });
});
