import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { readAppCss, rootBlock } from "$lib/appCss.ts";
import { FOLLOW_ANIM_MS, SCROLL_ANIM_MS } from "$lib/diffview/scroll.ts";

// caret's motion vocabulary lives in app.css: a small set of functional
// duration/easing tokens for one-shot chrome reveals, plus a single global
// prefers-reduced-motion rule that neutralizes movement for the light-DOM app
// root. This suite pins the substrate the acceptance criteria require — the
// token shape, the ≤200ms functional ceiling, and the global guard — so a drift
// fails the unit suite rather than only showing as motion under reduced-motion.

const uiDir = join(import.meta.dir, "..");
const appCss = readAppCss();
const composer = await Bun.file(join(uiDir, "components/SourceComposer.svelte")).text();
const emptyState = await Bun.file(join(uiDir, "components/EmptyState.svelte")).text();

// Every light-DOM chrome component whose CSS carries a one-shot reveal or a
// hover/state transition, loaded once for the migration-coverage suite below.
const chromeComponents = [
  "App.svelte",
  "components/RequestChangesDialog.svelte",
  "components/EmptyState.svelte",
  "components/TopBar.svelte",
  "components/ReviewSwitcher.svelte",
  // The plan's heading-navigation chrome: it inherited this list's slot from the
  // contents rail EXC-949 deleted, so the surface keeps its motion-token coverage.
  "components/PlanBreadcrumbs.svelte",
  // The other half of that chrome (EXC-1107). Its panel is PORTALLED rather than
  // light-DOM, which changes nothing this list checks: the tokens are the same
  // vocabulary, and the reduced-motion assertion is if anything stronger there — the
  // global rule reaches a portalled surface through its [data-slot] anchor, so a
  // per-component block here would be dead CSS in the one place it looks most needed.
  "components/PlanToc.svelte",
  "components/CommentNavigator.svelte",
  "components/NotifyBell.svelte",
  "components/VersionBadge.svelte",
  "components/SourceAnnotationCard.svelte",
  "components/DiffPlanView.svelte",
  // The plan surface's reference-teaching badge (EXC-1061). Its ping is ambient and
  // carved out below, so what listing it buys is the OTHER assertion: the badge's
  // whole reduced-motion story is that the global guard reaches it, which is only
  // true while it grows no block of its own.
  "components/RefHintBadge.svelte",
  "components/FileDrawer.svelte",
  "components/FilePreview.svelte",
  "components/VersionComparePicker.svelte",
  "components/UnsentCommentsDialog.svelte",
  "components/AlertHost.svelte",
  "components/ThemePreviewCard.svelte",
  // The settings-redesign surfaces (EXC-837 tree), pulled under the same coverage so
  // their one-shot hover/reveal motion stays on the shared --dur-* tokens and none
  // grows a per-component reduced-motion block the global rule already subsumes.
  "components/SettingsDialog.svelte",
  "components/SettingSelect.svelte",
  "components/NotificationsPane.svelte",
  "components/AdvancedPane.svelte",
  "components/ShortcutsHelp.svelte",
  "components/KeyboardHelpButton.svelte",
];
const chromeSources: Record<string, string> = Object.fromEntries(
  await Promise.all(
    chromeComponents.map(async (p) => [p, await Bun.file(join(uiDir, p)).text()] as const),
  ),
);

// Parse a ms/s duration value to milliseconds. Returns NaN for non-time values.
function toMs(value: string): number {
  const v = value.trim();
  if (v.endsWith("ms")) return Number.parseFloat(v);
  if (v.endsWith("s")) return Number.parseFloat(v) * 1000;
  return Number.NaN;
}

