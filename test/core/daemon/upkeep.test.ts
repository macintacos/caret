import { expect, test } from "bun:test";

import { recordingLog } from "@test/support/recording-log.ts";
import { startUpkeep, type UpkeepTask } from "@/daemon/upkeep.ts";

// Captures the tick so a test runs it directly instead of waiting out an hour.
function manualSchedule() {
  const armed: Array<{ fn: () => void; ms: number }> = [];
  return {
    armed,
    schedule: (fn: () => void, ms: number) => armed.push({ fn, ms }),
    tick: () => {
      for (const { fn } of armed) fn();
    },
  };
}

function task(name: string, run: () => void): UpkeepTask {
  return { name, run };
}

test("every task runs on a tick", () => {
  const { log } = recordingLog();
  const sched = manualSchedule();
  const ran: string[] = [];
  startUpkeep({
    tasks: [task("a", () => ran.push("a")), task("b", () => ran.push("b"))],
    log,
    schedule: sched.schedule,
  });
  expect(ran).toEqual([]);
  sched.tick();
  expect(ran).toEqual(["a", "b"]);
  sched.tick();
  expect(ran).toEqual(["a", "b", "a", "b"]);
});

test("a throwing task neither escapes nor stops its siblings", () => {
  const { recs, log } = recordingLog();
  const sched = manualSchedule();
  const ran: string[] = [];
  startUpkeep({
    tasks: [
      task("boom", () => {
        throw new Error("nope");
      }),
      task("after", () => ran.push("after")),
    ],
    log,
    schedule: sched.schedule,
  });
  expect(() => sched.tick()).not.toThrow();
  expect(ran).toEqual(["after"]);
  const warns = recs.filter((r) => r.step === "upkeep" && r.level === "warn");
  expect(warns).toHaveLength(1);
  expect(warns[0]?.extra).toMatchObject({ detail: "nope" });
});

test("an empty task list schedules nothing", () => {
  const { recs, log } = recordingLog();
  const sched = manualSchedule();
  expect(startUpkeep({ tasks: [], log, schedule: sched.schedule })).toEqual([]);
  expect(sched.armed).toEqual([]);
  expect(recs).toEqual([]);
});

test("arming logs one record naming the tasks", () => {
  const { recs, log } = recordingLog();
  const sched = manualSchedule();
  expect(
    startUpkeep({ tasks: [task("a", () => {})], log, schedule: sched.schedule, everyMs: 5 }),
  ).toEqual(["a"]);
  expect(sched.armed).toHaveLength(1);
  expect(sched.armed[0]?.ms).toBe(5);
  const arms = recs.filter((r) => r.step === "upkeep");
  expect(arms).toHaveLength(1);
  expect(arms[0]?.level).toBe("info");
  expect(arms[0]?.extra).toMatchObject({ tasks: ["a"] });
});
