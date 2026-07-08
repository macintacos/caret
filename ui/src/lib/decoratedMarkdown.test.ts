import { describe, expect, test } from "bun:test";
import { decorateMarkdown } from "./decoratedMarkdown.ts";

// decorateMarkdown turns plan markdown source into one decorated row per source
// line. Unlike a markdown-to-HTML render, it KEEPS the syntax delimiters (`**`,
// backticks, `#`, list/quote markers) and only wraps tokens in styled spans, so
// the rendered text stays 1:1 with the source. Two invariants anchor the suite:
// (1) one row per source line, and (2) each row's visible text equals its source
// line verbatim — nothing is dropped, only decorated.

/** Remove tags and unescape entities, recovering a row's visible text. */
function visibleText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

describe("decorateMarkdown structure", () => {
  test("emits one row per source line, 1-based", () => {
    const rows = decorateMarkdown("line one\nline two\nline three");
    expect(rows.map((r) => r.line)).toEqual([1, 2, 3]);
  });

  test("every row's visible text equals its source line verbatim", () => {
    const source = [
      "# Title",
      "Plain **bold** and `code` here.",
      "- item _one_",
      "> a quote",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "trailing",
    ].join("\n");
    const rows = decorateMarkdown(source);
    const lines = source.split("\n");
    expect(rows.length).toBe(lines.length);
    for (let i = 0; i < lines.length; i++) {
      expect(visibleText(rows[i]!.html)).toBe(lines[i]!);
    }
  });
});

describe("decorateMarkdown inline decoration keeps delimiters", () => {
  test("bold is wrapped in <strong> and keeps its asterisks", () => {
    const [row] = decorateMarkdown("a **important** word");
    expect(row!.html).toMatch(/<strong[^>]*>/);
    // the asterisks live inside the strong element, not stripped away
    expect(row!.html).toContain("**important**");
    expect(visibleText(row!.html)).toBe("a **important** word");
  });

  test("italic (underscores) is wrapped in <em> and keeps its underscores", () => {
    const [row] = decorateMarkdown("a _slanted_ word");
    expect(row!.html).toMatch(/<em[^>]*>/);
    expect(row!.html).toContain("_slanted_");
  });

  test("inline code is wrapped in <code> and keeps its backticks", () => {
    const [row] = decorateMarkdown("use `foo` here");
    expect(row!.html).toMatch(/<code[^>]*>/);
    expect(row!.html).toContain("`foo`");
  });

  test("nested emphasis keeps both markers", () => {
    const [row] = decorateMarkdown("**foo _bar_ baz**");
    expect(row!.html).toMatch(/<strong[^>]*>/);
    expect(row!.html).toMatch(/<em[^>]*>/);
    expect(visibleText(row!.html)).toBe("**foo _bar_ baz**");
  });

  test("adjacent nested emphasis does not duplicate delimiters", () => {
    // The inner marker abuts the outer one, so a greedy delimiter peel would
    // over-consume it (***foo*** -> *****foo*****). Each must stay verbatim.
    for (const src of ["***foo***", "**_foo_**", "_**foo**_", "a ***b*** c", "~~x~~"]) {
      expect(visibleText(decorateMarkdown(src)[0]!.html)).toBe(src);
    }
  });

  test("a link is an <a> whose visible text is the raw markdown", () => {
    const [row] = decorateMarkdown("see [docs](https://example.com/x)");
    expect(row!.html).toContain('href="https://example.com/x"');
    expect(visibleText(row!.html)).toBe("see [docs](https://example.com/x)");
  });

  test("plain prose text is not wrapped in a decoration element", () => {
    const [row] = decorateMarkdown("just some plain prose");
    expect(row!.html).not.toMatch(/<(strong|em|code|a)\b/);
  });
});

describe("decorateMarkdown block classification", () => {
  test("ATX heading carries kind + level and keeps its hashes", () => {
    const [row] = decorateMarkdown("## Approach");
    expect(row!.kind).toBe("heading");
    expect(row!.level).toBe(2);
    expect(visibleText(row!.html)).toBe("## Approach");
  });

  test("list item carries kind and keeps its marker", () => {
    const [row] = decorateMarkdown("- a point");
    expect(row!.kind).toBe("list-item");
    expect(row!.html).toContain("md-marker");
    expect(visibleText(row!.html)).toBe("- a point");
  });

  test("blockquote carries kind and keeps its marker", () => {
    const [row] = decorateMarkdown("> quoted");
    expect(row!.kind).toBe("blockquote");
    expect(visibleText(row!.html)).toBe("> quoted");
  });

  test("a plain line is a paragraph", () => {
    const [row] = decorateMarkdown("hello world");
    expect(row!.kind).toBe("paragraph");
  });

  test("a blank line is kind blank", () => {
    const rows = decorateMarkdown("a\n\nb");
    expect(rows[1]!.kind).toBe("blank");
  });

  test("fenced code lines are classified open / code / close", () => {
    const rows = decorateMarkdown("```ts\nconst x = 1;\n```");
    expect(rows.map((r) => r.kind)).toEqual(["code-open", "code", "code-close"]);
    // a `#` inside a fence is NOT a heading
    const hashInFence = decorateMarkdown("```\n# not a heading\n```");
    expect(hashInFence[1]!.kind).toBe("code");
  });
});

describe("decorateMarkdown sanitization", () => {
  test("a raw <script> in the plan is neutralized to text", () => {
    const [row] = decorateMarkdown("hi <script>alert(1)</script> there");
    expect(row!.html).not.toContain("<script");
    expect(visibleText(row!.html)).toBe("hi <script>alert(1)</script> there");
  });

  test("a javascript: link href is neutralized (scheme not executable)", () => {
    const [row] = decorateMarkdown("[click](javascript:alert(1))");
    // the raw markdown is shown verbatim as text (so `javascript:` appears), but
    // it must never survive as an executable href attribute.
    expect(row!.html).not.toContain('href="javascript:');
    expect(visibleText(row!.html)).toBe("[click](javascript:alert(1))");
  });
});
