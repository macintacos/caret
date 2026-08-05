import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bootDaemon, type TestDaemon } from "@test/support/daemon.ts";
import { recordingLog } from "@test/support/recording-log.ts";
import { expectNeverLogsBody } from "@test/support/redaction.ts";
import type { DirListing } from "@/lib/types.ts";
import { MAX_DIR_DEPTH, MAX_DIR_ENTRIES } from "@/plan/directory.ts";

// GET /api/reviews/:id/dir serves ONE level of a directory a plan referenced, so
// the folder preview can expand lazily (EXC-917). It reuses the same cwd-confined
// resolution the file routes use, so the escape assertions below matter as much
// as the happy path: the daemon must not become an arbitrary local-directory
// lister any more than it is an arbitrary file reader.

let store: string; // the daemon's own state dir
let cwd: string; // the review's project dir, populated with real files
let d: TestDaemon;

beforeEach(async () => {
  store = mkdtempSync(join(tmpdir(), "caret-dir-store-"));
  cwd = mkdtempSync(join(tmpdir(), "caret-dir-cwd-"));
  d = await bootDaemon(store);
});
afterEach(() => {
  d.stop();
  rmSync(store, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function write(rel: string, content = "x"): void {
  const abs = join(cwd, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

function dir(rel: string): void {
  mkdirSync(join(cwd, rel), { recursive: true });
}

function listing(id: string, root: string, path?: string): Promise<Response> {
  const q = new URLSearchParams({ root, ...(path === undefined ? {} : { path }) });
  return fetch(`${d.url}/api/reviews/${id}/dir?${q}`);
}

async function listed(id: string, root: string, path?: string): Promise<DirListing> {
  const res = await listing(id, root, path);
  expect(res.status).toBe(200);
  return (await res.json()) as DirListing;
}

test("dir returns one level of immediate children with their kinds", async () => {
  write("src/a.ts");
  write("src/nested/deep.ts");
  const id = await d.seed({ cwd });
  const body = await listed(id, "src");
  expect(body.path).toBe("src");
  expect(body.entries).toEqual([
    { name: "nested", kind: "directory" },
    { name: "a.ts", kind: "file" },
  ]);
  expect(body.total).toBe(2);
});

test("dir sorts directories before files, alphabetically within each", async () => {
  write("src/zebra.ts");
  write("src/apple.ts");
  dir("src/zulu");
  dir("src/alpha");
  const id = await d.seed({ cwd });
  expect((await listed(id, "src")).entries.map((e) => e.name)).toEqual([
    "alpha",
    "zulu",
    "apple.ts",
    "zebra.ts",
  ]);
});

test("dir marks the skip set and dotted directories rather than enumerating them", async () => {
  write("src/node_modules/pkg/index.js");
  write("src/dist/bundle.js");
  write("src/.git/HEAD");
  write("src/keep.ts");
  const id = await d.seed({ cwd });
  const body = await listed(id, "src");
  expect(body.entries).toEqual([
    { name: ".git", kind: "directory", skipped: true },
    { name: "dist", kind: "directory", skipped: true },
    { name: "node_modules", kind: "directory", skipped: true },
    { name: "keep.ts", kind: "file" },
  ]);
});

test("dir truncates a wide level and reports the true total", async () => {
  dir("wide");
  for (let i = 0; i < MAX_DIR_ENTRIES + 7; i++) {
    write(`wide/f${String(i).padStart(4, "0")}.ts`);
  }
  const id = await d.seed({ cwd });
  const body = await listed(id, "wide");
  expect(body.entries).toHaveLength(MAX_DIR_ENTRIES);
  expect(body.total).toBe(MAX_DIR_ENTRIES + 7);
  // The cap keeps the sort's head, so what the reader sees is the level's start.
  expect(body.entries[0]?.name).toBe("f0000.ts");
});

test("dir lists the root itself when no path is given", async () => {
  write("src/a.ts");
  const id = await d.seed({ cwd });
  expect((await listed(id, "src")).path).toBe("src");
});

test("dir serves a descendant exactly MAX_DIR_DEPTH below the root", async () => {
  const deep = Array.from({ length: MAX_DIR_DEPTH }, (_, i) => `d${i}`).join("/");
  write(`root/${deep}/leaf.ts`);
  const id = await d.seed({ cwd });
  const body = await listed(id, "root", `root/${deep}`);
  expect(body.entries).toEqual([{ name: "leaf.ts", kind: "file" }]);
});

test("dir refuses a descendant deeper than MAX_DIR_DEPTH below the root", async () => {
  const deep = Array.from({ length: MAX_DIR_DEPTH + 1 }, (_, i) => `d${i}`).join("/");
  write(`root/${deep}/leaf.ts`);
  const id = await d.seed({ cwd });
  expect((await listing(id, "root", `root/${deep}`)).status).toBe(404);
});

test("dir refuses a path outside the referenced root", async () => {
  write("src/a.ts");
  write("other/b.ts");
  const id = await d.seed({ cwd });
  // `other` resolves perfectly well inside cwd — it is simply not under `src`.
  expect((await listing(id, "src", "other")).status).toBe(404);
});

test("dir refuses a root that escapes the review's cwd", async () => {
  const id = await d.seed({ cwd });
  expect((await listing(id, "../..")).status).toBe(404);
  expect((await listing(id, "/etc")).status).toBe(404);
});

test("dir refuses a path that escapes the cwd even when the root is legitimate", async () => {
  write("src/a.ts");
  const id = await d.seed({ cwd });
  expect((await listing(id, "src", "src/../../..")).status).toBe(404);
});

test("dir refuses a symlinked directory pointing outside the cwd", async () => {
  const outside = mkdtempSync(join(tmpdir(), "caret-dir-outside-"));
  writeFileSync(join(outside, "secret.ts"), "x");
  try {
    symlinkSync(outside, join(cwd, "escape"));
    const id = await d.seed({ cwd });
    expect((await listing(id, "escape")).status).toBe(404);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("dir 404s for a file, a missing directory, a missing root, and an unknown review", async () => {
  write("src/a.ts");
  const id = await d.seed({ cwd });
  expect((await listing(id, "src/a.ts")).status).toBe(404);
  expect((await listing(id, "ghost")).status).toBe(404);
  expect((await fetch(`${d.url}/api/reviews/${id}/dir`)).status).toBe(404);
  expect((await listing("nope", "src")).status).toBe(404);
});

test("dir logs entry counts at debug level and never an entry name", async () => {
  const { recs, log } = recordingLog();
  const logged = await bootDaemon(store, { log });
  try {
    write("src/top-secret-filename.ts");
    dir("src/confidential-directory");
    const id = await logged.seed({ cwd });
    const res = await fetch(`${logged.url}/api/reviews/${id}/dir?root=src`);
    expect(res.status).toBe(200);
    const rec = recs.find((r) => r.msg.startsWith("dir listed"));
    expect(rec?.level).toBe("debug");
    expect(rec?.step).toBe("request");
    expect(rec?.extra).toMatchObject({ reviewId: id, total: 2, returned: 2 });
    expectNeverLogsBody(recs, ["top-secret-filename.ts", "confidential-directory"]);
  } finally {
    logged.stop();
  }
});
