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
// boundary to hang the icon on or to hit-test the hover against. A token
// qualifies on *shape* only (last path segment ends in a known file extension,
// optionally trailed by :line[:col]); whether it is a real file is resolved
// server-side, so a candidate that doesn't exist gets no icon and no hover.

/** A candidate filename reference on a single display line. Columns are 0-based,
 * half-open [startCol, endCol) into the display line's text; endCol includes any
 * trailing `:line[:col]` so a hover anywhere on the reference resolves. */
export interface FileRefSpan {
  startCol: number;
  endCol: number;
  /** The referenced path, without the trailing `:line`. */
  path: string;
  /** 1-based line number from a `path:line` reference, if present. */
  line?: number;
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

// A maximal run of path characters, optionally trailed by :line[:col]. The class
// admits leading `.`/`/` so a `../x.ts` or `/abs/x.ts` reference is captured
// whole (and then refused server-side) rather than mis-parsed from its tail.
const CANDIDATE_RE = /[A-Za-z0-9._/~-]+(?::\d+(?::\d+)?)?/g;

// Splits a candidate's trailing `:line[:col]` off the path.
const LINE_SUFFIX = /^(.+?):(\d+)(?::\d+)?$/;

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

/** Classifies a raw candidate run into a path + optional line, or null when it
 * is not file-shaped (no known extension, or a bare `.ext` with no name). */
function classify(raw: string): { path: string; line?: number } | null {
  let path = raw;
  let line: number | undefined;
  const suffix = LINE_SUFFIX.exec(raw);
  if (suffix) {
    path = suffix[1] as string;
    line = Number(suffix[2]);
  }
  const base = path.split("/").pop() ?? "";
  const ext = EXTENSION.exec(base)?.[1]?.toLowerCase();
  if (ext === undefined || !KNOWN_EXTENSIONS.has(ext)) return null;
  // Require a real name before the extension dot, so a bare ".ts" or a dotfile
  // like ".env" (which isn't a `name.ext` reference) is not a candidate.
  if (base.length <= ext.length + 1) return null;
  return { path, line };
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
      });
    }
  }
  return spans;
}

/** Scans plan display text into per-line filename-reference spans. Fenced code
 * blocks are skipped, so only prose and inline code are scanned. */
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
