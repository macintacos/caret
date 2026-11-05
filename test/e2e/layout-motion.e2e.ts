// The plan's layout moves. The outline column folding and standing, and a file docking
// beside the plan or leaving it, run on the live elements (ui/src/lib/layoutSlide.ts): the
// layout changes at once and each part slides home on a CSS transform transition, read
// here off `transitionrun` as each starts. Compare swaps the plan and its header's controls
// as one view transition (ui/src/lib/paneMove.ts), its parts named by their components and
// timed in styles/base.css, read off `document.getAnimations()` as it becomes ready.
// Whether a compare move runs as a transition at all is the unit suite's
// (ui/src/lib/paneMove.test.ts).
//
// The outline's own motion — the filter dropping in, the compare float's stamps — is
// read off the computed style, which holds the animation's name and timing after it ends.

import type { Page } from "@playwright/test";

import { fileRefCount, makeProject, settleDrawer } from "@test/e2e/support/file-refs.ts";
import { expect, motionToken, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

const PLAN = [
  "# Plan",
  "## Alpha",
  "Alpha text.",
  "## Bravo",
  "Bravo text.",
  "## Charlie",
  "Charlie text.",
  "",
].join("\n\n");
const REVISED = PLAN.replace("Bravo text.", "Bravo text, revised.");
const FILE_PLAN = "# Refs\n\n## Cache\n\nThe cache lives in `src/cache.ts`.\n";

interface Slide {
  part: string;
  duration: number;
  frame: number;
}

/** Log each transform transition that starts on a part of the layout, with its duration
 * and the frame it started in. */
async function armSlideLog(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __slides: Slide[] };
    w.__slides = [];
    const parts: [string, string][] = [
      ["column key", ".plan-outline .toc-title-row .header-tray"],
      ["column", ".plan-outline"],
      ["pane", ".plan-pane"],
      ["floor", ".pane-floor"],
      ["plan", ".diff-plan"],
      ["crumbs", ".plan-breadcrumbs"],
      ["drawer", "[data-file-drawer]"],
    ];
    window.addEventListener(
      "transitionrun",
      (e) => {
        const target = e.target as Element;
        const part = parts.find(([, selector]) => target.matches(selector))?.[0];
        if (e.propertyName !== "transform" || part === undefined) return;
        const transition = target
          .getAnimations()
          .find((a) => a instanceof CSSTransition && a.transitionProperty === "transform");
        w.__slides.push({
          part,
          duration: Number(transition?.effect?.getTiming().duration),
          frame: Number(document.timeline.currentTime),
        });
      },
      { capture: true },
    );
  });
}

/** The logged slides, once every part in `parts` has started one, emptying the log. */
async function slidesOf(page: Page, parts: string[]): Promise<Record<string, Slide>> {
  const read = () =>
    page.evaluate(() => (window as unknown as { __slides: Slide[] }).__slides.map((s) => s.part));
  await expect.poll(read).toEqual(expect.arrayContaining(parts));
  return page.evaluate(() => {
    const w = window as unknown as { __slides: Slide[] };
    const log = Object.fromEntries(w.__slides.map((s) => [s.part, s]));
    w.__slides = [];
    return log;
  });
}

/** Whether every slide started in one frame. */
const together = (slides: Record<string, Slide>): boolean =>
  new Set(Object.values(slides).map((s) => s.frame)).size === 1;

interface Move {
  tag: string;
  parts: { pseudo: string; duration: number }[];
}

/** Log each layout move's root tag and the duration of every animation on its parts, read
 * as its transition becomes ready. Other transitions, the plan's arrival among them, carry
 * no tag and are left out. */
async function armMoveLog(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __moves: Move[] };
    w.__moves = [];
    const proto = Document.prototype as unknown as {
      startViewTransition?: (update: () => void) => { ready: Promise<unknown> };
    };
    const start = proto.startViewTransition;
    if (start === undefined) return;
    proto.startViewTransition = function (this: Document, update: () => void) {
      const tag = document.documentElement.dataset.paneMove;
      const transition = start.call(this, update);
      if (tag === undefined) return transition;
      transition.ready.then(
        () =>
          w.__moves.push({
            tag,
            parts: document.getAnimations().flatMap((a) => {
              const effect = a.effect;
              return effect instanceof KeyframeEffect &&
                effect.pseudoElement?.startsWith("::view-transition")
                ? [{ pseudo: effect.pseudoElement, duration: Number(effect.getTiming().duration) }]
                : [];
            }),
          }),
        () => {},
      );
      return transition;
    };
  });
}

