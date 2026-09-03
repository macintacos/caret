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
// The one FALSE POSITIVE it can raise: a bare variant on a bits-ui attribute the
// allowlist does not yet name — the `data-active` the slider THUMB stamps as
// presence, or an attribute a newly vendored tree brings in. That red is fixed
// by extending PRESENCE_VALUED, not by rewriting the class, which is why the
// failure message names both remedies.
//
// What it deliberately does not catch: a class assembled at runtime from string
// concatenation, which no vendored component does today.
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
const VARIANT = /(?:has-|group-|peer-|in-|not-|\*:)*data-([a-z][a-z0-9-]*)(?:\/[a-z0-9_-]+)?:/g;

/**
 * Attributes bits-ui stamps as `"" | undefined`, so `[data-x]` presence is the
 * CORRECT selector. Verified against bits-ui 2.19.0, where the presence shape is
 * `boolToEmptyStrOrUndef(...)` / `x ? "" : undefined` and the valued one is a
 * plain assignment (`"data-orientation": this.opts.orientation.current`). Each
 * entry is one grep away from falsifiable:
 *
 *   grep -r '"data-disabled":' node_modules/.bun/bits-ui@*\/node_modules/bits-ui/dist
 *
 * These four are the ones TODAY'S tree uses, not the whole of what bits-ui
 * stamps that way — it presence-stamps ~22 attributes, `data-readonly`,
 * `data-invalid` and `data-today` among them. A newly vendored tree (calendar,
 * pin-input, pagination) may therefore red here on a variant that is perfectly
 * correct; extend this set rather than rewriting the class.
 *
 * The set is keyed on the attribute NAME, so it trusts a name rather than a
 * stamper. `data-disabled` already has two conventions in this ecosystem —
 * bits-ui stamps it presence, while shadcn's own Field treats it as a boolean
 * prop (hence `group-data-[disabled=true]/field:` in field-label.svelte). Every
 * bare `data-disabled:` in the tree today sits on a bits-ui primitive; one
 * landing inside the `field` tree would pass this gate while always matching.
 */
const PRESENCE_VALUED = new Set(["disabled", "highlighted", "selected", "placeholder"]);

/** Prepended once when the walk finds anything, rather than repeated per
 * offence — a full re-sync revert lists dozens, and `e2e-conventions.test.ts`
 * pushes bare `path:line: rule` entries for the same reason. */
const HINT =
  "A bare data-<word>: variant compiles to an [attribute] PRESENCE selector. " +
  "If the stamper gives the attribute a value, use the valued bracket form " +
  '(data-[state=open]:, data-[active=true]:). If bits-ui stamps it "" | undefined, ' +
  "add it to PRESENCE_VALUED instead — see this file's header.";

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
  // Tailwind scans the directory (`@source "./lib/components/ui"`), not a
  // glob, so a class string in a `.ts` — a `tv()` lifted out of a component —
  // is emitted from too and has to be read here as well.
  const glob = new Bun.Glob("**/*.{svelte,ts}");
  const paths = [...glob.scanSync({ cwd: join(REPO_ROOT, VENDORED_DIR) })].sort();
  // Without this the walk goes vacuous if the tree ever moves: an empty scan
  // passes while covering nothing. Same guard, same reason, as
  // e2e-conventions.test.ts.
  expect(paths.length).toBeGreaterThan(100);

  const violations: string[] = [];
  for (const path of paths) {
    const source = readFileSync(join(REPO_ROOT, VENDORED_DIR, path), "utf-8");
    for (const offence of offences(source)) violations.push(`${VENDORED_DIR}/${path}:${offence}`);
  }
  if (violations.length > 0) violations.unshift(HINT);
  expect(violations).toEqual([]);
});

// The cases below pin the detector's own behaviour — the half of the gate a
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

test("a multi-line comment blanks without shifting the lines below it", () => {
  // The newline preservation in stripComments has no other witness: every case
  // above is single-line, so each asserts line 1 and would pass just as readily
  // if the block collapsed. Here the offence is on line 3, and a strip that
  // dropped the comment's newlines would report it as line 1.
  const source = "<!-- data-open:\n     still a comment -->\ndata-open:animate-in";
  expect(offences(source)).toEqual(["3: data-open:"]);
});
