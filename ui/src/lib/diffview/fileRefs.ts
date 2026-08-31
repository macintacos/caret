// Pure detection for the source view's filename-reference layer (EXC-687).
// Takes the plan's display source text and returns a per-line map of path-shaped
// spans — the candidates the daemon then confirms against the real filesystem.
// The transform is strictly per-line and reads columns off the display text, so
// spans line up with the rendered tokens; line numbers are 1-based, matching the
// view's per-line data-line.
//
// Detection has three scopes, and bare prose outside them is never scanned — a
// path-shaped run in ordinary prose is an ordinary word. Inline-code spans (`…`)
// are where caret's plans cite files: backticks are the author saying "this is a
// path". A markdown link's target is a reference that is KNOWN rather than
// guessed, so the decoration pass cuts the row at its columns and decorates
// wherever it sits (inlineDecorate.ts). And a PARENTHESIZED run is the citation
// shape a plan writes beside the symbol it names — `Emailer.attempt_send`
// (spam/email.py:127-141) — which is safe only because of the separator clause
// worthAsking states below; PAREN_RUN carries the two gates that bound it.
//
// Within a scope a token qualifies on a bare plausibility floor — its last
// segment holds a letter — optionally trailed by a line reference (`:line`,
// `:line:col`, or a `:start-end` range, each also spellable with `#`/`L` as in
// `#L154-L162`). What a candidate actually IS, file or directory or nothing, is
// resolved server-side against the review's cwd (EXC-916); a candidate that
// resolves to neither gets no icon and no affordance. Only SINGLE-TOKEN runs are
// scanned: a run holding whitespace is a command or prose rather than a path, and
// since a candidate can never span a space, scanning one would offer each word on
// its own — enough for `bun test` to draw a folder glyph over the whole command
// on the strength of the word `test` (EXC-1065). That rule is also what makes a
// parenthesis a signal rather than a coincidence: a citation holds no spaces,
// prose does.
//
// The scan is not the only source of references: the link layer emits its own
// over collapsed markdown-link labels, whose paths never survive into the display
// text as inline code. mergeFileRefSpans unions the two into the one candidate
// set the view resolves and tags.

import type { FileRefKind } from "@core/lib/types";

/** A candidate filename reference on a single display line. Columns are 0-based,
 * half-open [startCol, endCol) into the display line's text; endCol includes the
 * whole trailing line reference — the range's end line included — so a click
 * anywhere on the reference resolves. */
export interface FileRefSpan {
  startCol: number;
  endCol: number;
  /** The referenced path, without the trailing `:line`. */
  path: string;
  /** 1-based line number from a `path:line` reference, if present. For a range
   * this is its start. */
  line?: number;
  /** 1-based inclusive end of a cited range (`path:154-162`), if the reference
   * carried one. Always ≥ `line`; absent for a single-line reference. */
  endLine?: number;
  /** The link target this reference was emitted from, when the display text does
   * not already show it (a prose-labelled markdown link). Hover reveals it in the
   * link tooltip; an inline-code reference leaves it unset. */
  target?: string;
  /** What the daemon resolved this path to on disk (EXC-916). Absent on a raw
   * candidate — detection is pure and never guesses — and set by the view once
   * the resolve lands, because it decides both which glyph the token draws and
   * which surface a click opens: an excerpt preview for a file, the folder tree
   * for a directory (EXC-918). */
  kind?: FileRefKind;
}

/** Per-line spans, keyed by 1-based display line number. Lines with no
 * references are absent from the map. */
export type FileRefSpanMap = Map<number, FileRefSpan[]>;

// A ``` (or longer) fence toggles fenced-code mode. The same stateless detection
// buildLinkLayer uses, so both layers agree on what counts as code.
const FENCE = /^\s*(`{3,}|~{3,})/;

// An inline-code span: one or more backticks, then the shortest run closing with
// the same count. Detection runs only inside these (group 2 is the interior).
const INLINE_CODE = /(`+)(.*?)\1/g;

