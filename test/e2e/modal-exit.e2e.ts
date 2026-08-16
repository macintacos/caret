// Modal exit presence (EXC-891). The host keeps a modal mounted while `open` is
// false so bits-ui can play its exit, then unmounts it once the exit reports done.
//
// It also carries the choreography those exits play (EXC-892): that panel and backdrop
// move as one gesture on the shared tokens, that leaving is quicker than arriving, and
// that reduced motion stills both without stranding either.
//
// This layer is e2e and cannot be anything else: happy-dom has no getAnimations,
// which is exactly what bits-ui's PresenceManager waits on — the hold this ticket
// introduces does not exist there at all, so a unit could only assert the gate's
// bookkeeping (modalPresence.test.ts already does). Whether a real exit runs, what it
// spends, and whether the surface actually leaves afterwards, is browser behavior.

import { alerts } from "@test/e2e/support/chrome.ts";
import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

const settingsDialog = "[data-slot='dialog-content']";
const settingsOverlay = "[data-slot='dialog-overlay']";
const guardContent = "[data-slot='alert-dialog-content']";
const guardOverlay = "[data-slot='alert-dialog-overlay']";

// The resolved animationName of the next animationend on the dialog content,
// parked on window so the listener is registered BEFORE the close intent fires.
type ExitWindow = { __exitAnimation: Promise<string> };

/** One animation that actually played: its keyframe name and its real active duration in
 * seconds, taken from the animationend rather than from a clock this test reads. */
type PlayedAnimation = { name: string; seconds: number };

/** The choreography samples (EXC-892), likewise parked on window so each is registered
 * before the intent that produces it. `__exits` holds the content's and the overlay's
 * departures; `__closing` holds their collapsed durations under reduced motion. */
type ChoreographyWindow = {
  __exits: Promise<PlayedAnimation[]>;
  __closing: Promise<number[]>;
};

/** One animation the hand-off recorder saw START (EXC-894). Ordering is the claim, so the
 * sample is taken at animationstart rather than at animationend — an exit that both begins
 * and ends before a slower arrival begins would satisfy an end-ordering trivially. `who`
 * is the surface's `data-slot`, or `arrival` for the curtain, which has no slot. */
type HandoffAnimation = { who: string; name: string; at: number; seconds: number };
type HandoffWindow = { __handoff: HandoffAnimation[] };

/** Record every animation that starts anywhere in the document, tagged by the surface it
 * ran on. Capture-phase on the document, so it sees the portalled modal surfaces (outside
 * #app) and the in-shell curtain alike, and installed BEFORE the intent — a hand-off whose
 * halves are 140ms and 220ms leaves no room to attach afterwards. */
async function recordHandoff(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    (window as unknown as HandoffWindow).__handoff = [];
    document.addEventListener(
      "animationstart",
      (e) => {
        const el = e.target as HTMLElement;
        if (!(el instanceof HTMLElement)) return;
        (window as unknown as HandoffWindow).__handoff.push({
          who: el.dataset.slot ?? (el.classList.contains("arrival") ? "arrival" : ""),
          name: (e as AnimationEvent).animationName,
          at: performance.now(),
          seconds: Number.parseFloat(getComputedStyle(el).animationDuration),
        });
      },
      true,
    );
  });
}

async function openSettings(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
}

/** Resolve once nothing is animating on the dialog content — the enter has
 * finished. Not a sleep: it reads the same getAnimations the presence layer does,
 * so a listener registered after it cannot catch the enter's tail. */
async function waitForEnterToSettle(page: import("@playwright/test").Page) {
  await page.waitForFunction(
    (sel) => (document.querySelector(sel)?.getAnimations().length ?? 1) === 0,
    settingsDialog,
  );
}

test("closing a modal plays its exit before the surface leaves the DOM", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  await openSettings(page);
  await waitForEnterToSettle(page);

  // Register before the close intent: the exit is over in --dur-exit (140ms), so a
  // listener attached after Escape would race the very event it is waiting on. Only a
  // self-targeted event counts — animationend BUBBLES, and a descendant inside
  // Settings (the theme pane's IN USE marker) animates on its own schedule, so an
  // unfiltered listener resolves with whichever fired first.
  await page.evaluate((sel) => {
    const content = document.querySelector(sel);
    (window as unknown as ExitWindow).__exitAnimation = new Promise<string>((resolve) => {
      content?.addEventListener("animationend", (e) => {
        if (e.target === content) resolve((e as AnimationEvent).animationName);
      });
    });
  }, settingsDialog);

  await page.keyboard.press("Escape");

  // tw-animate-css's --animate-out keyframe. Before this ticket the dialog's
  // animation classes keyed on an attribute bits-ui never sets, so nothing ran.
  const played = await page.evaluate(() => (window as unknown as ExitWindow).__exitAnimation);
  expect(played).toBe("exit");

  // …and the surface still leaves. A hold that never released would be worse than
  // no animation at all.
  await expect(page.locator(settingsDialog)).toHaveCount(0);
});

