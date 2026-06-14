import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { render } from "../../test-mount.ts";
import EmptyState from "./EmptyState.svelte";

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
  // sibling DevBadge test pins its own .metric the same way. (happy-dom's
  // getComputedStyle doesn't resolve Svelte-injected scoped styles, so the
  // runtime class — not a resolved font-feature value — is the falsifiable fact.)
  test("the hint pill carries the .metric atom (badge numeric vocabulary)", () => {
    for (const connected of [true, false]) {
      const { target } = render(EmptyState, { connected });
      const hint = target.querySelector(".hint");
      expect(hint).not.toBeNull();
      expect(hint!.classList.contains("metric")).toBe(true);
    }
  });

  // The hint pill's surface and border draw the SAME tokens as the VersionBadge
  // pill, so the empty screen and the populated chrome are provably one system.
  // Asserted against the CSS source (the type-scale/css-bridge suites prove "one
  // system" invariants this way) so a future drift on either pill fails the unit
  // suite rather than only showing visually.
  test("the hint pill shares VersionBadge's surface + border tokens", async () => {
    const hintRule = ruleBody(await componentCss("EmptyState.svelte"), ".hint");
    const badgeRule = ruleBody(await componentCss("VersionBadge.svelte"), ".version-badge");
    expect(hintRule).toContain("background: var(--paper-raised);");
    expect(badgeRule).toContain("background: var(--paper-raised);");
    expect(hintRule).toContain("border: 1px solid var(--rule);");
    expect(badgeRule).toContain("border: 1px solid var(--rule);");
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
});

// Read a component's <style> block from source. Used to pin CSS token references
// that happy-dom's getComputedStyle can't resolve (it ignores Svelte-injected
// scoped styles), matching how type-scale.test.ts / css-bridge.test.ts assert
// "one system" invariants from the CSS source itself.
async function componentCss(file: string): Promise<string> {
  const src = await Bun.file(join(import.meta.dir, file)).text();
  return src.match(/<style>([\s\S]*)<\/style>/)?.[1] ?? "";
}

// Extract the declaration body of a single CSS rule by its selector.
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}
