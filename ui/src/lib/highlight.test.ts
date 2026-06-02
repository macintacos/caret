import { beforeAll, describe, expect, test } from "bun:test";
import { highlightToHtml, initHighlighter } from "./highlight.ts";

// Note: the highlighter is a process-global singleton, so a "before init returns
// null" test would be order-dependent across the shared bun test process (any
// other suite that inits would make it flaky). The cold-start null path is still
// exercised here via the unknown-language and no-language cases below — they hit
// the same early `return null` — and in production by the await-before-mount in
// main.ts.
describe("highlightToHtml after initHighlighter()", () => {
  beforeAll(async () => {
    await initHighlighter();
  });

  test("highlights a known language with dual-theme CSS variables", () => {
    const html = highlightToHtml("const x = 1;", "ts");
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

  test("returns null for an unknown language so the caller renders plain text", () => {
    expect(highlightToHtml("hello", "no-such-lang")).toBeNull();
  });

  test("returns null when no language marker is present", () => {
    expect(highlightToHtml("hello", undefined)).toBeNull();
  });
});
