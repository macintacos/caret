import { afterEach, describe, expect, test } from "bun:test";

import { buildLinkLayer, openLinkInNewTab } from "$lib/diffview/links.ts";

// buildLinkLayer is the pure transform: plan source text -> display text +
// a per-line span map of clickable link ranges. It is strictly per-line — it
// never merges or splits lines, so line count is invariant. Columns in the
// span map are 0-based, half-open [startCol, endCol) into the *display* line.

function spansOnLine(text: string, line: number) {
  return buildLinkLayer(text).spans.get(line) ?? [];
}

describe("buildLinkLayer line parity", () => {
  test("line count is identical before and after for inline-link input", () => {
    const input = "# Title\n\nSee [the docs](https://example.com/docs) here.\n";
    const { text } = buildLinkLayer(input);
    expect(text.split("\n").length).toBe(input.split("\n").length);
  });

  // Property test: for arbitrary markdown-ish input, the transform never
  // changes the number of lines. This is the load-bearing AC guarantee.
  test("property: line count in == line count out for arbitrary input", () => {
    const fragments = [
      "# Heading",
      "",
      "plain prose with no links",
      "a [label](https://a.test) link",
      "[bad](javascript:alert(1)) scheme",
      "bare https://bare.test/path url",
      "autolink <https://auto.test> here",
      "```",
      "code [not a link](https://nope.test)",
      "```",
      "`inline [code](https://nope.test)`",
      "nested [a [b](https://b.test) c](https://outer.test)",
      "trailing",
      "",
    ];
    // Build 200 pseudo-random multi-line documents and assert line parity.
    let seed = 1234567;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 200; i++) {
      const lineCount = 1 + Math.floor(rand() * 12);
      const lines: string[] = [];
      for (let j = 0; j < lineCount; j++) {
        lines.push(fragments[Math.floor(rand() * fragments.length)] ?? "");
      }
      const input = lines.join("\n");
      const { text } = buildLinkLayer(input);
      expect(text.split("\n").length).toBe(input.split("\n").length);
    }
  });
});

describe("buildLinkLayer inline-link simplification", () => {
  test("[label](url) renders as label, with a span over the label", () => {
    const { text, spans } = buildLinkLayer("See [the docs](https://example.com) now.");
    expect(text).toBe("See the docs now.");
    const line = spans.get(1) ?? [];
    expect(line).toHaveLength(1);
    const span = line[0]!;
    expect(span.label).toBe("the docs");
    expect(span.href).toBe("https://example.com");
    // "See " is 4 chars; "the docs" spans [4, 12).
    expect(text.slice(span.startCol, span.endCol)).toBe("the docs");
    expect(span.startCol).toBe(4);
    expect(span.endCol).toBe(12);
  });

  test("multiple links on one line each get a correctly positioned span", () => {
    const { text, spans } = buildLinkLayer("[a](https://a.test) and [bb](https://b.test)");
    expect(text).toBe("a and bb");
    const line = spans.get(1) ?? [];
    expect(line).toHaveLength(2);
    expect(text.slice(line[0]!.startCol, line[0]!.endCol)).toBe("a");
    expect(line[0]!.href).toBe("https://a.test");
    expect(text.slice(line[1]!.startCol, line[1]!.endCol)).toBe("bb");
    expect(line[1]!.href).toBe("https://b.test");
  });

  test("http (not just https) is accepted", () => {
    const { text, spans } = buildLinkLayer("[x](http://plain.test)");
    expect(text).toBe("x");
    expect((spans.get(1) ?? [])[0]?.href).toBe("http://plain.test");
  });

  test("links on different lines map to their own line numbers", () => {
    const { text, spans } = buildLinkLayer("[a](https://a.test)\nmid\n[b](https://b.test)");
    expect(text).toBe("a\nmid\nb");
    expect((spans.get(1) ?? [])[0]?.label).toBe("a");
    expect(spans.get(2) ?? []).toHaveLength(0);
    expect((spans.get(3) ?? [])[0]?.label).toBe("b");
  });

  test("a URL with a balanced trailing paren keeps the whole URL", () => {
    // Wikipedia-style links carry a `)` in the path; the closing `)` of the
    // link must not be mistaken for the URL's own paren.
    const { text, spans } = buildLinkLayer("[wiki](https://en.wikipedia.org/wiki/Foo_(bar)) ok");
    expect(text).toBe("wiki ok");
    expect((spans.get(1) ?? [])[0]?.href).toBe("https://en.wikipedia.org/wiki/Foo_(bar)");
  });
});

