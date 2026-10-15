import "@ui/support/setup.ts";
import { describe, expect, test } from "bun:test";

import { renderPlanMarkdown } from "$lib/planMarkdown.ts";

function fragment(html: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

function spans(text: string): [number, number][] {
  const { html, blocks } = renderPlanMarkdown(text);
  const wrappers = [...fragment(html).children].map((el) => [
    Number(el.getAttribute("data-source-start")),
    Number(el.getAttribute("data-source-end")),
  ]);
  const listed = blocks.map((b) => [b.start, b.end]);
  expect(wrappers).toEqual(listed);
  return listed as [number, number][];
}

describe("renderPlanMarkdown block spans", () => {
  test("an empty plan has no blocks", () => {
    expect(renderPlanMarkdown("")).toEqual({ html: "", blocks: [] });
  });

  test("a plan that is one fenced block spans every line", () => {
    expect(spans("```ts\nconst a = 1;\nconst b = 2;\n```\n")).toEqual([[1, 4]]);
  });

  test("an unterminated fence runs to the last line", () => {
    expect(spans("intro\n\n```\ncode\nmore")).toEqual([
      [1, 1],
      [3, 5],
    ]);
  });

  test("an indented code block gets its exact lines", () => {
    expect(spans("para\n\n    code 1\n    code 2\n\nafter\n")).toEqual([
      [1, 1],
      [3, 4],
      [6, 6],
    ]);
  });

  test("lazy continuation spans both lines in a list and a quote", () => {
    expect(spans("- [ ] todo\nlazy")).toEqual([[1, 2]]);
    expect(spans("> q\nlazy")).toEqual([[1, 2]]);
  });

  test("a CRLF plan renders like its LF twin", () => {
    const lf = "# T\n\npara\nwrap\n\n- a\n- b\n";
    expect(renderPlanMarkdown(lf.replaceAll("\n", "\r\n"))).toEqual(renderPlanMarkdown(lf));
  });

  test("leading blank lines push the first block down", () => {
    expect(spans("\n\n# T\n")).toEqual([[3, 3]]);
  });

  test("a link definition records no block", () => {
    expect(spans("[r]: https://a.test\n\nsee [r]\n")).toEqual([[3, 3]]);
  });

  test("a mixed plan gets one span per block", () => {
    const text = [
      "# Title",
      "",
      "para one",
      "para two",
      "",
      "- a",
      "- b",
      "",
      "| h | i |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "> quote",
      "",
      "---",
    ].join("\n");
    expect(spans(text)).toEqual([
      [1, 1],
      [3, 4],
      [6, 7],
      [9, 11],
      [13, 13],
      [15, 15],
    ]);
  });
});

function withoutMarkers(html: string): string {
  return html.replace(/<span data-source-line="\d+"( data-source-code)?><\/span>/g, "");
}

function marker(line: number): string {
  return `<span data-source-line="${line}"></span>`;
}

function codeMarker(line: number): string {
  return `<span data-source-line="${line}" data-source-code></span>`;
}

function markerCount(html: string): number {
  return html.split("data-source-line=").length - 1;
}

describe("renderPlanMarkdown source-line markers", () => {
  test("a soft break starts the next line's marker after its newline", () => {
    expect(renderPlanMarkdown("alpha\nbeta").html).toContain(
      `<p>${marker(1)}alpha\n${marker(2)}beta</p>`,
    );
  });

  test("a bold run straddling a break carries the marker inside <strong>", () => {
    expect(renderPlanMarkdown("a **bold\nrun** b").html).toContain(
      `<strong>bold\n${marker(2)}run</strong>`,
    );
  });

  test("a link label straddling a break carries the marker inside <a>", () => {
    expect(renderPlanMarkdown("see [the\nlabel](https://a.test) x").html).toContain(
      `>the\n${marker(2)}label</a>`,
    );
  });

  test("a soft break before an autolink marks the next line before the link", () => {
    const html = renderPlanMarkdown("x\n<https://a.test>\ny https://b.test\n").html;
    expect(html).toContain(`\n${marker(2)}<a href="https://a.test"`);
    expect(html).toContain(`\n${marker(3)}y `);
  });

  test("a soft break before a codespan marks the next line before it", () => {
    expect(renderPlanMarkdown("a\n`c` b").html).toContain(`\n${marker(2)}<code>c</code>`);
  });

  test("a soft break inside inline html marks the next line before the closing tag", () => {
    const html = renderPlanMarkdown("a <b>x\n</b> y\nz").html;
    expect(html).toContain(`x\n${marker(2)}</b> y`);
    expect(html).toContain(`\n${marker(3)}z`);
  });

  test("a hard break puts the next line's marker after <br>", () => {
    for (const text of ["a  \nb", "a\\\nb"]) {
      expect(renderPlanMarkdown(text).html).toContain(`<br>${marker(2)}b`);
    }
  });

  test("a codespan straddling a break marks the next line after it", () => {
    const html = renderPlanMarkdown("x `co\nde` after").html;
    expect(html).toContain(`<code>co de</code>${marker(2)} after`);
    expect(markerCount(html)).toBe(2);
  });

  test("an image whose alt straddles a break keeps a plain alt and marks the next line after it", () => {
    const html = renderPlanMarkdown("![a\nb](https://a.test/i.png) tail\nnext").html;
    expect(html).toContain('alt="a\nb"');
    expect(html).toMatch(new RegExp(`<img [^>]*>${marker(2)} tail`));
  });

  test("an unsafe image's alt text straddling a break marks the next line after it", () => {
    const html = renderPlanMarkdown("![a\nb](rel.png) tail\nnext").html;
    expect(html).not.toContain("&lt;span");
    expect(html).toContain(`a\nb${marker(2)} tail`);
  });

  test("an entity that renders a newline starts no line", () => {
    expect(markerCount(renderPlanMarkdown("a &#10; b").html)).toBe(1);
  });

  test("a loose list item's second paragraph carries its own line", () => {
    expect(renderPlanMarkdown("- one\n\n  two\n").html).toContain(`<p>${marker(3)}two</p>`);
  });

  test("a blockquote's second paragraph carries its own line", () => {
    expect(renderPlanMarkdown("> one\n>\n> two").html).toContain(`<p>${marker(3)}two</p>`);
  });

  test("each table cell starts with its row's line", () => {
    const root = fragment(
      renderPlanMarkdown("intro\n\n| h | i |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |").html,
    );
    const lineOf = (cell: Element) => cell.firstElementChild?.getAttribute("data-source-line");
    expect([...root.querySelectorAll("th")].map(lineOf)).toEqual(["3", "3"]);
    expect([...root.querySelectorAll("td")].map(lineOf)).toEqual(["5", "5", "6", "6"]);
  });

  test("a fenced block is marked once, before <pre>, at its first code line", () => {
    const html = renderPlanMarkdown("para\n\n```\nx\ny\n```").html;
    expect(html).toContain(`${codeMarker(4)}<pre>`);
    expect(markerCount(html)).toBe(2);
  });

  test("an indented block is marked at its first line", () => {
    expect(renderPlanMarkdown("para\n\n    code").html).toContain(`${codeMarker(3)}<pre>`);
  });

  test("a fenced block in a list item is marked inside the <li>", () => {
    const li = fragment(renderPlanMarkdown("- item\n\n  ```\n  x\n  ```").html).querySelector("li");
    expect(li?.querySelector("[data-source-code]")?.getAttribute("data-source-line")).toBe("4");
  });

  test("an empty fenced block is unmarked", () => {
    expect(markerCount(renderPlanMarkdown("```\n```").html)).toBe(0);
  });

  test("a native task's marker follows its checkbox; a [/] task's precedes it", () => {
    expect(renderPlanMarkdown("- [ ] task").html).toMatch(
      /<input [^>]*> <span data-source-line="1"><\/span>task/,
    );
    expect(renderPlanMarkdown("- [/] task").html).toContain(`<li>${marker(1)}<input`);
  });

  test("a raw-HTML <pre> carries only its block's line marker", () => {
    const html = renderPlanMarkdown("<pre>\na\nb\n</pre>").html;
    expect(html).toContain(`${marker(1)}<pre>`);
    expect(html).not.toContain("data-source-code");
  });

  test("a raw marker-shaped span in plan text cannot forge a marker", () => {
    expect(
      renderPlanMarkdown('t <span data-source-line="9" data-source-code>x</span>').html,
    ).toContain("<span>x</span>");
  });
});

describe("renderPlanMarkdown text", () => {
  test("a soft line break stays a newline, not <br>", () => {
    const html = withoutMarkers(renderPlanMarkdown("a\nb").html);
    expect(html).toContain("<p>a\nb</p>");
    expect(html).not.toContain("<br");
  });

  test("markdown renders as semantic HTML", () => {
    const text = [
      "# 1",
      "## 2",
      "### 3",
      "#### 4",
      "##### 5",
      "###### 6",
      "",
      "**s** *e* `c`",
      "",
      "```",
      "fenced",
      "```",
      "",
      "    indented",
      "",
      "- u",
      "",
      "1. o",
      "",
      "> q",
      "",
      "| h |",
      "| - |",
      "| d |",
      "",
      "---",
    ].join("\n");
    const root = fragment(renderPlanMarkdown(text).html);
    for (const selector of [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "strong",
      "em",
      "p > code",
      "ul > li",
      "ol > li",
      "blockquote",
      "table th",
      "table td",
      "hr",
    ]) {
      expect(root.querySelector(selector) !== null).toBe(true);
    }
    const codeBlockTexts = [...root.querySelectorAll("pre > code")].map((el) => el.textContent);
    expect(codeBlockTexts).toEqual(["fenced\n", "indented\n"]);
  });
});

describe("renderPlanMarkdown tasks", () => {
  function checkboxes(text: string) {
    return [...fragment(renderPlanMarkdown(text).html).querySelectorAll("input")];
  }

  test("each task marker renders its own state, disabled, only [x] checked", () => {
    const inputs = checkboxes("- [ ] a\n- [x] b\n- [/] c");
    expect(inputs.map((i) => i.getAttribute("data-task"))).toEqual([
      "unchecked",
      "checked",
      "slashed",
    ]);
    expect(inputs.every((i) => i.hasAttribute("disabled"))).toBe(true);
    expect(inputs.map((i) => i.hasAttribute("checked"))).toEqual([false, true, false]);
  });

  test("the [/] marker leaves the item's text", () => {
    const li = fragment(renderPlanMarkdown("- [/] doing").html).querySelector("li");
    expect(li?.textContent?.trim()).toBe("doing");
  });

  test("[/] followed by inline markup still renders a slashed checkbox", () => {
    for (const text of [
      "- [/] **Phase 2**: wire it",
      "- [/] `foo` bar",
      "- [/] [doc](https://a.test) x",
      "- a\n  - [/] *b*",
    ]) {
      const root = fragment(renderPlanMarkdown(text).html);
      const states = [...root.querySelectorAll("input")].map((i) => i.getAttribute("data-task"));
      expect(states).toEqual(["slashed"]);
      expect(root.textContent?.includes("[/]")).toBe(false);
    }
  });

  test("nested and loose items get the slashed state", () => {
    expect(checkboxes("- a\n  - [/] nested").map((i) => i.getAttribute("data-task"))).toEqual([
      "slashed",
    ]);
    expect(checkboxes("- [/] one\n\n- [/] two").map((i) => i.getAttribute("data-task"))).toEqual([
      "slashed",
      "slashed",
    ]);
  });
});

describe("renderPlanMarkdown links", () => {
  test("a safe link opens in a new tab without an opener", () => {
    const html = renderPlanMarkdown("[x](https://a.test)").html;
    expect(html).toContain('href="https://a.test"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  test("an unsafe link renders its label as text", () => {
    for (const text of ["[x](javascript:alert(1))", "[x](./rel.md)", "<me@a.test>"]) {
      const html = renderPlanMarkdown(text).html;
      expect(html).not.toContain("<a");
      expect(html).not.toContain("javascript:");
    }
    expect(renderPlanMarkdown("[label](./rel.md)").html).toContain("label");
  });

  test("a bare https autolink renders a link", () => {
    expect(renderPlanMarkdown("see https://a.test/x").html).toContain('<a href="https://a.test/x"');
  });
});

describe("renderPlanMarkdown images", () => {
  test("a safe image loads lazily without a referrer", () => {
    const html = renderPlanMarkdown('![alt](https://a.test/i.png "t")').html;
    const img = fragment(html).querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://a.test/i.png");
    expect(img?.getAttribute("loading")).toBe("lazy");
    expect(img?.getAttribute("referrerpolicy")).toBe("no-referrer");
    for (const attr of ["srcset", "style", "title"]) expect(img?.hasAttribute(attr)).toBe(false);
  });

  test("an unsafe image renders its alt text", () => {
    for (const text of ["![alt](javascript:x)", "![alt](rel.png)"]) {
      const html = renderPlanMarkdown(text).html;
      expect(html).not.toContain("<img");
      expect(html).toContain("alt");
    }
  });

  test("alt text is the image label's plain text", () => {
    const altOf = (text: string) =>
      fragment(renderPlanMarkdown(text).html).querySelector("img")?.getAttribute("alt");
    expect(altOf("![**b** _i_](https://a.test/i.png)")).toBe("b i");
    expect(renderPlanMarkdown("![a & b](https://a.test/i.png)").html).toContain('alt="a &amp; b"');
    expect(renderPlanMarkdown("![**b** _i_](rel.png)").html).toContain("b i");
  });
});

describe("renderPlanMarkdown attribute escaping", () => {
  test("quotes in a link or image cannot add attributes", () => {
    const root = fragment(
      renderPlanMarkdown(
        [
          '[x](<https://a.test/"onx="y> "t\\" onx=\\"y")',
          "",
          '![a" onx="y](<https://a.test/"onx="y> "t\\" onx=\\"y")',
        ].join("\n"),
      ).html,
    );
    const attributeNamesOf = (selector: string) =>
      root.querySelector(selector)?.getAttributeNames().sort() ?? [];
    expect(attributeNamesOf("a")).toEqual(["href", "rel", "target", "title"]);
    expect(attributeNamesOf("img")).toEqual(["alt", "loading", "referrerpolicy", "src"]);
  });
});

describe("renderPlanMarkdown raw HTML", () => {
  test("a <script> tag does not survive", () => {
    expect(renderPlanMarkdown("<script>alert(1)</script>").html).not.toContain("<script");
  });

  test("an event-handler attribute does not survive", () => {
    expect(renderPlanMarkdown('<span onclick="x">t</span>').html).not.toContain("onclick");
  });

  test("a raw javascript: link renders as inert text", () => {
    const root = fragment(renderPlanMarkdown('<a href="javascript:alert(1)">j</a>').html);
    expect(root.querySelector("a, [href]") === null).toBe(true);
  });

  test("raw fetching tags and style/srcset render as text", () => {
    const html = renderPlanMarkdown(
      [
        '<img src="https://a.test/i.png" onerror="x">',
        "",
        '<video src="https://a.test/v"></video>',
        "",
        '<p style="color:red" srcset="https://a.test/s.png">s</p>',
      ].join("\n"),
    ).html;
    const root = fragment(html);
    expect(root.querySelector("img, video, [style], [srcset]") === null).toBe(true);
  });

  test("no raw tag keeps a URL-bearing attribute", () => {
    for (const text of [
      '<a href="https://a.test">a</a>',
      '<area href="https://a.test">',
      '<audio src="https://a.test/a"></audio>',
      '<img src="https://a.test/i.png">',
      '<video poster="https://a.test/p.png"></video>',
    ]) {
      const root = fragment(renderPlanMarkdown(text).html);
      expect(root.querySelector("[href], [src], [poster], [srcset]") === null).toBe(true);
    }
  });

  test("a raw <div> leaves every block a top-level sibling", () => {
    expect(spans("Wrap it in a <div> here.\n\n# A")).toEqual([
      [1, 1],
      [3, 3],
    ]);
    expect(spans('<div align="center">\n\n# Title\n\n</div>\n\npara')).toEqual([
      [1, 1],
      [3, 3],
      [5, 5],
      [7, 7],
    ]);
  });

  test("a raw <table> renders as text", () => {
    expect(renderPlanMarkdown("Render a <table> here.\n\n# Next").html).not.toContain("<table");
  });

  test("a raw <details> survives", () => {
    const root = fragment(renderPlanMarkdown("<details><summary>s</summary></details>").html);
    expect(root.querySelector("details > summary") !== null).toBe(true);
  });
});

describe("renderPlanMarkdown speed", () => {
  test("renders a 2,000-line plan in under 200 ms", () => {
    const chunk = [
      "",
      "## Step",
      "",
      "A paragraph that wraps at ninety columns with a [link](https://a.test) and",
      "some `inline code` on its second line.",
      "",
      "- [ ] todo",
      "- [x] done",
      "- [/] doing",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "> quoted ![img](https://a.test/i.png)",
      "",
      "<details><summary>s</summary></details>",
      "",
    ].join("\n");
    const plan = chunk.repeat(100);
    expect(plan.split("\n").length).toBeGreaterThanOrEqual(2000);
    renderPlanMarkdown(chunk);
    const start = performance.now();
    renderPlanMarkdown(plan);
    expect(performance.now() - start).toBeLessThan(200);
  });
});