/** The nth logged move, once the transition has become ready. */
async function move(page: Page, n: number): Promise<Move> {
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __moves: Move[] }).__moves.length))
    .toBeGreaterThan(n);
  return page.evaluate((i) => (window as unknown as { __moves: Move[] }).__moves[i] as Move, n);
}

/** The duration of the animation on `pseudo`, in ms, or undefined when the move has none. */
const took = (m: Move, pseudo: string): number | undefined =>
  m.parts.find((p) => p.pseudo === pseudo)?.duration;

async function tokens(page: Page): Promise<{ state: number; pane: number }> {
  return {
    state: (await motionToken(page, "--dur-state")) * 1000,
    pane: (await motionToken(page, "--dur-pane")) * 1000,
  };
}

const outlineKey = (page: Page) =>
  page.locator(".plan-header").getByRole("button", { name: "Outline", exact: true });
const hideKey = (page: Page) =>
  page.locator(".plan-outline").getByRole("button", { name: "Outline", exact: true });
const versions = (page: Page) => page.getByRole("button", { name: /^Versions/ });

async function open(page: Page): Promise<void> {
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);
}

/** Resolve once no part of the layout is sliding and no column is folding away. */
async function layoutStill(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      document.querySelector(".plan-outline.leaving") === null &&
      !document
        .querySelector(".plan-body")
        ?.getAnimations({ subtree: true })
        .some((a) => a instanceof CSSTransition),
  );
}

test("the outline column folds on --dur-state and stands on --dur-pane, the plan sliding with it", async ({
  daemon,
  page,
}) => {
  await armSlideLog(page);
  await armMoveLog(page);
  await daemon.seed({ plan: PLAN });
  await open(page);
  const { state, pane } = await tokens(page);

  await page.keyboard.press("Shift+Backslash");
  await expect(outlineKey(page)).toBeVisible();
  const fold = await slidesOf(page, ["column", "column key", "floor", "plan", "crumbs"]);
  for (const part of ["column", "column key", "floor", "plan", "crumbs"]) {
    expect(fold[part]?.duration, part).toBe(state);
  }
  expect(together(fold)).toBe(true);
  await expect(page.locator(".plan-outline")).toHaveCount(0);

  await page.keyboard.press("Shift+Backslash");
  await expect(hideKey(page)).toBeVisible();
  const stand = await slidesOf(page, ["column", "column key", "floor", "plan", "crumbs"]);
  for (const part of ["column", "column key", "floor", "plan", "crumbs"]) {
    expect(stand[part]?.duration, part).toBe(pane);
  }
  expect(together(stand)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __moves: Move[] }).__moves)).toEqual([]);
});

test("the outline key latches as it travels into the column, and lets go as it travels back", async ({
  daemon,
  page,
}) => {
  await armSlideLog(page);
  // Each move the column's key makes into or out of its latch, with its timing and frame.
  await page.addInitScript(() => {
    const w = window as unknown as { __latches: (Slide & { easing: string })[] };
    w.__latches = [];
    window.addEventListener(
      "transitionrun",
      (e) => {
        const key = e.target as Element;
        if (e.propertyName !== "translate" || !key.matches(".plan-outline .header-tray > button"))
          return;
        const timing = key
          .getAnimations()
          .find((a) => a instanceof CSSTransition && a.transitionProperty === "translate")
          ?.effect?.getTiming();
        w.__latches.push({
          part: key.getAttribute("aria-pressed") === "true" ? "latch" : "release",
          duration: Number(timing?.duration),
          easing: String(timing?.easing),
          frame: Number(document.timeline.currentTime),
        });
      },
      { capture: true },
    );
  });
  const latches = async () => {
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __latches: unknown[] }).__latches.length),
      )
      .toBe(1);
    return page.evaluate(() => {
      const w = window as unknown as { __latches: (Slide & { easing: string })[] };
      return w.__latches.splice(0)[0] as Slide & { easing: string };
    });
  };
  await daemon.seed({ plan: PLAN });
  await open(page);
  const { state, pane } = await tokens(page);
  const easeOut = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.setProperty("transition-timing-function", "var(--ease-out)");
    document.body.append(probe);
    const value = getComputedStyle(probe).transitionTimingFunction;
    probe.remove();
    return value;
  });
  await expect(hideKey(page)).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Shift+Backslash");
  const fold = await slidesOf(page, ["column key"]);
  const release = await latches();
  expect(release).toMatchObject({ part: "release", duration: state, easing: easeOut });
  expect(release.frame).toBe(fold["column key"]?.frame);
  await layoutStill(page);
  await expect(outlineKey(page)).toHaveAttribute("aria-pressed", "false");

  await page.keyboard.press("Shift+Backslash");
  const stand = await slidesOf(page, ["column key"]);
  const latch = await latches();
  expect(latch).toMatchObject({ part: "latch", duration: pane, easing: easeOut });
  expect(latch.frame).toBe(stand["column key"]?.frame);
  await expect(hideKey(page)).toHaveAttribute("aria-pressed", "true");
});

