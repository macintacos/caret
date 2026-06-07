import { beforeAll, describe, expect, test } from "bun:test";
import { highlightToHtml, initHighlighter } from "./highlight.ts";

// Note: the highlighter is a process-global singleton, so a "before init returns
// null" test would be order-dependent across the shared bun test process (any
// other suite that inits would make it flaky). The cold-start null path is still
// exercised here via the unknown-language and no-language cases below — they hit
// the same early `return null` — and in production while the highlighter builds
// off the critical path (main.ts), before the first repaint.
// Every grammar initHighlighter() loads, paired with a minimal snippet. The
// list mirrors highlight.ts's `langs` factories one-to-one: a grammar dropped
// or renamed there, or a `shiki/langs/*` import path / export that drifts,
// fails this suite instead of silently shipping a language that no longer
// highlights. Each id is shiki's canonical language name (the loaded-language
// key highlightToHtml matches against).
const GRAMMARS: { id: string; code: string }[] = [
  { id: "typescript", code: "const x: number = 1;" },
  { id: "javascript", code: "const x = 1;" },
  { id: "json", code: '{"x": 1}' },
  { id: "yaml", code: "x: 1" },
  { id: "toml", code: "x = 1" },
  { id: "shellscript", code: "echo hi" },
  { id: "diff", code: "+added\n-removed" },
  { id: "markdown", code: "# Heading" },
];

describe("highlightToHtml after initHighlighter()", () => {
  beforeAll(async () => {
    await initHighlighter();
  });

  test.each(GRAMMARS)("highlights $id with dual-theme CSS variables", ({ id, code }) => {
    const html = highlightToHtml(code, id);
    expect(html).not.toBeNull();
    // shiki's <pre class="shiki ..."> is the first tag (block-id anchoring).
    expect(html as string).toContain('class="shiki');
    // defaultColor:false emits per-token CSS vars for both themes.
    expect(html as string).toContain("--shiki-light:");
    expect(html as string).toContain("--shiki-dark:");
    // custom themes are named caret-light / caret-dark.
    expect(html as string).toContain("caret-light");
    expect(html as string).toContain("caret-dark");
  });

  test("accepts a language alias (ts) the loaded grammar registers", () => {
    // `ts` is an alias shiki's typescript grammar registers; highlightToHtml
    // lowercases and matches it against the loaded set, so the renderer can
    // pass a fenced block's raw `ts` tag without a normalization step.
    expect(highlightToHtml("const x = 1;", "ts")).not.toBeNull();
  });

  test("returns null for an unknown language so the caller renders plain text", () => {
    expect(highlightToHtml("hello", "no-such-lang")).toBeNull();
  });

  test("returns null when no language marker is present", () => {
    expect(highlightToHtml("hello", undefined)).toBeNull();
  });
});