test("re-opening a modal mounts it fresh", async ({ daemon, page }) => {
  // Asserted through LOCAL component state, not DOM presence: bits-ui removes the
  // content node on its own, so a count assertion would pass with or without the
  // gate. A surface the gate failed to renew would re-open carrying the previous
  // session's search query. Two mechanisms deliver this — the unmount on a
  // completed close, and the {#key} remount per open — and either alone suffices
  // here; the {#key}'s own case (re-opening mid-exit, where the unmount never
  // happens) is pinned in modalPresence.test.ts.
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  await openSettings(page);
  const search = page.getByPlaceholder("Search settings…");
  await search.fill("theme");
  await expect(search).toHaveValue("theme");

  // Dismiss by backdrop, not Escape: Escape in the search clears the query first
  // (settings.e2e.ts), which would hide exactly the state under test.
  await page.mouse.click(5, 5);
  await expect(page.locator(settingsDialog)).toHaveCount(0);

  await openSettings(page);
  await expect(page.getByPlaceholder("Search settings…")).toHaveValue("");
});

test("a confirm guard unmounts too — the alertdialog branch of the shell", async ({
  daemon,
  page,
}) => {
  // Modal selects a different bits-ui primitive per `kind`, and every other case
  // here drives the Dialog half. This covers the alertdialog half closing cleanly
  // under the gate — the guards are the sites where `active` can go null mid-exit.
  const id = await daemon.seed();
  await daemon.putDraft(id, {
    annotations: [{ id: "ann-1", startLine: 7, endLine: 8, comment: "explain cold cost" }],
  });
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-slot='alert-dialog-content']")).toHaveCount(0);
});

test("the backdrop moves with the panel, and both leave quicker than they arrived", async ({
  daemon,
  page,
}) => {
  // The choreography (EXC-892) asserted on the real thing rather than read back out of the
  // stylesheet that declares it. Three claims, none of which survives a unit — happy-dom
  // runs no animations at all:
  //   1. Both arms really ride the tokens, not tw-animate-css's .15s fallback.
  //   2. Overlay and content are ONE gesture — same keyframe, same duration — so the
  //      backdrop deepens with the panel instead of on a clock of its own.
  //   3. Leaving is quicker than arriving, which is what the --dur-enter/--dur-exit pair
  //      EXC-890 tiered exists to buy.
  //
  // Claim 1 is why the token values are read off :root and compared rather than the
  // durations merely being ordered: --dur-exit (140ms) is BELOW the .15s fallback, so an
  // open arm that silently stopped applying would still satisfy claims 2 and 3 on its own.
  //
  // Driven on the alertdialog GUARD; the Dialog branch is covered by the exit test above
  // plus the shared arms motion.test.ts pins. The guard is the branch where a backdrop on
  // its own clock is expressible at all — its overlay is the surface stock ships with no
  // duration of its own.
  const id = await daemon.seed();
  await daemon.putDraft(id, {
    annotations: [{ id: "ann-1", startLine: 7, endLine: 8, comment: "explain cold cost" }],
  });
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();

  // The enter is read off the COMPUTED style rather than off a running animation: the
  // surface stays data-state="open" for as long as it is open, so there is no window to
  // race. parseFloat over animationDuration is serialization-agnostic (a browser may emit
  // "0.22s" or a scientific form) and the unit is seconds either way.
  const entering = await page.evaluate(
    (sels) =>
      sels.map((sel) => {
        const style = getComputedStyle(document.querySelector(sel) as Element);
        return { name: style.animationName, seconds: Number.parseFloat(style.animationDuration) };
      }),
    [guardContent, guardOverlay],
  );
  // The tokens themselves, off :root — no mirrored constant, so a retune moves both sides
  // of the comparison together and only a surface falling OFF the vocabulary reds. Read
  // unit-agnostically: tokens.css authors these in ms, and the build's minifier is free to
  // emit either `220ms` or `.22s` for the same value.
  const tokens = await page.evaluate(() => {
    const seconds = (v: string): number =>
      v.trim().endsWith("ms") ? Number.parseFloat(v) / 1000 : Number.parseFloat(v);
    const root = getComputedStyle(document.documentElement);
    return {
      enter: seconds(root.getPropertyValue("--dur-enter")),
      exit: seconds(root.getPropertyValue("--dur-exit")),
    };
  });
  expect(entering.map((a) => a.name)).toEqual(["enter", "enter"]);
  expect(entering[0]?.seconds).toBe(tokens.enter);
  expect(entering[0]?.seconds).toBe(entering[1]?.seconds);

  // Both enters must be over before the exit listeners go on, or the enter's own
  // animationend resolves them. Same getAnimations the presence layer reads.
  await page.waitForFunction(
    (sels) => sels.every((s) => (document.querySelector(s)?.getAnimations().length ?? 1) === 0),
    [guardContent, guardOverlay],
  );

  // elapsedTime at animationend IS the animation's active duration, which is what makes
  // the exit measurable rather than merely observable — nothing here samples a clock.
  // Self-targeted only: animationend bubbles, and descendants inside Settings animate on
  // their own schedule.
  await page.evaluate(
    (sels) => {
      (window as unknown as ChoreographyWindow).__exits = Promise.all(
        sels.map(
          (sel) =>
            new Promise<PlayedAnimation>((resolve) => {
              const el = document.querySelector(sel);
              el?.addEventListener("animationend", (e) => {
                if (e.target !== el) return;
                const played = e as AnimationEvent;
                resolve({ name: played.animationName, seconds: played.elapsedTime });
              });
            }),
        ),
      );
    },
    [guardContent, guardOverlay],
  );

  await page.keyboard.press("Escape");

  const leaving = await page.evaluate(() => (window as unknown as ChoreographyWindow).__exits);
  expect(leaving.map((a) => a.name)).toEqual(["exit", "exit"]);
  expect(leaving[0]?.seconds).toBeCloseTo(tokens.exit, 3);
  expect(leaving[0]?.seconds).toBe(leaving[1]?.seconds);
  expect(leaving[0]?.seconds).toBeLessThan(entering[0]?.seconds ?? 0);
  await expect(page.locator(guardContent)).toHaveCount(0);
});

