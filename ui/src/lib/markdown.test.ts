import "../../test-setup.ts";
import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./markdown.ts";

// renderMarkdown turns a stored comment's markdown source into sanitized HTML
// for the annotation-card display. The composer stores literal markdown; this is
// the read-side render. Two concerns: the listed constructs render, and the
// output is XSS-safe (comment bodies are user-authored and injected with @html).

describe("renderMarkdown formatting", () => {
  test("inline code becomes <code>", () => {
    expect(renderMarkdown("use `please` here")).toContain("<code>please</code>");
  });

  test("bold becomes <strong>", () => {
    expect(renderMarkdown("a **bold** word")).toMatch(/<strong>bold<\/strong>/);
  });

  test("italic becomes <em>", () => {
    expect(renderMarkdown("a *slanted* word")).toMatch(/<em>slanted<\/em>/);
  });

  test("a link renders with its href and text", () => {
    const html = renderMarkdown("see [the docs](https://example.com/x)");
    expect(html).toContain('href="https://example.com/x"');
    expect(html).toContain(">the docs</a>");
  });

  test("a fenced code block becomes <pre><code>", () => {
    const html = renderMarkdown("```\nconst x = 1\n```");
    expect(html).toContain("<pre");
    expect(html).toContain("<code");
    expect(html).toContain("const x = 1");
  });

  test("an unordered list renders <ul><li>", () => {
    const html = renderMarkdown("- one\n- two");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one");
  });

  test("a blockquote renders <blockquote>", () => {
    expect(renderMarkdown("> quoted")).toContain("<blockquote>");
  });

  test("a heading renders <h1>", () => {
    expect(renderMarkdown("# Heading")).toMatch(/<h1[^>]*>Heading<\/h1>/);
  });

  test("plain text survives", () => {
    expect(renderMarkdown("just a plain comment")).toContain("just a plain comment");
  });
});

describe("renderMarkdown sanitization", () => {
  test("strips a <script> tag", () => {
    const html = renderMarkdown("hi <script>alert(1)</script> there");
    expect(html).not.toContain("<script");
    expect(html).toContain("hi");
  });

  test("neutralizes a javascript: link href", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  test("strips an inline event handler (img onerror)", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("onerror");
  });
});
