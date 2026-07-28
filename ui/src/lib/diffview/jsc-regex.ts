// A JavaScriptCore workaround for shiki's pure-JS regex engine.
//
// JSC treats an optional group containing `^` as anchoring the ENTIRE pattern, so
// the branch where the group matches nothing is never tried:
//
//     /(^a)?b/.exec("xb")   // V8: ["b", undefined]   JSC: null
//
// TextMate comment rules are built on exactly that shape — the leading-indent
// group is optional because a comment may follow code on the same line. The
// TypeScript grammar's is `(^[\t ]+)?((//)…)`, so under JSC a `//` after code
// never matched the comment rule and fell through to the arithmetic-operator
// rule. It affects every C-family `//`, SQL/Lua/Haskell `--`, Lisp/asm `;`, and
// block-comment `*/` rule in shiki's bundle: 42 of its 14,234 patterns carry the
// shape. (How many of those *observably* diverge depends on the input you probe
// with; the count of patterns carrying the shape is the checkable number.)
//
// `(^X)?` and `(?:(^X)|)` are equivalent — a greedy optional is "try X, then try
// empty" — but JSC matches the second correctly, so rewriting the compiled source
// restores Oniguruma-identical tokenization while keeping the pure-JS engine and
// shipping no WASM (EXC-523). The alternation form is deliberate: it keeps the
// original group in place, and TextMate indexes captures POSITIONALLY, so a
// rewrite that dropped or reordered the group would repaint the wrong span.
//
// This is a source-level workaround for a JSC bug, not a shiki bug. It is written
// to be a no-op on a fixed JSC — the rewritten form is correct everywhere — so the
// module can simply be deleted if the engine is ever repaired.

/**
 * The prefixes a group can open with, ordered so a longer form wins over a shorter
 * one it starts with (`(?<=` must not read as a named group called `=`). Matches
 * the empty string after `(` for a plain capture group.
 */
const GROUP_PREFIX = /^\((?:\?<[=!]|\?<[^>]*>|\?[=!]|\?[a-zA-Z]*(?:-[a-zA-Z]+)?:)?/;

/** A `(^…)?` occurrence: the index of its `(` and of its `)`. */
interface Site {
  open: number;
  close: number;
}

/**
 * The first `(^…)?` in `source`, or null. Scans paren-balanced so a group's own
 * `(` is paired with its own `)`, skipping escapes (`\(`) and character classes
 * (`[(]`) — in both, a paren is a literal and pairing on it would misread every
 * group boundary that follows.
 */
function findSite(source: string): Site | null {
  const stack: number[] = [];
  let inClass = false;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      i++;
      continue;
    }
    if (c === "[") {
      inClass = true;
      i++;
      continue;
    }
    if (c === "(") {
      stack.push(i);
      i++;
      continue;
    }
    if (c === ")") {
      const open = stack.pop();
      i++;
      if (open === undefined) continue;
      // A plain `?` only. `??` is lazy — a different rewrite — and `*`/`+`/`{n,}`
      // are different quantifiers again. None occurs on an anchored group anywhere
      // in shiki's bundle (all 42 sites are `?`), so they are left alone rather
      // than generalized over speculatively.
      if (source[i] !== "?" || source[i + 1] === "?") continue;
      const prefix = GROUP_PREFIX.exec(source.slice(open));
      if (source[open + (prefix?.[0].length ?? 1)] !== "^") continue;
      return { open, close: i - 1 };
    }
    i++;
  }
  return null;
}

/**
 * Rewrites every `(^X)?` in a compiled regex source to the JSC-safe `(?:(^X)|)`,
 * leaving a pattern with no such group byte-identical. Capture-group numbering is
 * preserved — the inserted group is non-capturing and the original keeps its
 * position.
 *
 * Rewriting the leftmost site and rescanning from the start is what makes nesting
 * safe: the inserted group's body begins with `(`, never `^`, so a rewritten site
 * cannot re-qualify and each pass removes exactly one site.
 */
export function jscSafeSource(source: string): string {
  let out = source;
  for (let site = findSite(out); site !== null; site = findSite(out)) {
    const group = out.slice(site.open, site.close + 1);
    out = `${out.slice(0, site.open)}(?:${group}|)${out.slice(site.close + 2)}`;
  }
  return out;
}
