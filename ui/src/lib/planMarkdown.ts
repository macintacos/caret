// The plan text is agent-authored, so its raw-HTML tokens are sanitized; caret's
// own markup and attributes are built outside the sanitizer, from marked's tokens.
import { Marked, type Token, type Tokens } from "marked";
import { FilterXSS } from "xss";

import { IMAGE_ATTRIBUTES } from "$lib/diffview/inlineImages.ts";
import { isSafeUrl } from "$lib/diffview/links.ts";
import { htmlWhiteList } from "$lib/markdown.ts";

/** A block's source lines in the version's stored text: 1-based, inclusive. */
export interface SourceSpan {
  start: number;
  end: number;
}

export interface RenderedPlan {
  /** One `<div data-source-start="…" data-source-end="…">` per block, in document order. */
  html: string;
  /** Each block's span; `blocks[i]` is the html's i-th top-level element. */
  blocks: SourceSpan[];
}

// Raw tags whose whitelisted attributes fetch or navigate: the source view shows
// them as text, so the preview must not load or follow them either.
const FETCHING_OR_NAVIGATING = new Set(["a", "area", "audio", "img", "video"]);

const rawHtml = new FilterXSS({
  whiteList: Object.fromEntries(
    Object.entries(htmlWhiteList()).filter(([tag]) => !FETCHING_OR_NAVIGATING.has(tag)),
  ),
});

// marked lifts only `[ ]` and `[x]` into a task checkbox; caret also has `[/]`.
const SLASHED_TASK = /^\[\/\] +(?=\S)/;

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html: ({ text }) => rawHtml.process(text),
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      if (!isSafeUrl(href)) return label;
      const titled = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(href)}"${titled} target="_blank" rel="noopener noreferrer">${label}</a>`;
    },
    image({ href, text }) {
      if (!isSafeUrl(href)) return escapeHtml(text);
      const attributes = Object.entries(IMAGE_ATTRIBUTES)
        .map(([name, value]) => ` ${name}="${value}"`)
        .join("");
      return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${attributes}>`;
    },
    checkbox({ checked, raw }) {
      const state = raw?.startsWith("[/]") ? "slashed" : checked ? "checked" : "unchecked";
      return `<input type="checkbox" disabled data-task="${state}"${checked ? " checked" : ""}> `;
    },
  },
});

function liftSlashedTask(token: Token): void {
  if (token.type !== "list_item" || token.task) return;
  const block = (token as Tokens.ListItem).tokens[0];
  if (block?.type !== "text" && block?.type !== "paragraph") return;
  const inline = (block as Tokens.Text | Tokens.Paragraph).tokens;
  const first = inline?.[0];
  if (inline === undefined || first?.type !== "text") return;
  const marker = SLASHED_TASK.exec(first.text);
  if (marker === null) return;
  first.text = first.text.slice(marker[0].length);
  first.raw = first.raw.slice(marker[0].length);
  inline.unshift({ type: "checkbox", raw: "[/] ", checked: false });
}

function newlines(text: string): number {
  return text.split("\n").length - 1;
}

export function renderPlanMarkdown(text: string): RenderedPlan {
  const tokens = marked.lexer(text);
  marked.walkTokens(tokens, liftSlashedTask);
  let html = "";
  const blocks: SourceSpan[] = [];
  let line = 1;
  for (const token of tokens) {
    const body = marked.parser([token]);
    if (body !== "") {
      const leading = token.raw.slice(0, token.raw.length - token.raw.trimStart().length);
      const span = { start: line + newlines(leading), end: line + newlines(token.raw.trimEnd()) };
      blocks.push(span);
      html += `<div data-source-start="${span.start}" data-source-end="${span.end}">${body}</div>`;
    }
    line += newlines(token.raw);
  }
  return { html, blocks };
}