// A parenthesized run holding no whitespace and no nested parens — the citation
// shape a plan writes beside a symbol, `(spam/email.py:127-141)` (EXC-1184).
// Group 1 is the interior, so the brackets themselves stay outside every span.
//
// Two of the three gates live at the call site rather than here, because both are
// about what precedes or overlaps the run rather than about its own shape. A run
// following `]` is a markdown link or image target: what survives into display
// text still wearing literal `](…)` markup is exactly an image, whose target
// links.ts refuses to cite because a click would open a text preview over bytes
// (EXC-870), and a link that did not collapse. A run overlapping an inline-code
// span already belongs to the code scan, whose columns sit tighter against the
// filename. The third gate is worthAsking.
const PAREN_RUN = /\(([^()\s]+)\)/g;

// A bare URL run — masked so a path-looking tail like ".../app.ts" inside a
// code-spanned URL is never mistaken for a file reference.
const URL_RE = /\bhttps?:\/\/\S+/gi;

// A maximal run of path characters, optionally trailed by a line reference:
// `:154`, `#L154`, `:154:9` (line + column), or a range `:154-162` /
// `:154,162` / `:#L154–L162`. The class admits leading `.`/`/` so a `../x.ts` or
// `/abs/x.ts` reference is captured whole (and then refused server-side) rather
// than mis-parsed from its tail. Matching the whole run — the range's end line
// included — is what puts the entire reference inside the span, and so inside
// the click target.
const CANDIDATE_RE = /[A-Za-z0-9._/~-]+(?:(?::L?|:?#L)\d+(?:[-–,]L?\d+|:\d+)?)?/g;

// Splits a candidate's trailing line reference off the path: group 2 is the
// start line, group 3 the range's end when it carries one. A `:\d+` tail is a
// column and is dropped — that alternative sits after the range one, which is
// what keeps `path:154:162` unambiguous.
//
// The separator is `:`, `#L`, or the `:#L` the two collide into, and never a
// bare `#` before the digits: `#` alone introduces a URL fragment, and
// `doc/guide.md#3` is a link to a numbered anchor rather than a citation of
// line 3. Requiring the `L` there is what keeps a fragment target inert, the
// same guarantee links.ts holds for `doc/guide.md#setup`, which collapses like
// any link but cites nothing.
const LINE_SUFFIX = /^(.+?)(?::L?|:?#L)(\d+)(?:[-–,]L?(\d+)|:\d+)?$/;

/** Classifies a raw candidate run into a path + optional cited line or range, or
 * null when it is not plausibly a path at all. A reversed range is normalized
 * here rather than downstream, so every consumer gets `line <= endLine` by
 * construction.
 *
 * The one definition of "path-shaped" in the codebase: the scan below applies it
 * to runs inside inline code and inside parentheses, and the link layer applies
 * it to a `[label](target)` target to decide whether it is a path at all
 * (EXC-954). A second, drifting
 * notion would let the two decoration paths disagree about the same text. The
 * floor is deliberately low — one letter in the last segment, trailing slashes
 * ignored — because the filesystem is what knows whether a token is a file, a
 * directory, or nothing (EXC-916), and a shape test that guessed would keep
 * `src/daemon/` invisible. What it does buy is silence on the tokens no
 * filesystem could answer for: `3.14`, `42`, `1.2.3`.
 *
 * A caller that needs a stricter gate narrows on top, and the link layer does,
 * since a reference draws a glyph and opens a preview where an un-cited label
 * costs nothing; links.ts owns those clauses. Each caller also adds its own
 * URL exclusion first, since this judges a run by its last segment and a URL's
 * tail can read as a path: the scan masks URLs inside code, the link layer
 * rejects a target that names a scheme or a host. */
export function classify(raw: string): { path: string; line?: number; endLine?: number } | null {
  let path = raw;
  let line: number | undefined;
  let endLine: number | undefined;
  const suffix = LINE_SUFFIX.exec(raw);
  if (suffix) {
    path = suffix[1] as string;
    line = Number(suffix[2]);
    if (suffix[3] !== undefined) {
      endLine = Number(suffix[3]);
      if (endLine < line) [line, endLine] = [endLine, line];
    }
  }
  // Trailing slashes are stripped before reading the last segment — `src/daemon/`
  // names the same thing as `src/daemon`, and the slash is not a discriminator.
  // The path itself keeps the slash, so the response the daemon keys by the
  // requested string still matches the span.
  const base = path.replace(/\/+$/, "").split("/").pop() ?? "";
  if (!/[A-Za-z]/.test(base)) return null;
  return { path, line, endLine };
}

/** One path-shaped run found in a piece of text: where it sits (0-based,
 * half-open, into the text it was found in) and what `classify` made of it. */
export interface PathCandidate {
  start: number;
  end: number;
  path: string;
  line?: number;
  endLine?: number;
}

/** The path-shaped runs in `text`, URLs masked out and `classify` applied.
 *
 * The tokenizer half of the "one definition of path-shaped" rule `classify`
 * states: `scanLine` applies it to an inline-code interior, and the feedback
 * editors' chip scan (`$lib/editorRefs.ts`) applies it to the document's prose
 * with code spans and fences masked out — so neither surface can drift on what a
 * run is. Offsets are relative to `text`; a caller scanning a fragment adds its
 * own base. */
export function pathCandidates(text: string): PathCandidate[] {
  const urlRanges = [...text.matchAll(URL_RE)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
  }));
  const found: PathCandidate[] = [];
  for (const m of text.matchAll(CANDIDATE_RE)) {
    const raw = m[0];
    const start = m.index;
    const end = start + raw.length;
    if (urlRanges.some((r) => start < r.end && end > r.start)) continue;
    const ref = classify(raw);
    if (ref === null) continue;
    found.push({ start, end, path: ref.path, line: ref.line, endLine: ref.endLine });
  }
  return found;
}

/** Whether a bare-prose run is discriminating enough to spend a request on.
 *
 * This clause is what lets a surface scan prose at all: `classify`'s floor is one
 * letter in the last segment, so without it every word is a candidate and `test`
 * wears a chip the moment a `test/` exists beside it. A separator is what
 * distinguishes a path someone wrote from a word they wrote. Both prose scanners
 * apply it — the parenthesized scope below, and the feedback editors' chip scan
 * (`$lib/editorRefs.ts`).
 *
 * ponytail: an extensionless file at the repo root — `Makefile`, `LICENSE` —
 * is therefore only recognized inside backticks, where the author's own
 * "this is a path" signal stands in for the separator. Widen this only with a
 * second signal to spend, never by dropping the clause. */
export function worthAsking(path: string): boolean {
  return path.includes("/") || path.includes(".");
}

function scanLine(source: string): FileRefSpan[] {
  const spans: FileRefSpan[] = [];
  // Every code span's outer range, the spacey ones included: a parenthesized run
  // inside `sed -n '1,5p' (x)` belongs to the command, not to prose.
  const codeRanges: { start: number; end: number }[] = [];
  for (const code of source.matchAll(INLINE_CODE)) {
    codeRanges.push({ start: code.index, end: code.index + code[0].length });
    const interior = code[2] ?? "";
    // Whitespace is a property of the SPAN and never of a candidate, since
    // CANDIDATE_RE cannot match across one — so this aborts the whole interior
    // rather than masking a range out of it the way pathCandidates' URL
    // exclusion does. Trimmed first: CommonMark strips a code span's one padding
    // space either side, so ` foo.ts ` is a single token (EXC-1065).
    if (/\s/.test(interior.trim())) continue;
    // Column of the interior's first character in the display line (past the
    // opening backticks), so span columns are absolute.
    const base = code.index + (code[1]?.length ?? 0);
    for (const c of pathCandidates(interior)) {
      spans.push({
        startCol: base + c.start,
        endCol: base + c.end,
        path: c.path,
        line: c.line,
        endLine: c.endLine,
      });
    }
  }
  for (const paren of source.matchAll(PAREN_RUN)) {
    if (source[paren.index - 1] === "]") continue;
    const start = paren.index;
    const end = start + paren[0].length;
    if (codeRanges.some((r) => start < r.end && end > r.start)) continue;
    // The interior's base is one past the `(`.
    const base = start + 1;
    for (const c of pathCandidates(paren[1] ?? "")) {
      if (!worthAsking(c.path)) continue;
      spans.push({
        startCol: base + c.start,
        endCol: base + c.end,
        path: c.path,
        line: c.line,
        endLine: c.endLine,
      });
    }
  }
  // Sorted rather than left in "code spans, then parens" order, so a line drawing
  // from both sources reads left to right the way mergeFileRefSpans' output does.
  return spans.sort((a, b) => a.startCol - b.startCol);
}

/** Scans plan display text into per-line filename-reference spans. Fenced code
 * blocks are skipped; each remaining line is scanned for references inside its
 * inline-code spans and its parenthesized runs. Each line's spans come back
 * sorted by `startCol`. */
export function buildFileRefLayer(text: string): FileRefSpanMap {
  const lines = text.split("\n");
  const map: FileRefSpanMap = new Map();
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    const source = lines[i] ?? "";
    const isFence = FENCE.test(source);
    if (inCode || isFence) {
      if (isFence) inCode = !inCode;
      continue;
    }
    const spans = scanLine(source);
    if (spans.length > 0) map.set(i + 1, spans);
  }
  return map;
}

