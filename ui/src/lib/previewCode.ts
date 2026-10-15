// The plan preview's code blocks as DOM: finding them, colouring them from shiki
// tokens, and marking the ones soft-wrapped. Colour is built from tokens with DOM
// APIs, never parsed markup, so neither the fence's language nor the theme reaches
// markup, and a block's text stays byte-identical to the fence's for the source map.

import { getTokenStyleObject, type ThemedToken } from "shiki/core";

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

/** Tokens per line, or null to leave the block plain. Must not reject: the pass runs detached. */
export type Tokenize = (code: string, language: string) => Promise<ThemedToken[][] | null>;

export interface HighlightDeps {
  tokenize: Tokenize;
  /** Resolves on a later task. Production passes a setTimeout(0) promise. */
  nextTask: () => Promise<void>;
  signal: AbortSignal;
}

function tokenSpan(token: ThemedToken): HTMLSpanElement {
  const span = document.createElement("span");
  span.textContent = token.content;
  for (const [property, value] of Object.entries(getTokenStyleObject(token)))
    span.style.setProperty(property, value);
  return span;
}

function tokenNodes(lines: ThemedToken[][]): Node[] {
  return lines.flatMap((tokens, i) => [
    ...(i > 0 ? [document.createTextNode("\n")] : []),
    ...tokens.map(tokenSpan),
  ]);
}

/** Highlights each block `languages` names, one block per task and none in the calling
 * task, by replacing its `code`'s children with token spans of the same text. A block
 * whose tokens come back null, or whose tokens' text differs from the block's, stays as
 * it is. Returns at the first await after `signal` aborts. */
export async function highlightPreviewCode(
  root: ParentNode,
  languages: ReadonlyMap<number, string>,
  { tokenize, nextTask, signal }: HighlightDeps,
): Promise<void> {
  for (const { line, code } of previewCodeBlocks(root)) {
    const language = languages.get(line);
    if (language === undefined) continue;
    // ponytail: yields per block only, so one huge block still tokenizes in a single
    // task; chunk it through grammar state as highlightChunk does if that bites.
    await nextTask();
    if (signal.aborted) return;
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
