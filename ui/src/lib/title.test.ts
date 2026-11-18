import { describe, expect, test } from "bun:test";

import { renderTitle } from "$lib/title.ts";

describe("renderTitle", () => {
  test("escapes plain text", () => {
    expect(renderTitle("a & b")).toBe("a &amp; b");
  });

  test("renders strong, emphasis, code and strikethrough inline", () => {
    expect(renderTitle("**b** *e* `c` ~~s~~")).toBe(
      "<strong>b</strong> <em>e</em> <code>c</code> <del>s</del>",
    );
  });

  test("renders a link as its text", () => {
    expect(renderTitle("Triage — [EXC-562](https://linear.app/x/EXC-562)")).toBe(
      "Triage — EXC-562",
    );
  });

  test("renders a link whose URL contains parentheses as its text", () => {
    expect(renderTitle("See [Foo](https://x/Foo_(bar)) now")).toBe("See Foo now");
  });

  test("renders a bare autolinked URL as text", () => {
    expect(renderTitle("see https://example.com")).toBe("see https://example.com");
  });

  test("renders an image as its alt text", () => {
    expect(renderTitle("logo ![Caret](https://x/a.png)")).toBe("logo Caret");
  });

  test("renders an image's formatted alt as plain text", () => {
    expect(renderTitle("logo ![**Caret**](https://x/a.png)")).toBe("logo Caret");
  });

  test("escapes markup in an image's alt", () => {
    expect(renderTitle("![a <b>](https://x/a.png)")).toBe("a &lt;b&gt;");
  });

  test("renders a hard line break as a space", () => {
    expect(renderTitle("a  \nb")).toBe("a b");
  });

  test("shows raw HTML as literal text", () => {
    expect(renderTitle("Wire up <Foo> props")).toBe("Wire up &lt;Foo&gt; props");
  });

  test.each([
    "<script>alert(1)</script>",
    '<img src=x onerror="alert(1)">',
    "[x](javascript:alert(1))",
    "**<svg onload=alert(1)>**",
  ])("leaves %p inert", (payload) => {
    const html = renderTitle(payload);
    expect(html).not.toMatch(/<(script|img|svg|a)\b/i);
    expect(html).not.toMatch(/href=/i);
  });

  test("renders a mixed bold/code title with no markdown syntax left", () => {
    const html = renderTitle(
      "**Environment:** `prod` (`https://jira.example.org`, user `someone@example.org`).",
    );
    expect(html).toContain("<strong>Environment:</strong>");
    expect(html).toContain("<code>https://jira.example.org</code>");
    expect(html).not.toMatch(/[*`]/);
  });
});
