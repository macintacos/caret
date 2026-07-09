import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EXCERPT_HEAD_LINES,
  EXCERPT_RADIUS,
  readFileExcerpt,
  resolveFileInCwd,
} from "../../src/plan-files.ts";

// plan-files.ts resolves a plan's filename reference to a real file *inside the
// review's cwd* (the daemon's source of truth is the review record, never the
// client) and reads a bounded, line-aware excerpt for the hover preview. The
// containment guard is load-bearing: the daemon must never become an arbitrary
// local-file reader, so `../` and symlink escapes resolve to null.

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
