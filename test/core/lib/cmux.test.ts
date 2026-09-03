import { expect, test } from "bun:test";

import { recordingLog } from "@test/support/recording-log.ts";
import { markPaneRead, readCmuxPane } from "@/lib/cmux.ts";

test("readCmuxPane returns the pane when both ids are set", () => {
  expect(readCmuxPane({ CMUX_WORKSPACE_ID: "w1", CMUX_SURFACE_ID: "s1" })).toEqual({
    workspaceId: "w1",
    surfaceId: "s1",
  });
});

test("readCmuxPane returns undefined when only the workspace id is set", () => {
  expect(readCmuxPane({ CMUX_WORKSPACE_ID: "w1" })).toBeUndefined();
});

test("readCmuxPane returns undefined when only the surface id is set", () => {
  expect(readCmuxPane({ CMUX_SURFACE_ID: "s1" })).toBeUndefined();
});

test("readCmuxPane returns undefined outside cmux (neither id set)", () => {
  expect(readCmuxPane({})).toBeUndefined();
});

test("readCmuxPane treats an empty id as absent", () => {
  expect(readCmuxPane({ CMUX_WORKSPACE_ID: "", CMUX_SURFACE_ID: "s1" })).toBeUndefined();
  expect(readCmuxPane({ CMUX_WORKSPACE_ID: "w1", CMUX_SURFACE_ID: "" })).toBeUndefined();
});

// ---- markPaneRead ----

const pane = { workspaceId: "w1", surfaceId: "s1" };

/** Record the argv a spawn would have run, without spawning anything. */
function recordingSpawn() {
  const calls: string[][] = [];
  const spawn = ((argv: string[]) => {
    calls.push(argv);
    return { unref: () => {} };
  }) as unknown as typeof Bun.spawn;
  return { calls, spawn };
}

/** A spawn stand-in that always throws — cmux absent from PATH. */
const throwingSpawn = (() => {
  throw new Error("ENOENT: cmux");
}) as unknown as typeof Bun.spawn;

test("markPaneRead clears exactly the named pane", () => {
  const { calls, spawn } = recordingSpawn();
  markPaneRead(pane, { spawn });
  expect(calls).toHaveLength(1);
  expect(calls[0]).toEqual([
    "cmux",
    "mark-notification-read",
    "--workspace",
    "w1",
    "--surface",
    "s1",
  ]);
});

test("markPaneRead never clears a whole workspace", () => {
  const { calls, spawn } = recordingSpawn();
  markPaneRead(pane, { spawn });
  expect(calls[0]).not.toContain("--all");
});

test("markPaneRead swallows a spawn failure (cmux absent from PATH)", () => {
  expect(() => markPaneRead(pane, { spawn: throwingSpawn })).not.toThrow();
});

test("markPaneRead warns rather than errors on a spawn failure", () => {
  const log = recordingLog();
  markPaneRead(pane, { spawn: throwingSpawn, log: log.log });
  const rec = log.recs.find((r) => r.step === "spawn");
  expect(rec?.level).toBe("warn");
});

test("markPaneRead never logs the opaque pane ids", () => {
  const log = recordingLog();
  markPaneRead(pane, { spawn: throwingSpawn, log: log.log });
  expect(JSON.stringify(log.recs)).not.toContain("w1");
  expect(JSON.stringify(log.recs)).not.toContain("s1");
});
