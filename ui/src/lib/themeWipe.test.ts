import { describe, expect, test } from "bun:test";

import { withWipe } from "$lib/themeWipe.ts";

// withWipe decides whether to wrap a DOM update in a View Transitions "wipe" or
// run it instantly. The decision is unit-testable through injected deps — no real
// browser, no real matchMedia — following browser-testing.md's "inject, don't
// wait" rule; the wipe's visual output is exercised in the e2e.
describe("withWipe", () => {
  test("runs the update instantly when the View Transitions API is unavailable", () => {
    let ran = 0;
    withWipe(() => ran++, {
      startViewTransition: undefined,
      prefersReducedMotion: () => false,
    });
    expect(ran).toBe(1);
  });

  test("runs the update instantly (no wipe) when reduced motion is requested", () => {
    let ran = 0;
    let started = false;
    withWipe(() => ran++, {
      startViewTransition: (update) => {
        started = true;
        update();
        return undefined;
      },
      prefersReducedMotion: () => true,
    });
    expect(started).toBe(false);
    expect(ran).toBe(1);
  });

  test("wraps the update in a view transition when supported and motion is allowed", () => {
    let ran = 0;
    let started = false;
    withWipe(() => ran++, {
      startViewTransition: (update) => {
        started = true;
        // The transition runs the DOM update inside the wipe; running it here
        // mirrors that the caller's update is the transition's callback.
        update();
        return undefined;
      },
      prefersReducedMotion: () => false,
    });
    expect(started).toBe(true);
    expect(ran).toBe(1);
  });

  test("runs the update exactly once — never both inside and outside the wipe", () => {
    let ran = 0;
    withWipe(() => ran++, {
      startViewTransition: (update) => {
        update();
        return undefined;
      },
      prefersReducedMotion: () => false,
    });
    expect(ran).toBe(1);
  });
});