/** Sample, each frame from now on, how far the outline key, the header's or the column's,
 * sits down in its well. */
async function sampleKeySinks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __sinks: number[]; __sampling: boolean };
    w.__sinks = [];
    w.__sampling = true;
    const sample = () => {
      const key =
        document.querySelector(".plan-outline .header-tray > button") ??
        document.querySelector(".plan-header .header-tray > button");
      if (key?.parentElement)
        w.__sinks.push(
          key.getBoundingClientRect().top - key.parentElement.getBoundingClientRect().top,
        );
      if (w.__sampling) requestAnimationFrame(sample);
    };
    sample();
  });
}

/** Stop sampling, and return the sinks sampled since `sampleKeySinks`. */
function sampledKeySinks(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __sinks: number[]; __sampling: boolean };
    w.__sampling = false;
    return w.__sinks;
  });
}

test("a column stood by pressing the header's key brings its key in held down", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await open(page);
  await page.keyboard.press("Shift+Backslash");
  await layoutStill(page);
  const box = await outlineKey(page).boundingBox();
  if (box === null) throw new Error("the header's outline key is not rendered");

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await outlineKey(page).evaluate((key) =>
    Promise.all(key.getAnimations().map((animation) => animation.finished)),
  );
  await sampleKeySinks(page);
  await page.mouse.up();
  await expect(hideKey(page)).toHaveAttribute("aria-pressed", "true");
  await layoutStill(page);
  const sinks = await sampledKeySinks(page);

  const [pressed = 0] = sinks;
  expect(Math.min(...sinks)).toBeGreaterThan(pressed - 0.1);
});

test("a column stood by Space on the header's key brings its key in held down", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await open(page);
  await page.keyboard.press("Shift+Backslash");
  await layoutStill(page);

  await outlineKey(page).focus();
  await page.keyboard.down("Space");
  await outlineKey(page).evaluate((key) =>
    Promise.all(key.getAnimations().map((animation) => animation.finished)),
  );
  await sampleKeySinks(page);
  await page.keyboard.up("Space");
  await expect(hideKey(page)).toHaveAttribute("aria-pressed", "true");
  await layoutStill(page);
  const sinks = await sampledKeySinks(page);

  const [pressed = 0] = sinks;
  expect(Math.min(...sinks)).toBeGreaterThan(pressed - 0.1);
});

