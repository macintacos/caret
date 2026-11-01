// Standing gate over the vendored shadcn tree: keyboard focus wears a control's hover look
// and never paints a ring (styles/base.css, doc/agents/shadcn-rules.md § Edits a re-sync
// will silently undo). The registry ships a ring on nearly every focusable component,
// so a re-sync would quietly bring them back.
//
// A ring here is a ring, border-ring or outline-width utility under any focus variant,
// including one keyed through `has-[…:focus-visible]`. `ring-0` paints nothing and
// passes. Forced colors needs no utility: base.css repaints an outline there itself.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");

const VENDORED_DIR = "ui/src/lib/components/ui";

function stripComments(source: string): string {
  return source.replace(/^\s*\/\/.*$/gm, "").replace(/<!--[\s\S]*?-->/g, "");
}

/** The utility after a class's variant chain, splitting on colons outside brackets. */
function variantsAndUtility(token: string): { variants: string; utility: string } {
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    else if (ch === ":" && depth === 0) cut = i;
  }
  return { variants: token.slice(0, cut + 1), utility: token.slice(cut + 1) };
}

function focusRings(source: string): string[] {
  return (stripComments(source).match(/[^\s"'`]+/g) ?? []).filter((token) => {
    const { variants, utility } = variantsAndUtility(token);
    return (
      /focus/.test(variants) &&
      /^(?:ring(?:-(?!0$)[^\s]*)?|border-ring|outline-\d|outline-ring[^\s]*)$/.test(utility)
    );
  });
}

test("no vendored component paints a focus ring", () => {
  const glob = new Bun.Glob("**/*.{svelte,ts}");
  const paths = [...glob.scanSync({ cwd: join(REPO_ROOT, VENDORED_DIR) })].sort();
  expect(paths.length).toBeGreaterThan(100); // an empty walk would pass vacuously

  const violations = paths.flatMap((path) =>
    focusRings(readFileSync(join(REPO_ROOT, VENDORED_DIR, path), "utf-8")).map(
      (token) => `${VENDORED_DIR}/${path}: ${token}`,
    ),
  );
  expect(violations).toEqual([]);
});

test("the rule reds on a ring under any focus variant", () => {
  expect(focusRings('"focus-visible:ring-3"')).toEqual(["focus-visible:ring-3"]);
  expect(focusRings('"dark:focus-visible:ring-destructive/40"')).toHaveLength(1);
  expect(focusRings('"focus-visible:border-ring"')).toHaveLength(1);
  expect(focusRings('"focus-visible:outline-1"')).toHaveLength(1);
  expect(focusRings('"has-[[data-slot=x]:focus-visible]:ring-3"')).toHaveLength(1);
});

test("the rule passes ring-0, a ring with no focus variant, and comments", () => {
  expect(focusRings('"focus-visible:ring-0 in-data-[slot=x]:focus-within:ring-0"')).toEqual([]);
  expect(focusRings('"aria-invalid:ring-3 focus-visible:outline-hidden"')).toEqual([]);
  expect(focusRings('  // registry ships focus-visible:ring-3\n"rounded-lg"')).toEqual([]);
});
