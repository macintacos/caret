import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { readAppCss, rootBlock, themeBlock } from "$lib/appCss.ts";
import { FOLLOW_ANIM_MS, SCROLL_ANIM_MS } from "$lib/diffview/scroll.ts";

// caret's motion vocabulary lives in app.css: a small set of functional
// duration/easing tokens for one-shot chrome reveals, plus a single global
// prefers-reduced-motion rule that neutralizes movement for the light-DOM app
// root. This suite pins the substrate the acceptance criteria require — the tier
// ladder (micro < exit < enter < travel, so a surface leaves quicker than it
// arrives), the JS constants that mirror it, and the global guard — so a drift
// fails the unit suite rather than only showing as motion under reduced-motion.

const uiDir = join(import.meta.dir, "..");
const appCss = readAppCss();
const composer = await Bun.file(join(uiDir, "components/SourceComposer.svelte")).text();
const emptyState = await Bun.file(join(uiDir, "components/EmptyState.svelte")).text();
// The two exit-window mirrors that live outside the chrome list below. Read as source
// text because neither constant is exported, and neither should be — an export minted
// only to be asserted on is a worse seam than the regex that avoids it.
const planKeyboard = await Bun.file(join(uiDir, "state/planKeyboard.svelte.ts")).text();
const alertsState = await Bun.file(join(uiDir, "state/alerts.ts")).text();

// The four vendored modal surfaces (EXC-892), keyed by the `data-slot` each stamps. The
// slot name IS the filename and its primitive is the slot minus `-overlay` / `-content`,
// so the sources locate themselves and a renamed file reds rather than reads as empty.
const modalSlots = [
  "dialog-overlay",
  "dialog-content",
  "alert-dialog-overlay",
  "alert-dialog-content",
];
const modalSources: Record<string, string> = Object.fromEntries(
  await Promise.all(
    modalSlots.map(
      async (slot) =>
        [
          slot,
          await Bun.file(
            join(
              uiDir,
              "lib/components/ui",
              slot.startsWith("alert-") ? "alert-dialog" : "dialog",
              `${slot}.svelte`,
            ),
          ).text(),
        ] as const,
    ),
  ),
);

// The chrome: every component in ui/src/components, plus the app root, READ OFF DISK
// rather than enumerated. The directory is the contract, so a component that grows
// motion is covered the moment it lands rather than whenever someone remembers to add
// it — and the reduced-motion assertion below reaches the whole chrome rather than the
// part anyone thought to name. A component with no motion costs one trivially-green
// test, which is the cheaper of the two mistakes a list can make.
const chromeComponents = [
  "App.svelte",
  ...(await readdir(join(uiDir, "components")))
    .filter((name) => name.endsWith(".svelte"))
    .sort()
    .map((name) => `components/${name}`),
];
const chromeSources: Record<string, string> = Object.fromEntries(
  await Promise.all(
    chromeComponents.map(async (p) => [p, await Bun.file(join(uiDir, p)).text()] as const),
  ),
);

// The shadcn bridge partial, read on its own rather than through readAppCss(): the modal
// suite below asserts the choreography is UNLAYERED, which the reconstituted sheet cannot
// show. See that block's own note.
const modalBridgeCss = await Bun.file(join(uiDir, "styles/shadcn-bridge.css")).text();

/** A component's stylesheet — its `<style>` block, or "" when it has none. Both
 * chrome scans below are claims about CSS, and a `.svelte` file's SCRIPT can hold
 * CSS-shaped text that is neither: `FolderTree.svelte` injects a reduced-motion block,
 * as a template string, into the `@pierre/diffs` SHADOW root — a tree the global
 * `#app` / `[data-slot]` guard provably cannot reach, which is what makes that block
 * correct rather than redundant. Scanning whole files would score it as a violation.
 *
 * Both tags are anchored to the start of a line, which is where Svelte's own `<style>`
 * sits and where CSS inside a script string never can — so the helper cannot be fooled
 * by the very thing it exists to skip. */
function styleBlock(source: string): string {
  return source.match(/^<style[^>]*>([\s\S]*?)^<\/style>/m)?.[1] ?? "";
}

// Parse a ms/s duration value to milliseconds. Returns NaN for non-time values.
function toMs(value: string): number {
  const v = value.trim();
  if (v.endsWith("ms")) return Number.parseFloat(v);
  if (v.endsWith("s")) return Number.parseFloat(v) * 1000;
  return Number.NaN;
}

