import "../../test-setup.ts";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { initHighlighter } from "./highlight.ts";
import { flush } from "./log.ts";
import { type HeadingEntry, renderPlan, shouldShowRail } from "./render.ts";

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

describe("shouldShowRail", () => {
  const headings = (n: number): HeadingEntry[] =>
    Array.from({ length: n }, (_, i) => ({
      level: 1,
      slug: `h${i}`,
      text: `Heading ${i}`,
      blockId: `b${i}`,
    }));

  test("suppresses the rail for a plan with no headings", () => {
    expect(shouldShowRail(headings(0))).toBe(false);
  });

  test("suppresses the rail for a single-heading plan (no one-tick rail)", () => {
    expect(shouldShowRail(headings(1))).toBe(false);
  });

  test("shows the rail once there are two or more headings", () => {
    expect(shouldShowRail(headings(2))).toBe(true);
    expect(shouldShowRail(headings(5))).toBe(true);
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

// Runs last so the earlier suites exercise the plain (un-highlighted) path; the
// highlighter singleton is process-global, so this beforeAll leaves it ready.
describe("renderPlan code block highlighting", () => {
  beforeAll(async () => {
    await initHighlighter();
  });

  test("highlights a fenced block with a known language via shiki", () => {
    const { html } = renderPlan("```ts\nconst x = 1;\n```\n");
    expect(html).toContain('class="shiki');
    expect(html).toContain("--shiki-light:");
    expect(html).toContain("--shiki-dark:");
    expect(html).toContain("caret-light");
  });

  test("keeps the structural id on the highlighted <pre>", () => {
    // The code block is the only block, so its id is b0 and must land on the
    // shiki <pre> (the first tag) so annotation anchoring still resolves.
    const { html } = renderPlan("```ts\nconst x = 1;\n```\n");
    const preTag = html.match(/<pre\b[^>]*>/)?.[0] ?? "";
    expect(preTag).toContain('id="b0"');
    expect(preTag).toContain('class="shiki');
  });

  test("token color CSS variables survive DOMPurify sanitization", () => {
    const { html } = renderPlan("```ts\nconst x = 1;\n```\n");
    expect(html).toMatch(/--shiki-light:\s*#[0-9a-fA-F]{3,8}/);
    expect(html).toMatch(/--shiki-dark:\s*#[0-9a-fA-F]{3,8}/);
  });

  test("italic/bold token styles (font-style/weight vars) survive sanitization", () => {
    // The caret theme styles comments italic, so shiki emits a
    // --shiki-*-font-style declaration on the comment span. The sanitizer hook
    // must keep the whole style (color included), not drop it because of the
    // font-style declaration.
    const { html } = renderPlan("```ts\n// a note\nconst x = 1;\n```\n");
    expect(html).toContain("--shiki-light-font-style:italic");
    // the comment's color must still ride along, not be stripped with it
    expect(html).toMatch(/--shiki-light:\s*#[0-9a-fA-F]{3,8};--shiki-light-font-style/);
  });

  test("bold token styles (font-weight vars) survive sanitization", () => {
    // The caret theme styles markdown headings bold, so shiki emits a
    // --shiki-*-font-weight declaration; it must survive the sanitizer hook too.
    const { html } = renderPlan("```md\n# Heading\n```\n");
    expect(html).toContain("--shiki-light-font-weight:bold");
  });

  test("drops a hostile inline style while keeping shiki's token styles", () => {
    const { html } = renderPlan(
      '<div style="position:fixed;inset:0;z-index:9999">x</div>\n\n```ts\nconst y = 2;\n```\n',
    );
    expect(html).not.toContain("position:fixed");
    expect(html).not.toContain("z-index");
    expect(html).toContain("--shiki-light:");
  });

  test("an unknown language falls back to a plain <pre><code>", () => {
    const { html } = renderPlan("```no-such-lang\nplain text\n```\n");
    expect(html).not.toContain("shiki");
    expect(html).toContain("<pre");
    expect(html).toContain("<code");
    expect(html).toContain("plain text");
  });

  test("a fenced block with no language marker renders as plain text", () => {
    const { html } = renderPlan("```\njust text\n```\n");
    expect(html).not.toContain("shiki");
    expect(html).toContain("<pre");
    expect(html).toContain("just text");
  });

  test("inline code (single backticks) is left unhighlighted", () => {
    const { html } = renderPlan("a `inline` word\n");
    expect(html).not.toContain("shiki");
    expect(html).toContain("<code>inline</code>");
  });
});

// A heading + paragraph + bullet list: three stamped block methods (heading,
// paragraph, list) so blocks === 3, and exactly one heading. Counted by hand so
// the assertions are deterministic, not derived from the code under test.
const LOG_FIXTURE = `# Title

A paragraph with secret-marker text.

- a
- b
`;

describe("renderPlan logging", () => {
  interface FetchCall {
    url: string;
    options: RequestInit | undefined;
  }
  let calls: FetchCall[];
  let originalFetch: typeof globalThis.fetch;

  function bodies(): Array<Record<string, unknown>> {
    return calls.flatMap((call) => {
      const parsed = JSON.parse(call.options?.body as string) as {
        events: Array<Record<string, unknown>>;
      };
      return parsed.events;
    });
  }

  beforeEach(() => {
    // Drain any residue buffered by the earlier suites BEFORE capture starts, so
    // our capture sees only this test's renderPlan call.
    flush();
    calls = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: string, options?: RequestInit) => {
      calls.push({ url, options });
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    // Drain so nothing bleeds into the next case (or other suites).
    flush();
    calls = [];
  });

  test("emits one debug 'plan rendered' record per renderPlan call", () => {
    renderPlan(LOG_FIXTURE);
    flush();

    const records = bodies();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: "debug",
      step: "render",
      msg: "plan rendered",
      extra: { chars: LOG_FIXTURE.length, blocks: 3, headings: 1 },
    });
  });

  test("never logs the plan text under any key", () => {
    renderPlan(LOG_FIXTURE);
    flush();

    const wire = JSON.stringify(bodies());
    expect(wire).not.toContain("secret-marker");
  });
});