test("Versions and the Search entry hold their place while the outline folds and stands", async ({
  daemon,
  page,
}) => {
  await daemon.seedVersions(2, [PLAN, REVISED]);
  await open(page);
  await expect(page.locator(".search-entry")).toBeVisible();

  for (const settled of [outlineKey, hideKey]) {
    await layoutStill(page);
    // Where Versions and the entry stand each frame, and whether anything slid meanwhile.
    await versions(page).evaluate((el) => {
      const w = window as unknown as { __xs: number[][]; __slid: boolean; __sampling: boolean };
      const entry = document.querySelector(".search-entry");
      w.__xs = [];
      w.__slid = false;
      w.__sampling = true;
      const sample = () => {
        w.__xs.push([
          el.getBoundingClientRect().left,
          entry?.getBoundingClientRect().left ?? Number.NaN,
        ]);
        w.__slid ||= document.getAnimations().some((a) => a instanceof CSSTransition);
        if (w.__sampling) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.keyboard.press("Shift+Backslash");
    await expect(settled(page)).toBeVisible();
    await layoutStill(page);
    const { xs, slid } = await page.evaluate(() => {
      const w = window as unknown as { __xs: number[][]; __slid: boolean; __sampling: boolean };
      w.__sampling = false;
      return { xs: w.__xs, slid: w.__slid };
    });
    expect(slid).toBe(true);
    for (const [i, part] of ["Versions", "the Search entry"].entries()) {
      const at = xs.map((x) => x[i] ?? Number.NaN);
      expect(Math.max(...at) - Math.min(...at), part).toBeLessThan(0.5);
    }
  }
});

test("a click lands on the plan's header while the outline slides", async ({ daemon, page }) => {
  await daemon.seedVersions(2, [PLAN, REVISED]);
  await open(page);

  // In the first frame from 60ms after the key, mid-slide, what sits at Versions' centre is
  // Versions, and clicking it there turns compare on. The click goes to what that frame
  // hit-tests: a real one would arrive frames later on a loaded host.
  type Aim = { hit: boolean; moving: boolean };
  await versions(page).evaluate((el) => {
    (window as unknown as { __aim: Promise<Aim> }).__aim = new Promise<Aim>((resolve) => {
      let key = 0;
      const look = (now: number) => {
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        if (now - key < 60) {
          requestAnimationFrame(look);
          return;
        }
        const found = document.elementFromPoint(x, r.top + r.height / 2);
        const aim = {
          hit: el.contains(found),
          moving: document.getAnimations().some((a) => a instanceof CSSTransition),
        };
        if (found instanceof HTMLElement) found.click();
        resolve(aim);
      };
      const aimAfterKey = (e: KeyboardEvent) => {
        if (e.code !== "Backslash") return;
        removeEventListener("keydown", aimAfterKey, { capture: true });
        key = e.timeStamp;
        requestAnimationFrame(look);
      };
      addEventListener("keydown", aimAfterKey, { capture: true });
    });
  });
  await page.keyboard.press("Shift+Backslash");
  const aim = await page.evaluate(() => (window as unknown as { __aim: Promise<Aim> }).__aim);
  expect(aim.moving).toBe(true);
  expect(aim.hit).toBe(true);
  await expect(page.locator(".plan-header .pair")).toBeVisible();
});

test("Shift+\\ pressed twice reverses the column mid-flight, never shutting it", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: PLAN });
  await open(page);
  await expect(hideKey(page)).toBeVisible();
  await layoutStill(page);
  // The column's right edge each frame, or -1 for a frame it is not in the page, and whether
  // it was mid-fold as each \ went down. The page presses the second \ itself, on the first
  // frame the folding column has moved, so it lands mid-fold however loaded the host is.
  await page.evaluate(() => {
    const w = window as unknown as {
      __edges: number[];
      __midFold: boolean[];
      __sampling: boolean;
      __pressed: boolean;
    };
    w.__edges = [];
    w.__midFold = [];
    w.__sampling = true;
    w.__pressed = false;
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.code === "Backslash")
          w.__midFold.push(document.querySelector(".plan-outline.leaving") !== null);
      },
      { capture: true },
    );
    const sample = () => {
      const right = document.querySelector(".plan-outline")?.getBoundingClientRect().right ?? -1;
      w.__edges.push(right);
      const folding = document.querySelector(".plan-outline.leaving") !== null;
      if (!w.__pressed && folding && right < (w.__edges[0] ?? 0) - 1) {
        w.__pressed = true;
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "|",
            code: "Backslash",
            shiftKey: true,
            bubbles: true,
          }),
        );
      }
      if (w.__sampling) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  await page.keyboard.press("Shift+Backslash");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __pressed: boolean }).__pressed))
    .toBe(true);
  await expect(hideKey(page)).toBeVisible();
  await layoutStill(page);
  const { edges, midFold } = await page.evaluate(() => {
    const w = window as unknown as {
      __edges: number[];
      __midFold: boolean[];
      __sampling: boolean;
    };
    w.__sampling = false;
    return { edges: w.__edges, midFold: w.__midFold };
  });
  expect(midFold, "the second press came mid-fold").toEqual([false, true]);
  expect(Math.min(...edges)).toBeGreaterThan(0);
  expect(edges.at(-1)).toBe(edges[0]);
});

