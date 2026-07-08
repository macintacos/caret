import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

// caret's chrome font sizing flows from one named scale declared in app.css: a
// set of --text-* steps with paired --leading-* tokens. This suite pins that
// the scale exists, that the shared atoms and the diff-view bridge draw from it,
// and that no chrome component reintroduces a raw font-size literal — so a
// drift (a stray `font-size: 0.82rem`) fails the unit suite instead of silently
// fragmenting the scale again.

const UI_SRC = join(import.meta.dir, "..");
const appCss = await Bun.file(join(UI_SRC, "app.css")).text();

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
};

// The body of the :root { … } light-theme block (first occurrence), where the
// scale tokens are declared.
function rootBlock(css: string): string {
  const start = css.indexOf(":root {");
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return "";
}

describe("the --text-*/--leading-* type scale in app.css", () => {
  const root = rootBlock(appCss);

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
  // (--text-sm ≈ 12.48px). Diff line-height stays --leading-normal so the diff
  // shares the chrome's reading rhythm. Pinning the exact step makes the
  // size/line-height choice falsifiable, not just prose.
  test("the .diffview bridge commits the diff-mono step-up to --text-base", () => {
    const rule = appCss.match(/\.diffview\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    expect(rule).toMatch(/--diffs-font-size:\s*var\(--text-base\);/);
    expect(rule).toMatch(/--diffs-line-height:\s*var\(--leading-normal\);/);
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
  "ApproveConfirmDialog.svelte": ["1.35rem"],
  // The rendered plan is a *document* surface (EXC-693), not chrome: its heading
  // hierarchy and inline-code step are em-relative on purpose, so they scale with
  // the reader's base rather than snapping to the chrome's absolute --text-* steps.
  "RenderedPlanView.svelte": ["1.7em", "1.4em", "1.2em", "1.05em", "0.9em"],
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
