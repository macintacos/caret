import { describe, expect, test } from "bun:test";

import { createPlanHandoff, type PlanHandoffDeps } from "$lib/planHandoff.ts";

/** Deps for a browser that crossfades, with everything already settled. */
function crossfading(over: Partial<PlanHandoffDeps> = {}): PlanHandoffDeps {
  return {
    startViewTransition: (update) => {
      update();
      return undefined;
    },
    prefersReducedMotion: () => false,
    tag: () => {},
    settled: () => Promise.resolve(),
    ...over,
  };
}

/** A promise and the function that settles it. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function ticks(n = 10): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

// Deps are injected — no real browser, no real matchMedia — per browser-testing.md; what
// the crossfade actually plays is exercised in the e2e.
describe("createPlanHandoff", () => {
  test("runs the update instantly when the View Transitions API is unavailable", () => {
    let ran = 0;
    const tagCalls: boolean[] = [];
    const handoff = createPlanHandoff(
      crossfading({
        startViewTransition: undefined,
        tag: (on) => tagCalls.push(on),
        settled: () => new Promise(() => {}),
      }),
    );
    void handoff(() => ran++);
    expect(ran).toBe(1);
    expect(tagCalls).toEqual([]);
  });

  test("runs the update instantly (no crossfade) when reduced motion is requested", () => {
    let ran = 0;
    let started = false;
    const tagCalls: boolean[] = [];
    const handoff = createPlanHandoff(
      crossfading({
        startViewTransition: (update) => {
          started = true;
          update();
          return undefined;
        },
        prefersReducedMotion: () => true,
        tag: (on) => tagCalls.push(on),
        settled: () => new Promise(() => {}),
      }),
    );
    void handoff(() => ran++);
    expect(started).toBe(false);
    expect(ran).toBe(1);
    expect(tagCalls).toEqual([]);
  });

  test("runs the update exactly once — never both inside and outside the transition", async () => {
    let ran = 0;
    await createPlanHandoff(crossfading())(() => ran++);
    expect(ran).toBe(1);
  });

  test("lets the motion already in flight finish before the transition takes its still", async () => {
    // The still freezes the window while the update renders, so a decided guard mid-exit
    // would hang there for the whole render instead of answering the click.
    const motion = deferred();
    let started = false;
    const done = createPlanHandoff(
      crossfading({
        startViewTransition: (update) => {
          started = true;
          update();
          return undefined;
        },
        settled: () => motion.promise,
      }),
    )(() => {});
    await ticks();
    expect(started).toBe(false);
    motion.resolve();
    await done;
    expect(started).toBe(true);
  });

  test("resolves only once the update has run inside the transition", async () => {
    let runUpdate: (() => void) | undefined;
    let resolved = false;
    const done = createPlanHandoff(
      crossfading({
        startViewTransition: (update) => {
          runUpdate = update;
          return undefined;
        },
      }),
    )(() => {}).then(() => {
      resolved = true;
    });
    await ticks();
    expect(runUpdate).toBeDefined();
    expect(resolved).toBe(false);
    runUpdate?.();
    await done;
    expect(resolved).toBe(true);
  });

  test("a swap asked for before the still is taken joins that transition", async () => {
    // A resolve's advance and the poll that saw the same plan leave can both ask inside one
    // settle wait. Two transitions would have the second skip the first, cutting its update
    // in with no crossfade at all.
    const motion = deferred();
    const starts: (() => void)[] = [];
    const ran: string[] = [];
    const handoff = createPlanHandoff(
      crossfading({
        startViewTransition: (update) => {
          starts.push(update);
          update();
          return undefined;
        },
        settled: () => motion.promise,
      }),
    );
    const first = handoff(() => ran.push("advance"));
    const second = handoff(() => ran.push("merge"));
    motion.resolve();
    await Promise.all([first, second]);
    expect(starts).toHaveLength(1);
    expect(ran).toEqual(["advance", "merge"]);
  });

  test("a swap asked for once a transition is running waits for it to finish", async () => {
    // Started any sooner, it would skip the running crossfade — and that one's untag, landing
    // after the second's tag, would hand the second the theme wipe's sweep.
    const finished = deferred();
    const tagCalls: boolean[] = [];
    let starts = 0;
    const handoff = createPlanHandoff(
      crossfading({
        startViewTransition: (update) => {
          starts++;
          update();
          return { finished: starts === 1 ? finished.promise : Promise.resolve() };
        },
        tag: (on) => tagCalls.push(on),
      }),
    );
    await handoff(() => {});
    const second = handoff(() => {});
    await ticks();
    expect(starts).toBe(1);
    finished.resolve();
    await second;
    await ticks();
    expect(starts).toBe(2);
    expect(tagCalls).toEqual([true, false, true, false]);
  });

  test("tags the document before the transition starts and clears it when it finishes", async () => {
    const tagCalls: boolean[] = [];
    let taggedAtStart: boolean | undefined;
    await createPlanHandoff(
      crossfading({
        startViewTransition: (update) => {
          taggedAtStart = tagCalls.at(-1);
          update();
          return { finished: Promise.resolve() };
        },
        tag: (on) => tagCalls.push(on),
      }),
    )(() => {});
    // The class has to be in place before the browser resolves the pseudo-elements'
    // styles, or the crossfade's first frame is the theme wipe's sweep.
    expect(taggedAtStart).toBe(true);
    await Promise.resolve();
    expect(tagCalls).toEqual([true, false]);
  });

  test("clears the tag when the transition is skipped and `finished` rejects", async () => {
    const tagCalls: boolean[] = [];
    await createPlanHandoff(
      crossfading({
        startViewTransition: (update) => {
          update();
          return { finished: Promise.reject(new Error("skipped")) };
        },
        tag: (on) => tagCalls.push(on),
      }),
    )(() => {});
    // A stranded class would restyle the next theme wipe, so a rejection has to clear it too.
    await Promise.resolve();
    expect(tagCalls).toEqual([true, false]);
  });
});