/** A declaration's value inside a rule body, or "" when the body declares no such property. */
const read = (block: string, prop: string): string =>
  block.match(new RegExp(`${prop}:\\s*([^;]+);`))?.[1]?.trim() ?? "";

describe("motion tokens in app.css", () => {
  // Keyed on a token the motion vocabulary owns, so the lookup is
  // self-locating. A marker that matches nothing yields "" and every assertion
  // below fails, so this cannot mask a missing block.
  const root = rootBlock(appCss, "--dur-micro:");

  // Both reads below anchor to the start of a line, so they see DECLARATIONS and not the
  // doc comment above them — which names every token it explains, and may legitimately
  // follow one with a colon mid-sentence.
  /** A `--dur-<name>` token's value in ms, or NaN when the block declares no such token. */
  const dur = (name: string): number =>
    toMs(root.match(new RegExp(`^\\s*--dur-${name}:\\s*([^;]+);`, "m"))?.[1] ?? "");

  test("declares the three surface tiers plus the travel exception", () => {
    // The vocabulary is tiered by WHAT MOVES, not capped at one ceiling: a micro
    // tier for tints and pops, an enter/exit pair for surfaces, and travel for a
    // scroll crossing distance. All four are real times.
    for (const name of ["micro", "enter", "exit", "travel"]) {
      expect(dur(name)).toBeGreaterThan(0);
    }
  });

  test("the ladder is monotonic, and a surface leaves quicker than it arrives", () => {
    // The retune's whole claim (EXC-890). `exit < enter` is the native asymmetry —
    // you watch a thing arrive, you only need a thing leaving to be gone — and the
    // micro tier sits below both because a hover tint spending an entrance's time
    // reads as lag on the pointer. Ordering rather than absolute values, so tuning
    // by eye stays free while an inverted pair reds here.
    expect(dur("micro")).toBeLessThan(dur("exit"));
    expect(dur("exit")).toBeLessThan(dur("enter"));
    expect(dur("enter")).toBeLessThan(dur("travel"));
  });

  test("the vocabulary is closed — every --dur-* is one of the four tiers", () => {
    // A fifth duration cannot be slipped in without arguing for itself in
    // tokens.css first. Travel is the standing exception inside the set because it
    // is the one token OFF the enter/exit axis — distance, not surface size.
    // [\w-] rather than [a-z]: a fifth token spelled the way most tokens in this
    // sheet are (--dur-fade-out, --dur-enter2) would slip past a letters-only class
    // and leave this green with the vocabulary silently at six.
    const names = [...root.matchAll(/^\s*--dur-([\w-]+):/gm)].map(([, name]) => name);
    expect(names.sort()).toEqual(["enter", "exit", "micro", "travel"]);
  });

  test("the plan's two JS scroll durations mirror their tokens", () => {
    // scrollTop is a JS property no stylesheet can drive, so scroll.ts carries each
    // token's value as a constant instead of reading it. That makes them numbers
    // coupled across files, which svelte-rules.md § CSS-token discipline says to
    // name once and TEST — the same pin layout.test.ts holds REFERENCE_WIDTH_PX to.
    expect(SCROLL_ANIM_MS).toBe(dur("travel")); // the jump to a place
    expect(FOLLOW_ANIM_MS).toBe(dur("micro")); // the cursor follow
  });

  test("the three exit-window timers mirror --dur-exit", () => {
    // happy-dom fires no animationend, so each surface that must outlive its own
    // closing keyframe holds the duration as a timer instead. Same coupling as the
    // scroll mirrors above and the same reason to pin it: these three moved when the
    // exit tier landed, and a future retune that misses one strands or flashes the
    // surface rather than failing anything.
    const exit = dur("exit");
    expect(planKeyboard).toContain(`const CLOSE_ANIM_MS = ${exit};`); // PlanSearch's collapse
    expect(chromeSources["components/DiffPlanView.svelte"]).toContain(
      `const CLOSE_ANIM_MS = ${exit};`, // FileDrawer's close wipe
    );
    expect(alertsState).toContain(`deps.exitMs ?? ${exit};`); // AlertHost's alert-out
  });

  test("declares an enter and an exit easing as cubic-beziers", () => {
    const out = root.match(/--ease-out:\s*([^;]+);/)?.[1] ?? "";
    const eIn = root.match(/--ease-in:\s*([^;]+);/)?.[1] ?? "";
    expect(out).toContain("cubic-bezier");
    expect(eIn).toContain("cubic-bezier");
  });

  test("documents the ambient/infinite carve-out", () => {
    // The functional tokens are for one-shot reveals; ambient/infinite
    // animations (safe-mode pulse, EmptyState float) keep their own durations.
    // A comment must record that exemption near the tokens.
    expect(appCss).toMatch(/ambient|infinite/i);
  });
});

