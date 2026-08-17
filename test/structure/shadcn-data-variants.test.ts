// Standing gate over the vendored shadcn tree: a bare `data-<word>:` variant is
// legal only when the attribute is stamped as presence (EXC-1117).
//
// Tailwind compiles a bare `data-open:` into an `[data-open]` PRESENCE selector.
// When whatever stamps the attribute gives it a *value*, the utility misfires in
// one of two silent directions — dead (`data-horizontal:` against bits-ui's
// `data-orientation="horizontal"`) or always-on (`data-active:` against Svelte's
// serialization of `isActive={false}` as `data-active="false"`). Neither mode is
// visible to a mount suite, because happy-dom computes no layout: EXC-1101
// shipped a volume slider whose track was 0px tall behind 290 lines of new
// passing unit tests. The rule is therefore text-level, and this is where it
// reds.
//
// The allowlist below is the rule's VOCABULARY, not an exception list. The rule
// is "presence selectors are for presence attributes", which cannot be stated
// without naming which attributes those are — the same standing
// `e2e-conventions.test.ts` gives `PLAYWRIGHT_BOUNDARY`. No entry excuses a
// file; every entry is one grep against bits-ui away from falsifiable.
//
// Comment lines are stripped before matching, and that is load-bearing rather
// than tidy: `dialog-content`, `dialog-overlay`, `popover-content` and
// `select-content` each SPELL `data-open:` in the comment EXC-891 left behind
// explaining why they no longer use it, so an unstripped read reports four
// violations against the prose that documents the fix.
//
// What it deliberately does not catch: a class assembled at runtime from string
// concatenation, which no vendored component does today; and the `data-active`
// bits-ui stamps as presence on the slider THUMB, which is a legal bare variant
// that would nonetheless red here — no vendored class uses it, and the day one
// does, this comment is the record of why the red is a false positive.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The suite sits at test/structure/, two levels below the repo root; resolving
// against import.meta.dir reads the real tree regardless of the runner's cwd.
const REPO_ROOT = join(import.meta.dir, "..", "..");

const VENDORED_DIR = "ui/src/lib/components/ui";

/**
 * Every data-attribute variant in a class string, group modifier included.
 *
 * `peer-data-active/menu-button:` is the form `sidebar-menu-badge.svelte` uses;
 * a pattern that stops at the colon misses it and reports the file clean. The
 * valued bracket form (`data-[state=open]:`) never matches, because `[` is not
 * in the attribute character class.
 */
const VARIANT = /(?:has-|group-|peer-|in-|not-|\*:)*data-([a-z][a-z0-9-]*)(?:\/[a-z-]+)?:/g;

/**
 * Attributes bits-ui stamps as `"" | undefined`, so `[data-x]` presence is the
 * CORRECT selector. Verified against bits-ui 2.18.1, where the presence shape is
 * `boolToEmptyStrOrUndef(...)` / `x ? "" : undefined` and the valued one is a
 * plain assignment (`"data-orientation": this.opts.orientation.current`). Each
 * entry is one grep away from falsifiable:
 *
 *   grep -r '"data-disabled":' node_modules/.bun/bits-ui@*\/node_modules/bits-ui/dist
 */
const PRESENCE_VALUED = new Set(["disabled", "highlighted", "selected", "placeholder"]);

/** Line-leading `//` lines and `<!--…-->` blocks, blanked before matching. A
 * URL mid-line survives, which is why the `//` form is anchored. Newlines are
 * kept — a `<!--…-->` spanning lines would otherwise shift every line number
 * below it, and an offence that names the wrong line is worse than none. */
function stripComments(source: string): string {
  return source
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/<!--[\s\S]*?-->/g, (block) => block.replace(/[^\n]/g, ""));
}

/**
 * Every bare-presence variant in `source` whose attribute is not presence-valued,
 * as `<line>: <variant>` strings.
 */
function offences(source: string): string[] {
  const found: string[] = [];
  const lines = stripComments(source).split("\n");
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(VARIANT)) {
      // The capture group is not optional, so a match always carries it.
      if (PRESENCE_VALUED.has(match[1]!)) continue;
      found.push(`${index + 1}: ${match[0]}`);
    }
  }
  return found;
}

test("no vendored component keys a utility on a bare data-<word>: variant", () => {
  const glob = new Bun.Glob("**/*.svelte");
  const paths = [...glob.scanSync({ cwd: join(REPO_ROOT, VENDORED_DIR) })].sort();
  // Without this the walk goes vacuous if the tree ever moves: an empty scan
  // passes while covering nothing. Same guard, same reason, as
  // e2e-conventions.test.ts.
  expect(paths.length).toBeGreaterThan(100);

  const violations: string[] = [];
  for (const path of paths) {
    const source = readFileSync(join(REPO_ROOT, VENDORED_DIR, path), "utf-8");
    for (const offence of offences(source)) {
      violations.push(
        `${VENDORED_DIR}/${path}:${offence} — the attribute carries a value, so this ` +
          `compiles to a presence selector that never matches (or always does). Use the ` +
          `valued bracket form, e.g. data-[state=open]: or data-[active=true]:.`,
      );
    }
  }
  expect(violations).toEqual([]);
});

// The two cases below pin the detector's own behaviour — the half of the gate a
// tree walk cannot prove, since a walk over a clean tree passes just as readily
// when the rule is broken. Sources are literals rather than files because the
// walk above only reads ui/src/lib/components/ui/, so this file is never one of
// its inputs.

test("the rule reds on a bare variant and names the attribute", () => {
  expect(offences("data-open:animate-in")).toEqual(["1: data-open:"]);
  expect(offences("peer-data-active/menu-button:hidden")).toEqual([
    "1: peer-data-active/menu-button:",
  ]);
});

test("the rule passes a valued bracket form and a presence-valued attribute", () => {
  expect(offences("data-[state=open]:animate-in")).toEqual([]);
  expect(offences("data-disabled:opacity-50")).toEqual([]);
  expect(offences("group-data-selected/command-item:text-accent")).toEqual([]);
  // The comments the EXC-891 fix left behind spell the banned form in prose.
  expect(offences("  // a bare `data-open:` compiles to [data-open]")).toEqual([]);
  expect(offences("<!-- data-open: -->")).toEqual([]);
});
