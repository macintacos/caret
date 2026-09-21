import { describe, expect, test } from "bun:test";

import { withPlanHandoff } from "$lib/planHandoff.ts";

// withPlanHandoff decides whether to wrap the drain-to-empty swap in a View
// Transitions crossfade or run it instantly, and tags the document root for the
// transition's lifetime so the stylesheet can pick this animation over the theme
// wipe's. Both halves are unit-testable through injected deps — no real browser, no
// real matchMedia — following browser-testing.md's "inject, don't wait" rule; the
// crossfade's visual output is exercised in the e2e.
describe("withPlanHandoff", () => {
  test("runs the update instantly when the View Transitions API is unavailable", () => {
    let ran = 0;
    const tagged: boolean[] = [];
    withPlanHandoff(() => ran++, {
      startViewTransition: undefined,
      prefersReducedMotion: () => false,
      tag: (on) => tagged.push(on),
    });
    expect(ran).toBe(1);
    expect(tagged).toEqual([]);
  });

  test("runs the update instantly (no crossfade) when reduced motion is requested", () => {
    let ran = 0;
    let started = false;
    const tagged: boolean[] = [];
    withPlanHandoff(() => ran++, {
      startViewTransition: (update) => {
        started = true;
        update();
        return undefined;
      },
      prefersReducedMotion: () => true,
      tag: (on) => tagged.push(on),
    });
    expect(started).toBe(false);
    expect(ran).toBe(1);
    expect(tagged).toEqual([]);
  });

  test("runs the update exactly once — never both inside and outside the transition", () => {
    let ran = 0;
    withPlanHandoff(() => ran++, {
      startViewTransition: (update) => {
        // The transition runs the DOM update inside the crossfade; running it here
        // mirrors that the caller's update is the transition's callback.
        update();
        return undefined;
      },
      prefersReducedMotion: () => false,
      tag: () => {},
    });
    expect(ran).toBe(1);
  });

  test("tags the document before the transition starts and clears it when it finishes", async () => {
    const tagged: boolean[] = [];
    let taggedAtStart: boolean | undefined;
    withPlanHandoff(() => {}, {
      startViewTransition: (update) => {
        taggedAtStart = tagged.at(-1);
        update();
        return { finished: Promise.resolve() };
      },
      prefersReducedMotion: () => false,
      tag: (on) => tagged.push(on),
    });
    // The class has to be in place before the browser resolves the pseudo-elements'
    // styles, or the crossfade's first frame is the theme wipe's sweep.
    expect(taggedAtStart).toBe(true);
    await Promise.resolve();
    expect(tagged).toEqual([true, false]);
  });

  test("clears the tag when the transition is skipped and `finished` rejects", async () => {
    const tagged: boolean[] = [];
    withPlanHandoff(() => {}, {
      startViewTransition: (update) => {
        update();
        return { finished: Promise.reject(new Error("skipped")) };
      },
      prefersReducedMotion: () => false,
      tag: (on) => tagged.push(on),
    });
    // A browser that abandons the transition rejects `finished`. A stranded class
    // would restyle the next theme wipe, so the rejection has to clear it too.
    await Promise.resolve();
    expect(tagged).toEqual([true, false]);
  });
});
