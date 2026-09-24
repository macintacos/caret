// One review's failures, written by the real hook and daemon loggers and read back by
// the real doctor reader, surface as one group carrying both sinks' codes.
import { afterEach, expect, test } from "bun:test";

import { doctorDeps } from "@test/support/doctor-deps.ts";
import { setupTempStateDir } from "@test/support/env.ts";
import { daemonLogFile, logFile } from "@/config/paths.ts";
import { collectReport, logErrorRecords, logStats, renderStdout } from "@/doctor/report.ts";
import { createDaemonLogger, logError, resetHookLogger, setLogContext } from "@/lib/log.ts";

setupTempStateDir("caret-failures-");
afterEach(resetHookLogger);

test("a review's hook and daemon failures surface as one group in doctor --json", async () => {
  setLogContext({ reviewId: "rid" });
  logError("longPoll", "review-timeout", new Error("review timed out"));
  createDaemonLogger(() => "info", daemonLogFile())
    .child({ reviewId: "rid" })
    .error("request", "request-failed", new Error("kaboom"));

  const report = await collectReport(
    doctorDeps({
      now: () => new Date(),
      logStats,
      logErrorRecords,
      logPaths: { caret: logFile(), daemon: daemonLogFile(), daemonStderr: "" },
    }),
  );
  const out = JSON.parse(renderStdout({ ...report, checks: [] }, "json"));

  expect(out.failures.groups).toEqual([
    {
      reviewId: "rid",
      records: [
        expect.objectContaining({ source: "hook", code: "review-timeout" }),
        expect.objectContaining({ source: "daemon", code: "request-failed" }),
      ],
    },
  ]);
});
