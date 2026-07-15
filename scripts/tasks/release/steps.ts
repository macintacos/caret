// Barrel for the release pipeline's orchestration: baseline / compute / prepare /
// finalize, the resume state machine that makes every step safe to re-run after a
// partial failure, the injected collaborators (Deps/FsOps/Io), the shared guards
// (GuardError), and the result/context shapes. The implementations live one per
// file under ./steps/; cli.ts and the steps test import them through here. The
// version is always derived from the latest tag — never from an agent-supplied
// value — so the "agent never invents the version" guarantee holds.

export { createNpm, type NpmOps } from "@/tasks/release/npm.ts";
export { createRumdl, type RumdlOps } from "@/tasks/release/rumdl.ts";
export { baseline } from "@/tasks/release/steps/baseline.ts";
export { compute } from "@/tasks/release/steps/compute.ts";
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
} from "@/tasks/release/steps/context.ts";
export type { Deps, FsOps, Io } from "@/tasks/release/steps/deps.ts";
export { finalize } from "@/tasks/release/steps/finalize.ts";
export {
  assertBranch,
  assertCleanTree,
  assertRepoAndGh,
  GuardError,
  offendingPaths,
  syncedVersion,
} from "@/tasks/release/steps/guards.ts";
export { prepare } from "@/tasks/release/steps/prepare.ts";
