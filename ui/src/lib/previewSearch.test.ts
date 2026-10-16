import "@ui/support/setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import { renderPlanMarkdown } from "$lib/planMarkdown.ts";
import { createPlanSourceMap, type PlanSourceMap } from "$lib/planSourceMap.ts";
import {
  clearPreviewSearch,
  createPreviewSearch,
  openMatchDetails,
  paintPreviewSearch,
  previewMatchRanges,
} from "$lib/previewSearch.ts";

let mounted: HTMLElement[] = [];

afterEach(() => {
  for (const el of mounted) el.remove();
  mounted = [];
});

function mount(text: string): { root: HTMLElement; map: PlanSourceMap } {
  const root = document.createElement("div");
  root.innerHTML = renderPlanMarkdown(text).html;
  document.body.append(root);
  mounted.push(root);
  return { root, map: createPlanSourceMap(root) };
}

function count(text: string, query: string): number {
  const { root, map } = mount(text);
  return createPreviewSearch(root, map).find(query).length;
}

describe("createPreviewSearch", () => {
  test("a phrase across a soft break is one match on its first line", () => {
    const { root, map } = mount("alpha beta\ngamma delta\n");
    const matches = createPreviewSearch(root, map).find("beta gamma");
    expect(matches.length).toBe(1);
    expect(matches[0]?.line).toBe(1);
    const [range] = previewMatchRanges(root, map, matches);
    expect(range?.toString()).toBe("beta\ngamma");
  });

  test("a match's columns locate its range from its line's start", () => {
    const { root, map } = mount("alpha beta\ngamma delta\n");
    const [m] = createPreviewSearch(root, map).find("beta gamma");
    if (m === undefined) throw new Error("no match");
    const [range] = previewMatchRanges(root, map, [m]);
    if (range == null) throw new Error("no range");
    expect(map.lineAt(range.startContainer, range.startOffset)).toBe(m.line);
    expect(m.endCol - m.startCol).toBe(range.toString().length);
  });

  test("markers, bullets and link URLs are not text", () => {
    const plan = "- **bold** item, see [the docs](https://docs.example.org/zebra)\n\n# Title\n";
    for (const query of ["zebra", "https", "**", "- ", "#"]) {
      expect(count(plan, query)).toBe(0);
    }
    for (const query of ["bold item", "the docs", "Title"]) {
      expect(count(plan, query)).toBe(1);
    }
  });

  test("a block bounds a match", () => {
    expect(count("one end\n\nstart two\n", "end start")).toBe(0);
    expect(count("- one end\n- start two\n", "end start")).toBe(0);
    expect(count("- one end\n  - start two\n", "end start")).toBe(0);
    expect(count("| one end | start two |\n| -- | -- |\n| a | b |\n", "end start")).toBe(0);
    expect(count("<dl><dt>Term</dt><dd>Definition</dd></dl>\n", "TermDefinition")).toBe(0);
    expect(count("<details open><summary>Heading</summary>Body</details>\n", "HeadingBody")).toBe(
      0,
    );
  });

  test("prose whitespace collapses to one space", () => {
    expect(count("foo   bar\n", "foo bar")).toBe(1);
    expect(count("foo  \nbar\n", "foo bar")).toBe(1);
    expect(count("foo  \nbar\n", "foobar")).toBe(0);
    expect(count("- [ ] task\n", " task")).toBe(0);
  });

  test("code matches literally, one line at a time", () => {
    const plan = "```\nlet  x = 1;\nlet y\n```\n";
    expect(count(plan, "let  x")).toBe(1);
    expect(count(plan, "1; let")).toBe(0);
    expect(count(plan, "let")).toBe(2);
  });

  test("smartcase", () => {
    expect(count("Widget widget\n", "widget")).toBe(2);
    expect(count("Widget widget\n", "Widget")).toBe(1);
  });
});

describe("openMatchDetails", () => {
  const plan = "<details><summary>More</summary>\nhidden secret text\n</details>\n";

  test("opens the closed details holding the match", () => {
    const { root, map } = mount(plan);
    const [m] = createPreviewSearch(root, map).find("secret");
    if (m === undefined) throw new Error("no match");
    openMatchDetails(root, map, m);
    expect(root.querySelector("details")?.open).toBe(true);
  });

  test("leaves details closed when the match is in its summary", () => {
    const { root, map } = mount(plan);
    const [m] = createPreviewSearch(root, map).find("More");
    if (m === undefined) throw new Error("no match");
    openMatchDetails(root, map, m);
    expect(root.querySelector("details")?.open).toBe(false);
  });
});

describe("previewMatchRanges", () => {
  test("matches resolve after a code block's text is split into spans", () => {
    const { root, map } = mount("intro\n\n```js\nlet x = 1;\nlet y = 2;\n```\n");
    const search = createPreviewSearch(root, map);
    const matches = search.find("= ");
    const code = root.querySelector("pre > code");
    if (code === null) throw new Error("no code block");
    code.replaceChildren(
      ...(code.textContent ?? "").split(/(?<=[ \n])/).map((text) => {
        const span = document.createElement("span");
        span.textContent = text;
        return span;
      }),
    );
    expect(search.find("= ")).toEqual(matches);
    const ranges = previewMatchRanges(root, map, matches);
    expect(ranges.length).toBe(2);
    expect(ranges.every((range) => range?.toString() === "= ")).toBe(true);
  });
});

describe("paintPreviewSearch", () => {
  test("paint and clear are no-ops without the Highlight API", () => {
    const { root, map } = mount("foo bar\n");
    const ranges = previewMatchRanges(root, map, createPreviewSearch(root, map).find("foo"));
    expect(() => {
      paintPreviewSearch(ranges, 0);
      clearPreviewSearch();
    }).not.toThrow();
  });
});
