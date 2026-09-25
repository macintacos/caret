// The build `mise run dev --update <kind>` poses as (EXC-1452). A from-source build has no
// upstream to be behind, so the daemon judges an older real one instead, and the update
// check, What's new and every link in it run the real path against GitHub.

import { RELEASE_TAG } from "@/daemon/update-changes.ts";
import type { UpdateReport } from "@/lib/types.ts";

/** What the update check judges: which install, at which version and commit. */
export type UpdateIdentity = Pick<UpdateReport, "install" | "version" | "commit">;

/** Runs git in the source checkout: trimmed stdout, or null on any failure. */
export type SourceGit = (args: string[]) => string | null;

/** So What's new lists several releases. */
const RELEASES_BACK = 3;
/** Past COMMIT_CAP, so the list ends in "…and N more". */
const COMMITS_BACK = 60;

/** The identity to judge in place of `built`, or null to judge `built` itself. Always
 * null off a dev build, so no installed caret can be made to pose. */
export function devUpdateIdentity(
  raw: string | undefined,
  built: UpdateIdentity,
  git: SourceGit,
): UpdateIdentity | null {
  if (built.install !== "dev") return null;
  if (raw === "release") {
    const tags = git(["tag", "--list", "v*", "--sort=-v:refname"])?.split("\n") ?? [];
    const tag = tags.filter((t) => RELEASE_TAG.test(t))[RELEASES_BACK];
    return tag ? { install: "bundle", version: tag.replace(/^v/, ""), commit: built.commit } : null;
  }
  if (raw === "commit") {
    const commit = git(["rev-parse", "--verify", "--quiet", `origin/trunk~${COMMITS_BACK}`]);
    return commit ? { install: "binary", version: built.version, commit } : null;
  }
  return null;
}

/** git in the checkout this module lives in, the way currentCommit reaches it. */
export function sourceGit(args: string[]): string | null {
  try {
    const r = Bun.spawnSync(["git", "-C", import.meta.dir, ...args]);
    const out = r.exitCode === 0 ? r.stdout.toString().trim() : "";
    return out || null;
  } catch {
    return null; // git not on PATH — spawnSync throws rather than failing.
  }
}
