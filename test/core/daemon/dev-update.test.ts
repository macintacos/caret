import { expect, test } from "bun:test";

import { devUpdateFor } from "@/daemon/dev-update.ts";
import { isNewer } from "@/lib/semver.ts";

const DEV = { install: "dev", version: "1.4.2", commit: "abc1234" } as const;

test("a non-dev build never stages an update, whatever the variable says", () => {
  expect(devUpdateFor("release", { ...DEV, install: "bundle" })).toBe(null);
  expect(devUpdateFor("commit", { ...DEV, install: "binary" })).toBe(null);
});

test("a dev build stages nothing when the variable is unset or unrecognized", () => {
  expect(devUpdateFor(undefined, DEV)).toBe(null);
  expect(devUpdateFor("", DEV)).toBe(null);
  expect(devUpdateFor("releases", DEV)).toBe(null);
});

test("release: a bundle behind a newer release, listing only releases in (running, available]", () => {
  const update = devUpdateFor("release", DEV);
  if (update?.status.kind !== "behind-release" || update.changes.kind !== "releases") {
    throw new Error(`unexpected mock: ${JSON.stringify(update)}`);
  }
  expect(update.install).toBe("bundle");
  const { available } = update.status;
  expect(update.changes.releases[0]?.version).toBe(available);
  for (const r of update.changes.releases) {
    expect(isNewer(r.version, DEV.version)).toBe(true);
    expect(isNewer(r.version, available)).toBe(false);
  }
});

test("commit: a binary behind trunk, whose listed and unlisted commits add up to aheadBy", () => {
  const update = devUpdateFor("commit", DEV);
  if (update?.status.kind !== "behind-commit" || update.changes.kind !== "commits") {
    throw new Error(`unexpected mock: ${JSON.stringify(update)}`);
  }
  expect(update.install).toBe("binary");
  expect(update.changes.commits.length + update.changes.more).toBe(update.status.aheadBy);
  expect(update.changes.more).toBeGreaterThan(0);
});
