import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bootDaemon, type TestDaemon } from "@test/support/daemon.ts";
import { recordingLog } from "@test/support/recording-log.ts";
import { expectNeverLogsBody } from "@test/support/redaction.ts";
import type { FileSearchResponse } from "@/lib/types.ts";
import { SEARCH_BUDGET } from "@/plan/file-search.ts";

// POST /api/reviews/:id/file-search backs the `@` completion in the feedback
// editors (EXC-1175): the browser cannot walk a filesystem, so it asks the
// daemon which files under THIS review's cwd match what the reviewer has typed.
//
// The route half is what this suite owns — the wire body, the untrusted request
// body, the single 404, and what reaches the log. The walk's own claims
// (matching, ordering, the caps, containment) are in
// test/core/plan/file-search.test.ts, driven against the module directly so the
// caps can be exercised without writing twenty thousand files.

let store: string; // the daemon's own state dir
let cwd: string; // the review's project dir, populated with real files
let d: TestDaemon;

beforeEach(async () => {
  store = mkdtempSync(join(tmpdir(), "caret-fsearch-store-"));
  cwd = mkdtempSync(join(tmpdir(), "caret-fsearch-cwd-"));
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

function search(id: string, body: unknown): Promise<Response> {
  return fetch(`${d.url}/api/reviews/${id}/file-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function found(id: string, query: string): Promise<FileSearchResponse> {
  const res = await search(id, { query });
  expect(res.status).toBe(200);
  return (await res.json()) as FileSearchResponse;
}

test("file-search answers with the matching paths and a truncation flag", async () => {
  write("src/lib/foo.ts");
  write("src/lib/bar.ts");
  const id = await d.seed({ cwd });
  expect(await found(id, "srlbfoo")).toEqual({ paths: ["src/lib/foo.ts"], truncated: false });
});

test("file-search roots candidates at the review's own cwd", async () => {
  const other = mkdtempSync(join(tmpdir(), "caret-fsearch-other-"));
  try {
    writeFileSync(join(other, "elsewhere.ts"), "x");
    write("here.ts");
    // Two reviews, two working directories: each answers from its own.
    const mine = await d.seed({ cwd });
    const theirs = await d.seed({ cwd: other, sessionId: "other-session" });
    expect((await found(mine, "")).paths).toEqual(["here.ts"]);
    expect((await found(theirs, "")).paths).toEqual(["elsewhere.ts"]);
  } finally {
    rmSync(other, { recursive: true, force: true });
  }
});

test("file-search reports truncation when the result cap stops it", async () => {
  for (let i = 0; i < SEARCH_BUDGET.results + 3; i++) {
    write(`f${String(i).padStart(4, "0")}.ts`);
  }
  const id = await d.seed({ cwd });
  const body = await found(id, "");
  expect(body.paths).toHaveLength(SEARCH_BUDGET.results);
  expect(body.truncated).toBe(true);
});

test("file-search treats the request body as untrusted and degrades to a bare listing", async () => {
  write("a.ts");
  const id = await d.seed({ cwd });
  const bare = { paths: ["a.ts"], truncated: false };
  // Every one of these is a body the schema has to survive without rejecting —
  // the same degrade-don't-reject posture the sibling routes keep.
  expect(await found(id, "")).toEqual(bare);
  expect((await (await search(id, {})).json()) as FileSearchResponse).toEqual(bare);
  expect((await (await search(id, { query: 42 })).json()) as FileSearchResponse).toEqual(bare);
  expect((await (await search(id, { query: null })).json()) as FileSearchResponse).toEqual(bare);
  expect((await (await search(id, [1, 2, 3])).json()) as FileSearchResponse).toEqual(bare);
  expect((await (await search(id, "not json at all")).json()) as FileSearchResponse).toEqual(bare);
});

test("file-search cannot be steered outside the cwd by the query", async () => {
  write("inside.ts");
  const id = await d.seed({ cwd });
  // The query is match text, never a path the route resolves — so a traversal
  // spelling matches nothing rather than reaching anything.
  expect((await found(id, "../")).paths).toEqual([]);
  expect((await found(id, "/etc/passwd")).paths).toEqual([]);
});

test("file-search 404s for an unknown review and for a cwd that is gone", async () => {
  const id = await d.seed({ cwd });
  expect((await search("nope", { query: "" })).status).toBe(404);
  const stale = await d.seed({ cwd: join(cwd, "ghost"), sessionId: "stale-session" });
  expect((await search(stale, { query: "" })).status).toBe(404);
  expect((await search(id, { query: "" })).status).toBe(200);
});

test("file-search is not reachable by GET, so /file keeps its own route", async () => {
  write("a.ts");
  const id = await d.seed({ cwd });
  expect((await fetch(`${d.url}/api/reviews/${id}/file-search`)).status).toBe(404);
});

test("file-search logs counts at debug level and never a query or a path", async () => {
  const { recs, log } = recordingLog();
  const logged = await bootDaemon(store, { log });
  try {
    write("top-secret-filename.ts");
    const id = await logged.seed({ cwd });
    const res = await fetch(`${logged.url}/api/reviews/${id}/file-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "confidential-query" }),
    });
    expect(res.status).toBe(200);
    const requests = recs.filter((r) => r.step === "request");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.level).toBe("debug");
    expect(requests[0]?.extra).toMatchObject({ reviewId: id, returned: 0, truncated: false });
    expectNeverLogsBody(recs, ["top-secret-filename.ts", "confidential-query"]);
  } finally {
    logged.stop();
  }
});
