import "@ui/test-setup.ts";
import { describe, expect, test } from "bun:test";

import { splitTokens } from "$lib/diffview/rowTokens.ts";

// Every pass that decorates a rendered row locates a token by walking the row's
// children in column order and accumulating text length. splitTokens is what makes
// every boundary those walks need a real element edge, for inlineDecorate.ts and
// fileRefTag.ts alike.

/** A row of `<span>` tokens whose text concatenates to `parts.join("")`. */
function row(...parts: string[]): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-line", "1");
  for (const part of parts) {
    const span = document.createElement("span");
    span.textContent = part;
    el.appendChild(span);
  }
  return el;
}

const texts = (els: Element[]): string[] => els.map((el) => el.textContent ?? "");

describe("splitTokens", () => {
  test("splits a token that a cut falls strictly inside", () => {
    const el = row("abcd");
    splitTokens(el, [2]);
    expect(texts([...el.children])).toEqual(["ab", "cd"]);
  });

  test("splits a token at several interior cuts at once", () => {
    const el = row("abcdef");
    splitTokens(el, [2, 4]);
    expect(texts([...el.children])).toEqual(["ab", "cd", "ef"]);
  });

  test("leaves a token alone when a cut lands on its edge", () => {
    const el = row("ab", "cd");
    const before = [...el.children];
    splitTokens(el, [0, 2, 4]);
    // Same nodes, not replacements: an already-correct row must mutate nothing, or
    // SourceView's MutationObserver would re-fire on every pass forever.
    expect([...el.children]).toEqual(before);
  });

  test("carries the split token's attributes onto every piece", () => {
    const el = row("abcd");
    el.children[0]?.setAttribute("style", "color:red");
    splitTokens(el, [2]);
    for (const piece of [...el.children]) {
      expect(piece.getAttribute("style")).toBe("color:red");
    }
  });

  test("skips a token holding elements of its own", () => {
    const el = document.createElement("div");
    const outer = document.createElement("span");
    outer.innerHTML = "<b>abcd</b>";
    el.appendChild(outer);
    splitTokens(el, [2]);
    expect(el.children).toHaveLength(1);
  });
});
