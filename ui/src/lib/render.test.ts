import "../../test-setup.ts";
import { describe, expect, test } from "bun:test";
import { renderPlan } from "./render.ts";

const SAMPLE = `# Introduction

This is the first paragraph with **bold** and \`code\`.

## Details

Second paragraph here.

- one
- two

\`\`\`ts
const x = 1;
\`\`\`
`;

describe("renderPlan block ids", () => {
  test("stamps sequential id=b0..bN on block elements in document order", () => {
    const { html } = renderPlan(SAMPLE);
    const ids = [...html.matchAll(/id="(b\d+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    // sequential, starting at b0, no gaps, in document order
    const expected = ids.map((_, i) => `b${i}`);
    expect(ids).toEqual(expected);
  });

  test("first block-level element is b0", () => {
    const { html } = renderPlan("# Hello\n\nWorld\n");
    const firstId = html.match(/id="(b\d+)"/)?.[1];
    expect(firstId).toBe("b0");
  });

  test("ids are unique", () => {
    const { html } = renderPlan(SAMPLE);
    const ids = [...html.matchAll(/id="(b\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("renderPlan determinism", () => {
  test("same input produces identical html", () => {
    const a = renderPlan(SAMPLE).html;
    const b = renderPlan(SAMPLE).html;
    expect(a).toBe(b);
  });
});

describe("renderPlan headings", () => {
  test("heading slug appears on data-slug, distinct from id", () => {
    const { html } = renderPlan("# Hello World\n");
    const m = html.match(/<h1[^>]*>/);
    expect(m).not.toBeNull();
    const tag = m![0];
    expect(tag).toContain('data-slug="hello-world"');
    expect(tag).toContain('id="b0"');
    // exactly one id attribute on the element
    expect((tag.match(/\sid=/g) ?? []).length).toBe(1);
  });

  test("returns headings list with level, slug and text", () => {
    const { headings } = renderPlan(SAMPLE);
    expect(headings).toEqual([
      { level: 1, slug: "introduction", text: "Introduction", blockId: "b0" },
      { level: 2, slug: "details", text: "Details", blockId: expect.any(String) },
    ]);
  });

  test("duplicate heading text yields unique slugs", () => {
    const { headings } = renderPlan("# Setup\n\ntext\n\n# Setup\n\nmore\n");
    expect(headings[0]!.slug).toBe("setup");
    expect(headings[1]!.slug).toBe("setup-1");
  });
});

describe("renderPlan sanitization", () => {
  test("strips <script> tags", () => {
    const { html } = renderPlan("Hello\n\n<script>alert(1)</script>\n");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
  });

  test("strips inline event handlers", () => {
    const { html } = renderPlan('<p onclick="evil()">hi</p>\n');
    expect(html).not.toContain("onclick");
  });
});

describe("renderPlan first-heading normalization", () => {
  test("promotes an authored ## first heading to <h1>", () => {
    const { html, headings } = renderPlan("## Title\n\nbody\n");
    expect(html).toMatch(/<h1[^>]*>Title<\/h1>/);
    expect(headings[0]).toMatchObject({ level: 1, text: "Title" });
  });

  test("promotes an authored ### first heading to <h1>", () => {
    const { html, headings } = renderPlan("### Deep\n");
    expect(html).toMatch(/<h1[^>]*>Deep<\/h1>/);
    expect(headings[0]).toMatchObject({ level: 1, text: "Deep" });
  });

  test("promotes a setext (underlined) first heading to <h1>", () => {
    const { html, headings } = renderPlan("Title\n---\n\nbody\n");
    expect(html).toMatch(/<h1[^>]*>Title<\/h1>/);
    expect(headings[0]).toMatchObject({ level: 1, text: "Title" });
  });

  test("leaves headings after the first at their authored level", () => {
    const { headings } = renderPlan("## Title\n\n### Sub\n");
    expect(headings).toEqual([
      { level: 1, slug: "title", text: "Title", blockId: "b0" },
      { level: 3, slug: "sub", text: "Sub", blockId: expect.any(String) },
    ]);
  });

  test("leaves an already-<h1> first heading unchanged", () => {
    const { headings } = renderPlan("# Title\n\n## Sub\n");
    expect(headings[0]).toMatchObject({ level: 1, text: "Title" });
    expect(headings[1]).toMatchObject({ level: 2, text: "Sub" });
  });

  test("a document with no headings renders without error", () => {
    const { html, headings } = renderPlan("just a paragraph\n");
    expect(headings).toEqual([]);
    expect(html).toContain("<p");
  });

  test("ignores a pseudo-heading inside a leading code fence", () => {
    // The fenced text is a code token, not a heading, so the first *real*
    // heading is the one promoted — a property only the token-level (not
    // string-level) approach guarantees.
    const { headings } = renderPlan("```\n## NotAHeading\n```\n\n## Real\n");
    expect(headings).toEqual([
      { level: 1, slug: "real", text: "Real", blockId: expect.any(String) },
    ]);
  });
});
