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
//
// This is also `@/plan/directory.ts`'s suite, rather than a second one at
// test/core/plan/directory.test.ts: every claim it makes is route-shaped (a
// status code, a wire body, a log record), so asserting them over real HTTP is
// asserting them where they are true.

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
  dir("src/nested");
  const id = await d.seed({ cwd });
  expect(await listed(id, "src")).toEqual(await listed(id, "src", "src"));
});

test("dir gives a contained symlink its target's kind and drops one that escapes", async () => {
  const outside = mkdtempSync(join(tmpdir(), "caret-dir-outside-"));
  try {
    write("src/real.ts");
    dir("src/realdir");
    symlinkSync(join(cwd, "src/real.ts"), join(cwd, "src/to-file"));
    symlinkSync(join(cwd, "src/realdir"), join(cwd, "src/to-dir"));
    symlinkSync(outside, join(cwd, "src/to-outside"));
    const id = await d.seed({ cwd });
    const body = await listed(id, "src");
    // A link takes its target's kind, and the escaping one is no row at all —
    // so it is absent from `total` as well as from `entries`.
    expect(body.entries).toEqual([
      { name: "realdir", kind: "directory" },
      { name: "to-dir", kind: "directory" },
      { name: "real.ts", kind: "file" },
      { name: "to-file", kind: "file" },
    ]);
    expect(body.total).toBe(4);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("dir still enumerates a skipped directory when asked for it directly", async () => {
  write("src/node_modules/pkg/index.js");
  const id = await d.seed({ cwd });
  // `skipped` is a hint to the UI, never a refusal here: a plan is entitled to
  // cite `node_modules/foo`, and that citation must still preview.
  expect((await listed(id, "src/node_modules")).entries).toEqual([
    { name: "pkg", kind: "directory" },
  ]);
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
    // Pinned on the record's durable shape — step, level, structured counts —
    // rather than its message prose, which is free to be reworded.
    const requests = recs.filter((r) => r.step === "request");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.level).toBe("debug");
    expect(requests[0]?.extra).toMatchObject({ reviewId: id, total: 2, returned: 2 });
    expectNeverLogsBody(recs, ["top-secret-filename.ts", "confidential-directory"]);
  } finally {
    logged.stop();
  }
});
