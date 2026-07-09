import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileExcerpt } from "../../src/types.ts";
import { bootDaemon, type TestDaemon } from "../support/daemon.ts";

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

function fileExcerpt(id: string, path: string, line?: number): Promise<Response> {
  const q = new URLSearchParams({ path, ...(line === undefined ? {} : { line: String(line) }) });
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
  expect(ex.startLine).toBe(38);
  expect(ex.endLine).toBe(62);
  expect(ex.lines[0]).toBe("line 38");
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
