// The plan text is agent-authored, so its raw-HTML tokens are sanitized; caret's
// own markup and attributes are built outside the sanitizer, from marked's tokens.
import { Marked, type Token, type Tokens } from "marked";
import { FilterXSS } from "xss";

import { IMAGE_ATTRIBUTES } from "$lib/diffview/inlineImages.ts";
import { isSafeUrl } from "$lib/diffview/links.ts";
import { htmlWhiteList } from "$lib/markdown.ts";

/** A block's source lines in the version's stored text: 1-based, inclusive.
 * A block ends at its last non-blank line; blank lines between blocks belong to none. */
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

// A raw tag that is excluded renders as text, as every raw tag does in the source view.
// The browser fetches or navigates to these attributes' values.
const URL_ATTRIBUTES = new Set(["href", "src", "srcset", "poster"]);
// Left unclosed, these swallow or reorder the blocks after them.
const UNBALANCED_CONTAINERS = new Set(["div", "table"]);

const rawHtmlFilter = new FilterXSS({
  whiteList: Object.fromEntries(
    Object.entries(htmlWhiteList()).filter(
      ([tag, attributes = []]) =>
        !UNBALANCED_CONTAINERS.has(tag) && !attributes.some((name) => URL_ATTRIBUTES.has(name)),
    ),
  ),
});

// marked lifts only `[ ]` and `[x]` into a task checkbox; caret also has `[/]`. Tested
// on the item's text, which marked trims, since the first inline token may be the bare marker.
const SLASHED_TASK = /^\[\/\] +/;

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
    html: ({ text }) => rawHtmlFilter.process(text),
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      if (!isSafeUrl(href)) return label;
      const titled = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(href)}"${titled} target="_blank" rel="noopener noreferrer">${label}</a>`;
    },
    image({ href, tokens }) {
      const alt = escapeHtml(this.parser.parseInline(tokens, this.parser.textRenderer));
      if (!isSafeUrl(href)) return alt;
      const attributes = Object.entries(IMAGE_ATTRIBUTES)
        .map(([name, value]) => ` ${name}="${value}"`)
        .join("");
      return `<img src="${escapeHtml(href)}" alt="${alt}"${attributes}>`;
    },
    checkbox({ checked, raw }) {
      const state = raw.startsWith("[/]") ? "slashed" : checked ? "checked" : "unchecked";
      return `<input type="checkbox" disabled data-task="${state}"${checked ? " checked" : ""}> `;
    },
  },
});

function liftSlashedTask(token: Token): void {
  if (token.type !== "list_item" || token.task) return;
  const item = token as Tokens.ListItem;
  if (!SLASHED_TASK.test(item.text)) return;
  const block = item.tokens[0];
  if (block?.type !== "text" && block?.type !== "paragraph") return;
  const inlineTokens = (block as Tokens.Text | Tokens.Paragraph).tokens;
  const firstInline = inlineTokens?.[0];
  if (inlineTokens === undefined || firstInline?.type !== "text") return;
  const marker = SLASHED_TASK.exec(firstInline.text);
  if (marker === null) return;
  firstInline.text = firstInline.text.slice(marker[0].length);
  firstInline.raw = firstInline.raw.slice(marker[0].length);
  inlineTokens.unshift({ type: "checkbox", raw: marker[0], checked: false });
}

function newlines(text: string): number {
  return text.split("\n").length - 1;
}

/** Renders a plan version's stored text for the preview. The HTML is safe for `{@html}`,
 * and each span indexes the text comment anchors use. A `[/]` task carries
 * `data-task="slashed"` but not `indeterminate`, which has no attribute form, so whoever
 * mounts the HTML sets the property. */
export function renderPlanMarkdown(text: string): RenderedPlan {
  const tokens = marked.lexer(text);
  marked.walkTokens(tokens, liftSlashedTask);
  let html = "";
  const blocks: SourceSpan[] = [];
  let line = 1;
  for (const token of tokens) {
    const blockHtml = marked.parser([token]);
    if (blockHtml !== "") {
      const leadingWhitespace = token.raw.slice(0, token.raw.length - token.raw.trimStart().length);
      const span = {
        start: line + newlines(leadingWhitespace),
        end: line + newlines(token.raw.trimEnd()),
      };
      blocks.push(span);
      // A wrapper, not attributes on the block's root: sanitized raw HTML has no reliable root.
      html += `<div data-source-start="${span.start}" data-source-end="${span.end}">${blockHtml}</div>`;
    }
    line += newlines(token.raw);
  }
  return { html, blocks };
}
