// Standing gate over the vendored shadcn tree: a component whose focus cue is a
// ring or border must hide its outline with `focus-visible:outline-hidden`, never
// `outline-none`.
//
// Forced-colors mode strips box-shadows, so a ring-only focus cue vanishes there.
// `outline-none` is `outline-style: none`, which forced colors leaves invisible;
// `outline-hidden` paints a transparent outline that forced colors repaints, and the
// `focus-visible:` scope keeps it off at rest. The registry ships `outline-none`, so a
// re-sync reverts the patch silently — this is where it reds. `settings.e2e.ts` checks
// the computed outline under emulated forced colors.
//
// Components with no focus cue of their own (scroll containers, programmatic
// focus targets, the input-group wrapper keyed on `has-[…:focus-visible]`)
// match no `focus-visible:ring`/`border` utility, so they need no allowlist. It is a
// whole-file heuristic, and it cannot see `focus:` or `focus-within:` cues.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");

const VENDORED_DIR = "ui/src/lib/components/ui";

const FOCUS_CUE = /(?<![\w-])focus-visible:(?:ring|border)/;

/** Line-leading `//` lines and `<!--…-->` blocks, blanked before matching. */
function stripComments(source: string): string {
  return source.replace(/^\s*\/\/.*$/gm, "").replace(/<!--[\s\S]*?-->/g, "");
}

function hidesOutlineUnsafely(source: string): boolean {
  const code = stripComments(source);
  return FOCUS_CUE.test(code) && /\boutline-none\b/.test(code);
}

test("no focus-cued vendored component uses outline-none", () => {
  const glob = new Bun.Glob("**/*.{svelte,ts}");
  const paths = [...glob.scanSync({ cwd: join(REPO_ROOT, VENDORED_DIR) })].sort();
  expect(paths.length).toBeGreaterThan(100); // an empty walk would pass vacuously

  const violations = paths
    .filter((path) =>
      hidesOutlineUnsafely(readFileSync(join(REPO_ROOT, VENDORED_DIR, path), "utf-8")),
    )
    .map(
      (path) =>
        `${VENDORED_DIR}/${path}: use focus-visible:outline-hidden, which forced colors repaints`,
    );
  expect(violations).toEqual([]);
});

test("the rule reds on a ring-cued outline-none and passes outline-hidden", () => {
  expect(hidesOutlineUnsafely('"outline-none focus-visible:ring-3"')).toBe(true);
  expect(hidesOutlineUnsafely('"outline-none focus-visible:border-ring"')).toBe(true);
  expect(hidesOutlineUnsafely('"outline-none dark:focus-visible:ring-3"')).toBe(true);
  expect(hidesOutlineUnsafely('"focus-visible:outline-hidden focus-visible:ring-3"')).toBe(false);
});

test("the rule passes an outline-none with no focus cue of its own", () => {
  expect(hidesOutlineUnsafely('"scroll-py-1 outline-none"')).toBe(false);
  expect(hidesOutlineUnsafely('"outline-none has-[[data-slot=x]:focus-visible]:ring-3"')).toBe(
    false,
  );
  expect(hidesOutlineUnsafely('"outline-none group-focus-visible:ring-3"')).toBe(false);
  expect(
    hidesOutlineUnsafely(
      '  // registry ships outline-none\n"focus-visible:outline-hidden focus-visible:ring-3"',
    ),
  ).toBe(false);
});
