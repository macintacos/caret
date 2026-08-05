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
//
// A link whose target is path-shaped is the third case: it collapses like any
// link but records NO clickable span — openUrl must never be handed a filesystem
// path — and instead emits a FileRefSpan over the collapsed label (EXC-954,
// EXC-956), which the view merges with the inline-code
// scan and decorates as a reference. Emission belongs here because fileRefs.ts
// reads *display* text: once the link collapses, its target is gone and only this
// layer still knows where the label landed. Two consequences worth knowing before
// changing this: collapsing is decided on shape alone, so a target that does NOT
// resolve leaves its label as bare prose with no affordance and no visible path;
// and a target carrying a fragment or query (`doc/guide.md#setup`) is a URL slot
// rather than a path, so that link stays literal.
//
// The span says only where a path was cited, never what it is. A file and a
// directory emit the identical shape, and the daemon's resolve (EXC-916) is what
// later decides which glyph the token draws and which surface a click opens.

import { hasKnownFileExtension } from "@core/config/constants";
import { classify, type FileRefSpan, type FileRefSpanMap } from "$lib/diffview/fileRefs.ts";

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
  /** File references emitted over collapsed link labels (EXC-954).
   * buildFileRefLayer reads DISPLAY text, so a path that collapsed into prose can
   * never be re-found — the link layer is the only place that still knows where
   * it landed. */
  fileRefs: FileRefSpanMap;
}

const SAFE_SCHEME = /^https?:\/\//i;

function isSafeUrl(url: string): boolean {
  return SAFE_SCHEME.test(url);
}

// Any URL scheme (`ftp:`, `mailto:`, `javascript:`, …). A path never carries one
// — `a/b.md:42` has no scheme because `/` is outside the scheme character class.
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

// A ``` (or longer) fence on its own — possibly indented, possibly with an
// info string — toggles fenced-code mode. Matching the opener loosely is
// enough here: we only need to know whether a line is "inside code".
const FENCE = /^\s*(`{3,}|~{3,})/;

// Inline-code spans: one or more backticks, then the shortest run closing with
// the same count. Used to mask code so links inside it are not rewritten.
const INLINE_CODE = /(`+)(?:.*?)\1/g;

// `[label](url)` — label has no unescaped `]`; url is the run inside the
// parens. The url body allows one level of balanced parens (Wikipedia-style
// paths like `Foo_(bar)`) so the link's own closing `)` is not mistaken for the
// URL's, then the final `)` closes the link.
const INLINE_LINK = /\[([^\]]*)\]\(((?:[^\s()]|\([^\s()]*\))+)\)/g;

// `<url>` autolink — angle-bracketed, no spaces inside.
const AUTOLINK = /<([^>\s]+)>/g;

// A link target made only of path characters. Matching the WHOLE target is the
// point: it is what refuses a fragment, a query, or a percent-escape, none of
// which a filesystem path carries. The gate below tests it against classify's
// path, so a `:line` tail is already off by then. `@` is in the class because a
// scoped package really does sit at `node_modules/@types/node/index.d.ts`.
const PATH_TARGET = /^[A-Za-z0-9._/~@-]+$/;

// A scheme-less URL: `github.com/macintacos/caret`. A first segment carrying a
// dot and followed by more path names a host, not a directory in the review's
// cwd — and collapsing one is the costliest mistake this layer can make, since
// the destination survives nowhere: not in the display text, and not in the
// tooltip either, which only a resolved reference gets. A leading dot
// (`.github/workflows/`) is not a host, and neither is a dotless first segment.
const HOSTLIKE = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\//;

// A target the daemon refuses by construction: `~` is never expanded, and `../`
// always climbs out of the review's cwd. Neither can resolve, so collapsing one
// trades visible markup for a reference that can never arrive. An absolute path
// is deliberately absent — it resolves when it happens to point inside cwd.
const UNRESOLVABLE = /^~|^\.\.\//;

