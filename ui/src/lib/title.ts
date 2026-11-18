// Feeds {@html}, so the output is sanitized: js-xss, since DOMPurify mis-sanitizes under
// the unit suite's happy-dom.
import { Marked, TextRenderer } from "marked";
import { escapeHtml, FilterXSS } from "xss";

// Links and images flatten to text: the title sits inside a button and a menu item,
// where a nested link is invalid and a click would leave the review. Raw HTML reads
// as literal text, as in the source view.
const marked = new Marked({
  gfm: true,
  renderer: {
    link({ tokens }) {
      return this.parser.parseInline(tokens);
    },
    image({ tokens }) {
      return this.parser.parseInline(tokens, this.parser.textRenderer);
    },
    html({ text }) {
      return escapeHtml(text);
    },
    br() {
      return " ";
    },
  },
});

// Exactly the tags the inline renderer above emits; a tag added there must be added here.
const sanitizer = new FilterXSS({
  whiteList: { strong: [], em: [], code: [], del: [] },
  css: false,
});

/** Renders a plan title's inline markdown as sanitized HTML. */
export function renderTitle(title: string): string {
  const html = marked.parseInline(title, { async: false });
  return sanitizer.process(html);
}

class PlainRenderer extends TextRenderer {
  override br(): string {
    return " ";
  }
}

/** A plan title's inline markdown as plain text, for a `title` attribute or an accessible name. */
export function plainTitle(title: string): string {
  const tokens = marked.Lexer.lexInline(title, marked.defaults);
  const parser = new marked.Parser(marked.defaults);
  const renderer = new PlainRenderer();
  renderer.parser = parser;
  const text = parser.parseInline(tokens, renderer);
  return decodeEntities(text);
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

// Undoes exactly the escapes marked emits.
function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e] ?? e);
}
