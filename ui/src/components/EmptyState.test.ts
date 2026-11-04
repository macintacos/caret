import "@ui/support/mount.ts";
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";

import { flushUntil, render } from "@ui/support/mount.ts";
import EmptyState from "@/components/EmptyState.svelte";
import { CARROT_FACTS, type CarrotFact } from "$lib/carrotFacts.ts";
import {
  createShortcutDispatcher,
  type ShortcutDispatcher,
  shortcuts,
} from "$lib/shortcuts/index.ts";
import { sound } from "$lib/sound.ts";

/** A fact source that counts its draws, so a test sees how many facts a turn spent. */
function countedFacts(): { facts: { next: () => CarrotFact }; drawn: () => number } {
  let drawn = 0;
  return {
    facts: { next: () => CARROT_FACTS[drawn++ % CARROT_FACTS.length] as CarrotFact },
    drawn: () => drawn,
  };
}

const keyOf = (target: HTMLElement) =>
  target.querySelector<HTMLButtonElement>('button[aria-label="Next carrot fact"]');

describe("EmptyState", () => {
  test("disconnected: says the daemon is not connected", () => {
    const { target } = render(EmptyState, { connected: false });
    expect(target.querySelector(".body")!.textContent).toContain(
      "Not connected to the caret daemon",
    );
  });

  // The stamp is a live region, so a screen reader hears the swap the LED shows.
  test("the status stamp reads listening while connected and offline while not", () => {
    for (const [connected, word] of [
      [true, "listening"],
      [false, "offline"],
    ] as const) {
      const { target } = render(EmptyState, { connected });
      const stamp = target.querySelector('[role="status"]');
      expect(stamp).not.toBeNull();
      expect(stamp!.textContent!.trim()).toBe(word);
      expect(stamp!.querySelector(".led")).not.toBeNull();
    }
  });

  // The stamp shares the badge numeric vocabulary by carrying the shared .metric atom,
  // the same source VersionBadge and the status strip draw their mono from. The harness
  // loads no stylesheet, so the runtime class, not a resolved font value, is the
  // falsifiable fact.
  test("the status stamp carries the .metric atom (badge numeric vocabulary)", () => {
    for (const connected of [true, false]) {
      const { target } = render(EmptyState, { connected });
      expect(target.querySelector('[role="status"]')!.classList.contains("metric")).toBe(true);
    }
  });

  test("the ^ stands as a key that names what it does", () => {
    const { target } = render(EmptyState, { connected: true });
    const key = keyOf(target);
    expect(key).not.toBeNull();
    expect(key!.textContent).toContain("^");
    expect(key!.getAttribute("aria-keyshortcuts")).toBe("^");
    expect(key!.disabled).toBe(false);
  });

  test("offline, the key sits disabled: there is no fact to turn", () => {
    const { target } = render(EmptyState, { connected: false });
    expect(keyOf(target)!.disabled).toBe(true);
  });

  test("pressing the key shows the next fact", async () => {
    const { facts, drawn } = countedFacts();
    const { target, flush } = render(EmptyState, { connected: true, facts });
    const text = () => target.querySelector(".carrot-fact")!.textContent;
    const first = text();
    keyOf(target)!.click();
    await flushUntil(flush, () => text() !== first);
    expect(text()).not.toBe(first);
    expect(drawn()).toBe(2);
  });

  // A press landing while the last turn is still fading out would otherwise draw a
  // second fact for one visible swap.
  test("a press during a turn spends no second fact", async () => {
    const { facts, drawn } = countedFacts();
    const { target, flush } = render(EmptyState, { connected: true, facts });
    const key = keyOf(target)!;
    key.click();
    key.click();
    await flushUntil(flush, () => drawn() > 2, 5);
    expect(drawn()).toBe(2);
  });

  // One cue per explicit action: the reader's press sounds, the timer's turn does not.
  test("a press plays the turn's cue, and a timed turn plays none", async () => {
    const play = spyOn(sound, "play").mockImplementation(() => {});
    try {
      const { facts, drawn } = countedFacts();
      const { target, flush } = render(EmptyState, { connected: true, rotateMs: 10, facts });
      await flushUntil(flush, () => drawn() > 1);
      expect(play).not.toHaveBeenCalled();
      keyOf(target)!.click();
      expect(play).toHaveBeenCalledWith("factTurned");
    } finally {
      play.mockRestore();
    }
  });

  // The cadence starts over from a press, so a timed turn never lands just after one the
  // reader asked for.
  test("after a press, no timed turn lands within one interval", async () => {
    const rotateMs = 80;
    const drawnAt: number[] = [];
    const facts = {
      next: () => {
        drawnAt.push(performance.now());
        return CARROT_FACTS[drawnAt.length % CARROT_FACTS.length] as CarrotFact;
      },
    };
    const { target, flush } = render(EmptyState, { connected: true, rotateMs, facts });
    flush();
    await Bun.sleep(rotateMs / 2);
    const before = drawnAt.length;
    const pressedAt = performance.now();
    keyOf(target)!.click();
    await flushUntil(flush, () => drawnAt.length > before);
    await Bun.sleep(rotateMs * 1.5);
    flush();
    const timed = drawnAt.slice(before + 1).map((at) => Math.round(at - pressedAt));
    expect(timed.length).toBeGreaterThan(0);
    // A timer can fire a millisecond early on its own clock.
    expect(Math.min(...timed)).toBeGreaterThanOrEqual(rotateMs - 2);
  });

  describe("the ^ shortcut", () => {
    let dispatcher: ShortcutDispatcher;
    beforeAll(() => {
      dispatcher = createShortcutDispatcher({ target: window, registry: shortcuts });
    });
    afterAll(() => dispatcher.destroy());
    const typeCaret = () =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "^", bubbles: true }));

    test("shows the next fact", async () => {
      const { facts, drawn } = countedFacts();
      const { flush } = render(EmptyState, { connected: true, facts });
      flush();
      typeCaret();
      await flushUntil(flush, () => drawn() > 1);
      expect(drawn()).toBe(2);
    });

    test("does nothing offline", async () => {
      const { facts, drawn } = countedFacts();
      const { flush } = render(EmptyState, { connected: false, facts });
      flush();
      typeCaret();
      await flushUntil(flush, () => drawn() > 1, 5);
      expect(drawn()).toBe(1);
    });

    // A review's screen has no fact to turn, so the key is live only on this one.
    test("is live only while the waiting screen is mounted", () => {
      const live = () => shortcuts.list().some((e) => e.id === "actions.nextFact" && e.run);
      expect(live()).toBe(false);
      const { flush } = render(EmptyState, { connected: true });
      flush();
      expect(live()).toBe(true);
    });
  });

  // Reduced motion stops the timer, but a press is the reader asking for the next fact.
  test("under reduced motion the fact holds, and a press still turns it", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "matchMedia");
    Object.defineProperty(globalThis, "matchMedia", {
      configurable: true,
      value: (query: string) => ({ matches: query.includes("reduce"), media: query }),
    });
    try {
      const { facts, drawn } = countedFacts();
      const { target, flush } = render(EmptyState, { connected: true, rotateMs: 10, facts });
      await flushUntil(flush, () => drawn() > 1, 5);
      expect(drawn()).toBe(1);
      keyOf(target)!.click();
      await flushUntil(flush, () => drawn() > 1);
      expect(drawn()).toBe(2);
    } finally {
      if (original) Object.defineProperty(globalThis, "matchMedia", original);
      else Reflect.deleteProperty(globalThis, "matchMedia");
    }
  });

  // The lit legend is the hero of this screen: a hot core over the accent, a darker rim,
  // and a glow in the accent behind it, at a display size and the regular weight (the
  // Button it sits in is medium). Pinned so a refactor can't quietly demote, embolden or
  // recolor the brand mark.
  test("lights the ^ legend in the accent (core, rim and glow), at display size and regular weight", async () => {
    const css = await componentCss("EmptyState.svelte");
    const core = ruleBody(css, ".lit-core");
    expect(core).toContain("var(--lit-core)");
    expect(core).toContain("var(--accent)");
    expect(core).toContain("var(--lit-rim)");
    expect(ruleBody(css, ".lit-glow")).toContain("color: var(--accent);");
    expect(ruleBody(css, ".legend")).toContain("font-size: 4.25rem;");
    expect(ruleBody(css, ".legend")).toContain("font-weight: 400;");
  });

  // EXC-763: the screen composes the shadcn Empty container, so its structure
  // reads as one system with the rest of the shadcn UI.
  test("renders inside a shadcn Empty container", () => {
    const { target } = render(EmptyState, { connected: true });
    expect(target.querySelector('[data-slot="empty"]')).not.toBeNull();
  });

  // The title stays a real <h2>: 8 e2e specs anchor on
  // getByRole("heading", { name: "No plans awaiting review" }), and the heading
  // is the correct semantics for the empty screen. Guards against silently
  // demoting it to shadcn's EmptyTitle <div>.
  test("keeps the title as a level-2 heading (the e2e anchor)", () => {
    const { target } = render(EmptyState, { connected: true });
    const h2 = target.querySelector("h2");
    expect(h2).not.toBeNull();
    expect(h2!.textContent).toContain("No plans awaiting review");
  });

  // EXC-381: one quiet sourced carrot fact docks above the status bar while the
  // reader waits. It is gated on `connected` so the disconnected screen's warning
  // is the only thing on it — a flourish under a "something is wrong" message
  // reads as the app not noticing.
  test("shows a carrot fact when connected", () => {
    const { target } = render(EmptyState, { connected: true });
    const line = target.querySelector(".carrot-fact");
    expect(line).not.toBeNull();
    expect(line!.textContent!.length).toBeGreaterThan(20);
  });

  test("hides the carrot fact when disconnected", () => {
    const { target } = render(EmptyState, { connected: false });
    expect(target.querySelector(".carrot-fact")).toBeNull();
  });

  // The first outbound link anywhere in ui/src, so its safe-window attributes are
  // pinned rather than left to review.
  test("the fact links out to its source in a new tab", () => {
    const { target } = render(EmptyState, { connected: true });
    const link = target.querySelector<HTMLAnchorElement>(".carrot-fact a");
    expect(link).not.toBeNull();
    expect(CARROT_FACTS.map((f) => f.source)).toContain(link!.getAttribute("href") ?? "");
    expect(link!.getAttribute("target")).toBe("_blank");
    expect(link!.getAttribute("rel")).toBe("noreferrer");
    expect(link!.getAttribute("aria-label")).toContain(new URL(link!.href).hostname);
  });

  // rotateMs injects the clock so rotation is provable without a 50-second wait
  // — the same seam lib/safeMode.ts takes for its grace and duration windows.
  test("rotates to another fact on the injected interval", async () => {
    const { target, flush } = render(EmptyState, { connected: true, rotateMs: 10 });
    const text = () => target.querySelector(".carrot-fact")!.textContent;
    const first = text();
    await flushUntil(flush, () => text() !== first);
    expect(text()).not.toBe(first);
  });

  // The line docks above the status bar off the shared --status-bar-h token (the
  // same one CommentNavigator docks from), and cross-fades on the state duration.
  test("the fact line docks off --status-bar-h and cross-fades on --dur-state", async () => {
    const css = await componentCss("EmptyState.svelte");
    const rule = ruleBody(css, ".carrot-fact");
    expect(rule).toContain("var(--status-bar-h)");
    expect(rule).toContain("var(--dur-state)");
  });

  // WCAG 2.2.2: auto-updating content running indefinitely needs a way to hold it.
  // The concrete bug it also closes is that the link's href swaps under a pointer
  // already reaching for it.
  test("holds the rotation while the pointer is over the line", async () => {
    const { target, flush } = render(EmptyState, { connected: true, rotateMs: 10 });
    const line = target.querySelector(".carrot-fact")!;
    line.dispatchEvent(new MouseEvent("mouseenter"));
    flush();
    const held = line.textContent;
    await flushUntil(flush, () => line.textContent !== held, 12);
    expect(line.textContent).toBe(held);

    // …and resumes on the way out, so the hold is a pause and not a stop.
    line.dispatchEvent(new MouseEvent("mouseleave"));
    flush();
    await flushUntil(flush, () => line.textContent !== held);
    expect(line.textContent).not.toBe(held);
  });

  // The strip spans the bottom band, and during the exit window its link is
  // invisible but would still hit-test. AlertHost draws the same pair.
  test("the strip lets clicks through but the link itself does not", async () => {
    const css = await componentCss("EmptyState.svelte");
    expect(ruleBody(css, ".carrot-fact")).toContain("pointer-events: none;");
    expect(ruleBody(css, ".carrot-fact a")).toContain("pointer-events: auto;");
  });

  // The link spends no accent and sits mid-sentence in the same faint ink as its own
  // text, so the underline is the only thing marking it. Tailwind's preflight resets
  // text-decoration-line to none, so the UA default leaves it with no affordance.
  test("the source link declares its own underline (preflight resets the UA one)", async () => {
    const rule = ruleBody(await componentCss("EmptyState.svelte"), ".carrot-fact a");
    expect(rule).toContain("text-decoration-line: underline;");
  });
});

// Read a component's <style> block from source. Token references are pinned by
// name: the harness loads no theme sheet, so a var() reference computes to "" — and
// a resolved value could not pin the token's name even if it did.
async function componentCss(file: string): Promise<string> {
  const src = await Bun.file(join(import.meta.dir, file)).text();
  return src.match(/<style>([\s\S]*)<\/style>/)?.[1] ?? "";
}

// Extract the declaration body of a single CSS rule by its selector.
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}