/** Unions the scanned and emitted reference maps into one candidate set. Where a
 * pair overlaps — a markdown link whose label is itself an inline-code path — the
 * leftmost SCANNED span's columns win (inline code is where a path gets its own
 * shiki token, so they place the glyph tight against the filename) and the
 * EMITTED span's path and target win (the link's real destination, which need
 * not be what the label says). Its cited lines win too, with one narrowing: where
 * it names NO line and both spans name the SAME path, the label is the only half
 * citing one, so `` [`a.ts:5-9`](a.ts) `` still frames 5–9 rather than opening on
 * the file's head — and that fallback reads the leftmost scanned span, the one
 * that placed the columns. A target naming a different path never inherits the
 * label's line, and line and end line always move as a unit, so a survivor never
 * carries a start from one span and an end from the other. Every span an emitted
 * one covers collapses into that single survivor, so a label citing two paths
 * draws one glyph pointing at the link's target rather than two, one of them at a
 * file the link never named. Each line's spans are sorted by startCol.
 *
 * Both maps and their spans are treated as immutable: the result carries emitted
 * spans by reference rather than copying them. */
export function mergeFileRefSpans(
  scanned: FileRefSpanMap,
  emitted: FileRefSpanMap,
): FileRefSpanMap {
  const merged: FileRefSpanMap = new Map();
  for (const [line, spans] of scanned) merged.set(line, [...spans]);
  for (const [line, spans] of emitted) {
    let into = merged.get(line) ?? [];
    for (const span of spans) {
      const hits = (s: FileRefSpan) => span.startCol < s.endCol && span.endCol > s.startCol;
      const anchor = into.find(hits);
      if (anchor === undefined) into.push(span);
      else {
        into = into.filter((s) => !hits(s));
        // The target names the file; the label may be the only thing that names the
        // line. A path mismatch keeps the anchor's line out — `` [`x.ts:10`](y.ts) ``
        // must not cite line 10 in y.ts — and that also fires on cosmetic differences
        // like a `./` prefix, where dropping the citation beats guessing at one. Line
        // and end line are picked as a unit, never field by field: an `a.ts:42` target
        // under an `a.ts:10-20` label would otherwise yield the reversed 42–20, which
        // bypasses the normalization classify does.
        const cited = span.line !== undefined || span.path !== anchor.path ? span : anchor;
        into.push({
          startCol: anchor.startCol,
          endCol: anchor.endCol,
          path: span.path,
          line: cited.line,
          endLine: cited.endLine,
          target: span.target,
        });
      }
    }
    merged.set(line, into);
  }
  for (const spans of merged.values()) spans.sort((a, b) => a.startCol - b.startCol);
  return merged;
}