// A bare URL run: http(s):// followed by non-space, non-bracket chars, with one
// level of balanced parens allowed inside (Wikipedia-style paths). Trailing
// sentence punctuation is trimmed separately (trimUrlTrailing).
const BARE_URL = /https?:\/\/(?:[^\s<>()]|\([^\s<>()]*\))+/g;

// Punctuation that commonly trails a URL in prose but is not part of it.
const TRAILING_PUNCT = /[.,;:!?'"]+$/;

// Trims trailing sentence punctuation and one unbalanced closing paren from a
// bare URL captured in prose (e.g. "see https://x.test/page." → drop the dot;
// "(see https://x.test)" → drop the ")"). Balanced parens inside the URL are
// preserved by BARE_URL itself, so only an *excess* ")" is removed here.
function trimUrlTrailing(url: string): string {
  let trimmed = url.replace(TRAILING_PUNCT, "");
  while (
    trimmed.endsWith(")") &&
    (trimmed.match(/\(/g)?.length ?? 0) < (trimmed.match(/\)/g)?.length ?? 0)
  ) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
}

/** Marks the [start, end) ranges already consumed on a source line so later
 * passes (bare-URL detection) don't re-scan rewritten regions. */
type Range = { start: number; end: number };

function overlaps(ranges: Range[], start: number, end: number): boolean {
  return ranges.some((r) => start < r.end && end > r.start);
}

// Builds the display line and its spans from one source line. `inCode` lines
// (fenced) are returned verbatim with no spans.
function transformLine(
  source: string,
  inCode: boolean,
): { display: string; spans: LinkSpan[]; fileRefs: FileRefSpan[] } {
  if (inCode) return { display: source, spans: [], fileRefs: [] };

  // Mask inline-code regions so their contents are never rewritten or linked.
  const codeRanges: Range[] = [];
  for (const m of source.matchAll(INLINE_CODE)) {
    codeRanges.push({ start: m.index, end: m.index + m[0].length });
  }
  // Containment, not overlap: the mask exists to keep a link WRITTEN inside
  // backticks literal. A link that merely *contains* a code span — the
  // [`foo/bar.ts`](foo/bar.ts) citation shape — is a real link and collapses,
  // keeping its backticks (and their inline-code styling) in the display text.
  const inMaskedCode = (start: number, end: number) =>
    codeRanges.some((r) => start >= r.start && end <= r.end);

  // Collect rewrites as {sourceStart, sourceEnd, display, href}. After
  // collecting, we rebuild the line left-to-right, tracking display columns so
  // each span lands at the right place in the *display* text. A rewrite carrying
  // `file` is a path-target link: it emits a file reference instead of a span.
  type Rewrite = {
    start: number;
    end: number;
    display: string;
    href: string | null;
    file?: { path: string; line?: number; endLine?: number; target: string };
  };
  const rewrites: Rewrite[] = [];
  const consumed: Range[] = [];

  for (const m of source.matchAll(INLINE_LINK)) {
    const start = m.index;
    const end = start + m[0].length;
    if (inMaskedCode(start, end)) continue;
    const label = m[1] ?? "";
    const url = m[2] ?? "";
    if (!isSafeUrl(url)) {
      // Not a URL caret will open — but a target carrying any scheme, or the
      // protocol-relative `//host/…` form, is still a URL slot rather than a
      // path, however its tail reads. classify judges a path by its last
      // segment, so `ftp://host/lib.ts` would otherwise pass as path-shaped and
      // resolve against the project's own lib.ts. The scan masks URLs inside
      // code for the same reason; this is that guard on the link side.
      if (HAS_SCHEME.test(url) || url.startsWith("//") || HOSTLIKE.test(url)) continue;
      // A path-shaped target is a reference; anything else stays literal with no
      // rewrite. Three narrowings sit on top of classify's shared gate at this
      // call site alone, because collapsing `[]()` happens before anything
      // resolves, and a target that turns out to be nothing has already lost its
      // markup where an unresolved inline-code candidate loses nothing.
      //
      // PATH_TARGET is the first: a fragment or query makes a target a URL slot
      // however its head reads, so `doc/guide.md#setup` stays a link to an anchor.
      // UNRESOLVABLE is the second — a target no resolve could ever answer.
      // The third is specificity: a multi-segment path, or a single segment
      // naming a file by extension. A bare `guide` is a word, not a citation.
      //
      // None of them reads the trailing slash, which is why it comes off before
      // the specificity test — `src` and `src/` name one thing, so they take one
      // branch, and whether that thing is a file or a directory is the daemon's
      // answer to give (EXC-916) rather than this layer's to guess. The path
      // itself keeps the slash, since the resolve response is keyed by the
      // string that was requested.
      const ref = classify(url);
      if (ref === null || !PATH_TARGET.test(ref.path) || UNRESOLVABLE.test(ref.path)) continue;
      const bare = ref.path.replace(/\/+$/, "");
      if (!bare.includes("/") && !hasKnownFileExtension(bare)) continue;
      rewrites.push({ start, end, display: label, href: null, file: { ...ref, target: url } });
      consumed.push({ start, end });
      continue;
    }
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
  // Trailing prose punctuation is excluded from the span so the href is clean.
  for (const m of source.matchAll(BARE_URL)) {
    const url = trimUrlTrailing(m[0]);
    if (url.length === 0) continue;
    const start = m.index;
    const end = start + url.length;
    if (inMaskedCode(start, end) || overlaps(consumed, start, end)) continue;
    rewrites.push({ start, end, display: url, href: url });
    consumed.push({ start, end });
  }

  if (rewrites.length === 0) return { display: source, spans: [], fileRefs: [] };

  rewrites.sort((a, b) => a.start - b.start);

  let display = "";
  let cursor = 0; // position in source consumed so far
  const spans: LinkSpan[] = [];
  const fileRefs: FileRefSpan[] = [];
  for (const rw of rewrites) {
    display += source.slice(cursor, rw.start);
    const startCol = display.length;
    display += rw.display;
    const endCol = display.length;
    cursor = rw.end;
    if (rw.href != null) {
      spans.push({ startCol, endCol, href: rw.href, label: rw.display });
    }
    if (rw.file != null) {
      // ponytail: a reference gets the glyph only where its columns coincide
      // with a shiki token. Backticks always give the label one, so a
      // backticked-path label takes the glyph wherever it sits; a bare-path or
      // prose label takes it only when the label is the whole line, since
      // anything else on the line puts it inside one coarse prose run that
      // tagFileRefTokens refuses (tagging that would chip the whole sentence).
      // Those get the click and the tooltip without the glyph. Painting exact
      // columns the way linkHighlight.ts does is the upgrade path (EXC-866).
      //
      // The target rides along only when the label hides it. Testing the raw
      // target, not the path, is what keeps `[a/b.md](a/b.md:42)` — whose label
      // shows the file but not the line — from suppressing the one affordance
      // that could say which line the click lands on.
      const target = rw.display.includes(rw.file.target) ? undefined : rw.file.target;
      fileRefs.push({
        startCol,
        endCol,
        path: rw.file.path,
        line: rw.file.line,
        endLine: rw.file.endLine,
        target,
      });
    }
  }
  display += source.slice(cursor);
  return { display, spans, fileRefs };
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
  const fileRefs: FileRefSpanMap = new Map();
  let inCode = false;
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const source = lines[i] ?? "";
    const isFence = FENCE.test(source);
    // A fence line itself is "code" (passed through verbatim, no links), and it
    // flips the state for subsequent lines.
    const lineInCode = inCode || isFence;
    const { display, spans: lineSpans, fileRefs: lineRefs } = transformLine(source, lineInCode);
    out.push(display);
    if (lineSpans.length > 0) spans.set(i + 1, lineSpans);
    if (lineRefs.length > 0) fileRefs.set(i + 1, lineRefs);
    if (isFence) inCode = !inCode;
  }

  return { text: out.join("\n"), spans, fileRefs };
}
