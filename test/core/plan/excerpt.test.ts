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

import { writeTreeFile } from "@test/support/fs-tree.ts";
import { EXCERPT_RADIUS } from "@/config/constants.ts";
import {
  EXCERPT_HEAD_LINES,
  isFileTooLargeToPreview,
  MAX_EXCERPT_BYTES,
  readFileExcerpt,
  resolveInCwd,
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
  writeTreeFile(cwd, rel, content);
}

// A file with n numbered lines: "line 1\nline 2\n…\nline n\n".
function numberedLines(n: number): string {
  return `${Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n")}\n`;
}

// ----- resolveInCwd -----

test("resolves a direct relative path to its canonical absolute path", async () => {
  write("src/foo.ts", "x");
  expect(await resolveInCwd(cwd, "src/foo.ts")).toEqual({
    path: join(cwd, "src/foo.ts"),
    kind: "file",
  });
});

test("resolves a directory, reporting its kind", async () => {
  mkdirSync(join(cwd, "src/daemon"), { recursive: true });
  expect(await resolveInCwd(cwd, "src/daemon")).toEqual({
    path: join(cwd, "src/daemon"),
    kind: "directory",
  });
});

test("resolves a directory written with a trailing slash", async () => {
  // The slash is not what makes it a directory — the stat is (EXC-916) — but a
  // plan that writes one must still resolve.
  mkdirSync(join(cwd, "src/daemon"), { recursive: true });
  expect((await resolveInCwd(cwd, "src/daemon/"))?.kind).toBe("directory");
});

test("returns null when nothing matches", async () => {
  expect(await resolveInCwd(cwd, "src/ghost.ts")).toBeNull();
});

test("falls back to a bounded basename search for a bare file-shaped name", async () => {
  write("ui/src/lib/api.ts", "x");
  expect((await resolveInCwd(cwd, "api.ts"))?.path).toBe(join(cwd, "ui/src/lib/api.ts"));
});

test("basename search prefers the shallowest match", async () => {
  write("index.ts", "top");
  write("deep/nested/index.ts", "deep");
  expect((await resolveInCwd(cwd, "index.ts"))?.path).toBe(join(cwd, "index.ts"));
});

test("does not search for a slash-bearing token that missed its exact path", async () => {
  // A plan that said where the file lives and got it wrong is a miss, not a
  // starting point — nothing guesses where a cited path really is (EXC-916).
  write("ui/src/lib/api.ts", "x");
  expect(await resolveInCwd(cwd, "src/api.ts")).toBeNull();
});

test("does not search for a name with no known file extension", async () => {
  // The candidate gate offers every inline-code token, so a walk per `--flag` and
  // `someVariable` is the cost that would otherwise follow.
  write("deep/nested/Makefile", "x");
  expect(await resolveInCwd(cwd, "Makefile")).toBeNull();
});

test("refuses a ../ escape above cwd", async () => {
  writeFileSync(join(cwd, "..", "outside.ts"), "secret");
  expect(await resolveInCwd(cwd, "../outside.ts")).toBeNull();
});

test("refuses an absolute path outside cwd", async () => {
  expect(await resolveInCwd(cwd, "/etc/hosts")).toBeNull();
});

test("refuses a symlink that escapes cwd", async () => {
  const outside = join(dir, "..", `caret-outside-${Date.now()}.ts`);
  writeFileSync(outside, "secret");
  symlinkSync(outside, join(cwd, "link.ts"));
  expect(await resolveInCwd(cwd, "link.ts")).toBeNull();
  rmSync(outside, { force: true });
});