describe("the global prefers-reduced-motion rule", () => {
  // The single guard for the light-DOM chrome. Extract the body of the
  // app-root-scoped reduced-motion @media block — the rule wraps one nested
  // selector block, so capture through its closing brace and the @media's own.
  const block =
    appCss.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?\n {2}\}\n\})/)?.[1] ?? "";

  test("a global reduced-motion @media rule exists, scoped to the #app root", () => {
    expect(block).not.toBe("");
    // Scoped to the light-DOM app root — not a bare universal selector with no
    // root anchor, so it cannot bleed past the mounted app.
    expect(block).toContain("#app");
  });

  test("also reaches shadcn surfaces portalled outside #app (via data-slot)", () => {
    // bits-ui portals dialog / dropdown / tooltip / popover content to
    // document.body — outside #app — and tw-animate-css (which drives their
    // enter/exit) ships no reduced-motion guard of its own. The single global
    // rule must therefore also cover the portalled shadcn surfaces, anchored to
    // their data-slot attribute (still not a bare universal), and their
    // descendants, so a dialog can't fade/zoom in under reduced motion.
    expect(block).toContain("[data-slot]");
    expect(block).toContain("[data-slot] *");
  });

  test("neutralizes animation and transition to near-zero", () => {
    expect(block).toMatch(/animation-duration:\s*0(\.0+)?(m?s)?/);
    expect(block).toMatch(/transition-duration:\s*0(\.0+)?(m?s)?/);
  });

  test("forces infinite animations to a single static frame", () => {
    // animation-iteration-count: 1 collapses an infinite ambient animation to
    // one resolved frame rather than letting it loop invisibly.
    expect(block).toMatch(/animation-iteration-count:\s*1/);
  });

  test("documents that the rule does not cross the shadow boundary", () => {
    // The @pierre/diffs surface lives in a Shadow DOM, unreachable from app.css.
    expect(appCss).toMatch(/shadow/i);
  });
});

describe("the formerly-unguarded composer reveal references the tokens", () => {
  test("SourceComposer's reveal uses a duration + easing token and is opacity-only", () => {
    // The `animation:` shorthand on the composer carries a var(--dur-*) and a
    // var(--ease-*), not a raw seconds/ease-out literal.
    const decl = composer.match(/animation:\s*reveal\s+([^;]+);/)?.[1] ?? "";
    expect(decl).toContain("var(--dur-");
    expect(decl).toContain("var(--ease-");
    // No bare seconds literal left on the shorthand.
    expect(decl).not.toMatch(/\d+(\.\d+)?s\b/);
    // The composer opens inside the library-reserved annotation row, so its
    // reveal animates opacity only — a transform in the keyframes would change
    // the row's measured height mid-reveal. Pin the keyframe to opacity, with
    // no transform, so the scale bounce can't creep back.
    const keyframes = composer.match(/@keyframes reveal\s*\{([\s\S]*?)\n {2}\}/)?.[1] ?? "";
    expect(keyframes).toContain("opacity");
    expect(keyframes).not.toContain("transform");
  });
});

