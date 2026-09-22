// How `caret doctor` renders OpenCode's upgrade verdict as one of its checks. The suite
// lives here rather than under test/core/ because the verdict is OpenCode's vocabulary;
// the core check layer never sees it.

import { expect, test } from "bun:test";

import type { UpgradeVerdict } from "@/adapters/opencode/upgrade.ts";
import { opencodeVersionCheck } from "@/commands/doctor.ts";
import { upgradeVerdictLine } from "@/commands/install/prompt.ts";

const STALE_CACHE: UpgradeVerdict = { kind: "stale-cache", cached: "0.8.0", published: "0.9.0" };
const STALE_PIN: UpgradeVerdict = {
  kind: "stale-pin",
  entry: "@macintacos/caret@0.8.0",
  pinned: "0.8.0",
  published: "0.9.0",
};

test("a settled verdict passes", () => {
  expect(opencodeVersionCheck({ kind: "fresh" }).status).toBe("pass");
  expect(opencodeVersionCheck({ kind: "current", version: "0.9.0" }).status).toBe("pass");
});

test("either staleness fails and names the flag that closes it", () => {
  for (const verdict of [STALE_CACHE, STALE_PIN]) {
    const check = opencodeVersionCheck(verdict);
    expect(check.status).toBe("fail");
    expect(check.status === "fail" && check.remedy).toContain("--refresh");
  }
});

test("the two stale kinds get their own remedies — a cache is cleared, a pin is bumped", () => {
  const cache = opencodeVersionCheck(STALE_CACHE);
  const pin = opencodeVersionCheck(STALE_PIN);
  expect(cache.status === "fail" && pin.status === "fail" && cache.remedy).not.toBe(
    pin.status === "fail" ? pin.remedy : "",
  );
});

test("an unreadable verdict is unknown and carries its reason", () => {
  const check = opencodeVersionCheck({ kind: "unknown", reason: "no network" });
  expect(check.status).toBe("unknown");
  expect(check.status === "unknown" && check.reason).toBe("no network");
});

test("the detail is the same line install prints, so neither can drift", () => {
  expect(opencodeVersionCheck(STALE_PIN).detail).toBe(upgradeVerdictLine(STALE_PIN));
});
