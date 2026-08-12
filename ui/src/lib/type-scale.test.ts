import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { readAppCss, rootBlock } from "$lib/appCss.ts";

// caret's chrome font sizing flows from one named scale declared in app.css: a
// set of --text-* steps with paired --leading-* tokens. This suite pins that
// the scale exists, that the shared atoms and the diff-view bridge draw from it,
// and that no chrome component reintroduces a raw font-size literal — so a
// drift (a stray `font-size: 0.82rem`) fails the unit suite instead of silently
// fragmenting the scale again.

const UI_SRC = join(import.meta.dir, "..");
const appCss = readAppCss();

// The documented type-scale steps and their rem values, in ascending order.
const TEXT_STEPS: Record<string, string> = {
  "--text-2xs": "0.65rem",
  "--text-xs": "0.7rem",
  "--text-sm": "0.78rem",
  "--text-base": "0.82rem",
  "--text-md": "0.9rem",
  "--text-lg": "1rem",
  "--text-xl": "1.15rem",
};

// Role-keyed leading tokens paired with the steps above.
const LEADING_TOKENS: Record<string, string> = {
  "--leading-none": "1",
  "--leading-tight": "1.3",
  "--leading-snug": "1.45",
  "--leading-normal": "1.55",
  "--leading-relaxed": "1.7",
};

describe("the --text-*/--leading-* type scale in app.css", () => {
  // Keyed on a token the scale owns, so the lookup is self-locating. A marker
  // that matches nothing yields "" and every assertion below fails, so this
  // cannot mask a missing block.
  const root = rootBlock(appCss, "--text-base:");

  for (const [token, value] of Object.entries(TEXT_STEPS)) {
    test(`declares ${token}: ${value}`, () => {
      expect(root).toContain(`${token}: ${value};`);
    });
  }

  for (const [token, value] of Object.entries(LEADING_TOKENS)) {
    test(`declares ${token}: ${value}`, () => {
      expect(root).toContain(`${token}: ${value};`);
    });
  }

  test("the .mono atom draws its font-size from the scale", () => {
    const rule = appCss.match(/\.mono\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/font-size:\s*var\(--text-/);
  });

  test("the .eyebrow atom draws its font-size from the scale", () => {
    const rule = appCss.match(/\.eyebrow\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/font-size:\s*var\(--text-/);
  });

  test("the .diffview bridge draws font-size/line-height from the scale", () => {
    const rule = appCss.match(/\.diffview\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(rule).toMatch(/--diffs-font-size:\s*var\(--text-/);
    expect(rule).toMatch(/--diffs-line-height:\s*var\(--leading-/);
  });

  // EXC-621's committed per-surface decision. The diff mono is stepped UP to the
  // --text-base step (0.82rem ≈ 13.12px at the 16px root) — the library's ~13px
  // reference — for crispness, decoupled from the .mono inline-chrome step
  // (--text-sm ≈ 12.48px). Its line-height is stepped up too, to --leading-relaxed:
  // the plan view draws inline chips, and a chip is taller than its glyphs, so two
  // stacked chips need the extra leading between the rows. Pinning both exact steps
  // makes the size/line-height choice falsifiable, not just prose.
  test("the .diffview bridge commits the diff-mono step-up to --text-base", () => {
    const rule = appCss.match(/\.diffview\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(rule).toMatch(/--diffs-font-size:\s*var\(--text-base\);/);
    expect(rule).toMatch(/--diffs-line-height:\s*var\(--leading-relaxed\);/);
  });

  // The chrome reading base is held at 15px (EXC-621). It is an absolute-px
  // declaration on <body>, distinct from the 16px rem origin the scale resolves
  // against; pinning it guards the legibility floor against a silent shrink.
  test("the body reading base holds 15px", () => {
    // The standalone `body { … }` rule (not the `html, body` reset that shares a
    // selector) carries the reading base. Scan every body-bearing rule for the
    // 15px declaration so the assertion doesn't hinge on rule ordering.
    const bodyRules = [...appCss.matchAll(/(?:^|[,\s])body\s*\{([^}]*)\}/gm)].map((m) => m[1]);
    expect(bodyRules.some((r) => /font-size:\s*15px;/.test(r ?? ""))).toBe(true);
  });
});

// Genuine display/glyph one-offs are exempt from the scale but must carry an
// inline justification so the exemption is intentional, not a missed migration.
// Keyed by component → the literal sizes allowed there.
const EXEMPT: Record<string, string[]> = {
  "EmptyState.svelte": ["6rem", "1.7rem"],
  "RequestChangesDialog.svelte": ["1.35rem"],
  // Shares the request-changes dialog's title size — the two review dialogs read
  // as one vocabulary, so their <h2> sits at the same display step above the scale.
  "UnsentCommentsDialog.svelte": ["1.35rem"],
  // The Settings dialog title shares that same display step, so the app's modals
  // read as one vocabulary (EXC-730).
  "SettingsDialog.svelte": ["1.35rem"],
  // The Shift+C key cap sizes its glyph relative to the dense status-strip text
  // (a keycap one-off, not a type-scale step), so it carries a raw em rather than
  // a --text-* token.
  "StatusStrip.svelte": ["0.9em"],
};

describe("chrome components reference the scale, not raw font-size literals", () => {
  const componentsDir = join(UI_SRC, "components");
  const files = readdirSync(componentsDir).filter((f) => f.endsWith(".svelte"));
  // App.svelte is chrome too, even though it sits a directory up.
  const targets = [
    ...files.map((f) => ({ name: f, path: join(componentsDir, f) })),
    { name: "App.svelte", path: join(UI_SRC, "App.svelte") },
  ];

  for (const { name, path } of targets) {
    test(`${name} has no unscaled font-size literal`, async () => {
      const src = await Bun.file(path).text();
      const allowed = new Set(EXEMPT[name] ?? []);
      // Match `font-size: <number><unit>` — a literal, not a var().
      const literals = [...src.matchAll(/font-size:\s*([\d.]+(?:rem|px|em))/g)].map(
        (m) => m[1] ?? "",
      );
      const unscaled = literals.filter((v) => !allowed.has(v));
      expect(unscaled).toEqual([]);
    });
  }
});
