// The source view's one per-line pass over plan text. It returns display text
// plus five layers keyed by display line: clickable link spans, file references,
// flat inline-markdown runs, blockquote depth, and images. The transform is
// strictly per-line — each line is processed independently and rejoined with "\n"
// — so the output always has the same line count as the input (the line-parity
// guarantee the annotation/feedback line numbers depend on).
//
// The LINK COLLAPSE is the only display rewrite, and the only reason a display
// column ever differs from its source column:
//   - inline links `[label](target)` collapse to `label`
//   - autolinks `<url>` collapse to `url`
//   - a bare `http(s)://…` URL is left in place
// Everything else — emphasis markers, backticks, task brackets, quote markers —
// stays in the text and is marked rather than removed (EXC-855), so what the
// reader copies is the real plan text. Fenced code blocks pass through with no
// layers at all, and a link written inside inline code stays literal.
//
// WHICH LINKS COLLAPSE. A safe `http`/`https` target does, and records a
// clickable span carrying its href. A path-shaped target does too, but records NO
// clickable span — openUrl must never be handed a filesystem path. Everything
// else stays literal source text: a target naming any other scheme
// (`javascript:`, `data:`, `mailto:`), the protocol-relative `//host/…` form, and
// a scheme-less host like `github.com/…`, whose destination would survive nowhere
// once collapsed. Leaving an unsafe scheme visible is a safety property — a
// reader can see what the link would actually do — not a styling one.
//
// WHAT MARKS A COLLAPSED LABEL. A path-shaped target specific enough to cite
// (isCitablePath) emits a FileRefSpan over the label (EXC-954, EXC-956), which
// the view merges with the inline-code scan and decorates as a reference.
// Emission belongs here because fileRefs.ts reads *display* text: once the link
// collapses, its target is gone and only this layer still knows where the label
// landed. Any other collapsed label takes a `link` run instead, which EXC-859
// renders as a chip. A collapsed label whose target does not resolve reads as
// prose with no visible path — the reason the citable gate is narrow even though
// the collapse is not.
//
// A FileRefSpan says only where a path was cited, never what it is. A file and a
// directory emit the identical shape, and the daemon's resolve (EXC-916) is what
// later decides which glyph the token draws and which surface a click opens.
//
// IMAGES are the exception to the collapse (EXC-870). `![alt](url)` keeps every
// character of its markup, so the row's display text is its source text and copy
// carries the real markdown; the picture is ADDED to that row by inlineImages.ts
// rather than substituted for it, which is the epic's transform-in-place stance
// (EXC-855) applied to the one construct that has something to render. Only an
// `http`/`https` target draws — the same isSafeUrl gate the links above use — and
// every image, drawable or not, takes a `link` run over its whole shape, so an
// image that cannot be fetched degrades to exactly the chip it already wore. The
// titled form `![alt](url "title")` matches nothing here at all, because the
// target grammar allows no space.
//
// An image emits NO FileRefSpan, even when its target is a citable path. That is
// a deliberate loss: before EXC-870 `![d](doc/arch.svg)` collapsed to `!d` and
// took the reference glyph, so a click opened the excerpt preview — a surface
// that renders TEXT, and therefore could only ever show an image file as bytes.
// What replaces it is strictly more information: the path is now visible in the
// row rather than hidden behind a label.

import { hasKnownFileExtension } from "@core/config/constants";
import { classify, type FileRefSpan, type FileRefSpanMap } from "$lib/diffview/fileRefs.ts";
import {
  buildInlineSpans,
  type ColumnRange,
  type InlineSpan,
  type InlineSpanMap,
} from "$lib/diffview/inlineSpans.ts";

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

/** A drawable markdown image on a display line (EXC-870). Deliberately carries no
 * columns, unlike every other span here: the picture is added to the ROW rather
 * than painted over a range, so where on the line the markup sits is not
 * something any consumer needs to know. */
export interface ImageSpan {
  /** The http/https source to fetch. No other scheme ever reaches here. */
  url: string;
  /** The alt text, used verbatim as the image's accessible name. */
  alt: string;
}

/** Per-line image spans, keyed by 1-based display line number. Lines carrying no
 * drawable image — including one whose target the safety gate refused — are
 * absent from the map. */
export type ImageSpanMap = Map<number, ImageSpan[]>;

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
  /** Flat atomic inline-markdown runs per display line (EXC-866). Fenced-code
   * lines are absent, as they are from every other map here. */
  inline: InlineSpanMap;
  /** Blockquote nesting depth per 1-based display line. Unquoted lines are
   * absent; this rides the ROW rather than the runs, since subduing a quote is a
   * whole-line property (EXC-863). */
  quoteDepth: Map<number, number>;
  /** Drawable images per 1-based display line (EXC-870). The picture is added to
   * the row by inlineImages.ts; the markup that names it stays in the text. */
  images: ImageSpanMap;
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

// Whether a path-shaped target is specific enough to cite as a reference. Three
// narrowings sit on top of classify's shared gate, and they decide only whether a
// FileRefSpan is emitted — never whether the link collapses, which every safe
// link does. A target that fails here keeps its label under a `link` run, so the
// markup it lost is still marked; what it does not get is a glyph, a preview or
// a resolve request against something that is not a citation.
//
// PATH_TARGET is the first: a fragment or query makes a target a URL slot however
// its head reads, so `doc/guide.md#setup` names an anchor rather than a file.
// UNRESOLVABLE is the second — a target no resolve could ever answer. The third
// is specificity: a multi-segment path, or a single segment naming a file by
// extension. A bare `guide` is a word, not a citation.
//
// None of them reads the trailing slash, which is why it comes off before the
// specificity test — `src` and `src/` name one thing, so they take one branch, and
// whether that thing is a file or a directory is the daemon's answer to give
// (EXC-916) rather than this layer's to guess. The path itself keeps the slash,
// since the resolve response is keyed by the string that was requested.
function isCitablePath(path: string): boolean {
  if (!PATH_TARGET.test(path) || UNRESOLVABLE.test(path)) return false;
  const bare = path.replace(/\/+$/, "");
  return bare.includes("/") || hasKnownFileExtension(bare);
}

