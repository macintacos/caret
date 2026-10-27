import "@ui/support/setup.ts";
import { describe, expect, test } from "bun:test";

import type { ReleaseNote, UpdateReport, UpdateStatus } from "@core/lib/types";
import { loadUpgradeNotes, type UpgradeNotesDeps, upgradeNotice } from "$lib/upgradeNotes.ts";

// Whether a load announces the releases since the version this browser last saw, and what
// it records. Pure over the update report and the stored record; the read is injected.

const CURRENT: UpdateStatus = { kind: "current" };
const DISABLED: UpdateStatus = { kind: "unavailable", reason: "disabled" };

const report = (over: Partial<UpdateReport> = {}): UpdateReport => ({
  install: "bundle",
  version: "1.5.0",
  commit: "abc1234",
  checkEnabled: true,
  status: CURRENT,
  ...over,
});

describe("upgradeNotice", () => {
  test("a bundle or binary running newer than the record announces from it", () => {
    for (const install of ["bundle", "binary"] as const) {
      expect(upgradeNotice(report({ install }), "1.3.0")).toEqual({
        kind: "announce",
        since: "1.3.0",
      });
    }
  });

  test("announces on any verdict the check reached, a newer release out included", () => {
    const statuses: UpdateStatus[] = [
      { kind: "behind-release", available: "1.6.0", command: "c" },
      { kind: "unknown", reason: "x" },
    ];
    for (const status of statuses) {
      expect(upgradeNotice(report({ status }), "1.4.0").kind).toBe("announce");
    }
  });

  test("first sight records the running version silently", () => {
    expect(upgradeNotice(report(), null)).toEqual({ kind: "record" });
  });

  test("a record that is not a version counts as none", () => {
    expect(upgradeNotice(report(), "garbage")).toEqual({ kind: "record" });
  });

  test("the same version or a downgrade does nothing, under the opt-out too", () => {
    for (const status of [CURRENT, DISABLED]) {
      expect(upgradeNotice(report({ status }), "1.5.0")).toEqual({ kind: "none" });
      expect(upgradeNotice(report({ status }), "1.6.0")).toEqual({ kind: "none" });
    }
  });

  test("the opt-out records an upgrade rather than reading its notes", () => {
    expect(upgradeNotice(report({ status: DISABLED }), "1.3.0")).toEqual({ kind: "record" });
  });

  test("a dev build neither announces nor records", () => {
    const dev = report({ install: "dev", status: { kind: "unavailable", reason: "dev" } });
    expect(upgradeNotice(dev, "1.3.0")).toEqual({ kind: "none" });
    expect(upgradeNotice(dev, null)).toEqual({ kind: "none" });
  });
});

describe("loadUpgradeNotes", () => {
  const NOTES: ReleaseNote[] = [
    { version: "1.5.0", body: "five" },
    { version: "1.4.0", body: "four" },
  ];

  /** Deps over a stored record, logging every record and read. */
  function deps(lastSeen: string | null, read: () => Promise<ReleaseNote[]>) {
    const recorded: string[] = [];
    const asked: string[] = [];
    const d: UpgradeNotesDeps = {
      lastSeen,
      record: (version) => recorded.push(version),
      notesSince: (since) => {
        asked.push(since);
        return read();
      },
    };
    return { d, recorded, asked };
  }

  test("an upgrade answers the notes since the record and leaves it for the dismissal", async () => {
    const { d, recorded, asked } = deps("1.3.0", async () => NOTES);
    expect(await loadUpgradeNotes(report(), d)).toEqual(NOTES);
    expect(asked).toEqual(["1.3.0"]);
    expect(recorded).toEqual([]);
  });

  test("a failed read answers null and keeps the record, so the next load retries", async () => {
    const { d, recorded } = deps("1.3.0", () => Promise.reject(new Error("502")));
    expect(await loadUpgradeNotes(report(), d)).toBeNull();
    expect(recorded).toEqual([]);
  });

  test("an upgrade with no published notes records the running version", async () => {
    const { d, recorded } = deps("1.4.0", async () => []);
    expect(await loadUpgradeNotes(report(), d)).toBeNull();
    expect(recorded).toEqual(["1.5.0"]);
  });

  test("first sight records the running version without a read", async () => {
    const { d, recorded, asked } = deps(null, async () => NOTES);
    expect(await loadUpgradeNotes(report(), d)).toBeNull();
    expect(recorded).toEqual(["1.5.0"]);
    expect(asked).toEqual([]);
  });

  test("nothing to announce makes no read and no record", async () => {
    const { d, recorded, asked } = deps("1.5.0", async () => NOTES);
    expect(await loadUpgradeNotes(report(), d)).toBeNull();
    expect(recorded).toEqual([]);
    expect(asked).toEqual([]);
  });
});
