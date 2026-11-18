// Feeds {@html}, so the output is sanitized: js-xss, since DOMPurify mis-sanitizes under
// the unit suite's happy-dom.
import { Marked } from "marked";
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
