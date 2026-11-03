import { describe, expect, test } from "bun:test";

import { createPaneMove, type PaneMoveDeps } from "$lib/paneMove.ts";

/** Deps for a browser that runs view transitions, each finishing on `finish`. */
function transitioning(over: Partial<PaneMoveDeps> = {}): PaneMoveDeps {
  return {
    startViewTransition: (update) => {
      update();
      return { finished: Promise.resolve() };
    },
    prefersReducedMotion: () => false,
    tag: () => {},
    restart: () => {},
    ...over,
  };
}

/** A promise and the functions that settle it. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: () => void } {
  let resolve = () => {};
  let reject = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function ticks(n = 10): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

// Deps are injected — no real browser, no real matchMedia — per browser-testing.md; what
// the transition plays is exercised in the e2e.
describe("createPaneMove", () => {
  test("runs the update instantly, untagged, when the View Transitions API is unavailable", () => {
    let ran = 0;
    const tags: (string | null)[] = [];
    const move = createPaneMove(
      transitioning({ startViewTransition: undefined, tag: (t) => tags.push(t) }),
    );
    move("exit", () => ran++);
    expect(ran).toBe(1);
    expect(tags).toEqual([]);
  });

  test("runs the update instantly, untagged, when reduced motion is requested", () => {
    let ran = 0;
    let started = false;
    const tags: (string | null)[] = [];
    const move = createPaneMove(
      transitioning({
        startViewTransition: (update) => {
          started = true;
          update();
          return undefined;
        },
        prefersReducedMotion: () => true,
        tag: (t) => tags.push(t),
      }),
    );
    move("enter", () => ran++);
    expect(started).toBe(false);
    expect(ran).toBe(1);
    expect(tags).toEqual([]);
  });

  test("tags the root with the move before the old state is taken, and clears it once done", async () => {
    const order: string[] = [];
    const done = deferred();
    const move = createPaneMove(
      transitioning({
        startViewTransition: (update) => {
          order.push("start");
          update();
          return { finished: done.promise };
        },
        tag: (t) => order.push(`tag ${t}`),
      }),
    );
    move("exit", () => order.push("update"));
    expect(order).toEqual(["tag exit", "start", "update"]);
    done.resolve();
    await ticks();
    expect(order.at(-1)).toBe("tag null");
  });

  test("clears the tag when the transition is skipped", async () => {
    const tags: (string | null)[] = [];
    const skipped = deferred();
    const move = createPaneMove(
      transitioning({
        startViewTransition: (update) => {
          update();
          return { finished: skipped.promise };
        },
        tag: (t) => tags.push(t),
      }),
    );
    move("enter", () => {});
    skipped.reject();
    await ticks();
    expect(tags).toEqual(["enter", null]);
  });

  // The new layout's first paint is the long frame, and it lands after the transition is
  // ready, so its animations start over on the frame after it.
  test("restarts the transition's animations once it is ready", async () => {
    const order: string[] = [];
    const ready = deferred();
    const move = createPaneMove(
      transitioning({
        startViewTransition: (update) => {
          update();
          return { ready: ready.promise, finished: new Promise(() => {}) };
        },
        restart: () => order.push("restart"),
      }),
    );
    move("exit", () => order.push("update"));
    await ticks();
    expect(order).toEqual(["update"]);
    ready.resolve();
    await ticks();
    expect(order).toEqual(["update", "restart"]);
  });

  test("restarts nothing when the transition is skipped before it is ready", async () => {
    const restarts: number[] = [];
    const ready = deferred();
    const move = createPaneMove(
      transitioning({
        startViewTransition: (update) => {
          update();
          return { ready: ready.promise, finished: Promise.reject(new Error("skipped")) };
        },
        restart: () => restarts.push(1),
      }),
    );
    move("exit", () => {});
    ready.reject();
    await ticks();
    expect(restarts).toEqual([]);
  });

  // A second move skips the running transition, which settles the first one's `finished`
  // only after the second has tagged the root.
  test("a move that interrupts another keeps its own tag", async () => {
    const tags: (string | null)[] = [];
    const runs = [deferred(), deferred()];
    let n = 0;
    const move = createPaneMove(
      transitioning({
        startViewTransition: (update) => {
          update();
          return { finished: runs[n++]?.promise };
        },
        tag: (t) => tags.push(t),
      }),
    );
    move("exit", () => {});
    move("enter", () => {});
    runs[0]?.reject();
    await ticks();
    expect(tags).toEqual(["exit", "enter"]);
    runs[1]?.resolve();
    await ticks();
    expect(tags.at(-1)).toBeNull();
  });
});
