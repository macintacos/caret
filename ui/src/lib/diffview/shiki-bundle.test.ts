import { describe, expect, test } from "bun:test";
import { bundledLanguages as fullShikiBundle } from "shiki/bundle/full";
import { bundledLanguages, bundledThemes } from "./shiki-bundle.ts";

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
