// Shared scaffolding for the bun-test suite: env isolation, NDJSON parsing, the
// in-process daemon boot + client, polling, free ports, the recording logger,
// and the never-log-body matcher. Import from here or the individual modules.
export { type BootOptions, bootDaemon, type TestDaemon } from "./daemon.ts";
export { setupTempStateDir, withEnv } from "./env.ts";
export { ndjsonRecords } from "./ndjson.ts";
export { freePort } from "./net.ts";
export { until, waitFor } from "./poll.ts";
export { type RecordedEmit, recordingLog } from "./recording-log.ts";
export { expectNeverLogsBody } from "./redaction.ts";
export {
  CHANGELOG,
  COMMITS,
  type GitHubOptions,
  type GitOptions,
  type HarnessOptions,
  type IoOptions,
  makeReleaseHarness,
  market,
  pkg,
  type ReleaseHarness,
} from "./release-harness.ts";
