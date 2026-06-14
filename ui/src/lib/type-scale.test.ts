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
});

// Genuine display/glyph one-offs are exempt from the scale but must carry an
// inline justification so the exemption is intentional, not a missed migration.
// Keyed by component → the literal sizes allowed there.
const EXEMPT: Record<string, string[]> = {
  "EmptyState.svelte": ["6rem", "1.7rem"],
  "RequestChangesDialog.svelte": ["1.35rem"],
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
