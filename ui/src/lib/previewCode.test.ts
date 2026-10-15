import "@ui/support/setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import type { ThemedToken } from "shiki/core";

import { highlightTokens } from "$lib/diffview/highlight.ts";
import { renderPlanMarkdown } from "$lib/planMarkdown.ts";
import { createPlanSourceMap, type PlanSourceMap } from "$lib/planSourceMap.ts";
import {
  applyPreviewReflow,
  highlightPreviewCode,
  previewCodeBlocks,
  type Tokenize,
} from "$lib/previewCode.ts";

let mounted: HTMLElement[] = [];

afterEach(() => {
  for (const el of mounted) el.remove();
  mounted = [];
});

function mount(text: string): { root: HTMLElement; languages: ReadonlyMap<number, string> } {
  const rendered = renderPlanMarkdown(text);
  const root = document.createElement("div");
  root.innerHTML = rendered.html;
  document.body.append(root);
  mounted.push(root);
  return { root, languages: rendered.codeLanguages };
}

const PLAN = [
  "intro", // 1
  "", // 2
  "```ts", // 3
  "const x = 1;", // 4
  "let y = 2;", // 5
  "```", // 6
  "", // 7
  "- item", // 8
  "", // 9
  "  ```js", // 10
  "  a();", // 11
  "  ```", // 12
  "", // 13
  "<pre>raw</pre>", // 14
  "", // 15
  "```nosuchlang", // 16
  "plain text", // 17
  "```", // 18
  "",
].join("\n");

const real: Tokenize = (c, l) => highlightTokens(c, l, "caret-dark");

/** Tokens of one red span per line: the shape a tokenizer returns, text untouched. */
const instant: Tokenize = async (code) =>
  code.split("\n").map((content) => [{ content, offset: 0, color: "#ff0000" } as ThemedToken]);

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

// Bun runs every due timer before draining microtasks, so the pass's own timer
// fires alongside this one and its continuation needs a flush after.
async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushMicrotasks();
}

function isHighlighted(code: Element): boolean {
  return code.querySelector("span") !== null;
}

function codes(root: ParentNode): HTMLElement[] {
  return previewCodeBlocks(root).map((block) => block.code);
}

describe("previewCodeBlocks", () => {
  test("finds every marked block in order, a nested one included, and skips raw HTML", () => {
    const { root } = mount(PLAN);
    const blocks = previewCodeBlocks(root);
    expect(blocks.map(({ line, start }) => [line, start])).toEqual([
      [4, 3],
      [11, 10],
      [17, 16],
    ]);
    expect(blocks.map((b) => b.code.textContent)).toEqual([
      "const x = 1;\nlet y = 2;\n",
      "a();\n",
      "plain text\n",
    ]);
  });
});

describe("highlightPreviewCode", () => {
  test("colours a known-language block without changing its text", async () => {
    const { root, languages } = mount(PLAN);
    const [code] = codes(root);
    const before = code?.textContent;
    await highlightPreviewCode(root, languages, real, new AbortController().signal);
    const spans = [...(code?.querySelectorAll("span") ?? [])];
    expect(spans.length).toBeGreaterThan(1);
    expect(spans.some((span) => span.style.color !== "")).toBe(true);
    expect(code?.textContent).toBe(before);
  });

  test("leaves a block no language names as its single text node", async () => {
    const { root, languages } = mount(PLAN);
    await highlightPreviewCode(root, languages, real, new AbortController().signal);
    const plain = codes(root)[2];
    expect(plain?.childNodes.length).toBe(1);
    expect(plain?.firstChild?.nodeType).toBe(Node.TEXT_NODE);
  });

  test("leaves a block untouched when the tokenizer gives up", async () => {
    const { root, languages } = mount(PLAN);
    await highlightPreviewCode(root, languages, async () => null, new AbortController().signal);
    expect(codes(root).some(isHighlighted)).toBe(false);
  });

  test("leaves a block untouched when the tokens' text differs from it", async () => {
    const { root, languages } = mount(PLAN);
    const wrong: Tokenize = async () => [[{ content: "other", offset: 0 } as ThemedToken]];
    await highlightPreviewCode(root, languages, wrong, new AbortController().signal);
    expect(codes(root).some(isHighlighted)).toBe(false);
  });

  test("highlights one block per task", async () => {
    const { root, languages } = mount(PLAN);
    const pass = highlightPreviewCode(root, languages, instant, new AbortController().signal);
    await flushMicrotasks();
    expect(codes(root).map(isHighlighted)).toEqual([true, false, false]);
    await tick();
    expect(codes(root).map(isHighlighted)).toEqual([true, true, false]);
    await pass;
  });

  test("stops at the next block once the signal aborts", async () => {
    const { root, languages } = mount(PLAN);
    const controller = new AbortController();
    const abortAfterFirst: Tokenize = async (code, language) => {
      const tokens = await instant(code, language);
      controller.abort();
      return tokens;
    };
    await highlightPreviewCode(root, languages, abortAfterFirst, controller.signal);
    expect(isHighlighted(codes(root)[1] as HTMLElement)).toBe(false);
  });

  test("a second pass in another theme repaints a highlighted block", async () => {
    const { root, languages } = mount(PLAN);
    const [code] = codes(root);
    const before = code?.textContent;
    const colours = () => [...(code?.querySelectorAll("span") ?? [])].map((s) => s.style.color);
    await highlightPreviewCode(root, languages, real, new AbortController().signal);
    const dark = colours();
    const light: Tokenize = (c, l) => highlightTokens(c, l, "caret-light");
    await highlightPreviewCode(root, languages, light, new AbortController().signal);
    expect(colours()).not.toEqual(dark);
    expect(code?.textContent).toBe(before);
  });
});

describe("the source map over highlighted code", () => {
  const CODE = "intro\n\n```js\nlet x = 1;\nlet y = 2;\n```\n\nafter\n";

  /** The text node holding `needle`'s first character, wherever token spans split it. */
  function find(root: Node, needle: string): [Text, number] {
    let index = root.textContent?.indexOf(needle) ?? -1;
    if (index === -1) throw new Error(`no text holds ${JSON.stringify(needle)}`);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const length = node.textContent?.length ?? 0;
      if (index < length) return [node as Text, index];
      index -= length;
    }
    throw new Error("unreachable");
  }

  function expectCodeLines(root: Element, map: PlanSourceMap): void {
    expect(map.lineAt(...find(root, "let x"))).toBe(4);
    expect(map.lineAt(...find(root, "let y"))).toBe(5);
    expect(map.rangeOf(4)?.toString()).toContain("let x = 1;");
    expect(map.rangeOf(5)?.toString()).toContain("let y = 2;");
    expect(map.lineAt(...find(root, "after"))).toBe(8);
  }

  test("maps built before and after the pass both answer", async () => {
    const { root, languages } = mount(CODE);
    const before = createPlanSourceMap(root);
    await highlightPreviewCode(root, languages, real, new AbortController().signal);
    expect(root.querySelectorAll("pre span").length).toBeGreaterThan(1);
    expectCodeLines(root, before);
    expectCodeLines(root, createPlanSourceMap(root));
  });
});

describe("applyPreviewReflow", () => {
  test("marks exactly the blocks whose opening line is in the set", () => {
    const { root } = mount(PLAN);
    const reflowed = () =>
      previewCodeBlocks(root).map((b) => b.pre.hasAttribute("data-code-reflow"));
    applyPreviewReflow(root, new Set([3, 16]));
    expect(reflowed()).toEqual([true, false, true]);
    applyPreviewReflow(root, new Set([10]));
    expect(reflowed()).toEqual([false, true, false]);
  });
});
