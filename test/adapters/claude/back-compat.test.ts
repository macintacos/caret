// Falsifiable back-compat (EXC-516): an on-disk review record written in the
// pre-epic `acceptMode` format must still parse and resolve to the correct approve
// variant. The fixture in the sibling fixtures/ dir is a checked-in artifact in that
// pre-epic shape; the assertion runs through the REAL read path — the daemon's
// persisted-decision serve — not a hand-rolled parser. If a future change strands
// that file, this test fails.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bootDaemon, type TestDaemon } from "@test/support/daemon.ts";
import { APPROVE_VARIANTS } from "@/adapters/claude/approve.ts";

const FIXTURES = join(import.meta.dir, "fixtures");

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-backcompat-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("a pre-epic review record's decision.acceptMode survives the persisted-decision serve", async () => {
  // Drop the checked-in approved review (carrying decision.acceptMode) into a
  // fresh daemon's reviews dir. rehydrate() leaves an approved review on disk, so
  // GET /decision falls to the persisted-recovery path — the real wire surface a
  // reconnecting hook hits — and serves the stored decision verbatim.
  await mkdir(dir, { recursive: true });
  const id = "pre-epic-review-0001";
  await copyFile(join(FIXTURES, "review-pre-epic.json"), join(dir, `${id}.json`));

  let d: TestDaemon | undefined;
  try {
    d = await bootDaemon(dir, { approveVariants: APPROVE_VARIANTS });
    // White-box: the store parses the pre-epic file straight through.
    const persisted = await d.store.persisted(id);
    expect(persisted?.decision?.acceptMode).toBe("auto");

    // Wire path: the daemon serves the persisted decision (the reconnect path).
    const res = await fetch(`${d.url}/api/reviews/${id}/decision`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ behavior: "allow", acceptMode: "auto" });
  } finally {
    d?.stop();
  }
});