describe("the ToC panel refines the vendored popover animation rather than replacing it", () => {
  // EXC-1107. The panel is one of the portalled shadcn surfaces, so its enter/exit is
  // tw-animate-css's rather than caret's — and bits-ui's portal presence waits on the
  // `animationend` those keyframes fire, which makes replacing them a correctness bug
  // and not only a style one. The refinement therefore writes the two custom properties
  // the compiled `animate-in` utility reads for its duration and its curve, leaving the
  // keyframes alone. Those are longhand custom-property writes, invisible to the
  // shorthand scan below (its pattern needs `animation:`, which `--tw-duration:` is
  // not), so the whole refinement would otherwise ship uncovered.
  const toc = chromeSources["components/PlanToc.svelte"] ?? "";
  // The panel's motion block, found by the property it is the only one to carry — the
  // selector itself is spelled three times in that stylesheet, one concern each.
  const openBlock =
    toc.match(/:global\(\.plan-toc-panel\)\s*\{([^}]*--tw-duration[^}]*)\}/)?.[1] ?? "";
  const closedBlock =
    toc.match(/:global\(\.plan-toc-panel\[data-state="closed"\]\)\s*\{([^}]*)\}/)?.[1] ?? "";

  test("retimes tw-animate-css's own properties, from the shared tokens", () => {
    // A marker matching nothing yields "" and reds every assertion here, so a moved or
    // deleted block cannot pass this suite by leaving it with nothing to check.
    expect(openBlock).not.toBe("");
    expect(closedBlock).not.toBe("");
    for (const block of [openBlock, closedBlock]) {
      for (const prop of ["--tw-duration", "--tw-ease"]) {
        const value = read(block, prop);
        expect(value).toMatch(/^var\(--(dur|ease)-[a-z]+\)$/);
      }
      // "Refined, not duplicated": a shorthand of caret's own on this element would
      // replace the `enter`/`exit` keyframes and strand the portal on close.
      expect(block).not.toContain("animation");
    }
  });

  test("pairs a distinct enter and exit rather than spending one timing twice", () => {
    // The vocabulary ships --ease-out and --ease-in as a pair precisely so a scripted
    // exit reads as the inverse of its entrance, and the vendored default it supersedes
    // used one plain `ease` at one duration in both directions. Collapsing the two arms
    // back to one is the regression this catches.
    expect(read(openBlock, "--tw-ease")).not.toBe(read(closedBlock, "--tw-ease"));
    expect(read(openBlock, "--tw-duration")).not.toBe(read(closedBlock, "--tw-duration"));
  });
});

