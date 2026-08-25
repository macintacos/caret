import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type BootOptions, bootDaemon, type TestDaemon } from "@test/support/daemon.ts";
import { recordingLog } from "@test/support/recording-log.ts";
import type { SkillDescriptionResponse } from "@/lib/types.ts";

// GET /api/reviews/:id/skill-description backs the Ctrl+Space preview panel over
// the `/` completion list (EXC-1186): the browser holds no filesystem, so the
// daemon reads the one skill the reviewer highlighted.
//
// A second route beside /skills rather than a field on it — the list names
// skills, this reads one — so the route half is what this suite owns: the wire
// body, the 404s, and what reaches the log. Which file an origin resolves to is
// the adapter's, pinned in test/adapters/; the capability arrives here as an
// injected dep so this suite never reaches into src/adapters/ (test-layout: no
// agent vocabulary in core).

let store: string;
let d: TestDaemon;

beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "caret-skilldesc-"));
});
afterEach(() => {
  d.stop();
  rmSync(store, { recursive: true, force: true });
});

async function boot(opts: BootOptions = {}): Promise<void> {
  d = await bootDaemon(store, opts);
}

function ask(id: string, name: string, origin: string): Promise<Response> {
  const params = new URLSearchParams({ name, origin });
  return fetch(`${d.url}/api/reviews/${id}/skill-description?${params}`);
}

test("serves the description the adapter read, for that name and origin", async () => {
  const seen: Array<[string, string, string]> = [];
  await boot({
    readSkillDescription: async (cwd: string, name: string, origin: string) => {
      seen.push([cwd, name, origin]);
      return "Plan a change before writing it";
    },
  });
  const id = await d.seed({ cwd: "/w/caret" });
  const res = await ask(id, "brainstorming", "user");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    description: "Plan a change before writing it",
  } satisfies SkillDescriptionResponse);
  // The review's own cwd, and the row's own origin — which is what tells two
  // roots offering the same bare name apart.
  expect(seen).toEqual([["/w/caret", "brainstorming", "user"]]);
});

test("a skill with no description answers null, not a failure", async () => {
  await boot({ readSkillDescription: async () => null });
  const id = await d.seed();
  const res = await ask(id, "git", "user");
  // 200 with a null body, deliberately: "this skill says nothing about itself"
  // is an answer the panel renders, and a 404 would make the UI show it as the
  // route being missing instead.
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ description: null } satisfies SkillDescriptionResponse);
});

test("404s when the daemon wires no description capability", async () => {
  // The same posture /skills and /diagnostics take for an absent optional
  // capability — and the posture the e2e fixture daemon relies on.
  await boot();
  const id = await d.seed();
  expect((await ask(id, "git", "user")).status).toBe(404);
});

test("404s for an unknown review id", async () => {
  await boot({ readSkillDescription: async () => "x" });
  expect((await ask("does-not-exist", "git", "user")).status).toBe(404);
});

test("a request naming no skill still answers rather than erroring", async () => {
  const seen: string[] = [];
  await boot({
    readSkillDescription: async (_cwd: string, name: string) => {
      seen.push(name);
      return null;
    },
  });
  const id = await d.seed();
  const res = await fetch(`${d.url}/api/reviews/${id}/skill-description`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ description: null } satisfies SkillDescriptionResponse);
  expect(seen).toEqual([""]);
});

test("logs that the route answered, and never the description", async () => {
  const { recs, log } = recordingLog();
  await boot({ readSkillDescription: async () => "Fold the laundry before it creases", log });
  const id = await d.seed();
  await ask(id, "laundry", "user");
  const record = recs.find((r) => r.msg.includes("skill description"));
  // `debug`, because this fires once per highlighted row — the cadence
  // logging-rules.md reserves the level for.
  expect(record?.level).toBe("debug");
  expect(record?.extra).toMatchObject({ reviewId: id });
  // A description is the reviewer's own configuration, so the record says only
  // that one was asked for — never the text, and never the name.
  expect(JSON.stringify(recs)).not.toContain("laundry");
  expect(JSON.stringify(recs)).not.toContain("creases");
});
