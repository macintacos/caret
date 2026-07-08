// Decorated-source model for the rendered plan view. Unlike renderMarkdown
// (markdown.ts), which turns markdown into HTML and DROPS the syntax markers,
// this keeps every character of the source and only WRAPS tokens in styled spans
// — so `**bold**` still shows its asterisks, `` `code` `` its backticks, and
// `## Heading` its hashes, each styled to match the text it delimits. Because no
// character is removed, the output stays 1:1 with the source lines, which is what
// lets the rendered view reuse the source view's per-line comment anchoring.
//
// The transform is pure and DOM-free (unit-tested directly). It reuses marked's
// lexer for tokenizing only — never its HTML renderer, which would strip the
// delimiters — and xss's filterXSS for defense-in-depth (all plan-origin text is
// already HTML-escaped by the walker, so the only injection vector is a token's
// own href, which filterXSS neutralizes).
import { Lexer } from "marked";
import { filterXSS, getDefaultWhiteList } from "xss";

/** Block role of a rendered row, used by the view to pick the row's CSS class. */
export type RowKind =
  | "blank"
  | "paragraph"
  | "heading"
  | "list-item"
  | "blockquote"
  | "hr"
  | "code-open"
  | "code"
  | "code-close";

/** One rendered row, 1:1 with a source line. */
export interface DecoratedRow {
  /** 1-based source line number (matches the view's per-line data-line). */
  line: number;
  kind: RowKind;
  /** ATX heading level 1–6; present only when kind === "heading". */
  level?: number;
  /** Decorated, sanitized HTML: the source line verbatim, tokens wrapped in
   * styled spans that keep their delimiters. */
  html: string;
}

// filterXSS strips class/data attributes by default, but the decoration spans
// need their class hooks to carry color/weight. Extend the default whitelist to
// allow class on the tags the walker emits (and href on links); everything else
// stays at the safe defaults, so a javascript: href is still dropped.
const whiteList: Record<string, string[] | undefined> = { ...getDefaultWhiteList() };
for (const tag of ["strong", "em", "del", "code", "span"]) {
  whiteList[tag] = [...new Set([...(whiteList[tag] ?? []), "class"])];
}
whiteList.a = [...new Set([...(whiteList.a ?? []), "class", "href", "title", "target"])];
const XSS_OPTIONS = { whiteList };

function sanitize(html: string): string {
  return filterXSS(html, XSS_OPTIONS);
}

/** HTML-escape plan-origin text so injected markup renders as visible text. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface InlineToken {
  type: string;
  raw: string;
  text?: string;
  href?: string;
  tokens?: InlineToken[];
}

// A symmetric-emphasis token's raw is `<marker><inner><marker>` (e.g. `**x**`).
// Re-emit the delimiters AROUND the recursively-decorated inner, keeping them
// visible and styled. The delimiter length is FIXED by token type — strong/del
// are two chars (`**`/`__`/`~~`), em is one (`*`/`_`) — never a greedy run: a
// greedy peel over-consumes an adjacent nested marker (in `***foo***` the em's
// leading `*` would be counted into strong's `**`), duplicating it and breaking
// the verbatim-source invariant.
function wrapEmphasis(tag: string, cls: string, t: InlineToken, delimLen: number): string {
  const open = t.raw.slice(0, delimLen);
  const close = t.raw.slice(t.raw.length - delimLen);
  const inner = t.tokens ? decorateTokens(t.tokens) : esc(t.text ?? "");
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
      // Inline code is literal (no child tokens); show the raw incl. backticks.
      return `<code class="md-code">${esc(t.raw)}</code>`;
    case "link":
      // Show the raw markdown link (`[text](url)`) styled + clickable. filterXSS
      // drops an unsafe href scheme.
      return `<a class="md-link" href="${esc(t.href ?? "")}">${esc(t.raw)}</a>`;
    case "br":
      return "<br>";
    default:
      // text, escape, autolink fallbacks, raw inline html — show verbatim (safe).
      return esc(t.raw ?? t.text ?? "");
  }
}

function decorateTokens(tokens: InlineToken[]): string {
  let out = "";
  for (const t of tokens) out += decorateToken(t);
  return out;
}

/** Decorate a line's inline markdown, keeping every delimiter as styled text. */
function decorateInline(text: string): string {
  return decorateTokens(Lexer.lexInline(text) as InlineToken[]);
}

const FENCE = /^\s*(`{3,}|~{3,})/;
const ATX = /^ {0,3}(#{1,6})(?:\s.*)?$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const BLOCKQUOTE = /^ {0,3}(>+)([ \t]?)(.*)$/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(.*)$/;

/** A leading block marker (`- `, `> `, `1. `) shown as a colored span, followed
 * by the inline-decorated remainder. */
function markerRow(marker: string, rest: string): string {
  return `<span class="md-marker">${esc(marker)}</span>${decorateInline(rest)}`;
}

/**
 * Turn plan markdown into one decorated row per source line. Fence-aware, so a
 * `#` inside a code block is code, not a heading; an unclosed fence runs to the
 * end. Prose stays prose (a plain line has no decoration element); only the
 * markdown constructs are wrapped.
 */
export function decorateMarkdown(source: string): DecoratedRow[] {
  const lines = source.split("\n");
  const rows: DecoratedRow[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const lineNo = i + 1;

    if (FENCE.test(line)) {
      const kind: RowKind = inFence ? "code-close" : "code-open";
      inFence = !inFence;
      rows.push({ line: lineNo, kind, html: sanitize(esc(line)) });
      continue;
    }
    if (inFence) {
      rows.push({ line: lineNo, kind: "code", html: sanitize(esc(line)) });
      continue;
    }
    if (line.trim() === "") {
      rows.push({ line: lineNo, kind: "blank", html: sanitize(esc(line)) });
      continue;
    }
    const heading = ATX.exec(line);
    if (heading) {
      rows.push({
        line: lineNo,
        kind: "heading",
        level: heading[1]?.length,
        html: sanitize(decorateInline(line)),
      });
      continue;
    }
    if (HR.test(line)) {
      rows.push({ line: lineNo, kind: "hr", html: sanitize(esc(line)) });
      continue;
    }
    const bq = BLOCKQUOTE.exec(line);
    if (bq) {
      rows.push({
        line: lineNo,
        kind: "blockquote",
        html: sanitize(markerRow(`${bq[1]}${bq[2]}`, bq[3] ?? "")),
      });
      continue;
    }
    const list = LIST.exec(line);
    if (list) {
      rows.push({
        line: lineNo,
        kind: "list-item",
        html: sanitize(markerRow(`${list[1]}${list[2]}${list[3]}`, list[4] ?? "")),
      });
      continue;
    }
    rows.push({ line: lineNo, kind: "paragraph", html: sanitize(decorateInline(line)) });
  }
  return rows;
}
