import { describe, expect, test } from "bun:test";

import { jscSafeSource } from "$lib/diffview/jsc-regex.ts";

// jscSafeSource is the pure source→source transform shiki-bundle.ts hands every
// compiled pattern. It rewrites `(^X)?` into `(?:(^X)|)` — an equivalent form JSC
// matches correctly — and returns everything else byte-identical.
//
// The string assertions are the guard: a rewrite that regressed to a no-op fails
// them on any engine. The behavioral block at the bottom used to be the stronger
// check — it ran both forms and showed the original failing where the rewritten
// one matched — but that only worked while the host engine carried the bug, and
// bun's JSC no longer does (EXC-1156). It now documents the semantics here and
// guards them on the engines that still need the rewrite. See its own comment.

describe("jscSafeSource rewrites an optional anchored group", () => {
  test("rewrites a leading optional capture group", () => {
    // The TypeScript grammar's line-comment rule, reduced to its trigger.
    expect(jscSafeSource(String.raw`(^[\t ]+)?(?=\/\/)`)).toBe(String.raw`(?:(^[\t ]+)|)(?=\/\/)`);
  });

  test("rewrites an optional non-capturing group nested inside a capture group", () => {
    // The second shape the bundle carries: the `?` sits on an inner `(?:…)`, so the
    // outer capture group is left alone and only the inner one is rewritten.
    expect(jscSafeSource(String.raw`((?:^[\t ]+)?)(?=\/\/)`)).toBe(
      String.raw`((?:(?:^[\t ]+)|))(?=\/\/)`,
    );
  });

  test("rewrites a bare optional non-capturing group", () => {
    expect(jscSafeSource(String.raw`(?:^[\t ]+)?(#)[^\n]*`)).toBe(
      String.raw`(?:(?:^[\t ]+)|)(#)[^\n]*`,
    );
  });

  test("rewrites every site in a pattern, not just the first", () => {
    expect(jscSafeSource("(^a)?b(^c)?d")).toBe("(?:(^a)|)b(?:(^c)|)d");
  });

  test("preserves capture-group numbering", () => {
    // TextMate indexes captures positionally, so a rewrite that renumbered them
    // would repaint the wrong span. The alternation form is chosen precisely
    // because the inserted group is non-capturing and the original keeps its index.
    const rewritten = new RegExp(jscSafeSource(String.raw`(^[\t ]+)?(\/\/)(\s*)`), "dg");
    const m = rewritten.exec("  // x");
    expect(m?.[1]).toBe("  ");
    expect(m?.[2]).toBe("//");
    expect(m?.[3]).toBe(" ");
  });
});

describe("jscSafeSource leaves everything else byte-identical", () => {
  // The transform fires on one shape only; every other pattern must come back
  // unchanged, since a needlessly rewritten pattern is a needless behavior risk.
  const untouched = [
    // No anchor in the group.
    String.raw`([\t ]+)?(?=\/\/)`,
    // Anchored, but not optional — `^` genuinely applies, so there is nothing to fix.
    String.raw`(^[\t ]+)(?=\/\/)`,
    // Anchor not at the group's start.
    String.raw`([\t ]*^)?(?=\/\/)`,
    // A bare anchor with no group around it.
    String.raw`^[\t ]*(\/\/)`,
    // Escaped parens are literals, not group delimiters: a scanner that counted
    // them would pair `\(` with `\)` and misread the group boundaries entirely.
    String.raw`\(\^a\)?b`,
    // Parens inside a character class are literals too.
    "[(^)]?b",
    // An escaped backslash before a paren — the paren really does open a group,
    // and that group is not anchored.
    String.raw`\\(a)?b`,
    "",
  ];

  for (const source of untouched) {
    test(`passes through ${JSON.stringify(source)}`, () => {
      expect(jscSafeSource(source)).toBe(source);
    });
  }

  test("leaves a quantifier other than `?` alone", () => {
    // Only `?` occurs on an anchored group across shiki's full bundle (all 42
    // sites), so the transform is scoped to it rather than generalized to `*`.
    expect(jscSafeSource("(^a)*b")).toBe("(^a)*b");
  });

  test("leaves a lazy optional alone", () => {
    // `(^a)??` needs the mirrored rewrite `(?:|(^a))`, and no bundled pattern uses
    // it — so the scanner skips it rather than emitting a wrong-precedence guess.
    expect(jscSafeSource("(^a)??b")).toBe("(^a)??b");
  });
});

