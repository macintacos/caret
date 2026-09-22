import { afterEach, beforeEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type BundleDeps, runBundle } from "@/doctor/bundle.ts";
import type { ZipEntry } from "@/doctor/zip.ts";

const NOW = new Date("2026-06-04T12:34:56.789Z");

let tmp: string;
let written: { path: string; entries: ZipEntry[] } | null;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "caret-bundle-"));
  written = null;
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function deps(over: Partial<BundleDeps> = {}): BundleDeps {
  return {
    stateDir: tmp,
    logPaths: [join(tmp, "logs", "caret.log"), join(tmp, "logs", "daemon.log")],
    reviewsDir: join(tmp, "reviews"),
    now: () => NOW,
    isInteractive: () => false,
    confirm: async () => true,
    write: (path, entries) => {
      written = { path, entries };
    },
    ...over,
  };
}

async function seed(): Promise<void> {
  await mkdir(join(tmp, "logs"), { recursive: true });
  await mkdir(join(tmp, "logs", "archive"), { recursive: true });
  await mkdir(join(tmp, "reviews"), { recursive: true });
  await writeFile(join(tmp, "logs", "caret.log"), '{"level":30}\n');
  await writeFile(join(tmp, "logs", "archive", "caret-20260101T000000000Z.log.gz"), "gz");
  await writeFile(join(tmp, "reviews", "a.json"), '{"id":"a"}');
  await writeFile(join(tmp, "reviews", "notes.txt"), "not a review");
}

// ---- the consent gate ----

test("--yes writes without asking", async () => {
  await seed();
  let asked = false;
  const outcome = await runBundle(
    { yes: true },
    deps({
      isInteractive: () => true,
      confirm: async () => {
        asked = true;
        return true;
      },
    }),
  );
  expect(outcome.kind).toBe("written");
  expect(asked).toBe(false);
  expect(written).not.toBeNull();
});

test("a terminal is asked, and a yes writes", async () => {
  await seed();
  const outcome = await runBundle(
    { yes: false },
    deps({ isInteractive: () => true, confirm: async () => true }),
  );
  expect(outcome.kind).toBe("written");
  expect(written).not.toBeNull();
});

test("a no writes nothing, and neither does a cancel", async () => {
  await seed();
  for (const answer of [false, null]) {
    const outcome = await runBundle(
      { yes: false },
      deps({ isInteractive: () => true, confirm: async () => answer }),
    );
    expect(outcome.kind).toBe("declined");
    expect(written).toBeNull();
  }
});

test("no terminal and no --yes refuses, naming the flag that would proceed", async () => {
  await seed();
  const outcome = await runBundle({ yes: false }, deps({ isInteractive: () => false }));
  expect(outcome.kind).toBe("refused");
  expect(outcome.kind === "refused" && outcome.message).toContain("--yes");
  expect(written).toBeNull();
});

// ---- membership ----

test("the archive carries the live logs and the review records, and nothing else", async () => {
  await seed();
  await runBundle({ yes: true }, deps());
  expect(written?.entries.map((e) => e.name).sort()).toEqual(["logs/caret.log", "reviews/a.json"]);
});

test("an unreadable or absent member is skipped rather than failing the bundle", async () => {
  await runBundle({ yes: true }, deps());
  expect(written?.entries).toEqual([]);
  expect(written?.path).toContain(tmp);
});

test("review membership stops at 5000 records", async () => {
  await mkdir(join(tmp, "reviews"), { recursive: true });
  for (let i = 0; i <= 5000; i++) {
    writeFileSync(join(tmp, "reviews", `r${String(i).padStart(5, "0")}.json`), '{"id":"r"}');
  }
  await runBundle({ yes: true }, deps());
  expect(written?.entries).toHaveLength(5000);
});

test("the default path is a UTC-stamped archive inside caret's state dir", async () => {
  await seed();
  await runBundle({ yes: true }, deps());
  expect(written?.path).toBe(join(tmp, "doctor-20260604T123456789Z.zip"));
});