describe("motion tokens in app.css", () => {
  // Keyed on a token the motion vocabulary owns, so the lookup is
  // self-locating. A marker that matches nothing yields "" and every assertion
  // below fails, so this cannot mask a missing block.
  const root = rootBlock(appCss, "--dur-fast:");

  test("declares two functional one-shot durations, both ≤200ms", () => {
    const fast = root.match(/--dur-fast:\s*([^;]+);/)?.[1] ?? "";
    const base = root.match(/--dur-base:\s*([^;]+);/)?.[1] ?? "";
    expect(fast).not.toBe("");
    expect(base).not.toBe("");
    // Functional reveal durations stay snappy — the AC caps them at 200ms.
    expect(toMs(fast)).toBeLessThanOrEqual(200);
    expect(toMs(base)).toBeLessThanOrEqual(200);
    expect(toMs(fast)).toBeGreaterThan(0);
    expect(toMs(base)).toBeGreaterThan(0);
  });

  test("the plan's two JS scroll durations mirror their tokens", () => {
    // scrollTop is a JS property no stylesheet can drive, so scroll.ts carries each
    // token's value as a constant instead of reading it. That makes them numbers
    // coupled across files, which svelte-rules.md § CSS-token discipline says to
    // name once and TEST — the same pin layout.test.ts holds REFERENCE_WIDTH_PX to.
    const travel = root.match(/--dur-travel:\s*([^;]+);/)?.[1] ?? "";
    const fast = root.match(/--dur-fast:\s*([^;]+);/)?.[1] ?? "";
    expect(travel).not.toBe("");
    expect(fast).not.toBe("");
    expect(SCROLL_ANIM_MS).toBe(toMs(travel)); // the jump to a place
    expect(FOLLOW_ANIM_MS).toBe(toMs(fast)); // the cursor follow
  });

  test("--dur-travel is the only duration above the 200ms ceiling", () => {
    // The carve-out has exactly one member, and this is what keeps it that way: it
    // is a TRAVEL time (the plan's scroll crosses hundreds of px), not a reveal, so
    // the ceiling's "chrome reads quick, never sluggish" reasoning does not apply.
    // A second token slipping over 200ms reds here rather than at review.
    const durations = [...root.matchAll(/--dur-([a-z]+):\s*([^;]+);/g)];
    expect(durations.length).toBeGreaterThanOrEqual(3);
    const over = durations.filter(([, , value]) => toMs(value ?? "") > 200).map(([, name]) => name);
    expect(over).toEqual(["travel"]);
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
  const read = (block: string, prop: string): string =>
    block.match(new RegExp(`${prop}:\\s*([^;]+);`))?.[1]?.trim() ?? "";

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

describe("chrome motion declarations draw from the tokens, not bare literals", () => {
  // Every light-DOM chrome component whose CSS carries a one-shot reveal or a
  // hover/state transition. Each is scanned for `transition:`/`animation:`
  // declarations; the one-shot ones must time off var(--dur-*) with no bare
  // seconds/ms literal, so the chrome harmonizes on the shared vocabulary.
  const chrome = chromeComponents;

  // The ambient carve-out: these animations run on their own bespoke durations and
  // are deliberately EXEMPT from the one-shot tokens, so their literals are expected
  // to remain. Matched by keyframe name. The first two are infinite; ref-hint-ping
  // is finite (three pings) and is ambient by SCALE rather than by repetition — a
  // teaching pulse that read at --dur-base would be a flicker, not a wave.
  const ambient = /\b(float|safe-mode-pulse|ref-hint-ping)\b/;

  // Pull every `transition:`/`animation:` declaration body (the text up to the
  // terminating semicolon) from a stylesheet, multi-line shorthands included.
  function motionDecls(css: string): string[] {
    return [...css.matchAll(/(?:transition|animation):\s*([\s\S]*?);/g)].map((m) => m[1] ?? "");
  }

  for (const path of chrome) {
    test(`${path} times every one-shot motion off var(--dur-*)`, () => {
      for (const decl of motionDecls(chromeSources[path] ?? "")) {
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
      const css = withoutComments(chromeSources[path] ?? "");
      expect(css).not.toMatch(/@media\s*\(prefers-reduced-motion/);
    }
  });
});
