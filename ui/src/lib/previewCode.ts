// The plan preview's code blocks as DOM: finding them, colouring them from shiki
// tokens, and marking the ones soft-wrapped. Colour is built from tokens with DOM
// APIs, never parsed markup, so neither the fence's language nor the theme reaches
// markup, and a block's text stays byte-identical to the fence's for the source map.

import type { ThemedToken } from "shiki/core";

// shiki's FontStyle bit flags; its enum is const, so it has no runtime export.
const ITALIC = 1;
const BOLD = 2;
const UNDERLINE = 4;
const STRIKETHROUGH = 8;

/** A code block in the mounted preview: the `pre` right after a `data-source-code` marker. */
export interface PreviewCodeBlock {
  /** The marker's line: the block's first code line, which keys `codeLanguages`. */
  line: number;
  /** The line before it: a fenced block's opening fence, which keys its chrome and wrap
   * state exactly as the source view's CodeBlockRange.start does. */
  start: number;
  pre: HTMLElement;
  code: HTMLElement;
}

/** The preview's code blocks in document order. */
export function previewCodeBlocks(root: ParentNode): PreviewCodeBlock[] {
  const blocks: PreviewCodeBlock[] = [];
  for (const marker of root.querySelectorAll("[data-source-code]")) {
    const pre = marker.nextElementSibling;
    const code = pre?.firstElementChild;
    if (!(pre instanceof HTMLElement) || !(code instanceof HTMLElement)) continue;
    const line = Number(marker.getAttribute("data-source-line"));
    blocks.push({ line, start: line - 1, pre, code });
  }
  return blocks;
}

export type Tokenize = (code: string, language: string) => Promise<ThemedToken[][] | null>;

function tokenSpan(token: ThemedToken): HTMLSpanElement {
  const span = document.createElement("span");
  span.textContent = token.content;
  if (token.color) span.style.color = token.color;
  const style = token.fontStyle ?? 0;
  if (style & ITALIC) span.style.fontStyle = "italic";
  if (style & BOLD) span.style.fontWeight = "bold";
  const lines = [
    style & UNDERLINE ? "underline" : "",
    style & STRIKETHROUGH ? "line-through" : "",
  ].filter(Boolean);
  if (lines.length > 0) span.style.textDecoration = lines.join(" ");
  return span;
}

function tokenNodes(lines: ThemedToken[][]): Node[] {
  return lines.flatMap((tokens, i) => [
    ...(i > 0 ? [document.createTextNode("\n")] : []),
    ...tokens.map(tokenSpan),
  ]);
}

/** Highlights each block `languages` names, one block per task, by replacing its `code`'s
 * children with token spans of the same text. A block whose tokens come back null, or
 * whose tokens' text differs from the block's, stays as it is. Returns at the first await
 * after `signal` aborts. */
export async function highlightPreviewCode(
  root: ParentNode,
  languages: ReadonlyMap<number, string>,
  tokenize: Tokenize,
  signal: AbortSignal,
): Promise<void> {
  let first = true;
  for (const { line, code } of previewCodeBlocks(root)) {
    const language = languages.get(line);
    if (language === undefined) continue;
    if (!first) {
      // ponytail: yields between blocks only, so one huge block still tokenizes in a
      // single task; chunk it through grammar state as highlightChunk does if that bites.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (signal.aborted) return;
    }
    first = false;
    const text = code.textContent ?? "";
    const tokens = await tokenize(text.replace(/\n$/, ""), language);
    if (signal.aborted) return;
    if (tokens === null) continue;
    const nodes = [...tokenNodes(tokens), document.createTextNode("\n")];
    if (nodes.map((node) => node.textContent).join("") === text) code.replaceChildren(...nodes);
  }
}

/** Marks each block whose `start` is in `reflowed` as wrapped (`data-code-reflow` on its
 * `pre`) and clears the rest. */
export function applyPreviewReflow(root: ParentNode, reflowed: ReadonlySet<number>): void {
  for (const { start, pre } of previewCodeBlocks(root))
    pre.toggleAttribute("data-code-reflow", reflowed.has(start));
}
