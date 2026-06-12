// Pure transform for the source view's link layer. Takes plan source text and
// returns display text plus a per-line map of clickable link spans. The
// transform is strictly per-line: it processes each line independently and
// rejoins with "\n", so the output always has the same line count as the input
// (the line-parity guarantee the annotation/feedback line numbers depend on).
//
// Two display rewrites happen, both line-local:
//   - inline links `[label](url)` collapse to `label`
//   - autolinks `<url>` collapse to `url`
// A bare `http(s)://…` URL is left in place. Every recorded span carries the
// http/https href; all other schemes (javascript:, data:, mailto:, …) are left
// as literal source text and produce no span. Fenced code blocks and inline
// code spans are passed through untouched for source fidelity.

/** A clickable link range on a single display line. Columns are 0-based,
 * half-open [startCol, endCol) into the display line's text. */
export interface LinkSpan {
  startCol: number;
  endCol: number;
  /** The http/https target to open. */
  href: string;
  /** The visible text of the span (display text between the columns). */
  label: string;
}

/** Per-line link spans, keyed by 1-based display line number. Lines with no
 * links are absent from the map. */
export type LinkSpanMap = Map<number, LinkSpan[]>;

export interface LinkLayer {
  /** Display text — same line count as the input. */
  text: string;
  /** Clickable spans per 1-based line. */
  spans: LinkSpanMap;
}

const SAFE_SCHEME = /^https?:\/\//i;

function isSafeUrl(url: string): boolean {
  return SAFE_SCHEME.test(url);
}

// A ``` (or longer) fence on its own — possibly indented, possibly with an
// info string — toggles fenced-code mode. Matching the opener loosely is
// enough here: we only need to know whether a line is "inside code".
const FENCE = /^\s*(`{3,}|~{3,})/;

// Inline-code spans: one or more backticks, then the shortest run closing with
// the same count. Used to mask code so links inside it are not rewritten.
const INLINE_CODE = /(`+)(?:.*?)\1/g;

// `[label](url)` — label has no unescaped `]`; url is the run up to the first
// `)` with no whitespace (CommonMark's simplest inline-link shape).
const INLINE_LINK = /\[([^\]]*)\]\((\S+?)\)/g;

// `<url>` autolink — angle-bracketed, no spaces inside.
const AUTOLINK = /<([^>\s]+)>/g;

// A bare URL run, ended by whitespace or a few trailing punctuation chars that
// are unlikely to be part of the URL.
const BARE_URL = /https?:\/\/[^\s<>()]+/g;

/** Marks the [start, end) ranges already consumed on a source line so later
 * passes (bare-URL detection) don't re-scan rewritten regions. */
type Range = { start: number; end: number };

function overlaps(ranges: Range[], start: number, end: number): boolean {
  return ranges.some((r) => start < r.end && end > r.start);
}

// Builds the display line and its spans from one source line. `inCode` lines
// (fenced) are returned verbatim with no spans.
function transformLine(source: string, inCode: boolean): { display: string; spans: LinkSpan[] } {
  if (inCode) return { display: source, spans: [] };

  // Mask inline-code regions so their contents are never rewritten or linked.
  const codeRanges: Range[] = [];
  for (const m of source.matchAll(INLINE_CODE)) {
    codeRanges.push({ start: m.index, end: m.index + m[0].length });
  }
  const inMaskedCode = (start: number, end: number) => overlaps(codeRanges, start, end);

  // Collect rewrites as {sourceStart, sourceEnd, display, href}. After
  // collecting, we rebuild the line left-to-right, tracking display columns so
  // each span lands at the right place in the *display* text.
  type Rewrite = { start: number; end: number; display: string; href: string | null };
  const rewrites: Rewrite[] = [];
  const consumed: Range[] = [];

  for (const m of source.matchAll(INLINE_LINK)) {
    const start = m.index;
    const end = start + m[0].length;
    if (inMaskedCode(start, end)) continue;
    const label = m[1] ?? "";
    const url = m[2] ?? "";
    if (!isSafeUrl(url)) continue; // unsafe scheme: leave literal, no rewrite
    rewrites.push({ start, end, display: label, href: url });
    consumed.push({ start, end });
  }

  for (const m of source.matchAll(AUTOLINK)) {
    const start = m.index;
    const end = start + m[0].length;
    if (inMaskedCode(start, end) || overlaps(consumed, start, end)) continue;
    const url = m[1] ?? "";
    if (!isSafeUrl(url)) continue;
    rewrites.push({ start, end, display: url, href: url });
    consumed.push({ start, end });
  }

  // Bare URLs are display-identical (no rewrite of text) but still get a span.
  for (const m of source.matchAll(BARE_URL)) {
    const start = m.index;
    const end = start + m[0].length;
    if (inMaskedCode(start, end) || overlaps(consumed, start, end)) continue;
    rewrites.push({ start, end, display: m[0], href: m[0] });
    consumed.push({ start, end });
  }

  if (rewrites.length === 0) return { display: source, spans: [] };

  rewrites.sort((a, b) => a.start - b.start);

  let display = "";
  let cursor = 0; // position in source consumed so far
  const spans: LinkSpan[] = [];
  for (const rw of rewrites) {
    display += source.slice(cursor, rw.start);
    const startCol = display.length;
    display += rw.display;
    const endCol = display.length;
    cursor = rw.end;
    if (rw.href != null) {
      spans.push({ startCol, endCol, href: rw.href, label: rw.display });
    }
  }
  display += source.slice(cursor);
  return { display, spans };
}

/** Production link opener: a new tab with noopener,noreferrer so the opened
 * page can neither reach back through window.opener nor leak the referrer. */
export function openLinkInNewTab(href: string): void {
  window.open(href, "_blank", "noopener,noreferrer");
}

/** Transforms plan source text into display text plus per-line link spans.
 * Line count is invariant. */
export function buildLinkLayer(text: string): LinkLayer {
  const lines = text.split("\n");
  const spans: LinkSpanMap = new Map();
  let inCode = false;
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const source = lines[i] ?? "";
    const isFence = FENCE.test(source);
    // A fence line itself is "code" (passed through verbatim, no links), and it
    // flips the state for subsequent lines.
    const lineInCode = inCode || isFence;
    const { display, spans: lineSpans } = transformLine(source, lineInCode);
    out.push(display);
    if (lineSpans.length > 0) spans.set(i + 1, lineSpans);
    if (isFence) inCode = !inCode;
  }

  return { text: out.join("\n"), spans };
}
