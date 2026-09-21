import { describe, expect, test } from "bun:test";

import { withPlanHandoff } from "$lib/planHandoff.ts";

// Deps are injected — no real browser, no real matchMedia — per browser-testing.md; what
// the crossfade actually plays is exercised in the e2e.
describe("withPlanHandoff", () => {
  test("runs the update instantly when the View Transitions API is unavailable", () => {
    let ran = 0;
    const tagCalls: boolean[] = [];
    withPlanHandoff(() => ran++, {
      startViewTransition: undefined,
      prefersReducedMotion: () => false,
      tag: (on) => tagCalls.push(on),
    });
    expect(ran).toBe(1);
    expect(tagCalls).toEqual([]);
  });

  test("runs the update instantly (no crossfade) when reduced motion is requested", () => {
    let ran = 0;
    let started = false;
    const tagCalls: boolean[] = [];
    withPlanHandoff(() => ran++, {
      startViewTransition: (update) => {
        started = true;
        update();
        return undefined;
      },
      prefersReducedMotion: () => true,
      tag: (on) => tagCalls.push(on),
    });
    expect(started).toBe(false);
    expect(ran).toBe(1);
    expect(tagCalls).toEqual([]);
  });

  test("runs the update exactly once — never both inside and outside the transition", () => {
    let ran = 0;
    withPlanHandoff(() => ran++, {
      startViewTransition: (update) => {
        update();
        return undefined;
      },
      prefersReducedMotion: () => false,
      tag: () => {},
    });
    expect(ran).toBe(1);
  });

  test("tags the document before the transition starts and clears it when it finishes", async () => {
    const tagCalls: boolean[] = [];
    let taggedAtStart: boolean | undefined;
    withPlanHandoff(() => {}, {
      startViewTransition: (update) => {
        taggedAtStart = tagCalls.at(-1);
        update();
        return { finished: Promise.resolve() };
      },
      prefersReducedMotion: () => false,
      tag: (on) => tagCalls.push(on),
    });
    // The class has to be in place before the browser resolves the pseudo-elements'
    // styles, or the crossfade's first frame is the theme wipe's sweep.
    expect(taggedAtStart).toBe(true);
    await Promise.resolve();
    expect(tagCalls).toEqual([true, false]);
  });

  test("clears the tag when the transition is skipped and `finished` rejects", async () => {
    const tagCalls: boolean[] = [];
    withPlanHandoff(() => {}, {
      startViewTransition: (update) => {
        update();
        return { finished: Promise.reject(new Error("skipped")) };
      },
      prefersReducedMotion: () => false,
      tag: (on) => tagCalls.push(on),
    });
    // A stranded class would restyle the next theme wipe, so a rejection has to clear it too.
    await Promise.resolve();
    expect(tagCalls).toEqual([true, false]);
  });
});