describe("buildLinkLayer scheme filtering", () => {
  test("javascript: links are left as literal text, not links", () => {
    const input = "click [here](javascript:alert(1)) please";
    const { text, spans } = buildLinkLayer(input);
    // Display text is unchanged — the unsafe link is not simplified.
    expect(text).toBe(input);
    expect(spans.get(1) ?? []).toHaveLength(0);
  });

  test("data: links are left as literal text, not links", () => {
    const input = "[img](data:text/html,<script>1</script>)";
    const { text, spans } = buildLinkLayer(input);
    expect(text).toBe(input);
    expect(spans.get(1) ?? []).toHaveLength(0);
  });

  test("other non-http schemes (file:, vbscript:, mailto:) are not linked", () => {
    for (const url of ["file:///etc/passwd", "vbscript:msgbox", "mailto:a@b.test"]) {
      const input = `[t](${url})`;
      const { text, spans } = buildLinkLayer(input);
      expect(text).toBe(input);
      expect(spans.get(1) ?? []).toHaveLength(0);
    }
  });

  test("scheme matching is case-insensitive (JavaScript: still blocked)", () => {
    const input = "[x](JavaScript:alert(1))";
    const { text, spans } = buildLinkLayer(input);
    expect(text).toBe(input);
    expect(spans.get(1) ?? []).toHaveLength(0);
  });
});

describe("buildLinkLayer bare URLs and autolinks", () => {
  test("a bare http(s) URL stays in place and gets a span", () => {
    const { text, spans } = buildLinkLayer("visit https://bare.test/path now");
    expect(text).toBe("visit https://bare.test/path now");
    const line = spans.get(1) ?? [];
    expect(line).toHaveLength(1);
    expect(text.slice(line[0]!.startCol, line[0]!.endCol)).toBe("https://bare.test/path");
    expect(line[0]!.href).toBe("https://bare.test/path");
  });

  test("trailing sentence punctuation is not captured into a bare URL", () => {
    const { text, spans } = buildLinkLayer("see https://x.test/page. end");
    // Display text is unchanged — only the span boundary excludes the period.
    expect(text).toBe("see https://x.test/page. end");
    const line = spans.get(1) ?? [];
    expect(line).toHaveLength(1);
    expect(line[0]!.href).toBe("https://x.test/page");
    expect(text.slice(line[0]!.startCol, line[0]!.endCol)).toBe("https://x.test/page");
  });

  test("a balanced paren inside a bare URL is kept", () => {
    const { text, spans } = buildLinkLayer("ref https://en.wikipedia.org/wiki/Foo_(bar) here");
    expect(text).toBe("ref https://en.wikipedia.org/wiki/Foo_(bar) here");
    expect((spans.get(1) ?? [])[0]?.href).toBe("https://en.wikipedia.org/wiki/Foo_(bar)");
  });

  test("an autolink <url> displays the inner URL and is clickable", () => {
    const { text, spans } = buildLinkLayer("see <https://auto.test> here");
    expect(text).toBe("see https://auto.test here");
    const line = spans.get(1) ?? [];
    expect(line).toHaveLength(1);
    expect(line[0]!.href).toBe("https://auto.test");
    expect(text.slice(line[0]!.startCol, line[0]!.endCol)).toBe("https://auto.test");
  });

  test("a non-http autolink is not linked", () => {
    const input = "ping <mailto:a@b.test> ok";
    const { text, spans } = buildLinkLayer(input);
    expect(text).toBe(input);
    expect(spans.get(1) ?? []).toHaveLength(0);
  });
});

