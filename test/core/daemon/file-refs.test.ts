import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bootDaemon, type TestDaemon } from "@test/support/daemon.ts";
import type { FileExcerpt } from "@/lib/types.ts";
import { EXCERPT_RADIUS, MAX_EXCERPT_BYTES } from "@/plan/excerpt.ts";

// The two review-scoped file routes back the plan view's filename hover (EXC-687).
// Both key off the review record's own cwd (never a client-supplied base), and
// both refuse to read outside it — the daemon must not become an arbitrary
// local-file reader even though it binds loopback-only.

let store: string; // the daemon's own state dir
let cwd: string; // the review's project dir, populated with real files
let d: TestDaemon;

beforeEach(async () => {
  store = mkdtempSync(join(tmpdir(), "caret-frefs-store-"));
  cwd = mkdtempSync(join(tmpdir(), "caret-frefs-cwd-"));
  d = await bootDaemon(store);
});
afterEach(() => {
  d.stop();
  rmSync(store, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const abs = join(cwd, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

function numbered(n: number): string {
  return `${Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n")}\n`;
}

async function fileRefs(id: string, paths: string[]): Promise<Response> {
  return fetch(`${d.url}/api/reviews/${id}/file-refs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  });
}

function fileExcerpt(
  id: string,
  path: string,
  line?: number,
  range?: { start: number; end: number },
): Promise<Response> {
  const q = new URLSearchParams({
    path,
    ...(line === undefined ? {} : { line: String(line) }),
    ...(range === undefined ? {} : { start: String(range.start), end: String(range.end) }),
  });
  return fetch(`${d.url}/api/reviews/${id}/file?${q}`);
}

// ----- POST /api/reviews/:id/file-refs -----

test("file-refs returns only the paths that resolve to a real file", async () => {
  write("src/foo.ts", "x");
  const id = await d.seed({ cwd });
  const res = await fileRefs(id, ["src/foo.ts", "src/ghost.ts"]);
  expect(res.status).toBe(200);
  expect((await res.json()) as { resolved: string[] }).toEqual({ resolved: ["src/foo.ts"] });
});

test("file-refs 404s for an unknown review", async () => {
  expect((await fileRefs("nope", ["src/foo.ts"])).status).toBe(404);
});

test("file-refs tolerates a malformed body", async () => {
  const id = await d.seed({ cwd });
  const res = await fetch(`${d.url}/api/reviews/${id}/file-refs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not json",
  });
  expect(res.status).toBe(200);
  expect((await res.json()) as { resolved: string[] }).toEqual({ resolved: [] });
});

// ----- GET /api/reviews/:id/file -----

test("file returns a line-centered excerpt for a real file", async () => {
  write("a.ts", numbered(100));
  const id = await d.seed({ cwd });
  const res = await fileExcerpt(id, "a.ts", 50);
  expect(res.status).toBe(200);
  const ex = (await res.json()) as FileExcerpt;
  expect(ex.path).toBe("a.ts");
  expect(ex.language).toBe("typescript");
  // A window of ±EXCERPT_RADIUS centered on line 50, well inside the 100-line file.
  expect(ex.startLine).toBe(50 - EXCERPT_RADIUS);
  expect(ex.endLine).toBe(50 + EXCERPT_RADIUS);
  expect(ex.lines[0]).toBe(`line ${50 - EXCERPT_RADIUS}`);
  expect(ex.totalLines).toBe(100);
});

test("file 404s for a path that resolves to nothing", async () => {
  const id = await d.seed({ cwd });
  expect((await fileExcerpt(id, "ghost.ts")).status).toBe(404);
});

test("file refuses a ../ escape and an absolute path outside cwd", async () => {
  const id = await d.seed({ cwd });
  expect((await fileExcerpt(id, "../../etc/hosts")).status).toBe(404);
  expect((await fileExcerpt(id, "/etc/hosts")).status).toBe(404);
});

test("file 404s for an unknown review", async () => {
  expect((await fileExcerpt("nope", "a.ts")).status).toBe(404);
});

test("file honours an explicit start/end window over the line", async () => {
  write("a.ts", numbered(300));
  const id = await d.seed({ cwd });
  const res = await fileExcerpt(id, "a.ts", 50, { start: 100, end: 160 });
  expect(res.status).toBe(200);
  const ex = (await res.json()) as FileExcerpt;
  expect(ex.startLine).toBe(100);
  expect(ex.endLine).toBe(160);
  expect(ex.lines[0]).toBe("line 100");
});

test("file clamps a window wider than the file to the whole file", async () => {
  write("a.ts", numbered(30));
  const id = await d.seed({ cwd });
  const ex = (await (
    await fileExcerpt(id, "a.ts", undefined, { start: 1, end: 9999 })
  ).json()) as FileExcerpt;
  expect(ex.startLine).toBe(1);
  expect(ex.endLine).toBe(30);
  expect(ex.lines).toHaveLength(30);
});

test("file ignores a half-supplied or non-numeric window", async () => {
  write("a.ts", numbered(300));
  const id = await d.seed({ cwd });
  const q = new URLSearchParams({ path: "a.ts", line: "50", start: "100" });
  const ex = (await (await fetch(`${d.url}/api/reviews/${id}/file?${q}`)).json()) as FileExcerpt;
  expect(ex.startLine).toBe(50 - EXCERPT_RADIUS);
  expect(ex.endLine).toBe(50 + EXCERPT_RADIUS);
});

test("file 413s for a file too large to preview", async () => {
  write("huge.ts", "x".repeat(MAX_EXCERPT_BYTES + 1));
  const id = await d.seed({ cwd });
  expect((await fileExcerpt(id, "huge.ts")).status).toBe(413);
});

test("file 404s rather than 413s for binary content", async () => {
  write("bin.dat", "abc\0def");
  const id = await d.seed({ cwd });
  expect((await fileExcerpt(id, "bin.dat")).status).toBe(404);
});

test("file still refuses an escaping path when a window is supplied", async () => {
  const id = await d.seed({ cwd });
  expect((await fileExcerpt(id, "../../etc/hosts", undefined, { start: 1, end: 50 })).status).toBe(
    404,
  );
});