test("a modal neither moves nor sticks under reduced motion", async ({ daemon, page }) => {
  // Two failures in one scenario. The serious one: an animation the preference collapses
  // to a single frame whose completion never resolves would strand the surface in the DOM
  // forever, and the count assertion times out rather than passing. The visible one: the
  // global guard in base.css reaches these surfaces only through its [data-slot] anchor —
  // they are portalled to document.body, outside #app — so a modal that opts into caret's
  // timing must not out-specify the guard and fade in anyway. Sampled in BOTH directions,
  // since the two arms are separate rules.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  await openSettings(page);
  const opening = await page.evaluate(
    (sels) =>
      sels.map((sel) => {
        const d = getComputedStyle(document.querySelector(sel) as Element).animationDuration;
        return d.endsWith("ms") ? Number.parseFloat(d) : Number.parseFloat(d) * 1000;
      }),
    [settingsDialog, settingsOverlay],
  );
  for (const ms of opening) expect(ms).toBeLessThan(1);

  // The closing arm is a second rule, and the surface wears it only during the exit —
  // which under this preference is over within a frame. Observe the state flip rather
  // than chase it: getComputedStyle resolves against the attribute the observer just saw
  // change, so the sample sees the closed arm while the node is still mounted.
  await page.evaluate(
    (sels) => {
      (window as unknown as ChoreographyWindow).__closing = new Promise<number[]>((resolve) => {
        const content = document.querySelector(sels[0] as string) as Element;
        const observer = new MutationObserver(() => {
          if (content.getAttribute("data-state") !== "closed") return;
          observer.disconnect();
          resolve(
            sels.map((sel) => {
              const d = getComputedStyle(document.querySelector(sel) as Element).animationDuration;
              return d.endsWith("ms") ? Number.parseFloat(d) : Number.parseFloat(d) * 1000;
            }),
          );
        });
        observer.observe(content, { attributes: true, attributeFilter: ["data-state"] });
      });
    },
    [settingsDialog, settingsOverlay],
  );

  await page.keyboard.press("Escape");
  const closing = await page.evaluate(() => (window as unknown as ChoreographyWindow).__closing);
  for (const ms of closing) expect(ms).toBeLessThan(1);
  await expect(page.locator(settingsDialog)).toHaveCount(0);
});