test("the Search entry keeps its place beside Versions as the outline folds while a file closes", async ({
  daemon,
  page,
}) => {
  const proj = await makeProject({ "src/cache.ts": "export const cache = new Map();\n" });
  try {
    await daemon.seedVersions(2, [FILE_PLAN, FILE_PLAN.replace("lives", "now lives")], proj.dir);
    await open(page);
    await expect.poll(() => fileRefCount(page)).toBe(1);
    await page.locator("[data-file-ref]").first().click();
    await expect(page.locator("[data-file-preview]")).toBeVisible();
    await settleDrawer(page);
    await layoutStill(page);

    // The outline folds 80ms after the click that closes the file. Each frame: how far
    // Versions stands from the entry.
    await versions(page).evaluate((versions) => {
      const w = window as unknown as { __gaps: number[]; __midSlide: boolean; __sampling: boolean };
      const entry = document.querySelector(".search-entry") as HTMLElement;
      w.__gaps = [];
      w.__sampling = true;
      const sample = () => {
        w.__gaps.push(versions.getBoundingClientRect().left - entry.getBoundingClientRect().left);
        if (w.__sampling) requestAnimationFrame(sample);
      };
      const fold = () => {
        w.__midSlide =
          (document.querySelector(".plan-pane") as HTMLElement).getAnimations().length > 0;
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "|",
            code: "Backslash",
            shiftKey: true,
            bubbles: true,
          }),
        );
      };
      const afterClick = () => {
        removeEventListener("click", afterClick, { capture: true });
        setTimeout(fold, 80);
      };
      addEventListener("click", afterClick, { capture: true });
      requestAnimationFrame(sample);
    });
    await page.getByRole("button", { name: "Close preview" }).click();
    await expect(page.locator("[data-file-drawer]")).toHaveCount(0);
    await expect(outlineKey(page)).toBeVisible();
    await layoutStill(page);
    const { gaps, midSlide } = await page.evaluate(() => {
      const w = window as unknown as { __gaps: number[]; __midSlide: boolean; __sampling: boolean };
      w.__sampling = false;
      return { gaps: w.__gaps, midSlide: w.__midSlide };
    });

    expect(midSlide, "the outline folded while the plan slid").toBe(true);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.5);
  } finally {
    await proj.cleanup();
  }
});

test("compare swaps the header's controls on --dur-state, Versions sliding into Preview's place once it is clear", async ({
  daemon,
  page,
}) => {
  await armMoveLog(page);
  await daemon.seedVersions(2, [PLAN, REVISED]);
  await open(page);
  const { state, pane } = await tokens(page);

  await page.keyboard.press("d");
  await expect(page.locator(".plan-header .pair")).toBeVisible();
  const into = await move(page, 0);
  expect(into.tag).toBe("exit");
  for (const pseudo of [
    "::view-transition-old(preview-key)",
    "::view-transition-old(plan-crumbs)",
    "::view-transition-new(compare-controls)",
    "::view-transition-old(plan-outline)",
    "::view-transition-group(plan-pane)",
  ]) {
    expect(took(into, pseudo), pseudo).toBe(state);
  }
  // Versions waits out the first 40% for Preview to go, and slides in the rest.
  expect(took(into, "::view-transition-group(versions-key)")).toBeCloseTo(state * 0.6, 3);

  await page.keyboard.press("d");
  await expect(page.locator(".plan-header .pair")).toHaveCount(0);
  const out = await move(page, 1);
  expect(out.tag).toBe("enter");
  for (const pseudo of [
    "::view-transition-new(preview-key)",
    "::view-transition-new(plan-crumbs)",
    "::view-transition-old(compare-controls)",
  ]) {
    expect(took(out, pseudo), pseudo).toBe(state);
  }
  expect(took(out, "::view-transition-group(versions-key)")).toBeCloseTo(state * 0.6, 3);
  // The column waits out the plan's old image, and arrives with the plan.
  expect(took(out, "::view-transition-new(plan-outline)")).toBeCloseTo(pane - state * 0.4, 3);
  expect(took(out, "::view-transition-group(plan-pane)")).toBe(pane);
});

test("focus holds through compare: on Versions when it is pressed, and on Versions as the column folds", async ({
  daemon,
  page,
}) => {
  await daemon.seedVersions(2, [PLAN, REVISED]);
  await open(page);

  await versions(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".plan-header .pair")).toBeVisible();
  await expect(versions(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".plan-header .pair")).toHaveCount(0);
  await expect(versions(page)).toBeFocused();

  // Compare has no outline, so focus on the column's outline key moves to Versions as the
  // column folds.
  await hideKey(page).focus();
  await page.keyboard.press("d");
  await expect(versions(page)).toBeFocused();
});

test.describe("under reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the layout moves at once, with no transition", async ({ daemon, page }) => {
    await armSlideLog(page);
    await armMoveLog(page);
    await daemon.seedVersions(2, [PLAN, REVISED]);
    await open(page);

    await page.keyboard.press("Shift+Backslash");
    await expect(outlineKey(page)).toBeVisible();
    await page.keyboard.press("Shift+Backslash");
    await expect(hideKey(page)).toBeVisible();
    await page.keyboard.press("d");
    await expect(page.locator(".plan-header .pair")).toBeVisible();
    await page.keyboard.press("d");
    await expect(page.locator(".plan-header .pair")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __moves: Move[] }).__moves)).toEqual(
      [],
    );
    const slid = await page.evaluate(() =>
      (window as unknown as { __slides: Slide[] }).__slides.filter((s) => s.duration > 1),
    );
    expect(slid).toEqual([]);
  });
});