// Builds the display line and its spans from one source line. `inCode` lines
// (fenced) are returned verbatim with no spans.
function transformLine(
  source: string,
  inCode: boolean,
): {
  display: string;
  spans: LinkSpan[];
  fileRefs: FileRefSpan[];
  inline: InlineSpan[];
  quoteDepth: number;
  images: ImageSpan[];
} {
  if (inCode)
    return { display: source, spans: [], fileRefs: [], inline: [], quoteDepth: 0, images: [] };

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
    image?: { url: string; alt: string };
  };
  const rewrites: Rewrite[] = [];
  const consumed: Range[] = [];

  for (const m of source.matchAll(INLINE_LINK)) {
    const start = m.index;
    const end = start + m[0].length;
    if (inMaskedCode(start, end)) continue;
    const label = m[1] ?? "";
    const url = m[2] ?? "";
    // An `!` in front makes this an IMAGE, and an image is the one shape here
    // that keeps its markup: nothing collapses, so display columns stay source
    // columns and what the reader copies is the real `![alt](url)`. Not
    // collapsing is also what stops the `!` from being stranded outside a
    // rewritten label. The rewrite is recorded anyway, with its display text
    // equal to its source text, because that is what marks the shape consumed —
    // without it the bare-URL pass would make the target inside the parens
    // separately clickable — and because a rewrite carrying neither an href nor
    // a file reference is exactly what the emission loop turns into a `link` run.
    // A safe target additionally draws the picture (inlineImages.ts); an unsafe
    // one draws nothing and keeps only the chip, which is the same rung a load
    // failure lands on.
    if (source[start - 1] === "!") {
      const imageStart = start - 1;
      rewrites.push({
        start: imageStart,
        end,
        display: source.slice(imageStart, end),
        href: null,
        image: isSafeUrl(url) ? { url, alt: label } : undefined,
      });
      consumed.push({ start: imageStart, end });
      continue;
    }
    if (!isSafeUrl(url)) {
      // Not a URL caret will open — but a target carrying any scheme, or the
      // protocol-relative `//host/…` form, is still a URL slot rather than a
      // path, however its tail reads. classify judges a path by its last
      // segment, so `ftp://host/lib.ts` would otherwise pass as path-shaped and
      // resolve against the project's own lib.ts. The scan masks URLs inside
      // code for the same reason; this is that guard on the link side.
      if (HAS_SCHEME.test(url) || url.startsWith("//") || HOSTLIKE.test(url)) continue;
      // What is left is a path-shaped target, and it collapses like every other
      // safe link. Whether it also emits a reference is isCitablePath's call: a
      // target too vague to cite still loses its `[]()` and takes a `link` run
      // over its label instead.
      const ref = classify(url);
      if (ref === null) continue;
      const file = isCitablePath(ref.path) ? { ...ref, target: url } : undefined;
      rewrites.push({ start, end, display: label, href: null, file });
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

  rewrites.sort((a, b) => a.start - b.start);

  let display = "";
  let cursor = 0; // position in source consumed so far
  const spans: LinkSpan[] = [];
  const fileRefs: FileRefSpan[] = [];
  // Display columns of everything the inline layer should mark as a link: the
  // clickable spans, plus a collapsed label that emitted no reference. A label
  // that DID emit one is a reference rather than a link (EXC-859), and a link
  // left literal is marked by nothing at all.
  const linkRanges: ColumnRange[] = [];
  const images: ImageSpan[] = [];
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
      // Every reference takes the glyph, wherever its label sits. That is the
      // decoration pass's doing (inlineDecorate.ts): it cuts each row at the
      // reference's own columns before tagFileRefTokens runs, so a bare-path or
      // prose label gets an element bounded by the reference exactly as a
      // backticked one does. Before that cut existed a collapsed prose label was
      // one coarse run and tagTokenAt refused it, since the glyph and its hover
      // chip would have wrapped the whole sentence (EXC-867).
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
    } else {
      linkRanges.push({ startCol, endCol });
    }
    if (rw.image != null) images.push(rw.image);
  }
  display += source.slice(cursor);
  const { spans: inline, quoteDepth } = buildInlineSpans(display, linkRanges);
  return { display, spans, fileRefs, inline, quoteDepth, images };
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
  const inline: InlineSpanMap = new Map();
  const quoteDepth = new Map<number, number>();
  const images: ImageSpanMap = new Map();
  let inCode = false;
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const source = lines[i] ?? "";
    const isFence = FENCE.test(source);
    // A fence line itself is "code" (passed through verbatim, no links), and it
    // flips the state for subsequent lines.
    const lineInCode = inCode || isFence;
    const line = transformLine(source, lineInCode);
    out.push(line.display);
    if (line.spans.length > 0) spans.set(i + 1, line.spans);
    if (line.fileRefs.length > 0) fileRefs.set(i + 1, line.fileRefs);
    if (line.inline.length > 0) inline.set(i + 1, line.inline);
    if (line.quoteDepth > 0) quoteDepth.set(i + 1, line.quoteDepth);
    if (line.images.length > 0) images.set(i + 1, line.images);
    if (isFence) inCode = !inCode;
  }

  return { text: out.join("\n"), spans, fileRefs, inline, quoteDepth, images };
}