test("a decided guard's exit leads the arrival that uncovers the next state", async ({
  daemon,
  page,
}) => {
  // The hand-off as a SEQUENCE (EXC-894), which is the half neither a stylesheet read nor
  // a screenshot can carry: the guard leaving and the next state arriving are two
  // animations on two different elements, and what this ticket is about is their
  // relationship. Both claims are ordering claims, so both are sampled at animationstart.
  await daemon.seed();
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  await page.getByRole("button", { name: "Reject", exact: true }).click();
  const guard = page.getByRole("alertdialog");
  await expect(guard).toBeVisible();
  // Let the guard's own arrival finish first, so the recorder cannot mistake the enter it
  // is still playing for part of the hand-off that has not started yet.
  await page.waitForFunction(
    (sels) => sels.every((s) => (document.querySelector(s)?.getAnimations().length ?? 1) === 0),
    [guardContent, guardOverlay],
  );

  await recordHandoff(page);
  await guard.getByRole("button", { name: "Reject", exact: true }).click();

  // The curtain is the last of the hand-off's parts to start — it waits on a real HTTP
  // round trip — so waiting for it is waiting for the whole gesture.
  await page.waitForFunction(() =>
    (window as unknown as HandoffWindow).__handoff.some((a) => a.who === "arrival"),
  );
  const played = await page.evaluate(() => (window as unknown as HandoffWindow).__handoff);
  const exit = played.find((a) => a.who === "alert-dialog-content" && a.name === "exit");
  const arrival = played.find((a) => a.who === "arrival");
  expect(exit).toBeDefined();
  expect(arrival).toBeDefined();

  // The exit LEADS. The guard's flag clears in the same tick the resolve fires, so its
  // departure is already running while the arrival is still waiting on the daemon.
  expect(exit?.at ?? 0).toBeLessThanOrEqual(arrival?.at ?? 0);
  // …and it is the SHORTER of the two, so it has cleared before the arrival settles. That
  // pair of facts is the whole of "deliberately timed against each other" — a relationship
  // drawn from the --dur-exit/--dur-enter tiers rather than a number this hand-off minted.
  expect(exit?.seconds ?? 0).toBeLessThan(arrival?.seconds ?? 0);

  // The curtain COVERS the content row rather than taking one. It is out of flow for a
  // reason the shell's shape makes non-obvious: DiffPlanView renders two AUTO-PLACED
  // siblings, so an in-flow curtain claiming row 3 is placed first and displaces one of
  // them into an implicit fifth row — leaving the status bar above the plan. Counting the
  // tracks states that directly: pinned-chrome.e2e.ts catches the consequence, this names
  // the cause, and it belongs here because the curtain is the thing that would break it.
  const rows = await page.evaluate(
    () => getComputedStyle(document.querySelector(".shell") as Element).gridTemplateRows,
  );
  expect(rows.split(/\s+/)).toHaveLength(4);
});

test("diverting from a guard to the dialog acknowledges nothing and uncovers nothing", async ({
  daemon,
  page,
}) => {
  // The guard-to-dialog swap wears the SAME choreography as any other modal pair — since
  // EXC-892 both surfaces take the bridge's two arms — but it is not a decision, and this
  // is the assertion that keeps it from becoming one. Nothing resolved, so there is
  // nothing to confirm; `active` never changed, so there is nothing to uncover. Written as
  // a guard against this ticket's own change leaking one step further than it should.
  const id = await daemon.seed();
  await daemon.putDraft(id, {
    annotations: [{ id: "ann-1", startLine: 7, endLine: 8, comment: "explain cold cost" }],
  });
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  await page.getByRole("button", { name: "Reject", exact: true }).click();
  const guard = page.getByRole("alertdialog");
  await expect(guard).toBeVisible();

  await recordHandoff(page);
  await guard.getByRole("button", { name: "Request changes" }).click();

  // The swap itself lands: one modal for another, the plan untouched behind both.
  await expect(page.getByRole("dialog", { name: "Send the plan back for revision" })).toBeVisible();
  await expect(guard).toHaveCount(0);
  // Neither half of the hand-off fires.
  await expect(alerts(page)).toHaveCount(0);
  const played = await page.evaluate(() => (window as unknown as HandoffWindow).__handoff);
  expect(played.filter((a) => a.who === "arrival")).toEqual([]);
  // And the review is still pending, which is what makes the two silences correct rather
  // than merely observed.
  await expect.poll(async () => (await daemon.listReviews()).map((r) => r.id)).toContain(id);
});
