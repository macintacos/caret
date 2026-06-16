// Barrel for the release pipeline's orchestration: baseline / compute / prepare /
// finalize, the resume state machine that makes every step safe to re-run after a
// partial failure, the injected collaborators (Deps/FsOps/Io), the shared guards
// (GuardError), and the result/context shapes. The implementations live one per
// file under ./steps/; cli.ts and the steps test import them through here. The
// version is always derived from the latest tag — never from an agent-supplied
// value — so the "agent never invents the version" guarantee holds.

export { baseline } from "./steps/baseline.ts";
export { compute } from "./steps/compute.ts";
export {
  BASELINE_TAG,
  type BaselineResult,
  CHANGELOG_PATH,
  type FinalizeResult,
  gatherContext,
  MANIFESTS,
  type PrepareResult,
  type ReleaseContext,
  readSyncedVersion,
} from "./steps/context.ts";
export type { Deps, FsOps, Io } from "./steps/deps.ts";
export { finalize } from "./steps/finalize.ts";
export { createNpm, type NpmOps } from "./npm.ts";
export {
  assertBranch,
  assertCleanTree,
  assertRepoAndGh,
  GuardError,
  offendingPaths,
  syncedVersion,
} from "./steps/guards.ts";
export { prepare } from "./steps/prepare.ts";