describe("the modal surfaces share one choreography, written in the shadcn bridge", () => {
  // EXC-892. The same refinement the ToC panel above makes, with one difference that
  // decides where it is written: four vendored files across two bits-ui primitives have to
  // wear it identically, so the arms live once in styles/shadcn-bridge.css keyed on
  // `data-slot`, and this block is what keeps a fifth spelling from appearing in a fifth
  // place. The chrome sweep below cannot cover them — it is a list of light-DOM component
  // files, and these carry no <style> at all.
  //
  // Read from the PARTIAL, not from readAppCss(): the reconstituted sheet would let these
  // rules pass this suite from inside an @layer, and being unlayered is the whole reason
  // they beat a re-synced utility. Scanning the file that must hold them pins the location
  // and the layering together, and keeps the selector predicates below off 100KB of
  // unrelated prose.
  const bridge = modalBridgeCss;
  // Every `selector { body }` pair in the partial. `[^{}]*` skips a rule holding a nested
  // block (the @theme inline map), which is fine: every rule below is flat. The selector
  // capture is "everything since the last brace", so it carries the preceding comment too
  // — harmless against these predicates, which look for bracket-quoted attribute selectors
  // that the comments here do not spell.
  const flatRules = [...bridge.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    ([, selector, body]) => [selector ?? "", body ?? ""] as const,
  );
  const ruleWhere = (pick: (selector: string) => boolean): string =>
    flatRules.find(([selector]) => pick(selector))?.[1] ?? "";
  const namesEverySlot = (selector: string): boolean =>
    modalSlots.every((slot) => selector.includes(`[data-slot="${slot}"]`));

  // The two timing arms: the open one carries no state qualifier, the exit one is the same
  // four slots narrowed to [data-state="closed"].
  const openArm = ruleWhere((s) => namesEverySlot(s) && !s.includes('[data-state="closed"]'));
  const closedArm = ruleWhere((s) => namesEverySlot(s) && s.includes('[data-state="closed"]'));
  // The scrim: both OVERLAYS and neither content, which is what makes "one treatment,
  // declared once" an assertion rather than two values that happen to agree today.
  const scrim = ruleWhere(
    (s) =>
      s.includes('[data-slot="dialog-overlay"]') &&
      s.includes('[data-slot="alert-dialog-overlay"]') &&
      !s.includes('[data-slot="dialog-content"]'),
  );
  // A predicate matching nothing yields "", which would leave every `read` below comparing
  // "" to "". Proven present once, here, for all three.
  const present = (): void => {
    expect(openArm).not.toBe("");
    expect(closedArm).not.toBe("");
    expect(scrim).not.toBe("");
  };
  const withoutComments = (src: string): string => src.replace(/^\s*\/\/.*$/gm, "");

  test("the bridge holds the choreography unlayered", () => {
    present();
    // The load-bearing property of the whole design: these rules are unlayered while the
    // utilities they supersede compile into Tailwind's utilities layer, so a
    // `shadcn add --overwrite` that restores the stock timing and scrim is overridden
    // rather than silently reinstated. Wrapping this partial in a layer would forfeit that
    // with no other symptom. Scanned comment-stripped — the section comment explains the
    // cascade it depends on, and naming the at-rule there must not red its own guard.
    expect(bridge.replace(/\/\*[\s\S]*?\*\//g, "")).not.toContain("@layer");
  });

  test("no vendored modal surface times itself", () => {
    for (const slot of modalSlots) {
      // Comment-stripped: each file names the stock utility it deliberately omits, and a
      // text rule that reds on that explanation teaches the next author to delete it.
      expect(withoutComments(modalSources[slot] ?? "")).not.toMatch(/\bduration-\d/);
    }
  });

  test("the vendored enter/exit keyframes are refined, never replaced", () => {
    // Not a style rule: bits-ui's presence layer waits on the animations tw-animate-css's
    // `animate-in`/`animate-out` start before it lets a dismissed surface leave the DOM.
    // Dropping those utilities, or writing a competing `animation` over them, strands a
    // closed modal on screen — so the utilities must survive and the arms must set only
    // the two custom properties the compiled utility reads.
    for (const slot of modalSlots) {
      const src = modalSources[slot] ?? "";
      expect(src).toContain("data-[state=open]:animate-in");
      expect(src).toContain("data-[state=closed]:animate-out");
    }
    for (const arm of [openArm, closedArm]) {
      expect(arm).not.toContain("animation");
    }
  });

  test("all four surfaces arrive on the enter tier and leave on the exit tier", () => {
    present();
    // The asymmetry EXC-890 tiered for, spent on the surfaces it was named for. Overlay
    // and content take the SAME arm on purpose: the panel settling in as the room dims is
    // one gesture, and a backdrop on its own clock reads as two.
    expect(read(openArm, "--tw-duration")).toBe("var(--dur-enter)");
    expect(read(openArm, "--tw-ease")).toBe("var(--ease-out)");
    expect(read(closedArm, "--tw-duration")).toBe("var(--dur-exit)");
    expect(read(closedArm, "--tw-ease")).toBe("var(--ease-in)");
  });

  test("both overlays wear one scrim, and its blur radius is a constant", () => {
    // "One treatment, declared once" as an assertion rather than two values that happen to
    // agree today — re-splitting the rule into two per-slot ones reds here.
    present();
    expect(scrim).toContain("backdrop-filter");
    // Constant radius, deliberately: element opacity composites the filtered backdrop, so
    // the fade the `enter` keyframe already runs ramps the blur with it. Interpolating the
    // radius instead re-blurs everything behind the overlay every frame to buy the same
    // percept.
    expect(scrim).not.toMatch(/transition|animation/);
    for (const slot of ["dialog-overlay", "alert-dialog-overlay"]) {
      expect(withoutComments(modalSources[slot] ?? "")).not.toMatch(/bg-black|backdrop-blur/);
    }
  });
});

describe("the portalled menus, popovers and tooltips run on caret's tempo", () => {
  // tw-animate-css compiles `animate-in` as
  // `enter var(--tw-animation-duration, var(--tw-duration, .15s)) var(--tw-ease, ease) …`,
  // so a portalled shadcn surface runs 150ms on a plain `ease` — 100ms where the
  // component ships a `duration-100`, as popover-content does — until something writes
  // those two properties. app.css writes them for the surfaces that are NOT modals; the
  // modal ones choreograph their own arrival, and their absence is asserted here rather
  // than left to be noticed.
  // Click-opened: a menu or a panel the reader asked for is a SURFACE, so it takes the
  // enter/exit pair. The tooltip is the deliberate exception below — it is hover-
  // triggered, and four of its six consumers open with no delay at all.
  const SURFACES = ["dropdown-menu-content", "dropdown-menu-sub-content", "popover-content"];
  const MODAL = [
    "dialog-content",
    "dialog-overlay",
    "alert-dialog-content",
    "alert-dialog-overlay",
    "sheet-content",
    "sheet-overlay",
  ];

  // Every rule in the sheet that writes --tw-duration, as selector-list plus body.
  // `before` reaches back to the previous rule's brace, so the doc comment above a rule
  // is trimmed off its selector list.
  const portalRules = [...appCss.matchAll(/([^{}]*)\{([^{}]*--tw-duration:[^{}]*)\}/g)].map(
    ([, before = "", body = ""]) => ({ selector: (before.split("*/").pop() ?? "").trim(), body }),
  );
  // Narrowed to the rules naming a surface from THIS set before anything is keyed on a
  // tier. The modal choreography writes the same two properties and the same enter/exit
  // tokens, so a tier alone does not identify a rule — it would hand this suite whichever
  // of the two the sheet happens to @import first.
  const mine = portalRules.filter((r) =>
    [...SURFACES, "tooltip-content"].some((s) => r.selector.includes(`[data-slot="${s}"]`)),
  );
  const armFor = (tier: string) => mine.find((r) => r.body.includes(`var(--dur-${tier})`));
  const enterArm = armFor("enter");
  const exitArm = armFor("exit");
  const tooltipArm = armFor("micro");
  const read = (arm: typeof enterArm, prop: string): string =>
    arm?.body.match(new RegExp(`${prop}:\\s*([^;]+);`))?.[1]?.trim() ?? "";

  test("retimes the click-opened surfaces from the shared tokens, in both directions", () => {
    for (const arm of [enterArm, exitArm]) {
      for (const slot of SURFACES) expect(arm?.selector).toContain(`[data-slot="${slot}"]`);
      expect(read(arm, "--tw-ease")).toMatch(/^var\(--ease-[a-z]+\)$/);
    }
    expect(exitArm?.selector).toContain('[data-state="closed"]');
    expect(enterArm?.selector).not.toContain("data-state");
  });

  test("pairs a distinct enter and exit rather than spending one timing twice", () => {
    // The same claim the ToC panel's suite above makes, for the same reason: the
    // vendored default this supersedes spent one duration and one curve in both
    // directions, and collapsing the arms back together is the regression to catch.
    expect(read(enterArm, "--tw-duration")).not.toBe(read(exitArm, "--tw-duration"));
    expect(read(enterArm, "--tw-ease")).not.toBe(read(exitArm, "--tw-ease"));
  });

  test("the tooltip takes the micro tier instead, symmetrically", () => {
    // The one hover-TRIGGERED surface in the set: NotifyBell, StatusStrip, VersionBadge
    // and VersionComparePicker all open it with delayDuration={0}, and an entrance's
    // worth of time before an instant tooltip resolves is the lag on the pointer
    // --dur-micro exists to avoid. Micro is symmetric by definition ("the SAME time in
    // both directions", tokens.css), so the tooltip takes one rule and no closed-state
    // arm — which also means it LEAVES on --ease-out, the one departure in the
    // vocabulary that does not take --ease-in. That follows from the same symmetry: a
    // hover tint does not invert its curve on the way out either.
    expect(tooltipArm?.selector).toContain('[data-slot="tooltip-content"]');
    expect(tooltipArm?.selector).not.toContain("data-state");
    expect(read(tooltipArm, "--tw-duration")).toBe("var(--dur-micro)");
    expect(read(tooltipArm, "--tw-ease")).toBe("var(--ease-out)");
    for (const arm of [enterArm, exitArm]) {
      expect(arm?.selector).not.toContain('[data-slot="tooltip-content"]');
    }
  });

  test("never mixes these surfaces with the modal ones", () => {
    // A dialog, an alert dialog and a sheet are not chrome that appears beside the
    // pointer — they take the whole surface, with a backdrop, and their timing is
    // theirs. They may well have rules of their own in this sheet; what must not happen
    // is one rule retiming both, because that is how a menu's tempo silently becomes a
    // modal's. So the check runs over every rule naming a surface from THIS set — three
    // of them, which is asserted too, since the likeliest way a modal gets swept in is a
    // FOURTH rule that a per-arm check would never look at.
    expect(mine).toHaveLength(3);
    for (const rule of mine) {
      for (const slot of MODAL) expect(rule.selector).not.toContain(`[data-slot="${slot}"]`);
    }
  });
});

describe("the vendored components' hover/focus tempo is caret's micro tier", () => {
  // The OTHER half of the two-track meeting, and the one that shows up on every
  // button rather than only on a portal. A bare `transition-colors` / `transition-all`
  // in the shadcn tree resolves through Tailwind's own theme defaults — 150ms on
  // cubic-bezier(.4, 0, .2, 1) — beside caret chrome that tints in --dur-micro on
  // --ease-out. Two hover tempos in one chrome is what the audit exists to catch, and
  // the theme keys are the whole fix: no selector, no per-component override, and a
  // vendored class that names its own duration (sheet's duration-200) still wins.
  const theme = themeBlock(appCss);
  const key = (name: string): string =>
    theme.match(new RegExp(`--default-transition-${name}:\\s*([^;]+);`))?.[1]?.trim() ?? "";

  test("both Tailwind transition defaults resolve to caret's tokens", () => {
    expect(theme).not.toBe("");
    expect(key("duration")).toBe("var(--dur-micro)");
    expect(key("timing-function")).toBe("var(--ease-out)");
  });
});

describe("chrome motion declarations draw from the tokens, not bare literals", () => {
  // The whole chrome, motion or not (see chromeComponents above). Each component's
  // `<style>` is scanned for `transition:`/`animation:` declarations; the one-shot ones
  // must time off var(--dur-*) with no bare seconds/ms literal, so the chrome
  // harmonizes on the shared vocabulary. A component with neither declares nothing to
  // scan and passes on an empty loop, which is the point of scanning the directory.
  const chrome = chromeComponents;

  // The ambient carve-out: these animations run on their own bespoke durations and
  // are deliberately EXEMPT from the one-shot tokens, so their literals are expected
  // to remain. Matched by keyframe name. The first two are infinite; ref-hint-ping
  // is finite (three pings) and is ambient by SCALE rather than by repetition — a
  // teaching pulse that read at --dur-enter would be a flicker, not a wave.
  const ambient = /\b(float|safe-mode-pulse|ref-hint-ping)\b/;

  // Pull every `transition:`/`animation:` declaration body (the text up to the
  // terminating semicolon) from a stylesheet, multi-line shorthands included.
  function motionDecls(css: string): string[] {
    return [...css.matchAll(/(?:transition|animation):\s*([\s\S]*?);/g)].map((m) => m[1] ?? "");
  }

  for (const path of chrome) {
    test(`${path} times every one-shot motion off var(--dur-*)`, () => {
      for (const decl of motionDecls(styleBlock(chromeSources[path] ?? ""))) {
        if (ambient.test(decl)) continue; // ambient carve-out keeps its literal
        // A one-shot reveal/transition references the duration token and leaves
        // no bare seconds/ms literal behind.
        expect(decl).toContain("var(--dur-");
        expect(decl).not.toMatch(/\b\d+(\.\d+)?m?s\b/);
      }
    });
  }

  test("the ambient animations keep their bespoke durations", () => {
    // The carve-out is real, not vacuous: each ambient animation still carries
    // its own long literal (4s float, 1.2s pulse, 1.6s ping) — the sweep must not
    // have pulled them onto the snappy one-shot tokens.
    expect(emptyState).toMatch(/animation:\s*float\s+4s\b/);
    expect(chromeSources["App.svelte"]).toMatch(/animation:\s*safe-mode-pulse\s+1\.2s\b/);
    expect(chromeSources["components/RefHintBadge.svelte"]).toMatch(
      /animation:\s*ref-hint-ping\s+1\.6s\b/,
    );
  });

  test("no chrome component keeps a reduced-motion block the global rule subsumes", () => {
    // The single global guard in app.css neutralizes movement for the whole
    // light-DOM root, so a per-component `@media (prefers-reduced-motion)`
    // block in these files is dead CSS. (app.css itself hosts the one global
    // rule and is excluded.)
    //
    // Matched against the comment-stripped source, the same way coreStyles.test.ts
    // reads its override body: a component that DEPENDS on the global guard has
    // every reason to say so in a comment — RefHintBadge's whole reduced-motion
    // story is that the guard reaches it — and a text rule that reds on the
    // explanation teaches the next author to delete the explanation.
    const withoutComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const path of chrome) {
      const css = withoutComments(styleBlock(chromeSources[path] ?? ""));
      expect(css).not.toMatch(/@media\s*\(prefers-reduced-motion/);
    }
  });
});
