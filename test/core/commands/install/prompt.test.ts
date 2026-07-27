// The copy install owns: the chooser's rows and the upgrade question's wording. The
// multiselect and confirm calls themselves are clack's; what caret owns is which rows it
// offers, how it marks the agents detected on this machine, and what a stale OpenCode is
// told about the version gap.

import { expect, test } from "bun:test";

import type { UpgradeVerdict } from "@/adapters/opencode/upgrade.ts";
import {
  chooserOptions,
  promptUpgrade,
  upgradePromptMessage,
  upgradeVerdictLine,
} from "@/commands/install/prompt.ts";
import { INSTALL_TARGET_IDS } from "@/commands/install/targets.ts";

const STALE_CACHE = { kind: "stale-cache", cached: "0.2.0", published: "0.8.1" } as const;
const STALE_PIN = {
  kind: "stale-pin",
  entry: "@macintacos/caret@0.7.3",
  pinned: "0.7.3",
  published: "0.8.1",
} as const;

test("every registry target gets a row, in registry order", () => {
  expect(chooserOptions([]).map((o) => o.value)).toEqual([...INSTALL_TARGET_IDS]);
});

test("a detected agent's row says so; an undetected one's does not", () => {
  const rows = chooserOptions(["claude"]);
  const claude = rows.find((o) => o.value === "claude");
  const opencode = rows.find((o) => o.value === "opencode");
  expect(claude?.hint).toContain("detected");
  expect(opencode?.hint).not.toContain("detected");
});

test("a stale cache's question names both versions and offers the clear", () => {
  const msg = upgradePromptMessage(STALE_CACHE);
  expect(msg).toContain("0.2.0");
  expect(msg).toContain("0.8.1");
  expect(msg).toContain("Clear the cached copy");
});

test("a stale pin's question names the verbatim entry and offers the bump", () => {
  const msg = upgradePromptMessage(STALE_PIN);
  expect(msg).toContain("@macintacos/caret@0.7.3");
  expect(msg).toContain("0.8.1");
  expect(msg).toContain("Bump the pin");
});

test("every verdict has a line, and only the stale ones name a version gap", () => {
  const lines: Record<UpgradeVerdict["kind"], string> = {
    fresh: upgradeVerdictLine({ kind: "fresh" }),
    current: upgradeVerdictLine({ kind: "current", version: "0.8.1" }),
    "stale-cache": upgradeVerdictLine(STALE_CACHE),
    "stale-pin": upgradeVerdictLine(STALE_PIN),
    unknown: upgradeVerdictLine({ kind: "unknown", reason: "offline" }),
  };
  expect(lines.current).toContain("0.8.1");
  expect(lines["stale-cache"]).toContain("0.2.0");
  expect(lines["stale-pin"]).toContain("@macintacos/caret@0.7.3");
  // A line that could not be read must not read as a verdict about a version.
  expect(lines.unknown).not.toContain("0.8.1");
  expect(Object.values(lines).every((l) => l.length > 0)).toBe(true);
});

test("a cancelled confirm answers null, so the caller changes nothing", async () => {
  const cancelled = Symbol("cancel");
  const answer = await promptUpgrade(STALE_CACHE, {
    confirm: async () => cancelled,
    isCancel: (v) => v === cancelled,
  });
  expect(answer).toBeNull();
});

test("the confirm is asked the verdict's question, and its answer is passed through", async () => {
  const asked: string[] = [];
  const answer = await promptUpgrade(STALE_PIN, {
    confirm: async (o: { message: string }) => {
      asked.push(o.message);
      return false;
    },
    isCancel: () => false,
  });
  expect(answer).toBe(false);
  expect(asked).toEqual([upgradePromptMessage(STALE_PIN)]);
  expect(
    await promptUpgrade(STALE_CACHE, { confirm: async () => true, isCancel: () => false }),
  ).toBe(true);
});
