import { describe, expect, test } from "bun:test";

import { bundledLanguages as fullShikiBundle } from "shiki/bundle/full";
import { createHighlighterCore } from "shiki/core";

import { shikiThemeFor } from "$lib/caret-theme.ts";
import {
  bundledLanguages,
  bundledThemes,
  CARET_TOKENIZE_OPTIONS,
  createCaretRegexEngine,
} from "$lib/diffview/shiki-bundle.ts";

// EXC-665: caret bundles shiki's FULL grammar set, so every language an agent can
// tag a fenced code block with highlights in the plan review UI — not just a
// hand-picked subset. (caret runs entirely locally, so the embedded asset's size
// is a non-concern.) These assertions guard against silently re-narrowing the
// bundle, which is what left `lua` — and every other unlisted language —
// rendering plain instead of highlighted (the bug this fixed).

describe("the shiki bundle", () => {
  test("exposes shiki's full bundled-language set", () => {
    expect(Object.keys(bundledLanguages).sort()).toEqual(Object.keys(fullShikiBundle).sort());
  });

  test("includes markdown plus languages the old scoped set dropped (EXC-665)", () => {
    const keys = Object.keys(bundledLanguages);
    // markdown is the plan source language; lua/kotlin/swift were all absent from
    // the old 26-grammar set and rendered plain — the EXC-665 regression markers.
    for (const lang of ["markdown", "lua", "kotlin", "swift"]) {
      expect(keys).toContain(lang);
    }
  });

  test("is the full bundle, not a re-narrowed subset", () => {
    // The old scoped set was 26 grammars; the full bundle is hundreds. A generous
    // floor pins "full bundle" without coupling the test to shiki's exact count.
    expect(Object.keys(bundledLanguages).length).toBeGreaterThan(100);
  });

  test("each grammar is a lazy loader, so vite emits one on-demand chunk per grammar", () => {
    for (const loader of Object.values(bundledLanguages)) {
      expect(typeof loader).toBe("function");
    }
  });

  test("bundledThemes is empty — caret renders only its own registered themes", () => {
    expect(Object.keys(bundledThemes)).toEqual([]);
  });
});

// EXC-1056: shiki defaults `tokenizeTimeLimit` to 500ms and vscode-textmate spends it
// as WALL CLOCK inside its scan loop — once the budget is gone the line is abandoned
// where it stands and its remainder comes back as one token wearing whatever scope was
// in force. Nothing is thrown and nothing is logged, so the caller cannot tell a
// truncated line from a real one. That made every shiki call in this repo a function of
// host load rather than of its input, which is what reddened the preflight gate: the
// first tokenize in a bun process alone costs ~800ms (the engine translates a grammar's
// patterns lazily, through JIT-cold transpiler code), and under gate contention even a
// warmed one crosses 500ms.
//
// Both halves are asserted, because the value alone would say nothing about why it is
// that value: the constant disables the budget, and a budget that is NOT disabled really
// does silently truncate. The second half is what makes this a regression pin rather than
// a restatement — if shiki ever stops truncating, it reds and this workaround can go.
describe("caret's tokenize options", () => {
  // One line, tokenized rich enough to need many patterns: `Row` is the token that
  // disappears when the line is abandoned mid-scan (it merges into the run that follows).
  const SAMPLE = "function build(rows: Row[]): string {";

  /** A fresh highlighter, which is what makes the starved call deterministic: a new
   * engine carries an empty pattern cache, so its first tokenize pays the translation
   * cost and blows any budget this tight regardless of the host. */
  async function highlighter() {
    return await createHighlighterCore({
      themes: [shikiThemeFor("caret-dark")],
      langs: [import("shiki/langs/tsx.mjs")],
      engine: createCaretRegexEngine(),
    });
  }

  test("carry no wall-clock budget at all", () => {
    expect(CARET_TOKENIZE_OPTIONS.tokenizeTimeLimit).toBe(0);
  });

  test("keep a line whole where a wall-clock budget truncates it", async () => {
    // A highlighter each, so the budget is the only thing that differs between the
    // two calls. Sharing one would leave the second running on a warm engine, where
    // any budget survives — it would agree with this assertion while proving nothing
    // about the option under test.
    const base = { lang: "tsx", theme: "caret-dark" } as const;
    const starved = (await highlighter()).codeToTokensBase(SAMPLE, {
      ...base,
      tokenizeTimeLimit: 1,
    });
    const whole = (await highlighter()).codeToTokensBase(SAMPLE, {
      ...base,
      ...CARET_TOKENIZE_OPTIONS,
    });

    expect(starved[0]?.map((t) => t.content)).not.toContain("Row");
    expect(whole[0]?.map((t) => t.content)).toContain("Row");
  });
});

