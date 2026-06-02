import { beforeAll, describe, expect, test } from "bun:test";
import { highlightToHtml, initHighlighter } from "./highlight.ts";

// Runs before initHighlighter() — exercises the cold-start path renderPlan
// relies on (returns null so the caller falls back to a plain <pre>).
describe("highlightToHtml before the highlighter is ready", () => {
  test("returns null", () => {
    expect(highlightToHtml("const x = 1;", "ts")).toBeNull();
  });
});

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
