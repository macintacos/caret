// The plan text is agent-authored, so its raw-HTML tokens are sanitized; caret's
// own markup and attributes are built outside the sanitizer, from marked's tokens.
import { Marked, type Token, type Tokens } from "marked";
import { FilterXSS } from "xss";

import { IMAGE_ATTRIBUTES } from "$lib/diffview/inlineImages.ts";
import { fenceGrammar } from "$lib/diffview/languages.ts";
import { isSafeUrl } from "$lib/diffview/links.ts";
import { htmlWhiteList } from "$lib/markdown.ts";

/** An inclusive, 1-based range of source lines in the version's stored text. */
export interface SourceSpan {
  start: number;
  end: number;
}

export interface RenderedPlan {
  /** One `<div data-source-start="…" data-source-end="…">` per block, in document order.
   * An empty `<span data-source-line="N">` precedes the first rendered character of each
   * source line that renders text; the one before a code block's `<pre>` also carries `data-source-code`. */
  html: string;
  /** Each block's span; `blocks[i]` is the html's i-th top-level element. A block ends at
   * its last non-blank line; blank lines between blocks belong to none. */
  blocks: SourceSpan[];
  /** Each fenced block's bundled shiki grammar, keyed by the line its `data-source-code`
   * marker carries. Indented blocks and fences naming no bundled grammar have no entry. */
  codeLanguages: ReadonlyMap<number, string>;
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

interface SourceLineToken {
  type: "sourceLine";
  raw: "";
  line: number;
  code: boolean;
}

const marked = new Marked({
  gfm: true,
  breaks: false,
  extensions: [
    {
      name: "sourceLine",
      renderer: (token) =>
        `<span data-source-line="${token.line}"${token.code ? " data-source-code" : ""}></span>`,
    },
  ],
  renderer: {
    html: ({ text }) => rawHtmlFilter.process(text),
    // marked's default minus the `language-` class: the info string never reaches markup.
    code({ text, escaped }) {
      const body = `${text.replace(/\n$/, "")}\n`;
      return `<pre><code>${escaped ? body : escapeHtml(body)}</code></pre>\n`;
    },
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

function sourceLine(line: number): Token {
  return { type: "sourceLine", raw: "", line, code: false } satisfies SourceLineToken;
}

function leadingNewlines(raw: string): number {
  return newlines(raw.slice(0, raw.length - raw.trimStart().length));
}

// Inline text has `raw === text` in marked, so each piece is its own raw.
function splitAfterNewlines(token: Tokens.Text): Tokens.Text[] {
  // A trailing "\n" keeps its empty piece, so the next line's marker still follows it.
  const pieces = token.text
    .split("\n")
    .map((piece, i, all) => (i < all.length - 1 ? `${piece}\n` : piece));
  return pieces.map((piece) => ({ ...token, raw: piece, text: piece }));
}

// A token's own newlines come from its raw, never its rendered text: a codespan renders
// its break as a space, and `&#10;` renders a newline that starts no source line.
function markInline(tokens: Token[], line: number): { tokens: Token[]; line: number } {
  const out: Token[] = [];
  for (const token of tokens) {
    const start = line;
    if (token.type === "text" && !("tokens" in token && token.tokens)) {
      splitAfterNewlines(token as Tokens.Text).forEach((piece, i) => {
        if (i > 0) out.push(sourceLine(++line));
        if (piece.text) out.push(piece);
      });
      continue;
    }
    // An image's children are its alt text, rendered into an attribute or as plain text,
    // so a marker inside would be escaped into it.
    if (token.type !== "image" && "tokens" in token && token.tokens) {
      const inner = markInline(token.tokens, line);
      token.tokens = inner.tokens;
      line = inner.line;
    }
    out.push(token);
    const end = start + newlines(token.raw);
    if (end > line) {
      line = end;
      out.push(sourceLine(line));
    }
  }
  return { tokens: out, line };
}

function markLeaf(tokens: Token[], line: number): Token[] {
  return [sourceLine(line), ...markInline(tokens, line).tokens];
}

const LEAVES = new Set(["paragraph", "heading", "text"]);

/** Marks where each source line starts in block tokens whose raws begin on `firstLine`:
 * a marker leads each leaf's inline text and each source line inside it, and precedes each
 * code and raw-HTML block, recording each marked fence's grammar into `codeLanguages`.
 * Mutates nested tokens in place; returns this level's tokens. */
function markSourceLines(
  tokens: Token[],
  firstLine: number,
  codeLanguages: Map<number, string>,
): Token[] {
  const out: Token[] = [];
  let line = firstLine;
  for (const token of tokens) {
    const start = line + leadingNewlines(token.raw);
    if (token.type === "code") {
      // An empty block's only rendered character sits on its closing fence.
      if (token.text !== "") {
        const firstCodeLine = token.codeBlockStyle === "indented" ? start : start + 1;
        out.push({
          type: "sourceLine",
          raw: "",
          line: firstCodeLine,
          code: true,
        } satisfies SourceLineToken);
        const grammar = token.codeBlockStyle === "indented" ? null : fenceGrammar(token.lang ?? "");
        if (grammar !== null) codeLanguages.set(firstCodeLine, grammar);
      }
    } else if (token.type === "html") {
      if (rawHtmlFilter.process(token.text) !== "") out.push(sourceLine(start));
    } else if (token.type === "table") {
      const table = token as Tokens.Table;
      for (const cell of table.header) cell.tokens = markLeaf(cell.tokens, start);
      const firstBodyLine = start + 2; // past the header and delimiter rows
      table.rows.forEach((row, i) => {
        for (const cell of row) cell.tokens = markLeaf(cell.tokens, firstBodyLine + i);
      });
    } else if (token.type === "list") {
      let itemLine = start;
      for (const item of (token as Tokens.List).items) {
        item.tokens = markSourceLines(item.tokens, itemLine, codeLanguages);
        itemLine += newlines(item.raw);
      }
    } else if (token.type === "blockquote") {
      token.tokens = markSourceLines((token as Tokens.Blockquote).tokens, start, codeLanguages);
    } else if (LEAVES.has(token.type) && "tokens" in token && token.tokens) {
      token.tokens = markLeaf(token.tokens, start);
    }
    out.push(token);
    line += newlines(token.raw);
  }
  return out;
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
  const codeLanguages = new Map<number, string>();
  let line = 1;
  for (const token of tokens) {
    const blockHtml = marked.parser(markSourceLines([token], line, codeLanguages));
    if (blockHtml !== "") {
      const span = {
        start: line + leadingNewlines(token.raw),
        end: line + newlines(token.raw.trimEnd()),
      };
      blocks.push(span);
      // A wrapper, not attributes on the block's root: sanitized raw HTML has no reliable root.
      html += `<div data-source-start="${span.start}" data-source-end="${span.end}">${blockHtml}</div>`;
    }
    line += newlines(token.raw);
  }
  return { html, blocks, codeLanguages };
}
