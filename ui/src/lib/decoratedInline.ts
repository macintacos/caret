// Inline markdown decoration for the rendered plan view (EXC-693). Unlike a
// normal renderer, emphasis KEEPS its source delimiters visible and styled:
// `**bold**` still shows its asterisks (bold), `_it_` its underscores (italic),
// `` `x` `` its backticks (monospace), `~~x~~` its tildes — each wrapped in a
// class the view colors, so formatted text stands out while its exact source is
// still legible. Two constructs render "properly" instead (Julian's call): a
// link shows only its label and carries its href (no `[..](..)` syntax), and a
// footnote reference `[^id]` renders as a superscript.
//
// Pure and DOM-free (unit-tested directly). Uses marked's inline lexer for
// tokenizing only — never its HTML renderer, which would strip the delimiters —
// and filterXSS as defense in depth: all plan-origin text is HTML-escaped by the
// walker, so the only attribute that reaches markup is a link's own href, which
// filterXSS neutralizes (javascript: and friends are voided).
import { Lexer } from "marked";
import { filterXSS, getDefaultWhiteList } from "xss";

// filterXSS drops class/data attributes by default, but the decoration spans
// need class hooks for color/weight, and links need href/target/rel. Everything
// else stays at safe defaults, so a dangerous href is still voided.
const whiteList: Record<string, string[] | undefined> = { ...getDefaultWhiteList() };
for (const tag of ["strong", "em", "del", "code", "sup", "span"]) {
  whiteList[tag] = [...new Set([...(whiteList[tag] ?? []), "class"])];
}
whiteList.a = [...new Set([...(whiteList.a ?? []), "class", "href", "title", "target", "rel"])];
const XSS_OPTIONS = { whiteList };

function sanitize(html: string): string {
  return filterXSS(html, XSS_OPTIONS);
}

/** HTML-escape plan-origin text so any markup in it renders as visible text. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// A footnote reference `[^id]` inside prose. marked has no footnote rule, so the
// ref arrives as plain text; wrap each one as a superscript and escape the rest.
const FOOTNOTE_REF = /\[\^([^\]\s]+)\]/g;
function escText(raw: string): string {
  let out = "";
  let last = 0;
  FOOTNOTE_REF.lastIndex = 0;
  let m: RegExpExecArray | null = FOOTNOTE_REF.exec(raw);
  while (m !== null) {
    out += esc(raw.slice(last, m.index));
    out += `<sup class="md-fn-ref">${esc(m[1] ?? "")}</sup>`;
    last = m.index + m[0].length;
    m = FOOTNOTE_REF.exec(raw);
  }
  out += esc(raw.slice(last));
  return out;
}

interface InlineToken {
  type: string;
  raw: string;
  text?: string;
  href?: string;
  tokens?: InlineToken[];
}

// A symmetric-emphasis token's raw is `<marker><inner><marker>` (e.g. `**x**`).
// Re-emit the delimiters AROUND the recursively-decorated inner so they stay
// visible and styled. The delimiter length is FIXED per token type — strong/del
// are two chars (`**`/`__`/`~~`), em is one (`*`/`_`) — never a greedy run: a
// greedy peel over-consumes an adjacent nested marker (in `***foo***` em's
// leading `*` would be counted into strong's `**`), duplicating markers and
// breaking the verbatim-source invariant.
function wrapEmphasis(tag: string, cls: string, t: InlineToken, delimLen: number): string {
  const open = t.raw.slice(0, delimLen);
  const close = t.raw.slice(t.raw.length - delimLen);
  const inner = t.tokens ? decorateTokens(t.tokens) : escText(t.text ?? "");
  return `<${tag} class="${cls}">${esc(open)}${inner}${esc(close)}</${tag}>`;
}

function decorateToken(t: InlineToken): string {
  switch (t.type) {
    case "strong":
      return wrapEmphasis("strong", "md-strong", t, 2);
    case "em":
      return wrapEmphasis("em", "md-em", t, 1);
    case "del":
      return wrapEmphasis("del", "md-del", t, 2);
    case "codespan":
      // Keep the backticks visible (t.raw), monospace via the class. Named
      // md-codespan (not md-code) so it never collides with the code-BLOCK kind
      // class the view puts on a fenced-code anchor.
      return `<code class="md-codespan">${esc(t.raw)}</code>`;
    case "link": {
      // Render normally: label only, no `[..](..)` syntax. The href is the one
      // attribute that reaches markup; filterXSS voids dangerous schemes.
      const inner = t.tokens ? decorateTokens(t.tokens) : escText(t.text ?? "");
      return `<a class="md-link" href="${esc(t.href ?? "")}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
    }
    case "br":
      return "<br>";
    default:
      // text, escape, autolink fallbacks, raw inline html — show verbatim (safe),
      // lifting any footnote refs out to superscripts.
      return escText(t.raw ?? t.text ?? "");
  }
}

function decorateTokens(tokens: InlineToken[]): string {
  let out = "";
  for (const t of tokens) out += decorateToken(t);
  return out;
}

/** Decorate a run of inline markdown, keeping every emphasis delimiter visible
 * and styled. Sanitized; safe to inject with {@html}. */
export function decorateInline(markdown: string): string {
  return sanitize(decorateTokens(Lexer.lexInline(markdown) as InlineToken[]));
}