// EXC-911 dropped `forgiving: true` from the engine, which had been carried since
// EXC-665 on the theory that some grammar could not compile strictly. Nothing in
// the bundle needs it, and these two tests are what say so.
//
// They are deliberately split, because the two halves cost three orders of
// magnitude apart and pin different things:
//
//   - Loading a grammar registers its rules but compiles NONE of its patterns —
//     an engine whose regexConstructor always throws still loads every grammar,
//     and only throws once something is tokenized. So the cheap test below is a
//     real guard on the bundle, but it is NOT evidence that patterns compile.
//   - Translating all 14,234 patterns is the claim that actually justifies strict
//     mode, and costs ~9s.
//
// Saying which is which matters: the load test alone reads like proof that strict
// is safe, and it is not.
describe("every bundled grammar loads under caret's engine", () => {
  test("every grammar in the bundle registers without throwing", async () => {
    const highlighter = await createHighlighterCore({
      themes: [],
      langs: [],
      engine: createCaretRegexEngine(),
    });

    // Loaded one at a time rather than in a single `langs:` array so a failure
    // names the grammar that caused it instead of collapsing the whole bundle
    // into one rejected promise.
    const failures: string[] = [];
    for (const [id, load] of Object.entries(bundledLanguages)) {
      try {
        await highlighter.loadLanguage(load);
      } catch (err) {
        failures.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    expect(failures).toEqual([]);
    // The empty-failures assertion above is vacuously true if nothing loaded, so
    // pin that it did. A floor rather than an exact count — shiki adds grammars
    // between releases, and the loaded set runs slightly ahead of the bundle's own
    // key count because some grammars pull in embedded dependencies.
    expect(highlighter.getLoadedLanguages().length).toBeGreaterThan(300);
  });
});

/** The TextMate rule keys whose value is an Oniguruma pattern. */
const PATTERN_KEYS = new Set(["match", "begin", "end", "while"]);

/** Every `match` / `begin` / `end` / `while` string reachable from a grammar. */
function collectPatterns(node: unknown, out: Set<string>) {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) collectPatterns(child, out);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === "string") {
      if (PATTERN_KEYS.has(key)) out.add(value);
      continue;
    }
    collectPatterns(value, out);
  }
}

// The expensive half — the claim that actually justifies strict mode, and the only
// thing a shiki bump can invalidate. The ~9s is paid on every run deliberately:
// behind an opt-in flag it would never actually run, and an unverified claim about
// these 14,234 patterns is what let EXC-911 hide for as long as it did.
describe("every bundled pattern translates strictly", () => {
  test("no pattern fails to compile through caret's regexConstructor", async () => {
    const patterns = new Set<string>();
    for (const load of Object.values(bundledLanguages)) {
      collectPatterns((await load()).default, patterns);
    }

    // The engine's own scanner, called on the engine, so this exercises the
    // jsc-regex rewrite as production reaches it rather than a paraphrase.
    const engine = createCaretRegexEngine();
    const failures: string[] = [];
    for (const pattern of patterns) {
      try {
        engine.createScanner([pattern]);
      } catch (err) {
        failures.push(`${pattern}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    expect(failures).toEqual([]);
    // Non-vacuity again: an empty pattern set would pass the check above.
    expect(patterns.size).toBeGreaterThan(10_000);
  }, 60_000);
});