describe("jscSafeSource finds the group boundary through every prefix form", () => {
  // The scanner hand-parses regex source, so each prefix it claims to understand
  // needs a case: a prefix misread by one character puts the `^` test on the wrong
  // offset and the site is silently missed.
  const cases: Array<[string, string, string]> = [
    ["plain capture", "(^a)?b", "(?:(^a)|)b"],
    ["non-capturing", "(?:^a)?b", "(?:(?:^a)|)b"],
    ["named group", "(?<n>^a)?b", "(?:(?<n>^a)|)b"],
    ["lookahead", "(?=^a)?b", "(?:(?=^a)|)b"],
    ["negative lookahead", "(?!^a)?b", "(?:(?!^a)|)b"],
    ["lookbehind", "(?<=^a)?b", "(?:(?<=^a)|)b"],
    ["modifier group", "(?i:^a)?b", "(?:(?i:^a)|)b"],
  ];

  for (const [name, source, expected] of cases) {
    test(`rewrites through a ${name}`, () => {
      expect(jscSafeSource(source)).toBe(expected);
    });
  }

  test("does not mistake a class-bracketed paren for a group open", () => {
    // `[(]` is a literal `(`; only the real group that follows may be rewritten.
    expect(jscSafeSource("[(](^a)?b")).toBe("[(](?:(^a)|)b");
  });

  test("does not mistake an escaped paren for a group open", () => {
    expect(jscSafeSource(String.raw`\((^a)?b`)).toBe(String.raw`\((?:(^a)|)b`);
  });
});

describe("the rewritten form matches where the original diverges", () => {
  // The bug: JSC treats an optional group containing `^` as anchoring the whole
  // pattern, so scanning for the group's *absent* case fails. V8 returns a match.
  //
  // This block runs on whatever engine hosts the suite, and deliberately asserts
  // nothing about which one that is. The two JSCs in play move independently:
  // bun's is a fork on bun's release cadence, the UI's is whatever WebKit the
  // reviewer's browser ships. Measured under EXC-1156, they already disagree —
  // bun 1.4.0 returns a match for `/(^a)?b/.exec("xb")`, WebKit 26.5 still
  // returns null. So the suite's own engine is not evidence about the deployment
  // engine, and a reproduction asserted here would only pin the wrong one.
  //
  // What survives is the invariant that holds either way: the rewritten form
  // matches on every engine. The deletion trigger is a fixed BROWSER JSC, which
  // this suite cannot observe — see the header of jsc-regex.ts.
  //
  // Be clear about what these three cases are worth on each engine. On a FIXED
  // one — bun 1.4's — they pass under an identity transform too, so here they
  // document the intended semantics rather than guard them; the string assertions
  // in the describes above are what actually fail on a broken rewrite. On an
  // engine that still carries the bug, which is every WebKit that ships this code
  // today, they are a real behavioural guard. They earn their place on the second
  // engine, not the one running them — test/e2e/jsc-regex.e2e.ts runs the same
  // three there, under the webkit project (EXC-1223).
  const shapes = [
    String.raw`(^[\t ]+)?(?=\/\/)`,
    String.raw`((?:^[\t ]+)?)(?=\/\/)`,
    String.raw`(?:^[\t ]+)?(\/\/)`,
  ];

  for (const source of shapes) {
    test(`rewritten ${source} matches a trailing comment`, () => {
      // "code // x" — the comment rule has to match at index 5 having skipped the
      // leading-indent branch, which is exactly the case JSC drops.
      expect(new RegExp(jscSafeSource(source), "dg").exec("code // x")?.index).toBe(5);
    });
  }
});
