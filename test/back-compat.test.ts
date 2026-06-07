// Falsifiable back-compat (EXC-516): prefs and on-disk review records written in
// the pre-epic `acceptMode` format must still parse and resolve to the correct
// approve variant after the daemon/prefs decoupling. The fixtures under
// test/fixtures/ are checked-in artifacts in that pre-epic shape; the assertions
// run through the REAL read paths (readApproveMode for prefs; the daemon's
// persisted-decision serve for a review record), not a hand-rolled parser. If a
// future change strands those files, these tests fail.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APPROVE_VARIANTS } from "../src/adapters/claude/approve.ts";
import { type ApproveModeSet, readApproveMode } from "../src/prefs.ts";
import { bootDaemon, type TestDaemon } from "./support/daemon.ts";

const FIXTURES = join(import.meta.dir, "fixtures");

// The recognized set the Claude-paired daemon derives from its declared variants
// — what the resolve/prefs persistence gates incoming and stored ids against.
const CLAUDE_SET: ApproveModeSet = {
  valid: APPROVE_VARIANTS.map((v) => v.id),
  fallback: APPROVE_VARIANTS[0]?.id ?? "default",
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-backcompat-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("a pre-epic prefs file ({approveMode:'acceptEdits'}) still resolves to that variant", async () => {
  // The real prefs read path, gated against the Claude-declared set: the legacy
  // token is a recognized variant id, so it round-trips rather than degrading.
  const mode = await readApproveMode(join(FIXTURES, "prefs-pre-epic.json"), undefined, CLAUDE_SET);
  expect(mode).toBe("acceptEdits");
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
