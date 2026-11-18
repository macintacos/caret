// `renderTitle` feeds {@html}, so its output is sanitized: js-xss, since DOMPurify mis-sanitizes under
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

/** Renders a plan title or a heading's inline markdown as sanitized HTML. */
export function renderTitle(title: string): string {
  const html = marked.parseInline(title, { async: false });
  return sanitizer.process(html);
}

// Reads a hard break as a space, as `renderTitle` does.
class PlainRenderer extends TextRenderer {
  override br(): string {
    return " ";
  }
}

// A copy: the Lexer and Parser constructors write into the options they are handed.
const plainOptions = { ...marked.defaults };
const plainParser = new marked.Parser(plainOptions);
const plainRenderer = new PlainRenderer();
plainRenderer.parser = plainParser;

/**
 * A plan title or a heading's inline markdown as plain text, for a `title` attribute or an
 * accessible name. Unescaped: bind it as text or an attribute, never through `{@html}`.
 */
export function plainTitle(title: string): string {
  // ponytail: an entity reference typed outside a code span (`&copy;`) renders as `©` in
  // the label but stays literal here; decode outside code spans if that ever matters.
  return plainParser.parseInline(marked.Lexer.lexInline(title, plainOptions), plainRenderer);
}