describe("buildLinkLayer code passthrough", () => {
  test("links inside a fenced code block are left untouched", () => {
    const input = "```\nconst u = [x](https://nope.test);\n```";
    const { text } = buildLinkLayer(input);
    expect(text).toBe(input);
    // No spans anywhere — the fenced region is source-faithful.
    expect(spansOnLine(input, 2)).toHaveLength(0);
  });

  test("an inline code span is left untouched", () => {
    const input = "use `[x](https://nope.test)` literally";
    const { text, spans } = buildLinkLayer(input);
    expect(text).toBe(input);
    expect(spans.get(1) ?? []).toHaveLength(0);
  });

  test("a real link outside an inline code span on the same line still simplifies", () => {
    const { text, spans } = buildLinkLayer("`code` then [go](https://go.test)");
    expect(text).toBe("`code` then go");
    const line = spans.get(1) ?? [];
    expect(line).toHaveLength(1);
    expect(line[0]!.label).toBe("go");
    expect(text.slice(line[0]!.startCol, line[0]!.endCol)).toBe("go");
  });
});

describe("buildLinkLayer degenerate inputs", () => {
  test("empty string yields empty text and no spans", () => {
    const { text, spans } = buildLinkLayer("");
    expect(text).toBe("");
    expect(spans.size).toBe(0);
  });

  test("text with no links is returned verbatim", () => {
    const input = "just\nsome\nplain text";
    const { text, spans } = buildLinkLayer(input);
    expect(text).toBe(input);
    expect(spans.size).toBe(0);
  });

  test("an unterminated link syntax (no URL) is left as literal text", () => {
    const input = "[label](unterminated no close";
    const { text, spans } = buildLinkLayer(input);
    expect(text).toBe(input);
    expect(spans.get(1) ?? []).toHaveLength(0);
  });

  test("an unterminated link still exposes any bare URL inside it as clickable", () => {
    // The `[label](…` is not a valid inline link, but the http URL embedded in
    // it is a real bare URL — it stays clickable, with the text unchanged.
    const input = "[label](https://x.test no close";
    const { text, spans } = buildLinkLayer(input);
    expect(text).toBe(input);
    const line = spans.get(1) ?? [];
    expect(line).toHaveLength(1);
    expect(line[0]!.href).toBe("https://x.test");
    expect(text.slice(line[0]!.startCol, line[0]!.endCol)).toBe("https://x.test");
  });

  test("an empty-label link simplifies to empty and records a zero-width span", () => {
    const { text, spans } = buildLinkLayer("a [](https://x.test) b");
    expect(text).toBe("a  b");
    const line = spans.get(1) ?? [];
    expect(line).toHaveLength(1);
    expect(line[0]!.startCol).toBe(2);
    expect(line[0]!.endCol).toBe(2);
    expect(line[0]!.href).toBe("https://x.test");
  });
});

// The opener is the only window-touching effect of the link layer. Together
// with the scheme filtering above (only http/https hrefs ever reach a span, so
// only those can be opened) it is the link layer's navigation-safety contract:
// every opened tab is severed from the opener (no window.opener handle back)
// and sends no Referer. These are the guarantees the source view relies on for
// safe outbound links.
describe("openLinkInNewTab", () => {
  const realOpen = globalThis.window?.open;
  afterEach(() => {
    if (globalThis.window) globalThis.window.open = realOpen!;
  });

  test("opens in a new tab with noopener,noreferrer", () => {
    const calls: { url?: string | URL; target?: string; features?: string }[] = [];
    // happy-dom is not loaded in this suite; stub a minimal window for the call.
    globalThis.window ??= {} as Window & typeof globalThis;
    globalThis.window.open = ((url?: string | URL, target?: string, features?: string) => {
      calls.push({ url, target, features });
      return null;
    }) as typeof window.open;

    openLinkInNewTab("https://example.test/page");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://example.test/page");
    expect(calls[0]!.target).toBe("_blank");
    // Both flags must be present so the opened page can neither reach back
    // through window.opener nor leak the referrer.
    expect(calls[0]!.features).toContain("noopener");
    expect(calls[0]!.features).toContain("noreferrer");
  });
});
