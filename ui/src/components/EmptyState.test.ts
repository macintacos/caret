import "@ui/test-mount.ts";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { flushUntil, render } from "@ui/test-mount.ts";
import EmptyState from "@/components/EmptyState.svelte";
import { CARROT_FACTS } from "$lib/carrotFacts.ts";

describe("EmptyState", () => {
  test("connected (default): shows the listening copy, no warning", () => {
    const { target } = render(EmptyState, {});
    expect(target.textContent).toContain("No plans awaiting review");
    expect(target.textContent).toContain("This window stays open and listening");
    expect(target.querySelector(".warn")).toBeNull();
  });

  test("disconnected: shows the not-connected warning with the unplug icon", () => {
    const { target } = render(EmptyState, { connected: false });
    const warn = target.querySelector(".warn");
    expect(warn).not.toBeNull();
    expect(warn!.textContent).toContain("Not connected to the caret daemon");
    expect(warn!.querySelector(".icon svg")).not.toBeNull();
  });

  test("always shows the brand glyph and the status hint", () => {
    const { target } = render(EmptyState, { connected: true });
    expect(target.querySelector(".glyph")!.textContent).toBe("^");
    expect(target.querySelector(".hint")!.textContent).toContain("polling /api/reviews");
  });

  // The hint pill shares the badge numeric vocabulary by carrying the shared
  // .metric atom — the same source VersionBadge/DevBadge draw their tabular
  // figures from, so empty and populated chrome read as one tabular system. The
  // sibling DevBadge test pins its own .metric the same way. (.metric is a
  // global atom in ui/src/styles/atoms.css, and the mount harness loads no
  // stylesheet — only the component's own scoped block is injected — so the
  // runtime class, not a resolved font-feature value, is the falsifiable fact.)
  test("the hint pill carries the .metric atom (badge numeric vocabulary)", () => {
    for (const connected of [true, false]) {
      const { target } = render(EmptyState, { connected });
      const hint = target.querySelector(".hint");
      expect(hint).not.toBeNull();
      expect(hint!.classList.contains("metric")).toBe(true);
    }
  });

  // The hint pill keeps its own quiet floating-pill surface — paper-raised fill +
  // hairline border — the discoverability-hint vocabulary the empty screen shares
  // with the other floating pills (the safe-mode toast, the comment navigator). It
  // no longer couples to VersionBadge, which moved into the flat status bar
  // (EXC-787) and dropped its pill surface. Asserted against the CSS source so a
  // drift fails the unit suite rather than only showing visually.
  test("the hint pill keeps its floating-pill surface + border tokens", async () => {
    const hintRule = ruleBody(await componentCss("EmptyState.svelte"), ".hint");
    expect(hintRule).toContain("background: var(--paper-raised);");
    expect(hintRule).toContain("border: 1px solid var(--rule);");
  });

  // The amber ^ glyph is the hero of this screen and must survive the elevate:
  // the accent color, the accent-wash text-shadow, and the 6rem display size are
  // pinned so a refactor can't quietly demote or recolor the brand mark.
  test("preserves the amber ^ glyph (accent color, accent-wash, 6rem)", async () => {
    const glyphRule = ruleBody(await componentCss("EmptyState.svelte"), ".glyph");
    expect(glyphRule).toContain("color: var(--accent);");
    expect(glyphRule).toContain("var(--accent-wash)");
    expect(glyphRule).toContain("font-size: 6rem;");
  });

  // EXC-763: the screen is rebuilt on the shadcn Empty container, so its
  // structure now reads as one system with the rest of the shadcn-migrated UI.
  test("renders inside a shadcn Empty container", () => {
    const { target } = render(EmptyState, { connected: true });
    expect(target.querySelector('[data-slot="empty"]')).not.toBeNull();
  });

  // The title stays a real <h2>: 8 e2e specs anchor on
  // getByRole("heading", { name: "No plans awaiting review" }), and the heading
  // is the correct semantics for the empty screen. Guards the migration from
  // silently demoting it to shadcn's EmptyTitle <div>.
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
  // same one CommentNavigator docks from), and cross-fades on both arms of the
  // surface duration pair. Pinned against the CSS source so a retune that drops
  // an arm — leaving the swap to snap in one direction — reds the unit suite.
  test("the fact line docks off --status-bar-h and cross-fades on both arms", async () => {
    const css = await componentCss("EmptyState.svelte");
    const rule = ruleBody(css, ".carrot-fact");
    expect(rule).toContain("var(--status-bar-h)");
    expect(rule).toContain("var(--dur-enter)");
    expect(ruleBody(css, ".carrot-fact.leaving")).toContain("var(--dur-exit)");
  });
});

// Read a component's <style> block from source. Used to pin CSS token references
// by name: the harness loads no theme sheet, so a var() reference computes to ""
// — and a resolved value could not pin the token's name even if it did. Matches
// how type-scale.test.ts / css-bridge.test.ts assert "one system" invariants from
// the CSS source itself.
async function componentCss(file: string): Promise<string> {
  const src = await Bun.file(join(import.meta.dir, file)).text();
  return src.match(/<style>([\s\S]*)<\/style>/)?.[1] ?? "";
}

// Extract the declaration body of a single CSS rule by its selector.
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}
