// Pure detection for the source view's filename-reference layer (EXC-687).
// Takes the plan's display source text and returns a per-line map of path-shaped
// spans — the candidates the daemon then confirms against the real filesystem.
// The transform is strictly per-line and reads columns off the display text, so
// spans line up with the rendered tokens; line numbers are 1-based, matching the
// view's per-line data-line.
//
// Detection is scoped to inline-code spans (`…`), which is where caret's plans
// cite files and — decisively — the only place a path renders as its own shiki
// token: prose is tokenized as one coarse run, so a path inside it has no token
// boundary to hang the icon on or to hit-test a click against. A token
// qualifies on *shape* only (last path segment ends in a known file extension,
// optionally trailed by a line reference — `:line`, `:line:col`, or a
// `:start-end` range, each also spellable with `#`/`L` as in `#L154-L162`);
// whether it is a real file is resolved server-side, so a candidate that doesn't
// exist gets no icon and no affordance.
//
// The scan is not the only source of references: the link layer emits its own
// over collapsed markdown-link labels, whose paths never survive into the display
// text as inline code. mergeFileRefSpans unions the two into the one candidate
// set the view resolves and tags.

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

// A bare URL run — masked so a path-looking tail like ".../app.ts" inside a
// code-spanned URL is never mistaken for a file reference.
const URL_RE = /\bhttps?:\/\/\S+/gi;

// A maximal run of path characters, optionally trailed by a line reference:
// `:154`, `#L154`, `:154:9` (line + column), or a range `:154-162` /
// `:#L154–L162`. The class admits leading `.`/`/` so a `../x.ts` or `/abs/x.ts`
// reference is captured whole (and then refused server-side) rather than
// mis-parsed from its tail. Matching the whole run — the range's end line
// included — is what puts the entire reference inside the span, and so inside
// the click target.
const CANDIDATE_RE = /[A-Za-z0-9._/~-]+(?:(?::#?|#)L?\d+(?:[-–]L?\d+|:\d+)?)?/g;

// Splits a candidate's trailing line reference off the path: group 2 is the
// start line, group 3 the range's end when it carries one. The separator admits
// `:`, `#`, and the `:#` the two collide into, and `L?` covers the `L154` /
// `#L154` spellings. A `:\d+` tail is a column and is dropped — that alternative
// sits after the range one, which is what keeps `path:154:162` unambiguous.
const LINE_SUFFIX = /^(.+?)(?::#?|#)L?(\d+)(?:[-–]L?(\d+)|:\d+)?$/;

// The final `.ext` of a path's last segment (extension must start with a letter
// or digit; the membership test below narrows it to real file kinds).
const EXTENSION = /\.([A-Za-z0-9]+)$/;

// File extensions that count as a reference. Broad enough to cover the source and
// config kinds a plan cites, narrow enough that prose ("e.g", "obj.property")
// and numbers ("3.14") never qualify. The daemon is the real existence gate; this
// set just keeps the candidate batch tight and precise.
const KNOWN_EXTENSIONS: ReadonlySet<string> = new Set([
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "svelte",
  "vue",
  "json",
  "jsonc",
  "css",
  "scss",
  "less",
  "html",
  "htm",
  "xml",
  "svg",
  "md",
  "mdx",
  "py",
  "rb",
  "rs",
  "go",
  "java",
  "kt",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "sh",
  "bash",
  "zsh",
  "toml",
  "yaml",
  "yml",
  "ini",
  "sql",
  "graphql",
  "gql",
  "php",
  "swift",
  "dart",
  "txt",
  "lock",
  "cfg",
  "conf",
]);

/** Classifies a raw candidate run into a path + optional cited line or range,
 * or null when it is not file-shaped (no known extension, or a bare `.ext` with
 * no name). A reversed range is normalized here rather than downstream, so every
 * consumer gets `line <= endLine` by construction.
 *
 * The one definition of "path-shaped" in the codebase: the scan below applies it
 * to runs inside inline code, and the link layer applies it to a `[label](target)`
 * target before collapsing it (EXC-954). A second, drifting notion would let the
 * two decoration paths disagree about the same text. Each caller adds its own
 * URL exclusion first, since this judges a run by its last segment and a URL's
 * tail can read as a path: the scan masks URLs inside code, the link layer
 * rejects a target carrying a scheme. */
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
  const base = path.split("/").pop() ?? "";
  const ext = EXTENSION.exec(base)?.[1]?.toLowerCase();
  if (ext === undefined || !KNOWN_EXTENSIONS.has(ext)) return null;
  // Require a real name before the extension dot, so a bare ".ts" or a dotfile
  // like ".env" (which isn't a `name.ext` reference) is not a candidate.
  if (base.length <= ext.length + 1) return null;
  return { path, line, endLine };
}

function scanLine(source: string): FileRefSpan[] {
  const spans: FileRefSpan[] = [];
  for (const code of source.matchAll(INLINE_CODE)) {
    const interior = code[2] ?? "";
    // Column of the interior's first character in the display line (past the
    // opening backticks), so span columns are absolute.
    const base = code.index + (code[1]?.length ?? 0);
    const urlRanges = [...interior.matchAll(URL_RE)].map((m) => ({
      start: m.index,
      end: m.index + m[0].length,
    }));
    for (const m of interior.matchAll(CANDIDATE_RE)) {
      const raw = m[0];
      const localStart = m.index;
      const localEnd = localStart + raw.length;
      if (urlRanges.some((r) => localStart < r.end && localEnd > r.start)) continue;
      const ref = classify(raw);
      if (ref === null) continue;
      spans.push({
        startCol: base + localStart,
        endCol: base + localEnd,
        path: ref.path,
        line: ref.line,
        endLine: ref.endLine,
      });
    }
  }
  return spans;
}

/** Scans plan display text into per-line filename-reference spans. Fenced code
 * blocks are skipped; each remaining line is scanned for references inside its
 * inline-code spans. */
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
 * EMITTED span's path, cited lines and target win (the link's real destination,
 * which need
 * not be what the label says). Every span an emitted one covers collapses into
 * that single survivor, so a label citing two paths draws one glyph pointing at
 * the link's target rather than two, one of them at a file the link never named.
 * Each line's spans are sorted by startCol.
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
        into.push({
          startCol: anchor.startCol,
          endCol: anchor.endCol,
          path: span.path,
          line: span.line,
          endLine: span.endLine,
          target: span.target,
        });
      }
    }
    merged.set(line, into);
  }
  for (const spans of merged.values()) spans.sort((a, b) => a.startCol - b.startCol);
  return merged;
}
