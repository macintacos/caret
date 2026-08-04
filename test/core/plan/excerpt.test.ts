import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EXCERPT_RADIUS } from "@/config/constants.ts";
import {
  EXCERPT_HEAD_LINES,
  isFileTooLargeToPreview,
  MAX_EXCERPT_BYTES,
  readFileExcerpt,
  resolveFileInCwd,
} from "@/plan/excerpt.ts";

// excerpt.ts resolves a plan's filename reference to a real file *inside the
// review's cwd* (the daemon's source of truth is the review record, never the
// client) and reads a line-aware excerpt for the preview card — a default window
// around the reference, or an explicit range the card asks for as the reader
// expands it. The containment guard is load-bearing: the daemon must never
// become an arbitrary local-file reader, so `../` and symlink escapes resolve to
// null, whatever window is requested.

let dir: string;
let cwd: string; // realpath of dir, so assertions compare canonical paths
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "caret-planfiles-"));
  cwd = realpathSync(dir);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const abs = join(cwd, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

// A file with n numbered lines: "line 1\nline 2\n…\nline n\n".
function numberedLines(n: number): string {
  return `${Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n")}\n`;
}

// ----- resolveFileInCwd -----

test("resolves a direct relative path to its canonical absolute path", () => {
  write("src/foo.ts", "x");
  expect(resolveFileInCwd(cwd, "src/foo.ts")).toBe(join(cwd, "src/foo.ts"));
});

test("returns null when nothing matches", () => {
  expect(resolveFileInCwd(cwd, "src/ghost.ts")).toBeNull();
});

test("falls back to a bounded basename search when the path does not resolve directly", () => {
  write("ui/src/lib/api.ts", "x");
  // The plan cites just the basename; the search finds it under cwd.
  expect(resolveFileInCwd(cwd, "api.ts")).toBe(join(cwd, "ui/src/lib/api.ts"));
});

test("basename search prefers the shallowest match", () => {
  write("index.ts", "top");
  write("deep/nested/index.ts", "deep");
  expect(resolveFileInCwd(cwd, "index.ts")).toBe(join(cwd, "index.ts"));
});

test("refuses a ../ escape above cwd", () => {
  // A real file exists just outside cwd; resolution must still refuse it.
  writeFileSync(join(cwd, "..", "outside.ts"), "secret");
  expect(resolveFileInCwd(cwd, "../outside.ts")).toBeNull();
});

test("refuses an absolute path outside cwd", () => {
  expect(resolveFileInCwd(cwd, "/etc/hosts")).toBeNull();
});

test("refuses a symlink that escapes cwd", () => {
  const outside = join(dir, "..", `caret-outside-${Date.now()}.ts`);
  writeFileSync(outside, "secret");
  symlinkSync(outside, join(cwd, "link.ts"));
  expect(resolveFileInCwd(cwd, "link.ts")).toBeNull();
  rmSync(outside, { force: true });
});

test("returns null for a missing or relative cwd", () => {
  write("foo.ts", "x");
  expect(resolveFileInCwd("", "foo.ts")).toBeNull();
  expect(resolveFileInCwd("relative/dir", "foo.ts")).toBeNull();
});

// ----- readFileExcerpt -----

test("with no line, returns the head of the file", () => {
  write("a.ts", numberedLines(100));
  const ex = readFileExcerpt(cwd, "a.ts");
  expect(ex).not.toBeNull();
  expect(ex?.startLine).toBe(1);
  expect(ex?.endLine).toBe(EXCERPT_HEAD_LINES);
  expect(ex?.totalLines).toBe(100);
  expect(ex?.lines[0]).toBe("line 1");
  expect(ex?.lines).toHaveLength(EXCERPT_HEAD_LINES);
});

test("with a line, returns a window of ±EXCERPT_RADIUS centered on it", () => {
  write("a.ts", numberedLines(100));
  const ex = readFileExcerpt(cwd, "a.ts", 50);
  expect(ex?.startLine).toBe(50 - EXCERPT_RADIUS);
  expect(ex?.endLine).toBe(50 + EXCERPT_RADIUS);
  expect(ex?.lines[0]).toBe(`line ${50 - EXCERPT_RADIUS}`);
});

test("clamps the window at the start and end of the file", () => {
  write("a.ts", numberedLines(10));
  const near = readFileExcerpt(cwd, "a.ts", 2);
  expect(near?.startLine).toBe(1);
  const end = readFileExcerpt(cwd, "a.ts", 10);
  expect(end?.endLine).toBe(10);
});

test("clamps a line past the end of the file to the last line's window", () => {
  write("a.ts", numberedLines(10));
  // A plan can cite a line past a file that has since shrunk; the window must
  // stay non-empty and correctly labeled rather than startLine > endLine.
  const ex = readFileExcerpt(cwd, "a.ts", 150);
  expect(ex?.endLine).toBe(10);
  expect(ex?.startLine).toBeLessThanOrEqual(10);
  expect(ex?.lines.length).toBeGreaterThan(0);
  expect(ex?.lines.at(-1)).toBe("line 10");
});

test("reports a cwd-relative path and infers the language from the extension", () => {
  write("ui/src/app.css", "body{}");
  const ex = readFileExcerpt(cwd, "ui/src/app.css");
  expect(ex?.path).toBe("ui/src/app.css");
  expect(ex?.language).toBe("css");
});

test("defaults the language to text for an unknown extension", () => {
  write("notes", "hello");
  expect(readFileExcerpt(cwd, "notes")?.language).toBe("text");
});

test("returns null for binary content", () => {
  write("bin.dat", "abc\0def");
  expect(readFileExcerpt(cwd, "bin.dat")).toBeNull();
});

test("returns null when the reference does not resolve", () => {
  expect(readFileExcerpt(cwd, "ghost.ts", 5)).toBeNull();
});

// ----- readFileExcerpt with an explicit range -----

test("honours an explicit range, ignoring the line", () => {
  write("a.ts", numberedLines(100));
  const ex = readFileExcerpt(cwd, "a.ts", 50, { start: 20, end: 30 });
  expect(ex?.startLine).toBe(20);
  expect(ex?.endLine).toBe(30);
  expect(ex?.lines).toHaveLength(11);
  expect(ex?.lines[0]).toBe("line 20");
  expect(ex?.lines.at(-1)).toBe("line 30");
});

test("clamps an explicit range at both ends of the file", () => {
  write("a.ts", numberedLines(40));
  const ex = readFileExcerpt(cwd, "a.ts", undefined, { start: -10, end: 500 });
  expect(ex?.startLine).toBe(1);
  expect(ex?.endLine).toBe(40);
  expect(ex?.lines).toHaveLength(40);
});

test("keeps an inverted range non-empty by widening the end to the start", () => {
  write("a.ts", numberedLines(40));
  const ex = readFileExcerpt(cwd, "a.ts", undefined, { start: 30, end: 5 });
  expect(ex?.startLine).toBe(30);
  expect(ex?.endLine).toBe(30);
  expect(ex?.lines).toEqual(["line 30"]);
});

// ----- isFileTooLargeToPreview -----

test("reports a file over MAX_EXCERPT_BYTES as too large to preview", () => {
  write("huge.ts", "x".repeat(MAX_EXCERPT_BYTES + 1));
  expect(isFileTooLargeToPreview(cwd, "huge.ts")).toBe(true);
  expect(readFileExcerpt(cwd, "huge.ts")).toBeNull();
});

// The ceiling moved from 2 MiB to 10 MiB (EXC-973) once chunked serving and row
// virtualization stopped a preview from costing a whole file at once. This is
// the file that changed answer: comfortably past the old ceiling, well under the
// new one.
test("previews a file past the old 2 MiB ceiling", () => {
  const count = Math.ceil((3 * 1024 * 1024) / 100);
  write("mid.ts", `${"x".repeat(99)}\n`.repeat(count));
  const ex = readFileExcerpt(cwd, "mid.ts");
  expect(isFileTooLargeToPreview(cwd, "mid.ts")).toBe(false);
  expect(ex?.totalLines).toBe(count);
  expect(ex?.lines).toHaveLength(EXCERPT_HEAD_LINES);
});

test("does not report a small, a missing, or an escaping file as too large", () => {
  write("small.ts", numberedLines(5));
  // An oversized file outside cwd answers false because it never resolves, not
  // because of its size — so it needs to really be oversized. Its own temp dir,
  // torn down in a finally, keeps 2 MiB out of the shared tmpdir on a failure.
  const outsideDir = mkdtempSync(join(tmpdir(), "caret-planfiles-outside-"));
  const outside = join(outsideDir, "huge.ts");
  try {
    writeFileSync(outside, "x".repeat(MAX_EXCERPT_BYTES + 1));
    expect(isFileTooLargeToPreview(cwd, "small.ts")).toBe(false);
    expect(isFileTooLargeToPreview(cwd, "ghost.ts")).toBe(false);
    expect(isFileTooLargeToPreview(cwd, outside)).toBe(false);
  } finally {
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

// ----- one read per file, not one per chunk -----

// A preview grows a chunk at a time (EXC-969), so a scroll through a file is
// many range requests for the same file. Each one used to re-read and re-split
// the whole thing; at the new ceiling that would have made the daemon the
// bottleneck the raised ceiling was supposed to remove.

// root reads straight through a 0o000 file, so the proof below doesn't hold there.
const asRoot = process.getuid?.() === 0;

test.skipIf(asRoot)("serves successive chunks of one file without re-reading it", () => {
  write("big.ts", numberedLines(400));
  expect(readFileExcerpt(cwd, "big.ts", undefined, { start: 1, end: 148 })?.lines).toHaveLength(
    148,
  );

  // Take away read permission. stat still answers — so the size check and the
  // cache's own identity check both still pass — but a re-read would throw. A
  // second chunk that still arrives, with the right lines, can only have been
  // served from the memoized split.
  chmodSync(join(cwd, "big.ts"), 0o000);
  try {
    const second = readFileExcerpt(cwd, "big.ts", undefined, { start: 149, end: 296 });
    expect(second?.lines).toHaveLength(148);
    expect(second?.lines[0]).toBe("line 149");
    expect(second?.lines.at(-1)).toBe("line 296");
    expect(second?.totalLines).toBe(400);
  } finally {
    chmodSync(join(cwd, "big.ts"), 0o600);
  }
});

test("re-reads after the file changes rather than serving a stale copy", () => {
  write("edited.ts", numberedLines(10));
  expect(readFileExcerpt(cwd, "edited.ts")?.lines[0]).toBe("line 1");

  // A different byte count, so the entry is invalidated on size alone — no
  // reliance on how finely two writes are separated in time.
  write("edited.ts", `changed\n${numberedLines(20)}`);
  const after = readFileExcerpt(cwd, "edited.ts");
  expect(after?.lines[0]).toBe("changed");
  expect(after?.totalLines).toBe(21);
});

test("re-reads a same-size edit, so size alone is not what validates an entry", () => {
  write("same.ts", numberedLines(5));
  expect(readFileExcerpt(cwd, "same.ts")?.lines[0]).toBe("line 1");

  // Same byte count, so only the timestamp separates the two versions. Advanced
  // explicitly rather than trusting two writes to land in different ticks.
  const abs = join(cwd, "same.ts");
  writeFileSync(abs, numberedLines(5).replace("line 1", "LINE 1"));
  const later = new Date(Date.now() + 2000);
  utimesSync(abs, later, later);
  expect(readFileExcerpt(cwd, "same.ts")?.lines[0]).toBe("LINE 1");
});

test("keeps one file's cached lines from answering for another", () => {
  write("one.ts", numberedLines(10));
  write("two.ts", `${"other 1"}\n${"other 2"}\n`);
  expect(readFileExcerpt(cwd, "one.ts")?.lines[0]).toBe("line 1");
  expect(readFileExcerpt(cwd, "two.ts")?.lines[0]).toBe("other 1");
  expect(readFileExcerpt(cwd, "one.ts")?.lines[0]).toBe("line 1");
});