test("refuses a symlinked directory that escapes cwd", async () => {
  // Directories resolve too, so the symlink escape has a second door.
  const outside = mkdtempSync(join(tmpdir(), "caret-planfiles-outdir-"));
  symlinkSync(outside, join(cwd, "linkdir"));
  try {
    expect(await resolveInCwd(cwd, "linkdir")).toBeNull();
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("returns null for a missing or relative cwd", async () => {
  write("foo.ts", "x");
  expect(await resolveInCwd("", "foo.ts")).toBeNull();
  expect(await resolveInCwd("relative/dir", "foo.ts")).toBeNull();
});

// ----- readFileExcerpt -----

test("with no line, returns the head of the file", async () => {
  write("a.ts", numberedLines(100));
  const ex = await readFileExcerpt(cwd, "a.ts");
  expect(ex).not.toBeNull();
  expect(ex?.startLine).toBe(1);
  expect(ex?.endLine).toBe(EXCERPT_HEAD_LINES);
  expect(ex?.totalLines).toBe(100);
  expect(ex?.lines[0]).toBe("line 1");
  expect(ex?.lines).toHaveLength(EXCERPT_HEAD_LINES);
});

test("with a line, returns a window of ±EXCERPT_RADIUS centered on it", async () => {
  write("a.ts", numberedLines(100));
  const ex = await readFileExcerpt(cwd, "a.ts", 50);
  expect(ex?.startLine).toBe(50 - EXCERPT_RADIUS);
  expect(ex?.endLine).toBe(50 + EXCERPT_RADIUS);
  expect(ex?.lines[0]).toBe(`line ${50 - EXCERPT_RADIUS}`);
});

test("clamps the window at the start and end of the file", async () => {
  write("a.ts", numberedLines(10));
  const near = await readFileExcerpt(cwd, "a.ts", 2);
  expect(near?.startLine).toBe(1);
  const end = await readFileExcerpt(cwd, "a.ts", 10);
  expect(end?.endLine).toBe(10);
});

test("clamps a line past the end of the file to the last line's window", async () => {
  write("a.ts", numberedLines(10));
  // A plan can cite a line past a file that has since shrunk; the window must
  // stay non-empty and correctly labeled rather than startLine > endLine.
  const ex = await readFileExcerpt(cwd, "a.ts", 150);
  expect(ex?.endLine).toBe(10);
  expect(ex?.startLine).toBeLessThanOrEqual(10);
  expect(ex?.lines.length).toBeGreaterThan(0);
  expect(ex?.lines.at(-1)).toBe("line 10");
});

test("reports a cwd-relative path and infers the language from the extension", async () => {
  write("ui/src/app.css", "body{}");
  const ex = await readFileExcerpt(cwd, "ui/src/app.css");
  expect(ex?.path).toBe("ui/src/app.css");
  expect(ex?.language).toBe("css");
});

test("defaults the language to text for an unknown extension", async () => {
  write("notes", "hello");
  expect((await readFileExcerpt(cwd, "notes"))?.language).toBe("text");
});

test("returns null for binary content", async () => {
  write("bin.dat", "abc\0def");
  expect(await readFileExcerpt(cwd, "bin.dat")).toBeNull();
});

test("returns null when the reference does not resolve", async () => {
  expect(await readFileExcerpt(cwd, "ghost.ts", 5)).toBeNull();
});

test("returns null for a directory, and never reports one as too large", async () => {
  // "Only a file is ever read" is a property of these two call sites, not of
  // resolution, which answers for directories too. Both are pinned here, or the
  // guarantee has no falsifier.
  mkdirSync(join(cwd, "src/daemon"), { recursive: true });
  expect(await readFileExcerpt(cwd, "src/daemon")).toBeNull();
  expect(await isFileTooLargeToPreview(cwd, "src/daemon")).toBe(false);
});

// ----- readFileExcerpt with an explicit range -----

test("honours an explicit range, ignoring the line", async () => {
  write("a.ts", numberedLines(100));
  const ex = await readFileExcerpt(cwd, "a.ts", 50, { start: 20, end: 30 });
  expect(ex?.startLine).toBe(20);
  expect(ex?.endLine).toBe(30);
  expect(ex?.lines).toHaveLength(11);
  expect(ex?.lines[0]).toBe("line 20");
  expect(ex?.lines.at(-1)).toBe("line 30");
});

test("clamps an explicit range at both ends of the file", async () => {
  write("a.ts", numberedLines(40));
  const ex = await readFileExcerpt(cwd, "a.ts", undefined, { start: -10, end: 500 });
  expect(ex?.startLine).toBe(1);
  expect(ex?.endLine).toBe(40);
  expect(ex?.lines).toHaveLength(40);
});

test("keeps an inverted range non-empty by widening the end to the start", async () => {
  write("a.ts", numberedLines(40));
  const ex = await readFileExcerpt(cwd, "a.ts", undefined, { start: 30, end: 5 });
  expect(ex?.startLine).toBe(30);
  expect(ex?.endLine).toBe(30);
  expect(ex?.lines).toEqual(["line 30"]);
});

// ----- isFileTooLargeToPreview -----

test("reports a file over MAX_EXCERPT_BYTES as too large to preview", async () => {
  write("huge.ts", "x".repeat(MAX_EXCERPT_BYTES + 1));
  expect(await isFileTooLargeToPreview(cwd, "huge.ts")).toBe(true);
  expect(await readFileExcerpt(cwd, "huge.ts")).toBeNull();
});

// 3 MiB: comfortably past the 2 MiB ceiling chunked serving and row virtualization
// replaced, and well under the current one (EXC-973).
test("previews a file past the old 2 MiB ceiling", async () => {
  const count = Math.ceil((3 * 1024 * 1024) / 100);
  write("mid.ts", `${"x".repeat(99)}\n`.repeat(count));
  const ex = await readFileExcerpt(cwd, "mid.ts");
  expect(await isFileTooLargeToPreview(cwd, "mid.ts")).toBe(false);
  expect(ex?.totalLines).toBe(count);
  expect(ex?.lines).toHaveLength(EXCERPT_HEAD_LINES);
});

test("does not report a small, a missing, or an escaping file as too large", async () => {
  write("small.ts", numberedLines(5));
  // An oversized file outside cwd answers false because it never resolves, not
  // because of its size — so it needs to really be oversized. Its own temp dir,
  // torn down in a finally, keeps 2 MiB out of the shared tmpdir on a failure.
  const outsideDir = mkdtempSync(join(tmpdir(), "caret-planfiles-outside-"));
  const outside = join(outsideDir, "huge.ts");
  try {
    writeFileSync(outside, "x".repeat(MAX_EXCERPT_BYTES + 1));
    expect(await isFileTooLargeToPreview(cwd, "small.ts")).toBe(false);
    expect(await isFileTooLargeToPreview(cwd, "ghost.ts")).toBe(false);
    expect(await isFileTooLargeToPreview(cwd, outside)).toBe(false);
  } finally {
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

// ----- one read per file, not one per chunk -----

// A preview grows a chunk at a time (EXC-969), so a scroll is many range requests
// for one file. Re-reading and re-splitting the whole file per chunk would make the
// daemon the bottleneck the raised ceiling exists to remove.

// root reads straight through a 0o000 file, so the proof below doesn't hold there.
const asRoot = process.getuid?.() === 0;

test.skipIf(asRoot)("serves successive chunks of one file without re-reading it", async () => {
  write("big.ts", numberedLines(400));
  expect(
    (await readFileExcerpt(cwd, "big.ts", undefined, { start: 1, end: 148 }))?.lines,
  ).toHaveLength(148);

  // Take away read permission. stat still answers — so the size check and the
  // cache's own identity check both still pass — but a re-read would throw. A
  // second chunk that still arrives, with the right lines, can only have been
  // served from the memoized split.
  chmodSync(join(cwd, "big.ts"), 0o000);
  try {
    const second = await readFileExcerpt(cwd, "big.ts", undefined, { start: 149, end: 296 });
    expect(second?.lines).toHaveLength(148);
    expect(second?.lines[0]).toBe("line 149");
    expect(second?.lines.at(-1)).toBe("line 296");
    expect(second?.totalLines).toBe(400);
  } finally {
    chmodSync(join(cwd, "big.ts"), 0o600);
  }
});

test("re-reads after the file changes rather than serving a stale copy", async () => {
  write("edited.ts", numberedLines(10));
  expect((await readFileExcerpt(cwd, "edited.ts"))?.lines[0]).toBe("line 1");

  // A different byte count, so the entry is invalidated on size alone — no
  // reliance on how finely two writes are separated in time.
  write("edited.ts", `changed\n${numberedLines(20)}`);
  const after = await readFileExcerpt(cwd, "edited.ts");
  expect(after?.lines[0]).toBe("changed");
  expect(after?.totalLines).toBe(21);
});

test("re-reads a same-size edit, so size alone is not what validates an entry", async () => {
  write("same.ts", numberedLines(5));
  expect((await readFileExcerpt(cwd, "same.ts"))?.lines[0]).toBe("line 1");

  // Same byte count, so only the timestamp separates the two versions. Advanced
  // explicitly rather than trusting two writes to land in different ticks.
  const abs = join(cwd, "same.ts");
  writeFileSync(abs, numberedLines(5).replace("line 1", "LINE 1"));
  const later = new Date(Date.now() + 2000);
  utimesSync(abs, later, later);
  expect((await readFileExcerpt(cwd, "same.ts"))?.lines[0]).toBe("LINE 1");
});

test("keeps one file's cached lines from answering for another", async () => {
  write("one.ts", numberedLines(10));
  write("two.ts", `${"other 1"}\n${"other 2"}\n`);
  expect((await readFileExcerpt(cwd, "one.ts"))?.lines[0]).toBe("line 1");
  expect((await readFileExcerpt(cwd, "two.ts"))?.lines[0]).toBe("other 1");
  expect((await readFileExcerpt(cwd, "one.ts"))?.lines[0]).toBe("line 1");
});
