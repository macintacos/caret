import { describe, expect, test } from "bun:test";

import { bundledLanguages as fullShikiBundle } from "shiki/bundle/full";
import { createHighlighterCore } from "shiki/core";

import {
  bundledLanguages,
  bundledThemes,
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

// EXC-911 dropped `forgiving: true` from the engine, which had been carried since
// EXC-665 on the theory that some grammar could not compile strictly. Nothing in
// the bundle needs it — and this is the test that says so, permanently.
//
// It is the standing answer to two questions that were previously unmeasured:
// which grammars fail to load strictly (none), and whether any fence regressed to
// plain when `forgiving` went away (none can, since a fence renders plain only
// when its grammar fails to load). Without this, re-adding `forgiving` would look
// harmless — and it would restore exactly the silent per-pattern degradation that
// let EXC-911's mis-scoped comments ship unnoticed.
describe("every bundled grammar loads under caret's engine", () => {
  test("no grammar fails to load, so no fence falls back to plain", async () => {
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
