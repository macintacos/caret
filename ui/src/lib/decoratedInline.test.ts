import { describe, expect, test } from "bun:test";
import { decorateInline } from "./decoratedInline.ts";

/** Strip tags and decode the handful of entities esc() emits, so a test can
 * assert on the human-visible text a decorated run renders. */
function visible(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

describe("decorateInline — emphasis keeps its markers visible", () => {
  test("strong keeps ** and is tagged", () => {
    const html = decorateInline("**bold**");
    expect(html).toContain('<strong class="md-strong">');
    expect(visible(html)).toBe("**bold**");
  });

  test("underscore-strong keeps __", () => {
    expect(visible(decorateInline("__bold__"))).toBe("__bold__");
    expect(decorateInline("__bold__")).toContain('class="md-strong"');
  });

  test("em keeps _ / *", () => {
    expect(visible(decorateInline("_it_"))).toBe("_it_");
    expect(decorateInline("_it_")).toContain('<em class="md-em">');
    expect(visible(decorateInline("*it*"))).toBe("*it*");
  });

  test("del keeps ~~", () => {
    const html = decorateInline("~~gone~~");
    expect(html).toContain('<del class="md-del">');
    expect(visible(html)).toBe("~~gone~~");
  });

  test("inline code keeps its backticks and is monospace-tagged", () => {
    const html = decorateInline("`code`");
    expect(html).toContain('<code class="md-codespan">');
    expect(visible(html)).toBe("`code`");
  });

  test("adjacent/nested emphasis renders its source verbatim (no marker duplication)", () => {
    for (const src of [
      "***foo***",
      "**_foo_**",
      "_**foo**_",
      "a ***b*** c",
      "~~x~~",
      "`a` **b** _c_",
    ]) {
      expect(visible(decorateInline(src))).toBe(src);
    }
  });
});

describe("decorateInline — links render normally, not as source", () => {
  test("a link shows only its label, links to its href, drops the [..](..) syntax", () => {
    const html = decorateInline("see [the docs](https://example.test/x) now");
    expect(html).toContain('href="https://example.test/x"');
    expect(visible(html)).toBe("see the docs now");
    expect(visible(html)).not.toContain("[");
    expect(visible(html)).not.toContain("](");
  });

  test("emphasis inside a link keeps its markers", () => {
    const html = decorateInline("[**bold** link](https://example.test/x)");
    expect(html).toContain('href="https://example.test/x"');
    expect(html).toContain('class="md-strong"');
    expect(visible(html)).toBe("**bold** link");
  });

  test("a javascript: link is neutralized (no executable href)", () => {
    const html = decorateInline("[x](javascript:alert(1))");
    expect(html.toLowerCase()).not.toContain("javascript:alert");
    expect(visible(html)).toBe("x");
  });
});

describe("decorateInline — footnote references", () => {
  test("a [^id] reference renders as a superscript, not literal brackets", () => {
    const html = decorateInline("A claim.[^note] Continue.");
    expect(html).toContain('class="md-fn-ref"');
    expect(html).toContain("<sup");
    // The label survives; the visible run drops the raw [^..] brackets.
    expect(visible(html)).toContain("note");
    expect(visible(html)).not.toContain("[^note]");
  });
});

describe("decorateInline — sanitization (defense in depth)", () => {
  test("raw HTML is escaped, never emitted as live markup", () => {
    const html = decorateInline("<script>alert(1)</script>");
    expect(html.toLowerCase()).not.toContain("<script>");
    expect(visible(html)).toBe("<script>alert(1)</script>");
  });

  test("raw HTML with an onerror handler is escaped to inert text, not a live element", () => {
    const html = decorateInline('<img src=x onerror="alert(1)">');
    // No live <img> element reaches the DOM — the whole thing is escaped text, so
    // the handler can never fire (the "onerror" chars survive only as visible text).
    expect(html).not.toContain("<img");
    expect(visible(html)).toBe('<img src=x onerror="alert(1)">');
  });

  test("plain angle brackets and ampersands survive as visible text", () => {
    expect(visible(decorateInline("a < b && c > d"))).toBe("a < b && c > d");
  });
});
