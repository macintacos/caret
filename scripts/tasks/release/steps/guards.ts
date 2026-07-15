// The shared guards every release step runs before it mutates anything: the repo
// and gh availability checks, the branch and clean-tree assertions, and the
// manifest-sync check. Each raises a typed GuardError so the CLI can surface a
// machine-readable ErrorCode in its JSON contract.

import type { ErrorCode } from "../contract.ts";
import { assertInSync } from "../manifest.ts";
import type { Deps } from "./deps.ts";

/** A guard rejection carrying the machine-readable ErrorCode for the contract. */
export class GuardError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GuardError";
  }
}

/** Assert we're in a repo with `gh` available; return the repo slug and default branch. */
export async function assertRepoAndGh(
  deps: Deps,
): Promise<{ repoSlug: string; defaultBranch: string }> {
  if (!(await deps.git.isRepo())) {
    throw new GuardError("NOT_A_REPO", "Not inside a git repository.");
  }
  if (!(await deps.github.available())) {
    throw new GuardError("NO_GH", "The gh CLI is not available.");
  }
  return {
    repoSlug: await deps.github.repoSlug(),
    defaultBranch: await deps.github.defaultBranch(),
  };
}

/** Assert the current branch is the default branch or an allowed prefix; return it. */
export async function assertBranch(
  deps: Deps,
  defaultBranch: string,
  opts: { allowPrefixes?: string[] } = {},
): Promise<string> {
  const branch = await deps.git.currentBranch();
  if (branch === "HEAD") {
    throw new GuardError("DETACHED_HEAD", "HEAD is detached; checkout a branch.");
  }
  const prefixes = opts.allowPrefixes ?? [];
  if (branch !== defaultBranch && !prefixes.some((p) => branch.startsWith(p))) {
    const allowed = [defaultBranch, ...prefixes.map((p) => `${p}*`)].join(" or ");
    throw new GuardError("WRONG_BRANCH", `On ${branch}; expected ${allowed}.`);
  }
  return branch;
}

/** Tracked paths the working tree has changed, minus the `allowed` set. */
export async function offendingPaths(deps: Deps, allowed: string[]): Promise<string[]> {
  return (await deps.git.porcelainStatus())
    .map((line) => line.slice(3).trim())
    .filter((path) => path !== "" && !allowed.includes(path));
}

/** Raise DIRTY_TREE if the working tree has changes outside the `allowed` paths. */
export async function assertCleanTree(deps: Deps, allowed: string[] = []): Promise<void> {
  const offending = await offendingPaths(deps, allowed);
  if (offending.length > 0) {
    throw new GuardError("DIRTY_TREE", `Working tree has changes: ${offending.join(", ")}.`);
  }
}

/** assertInSync but raising the typed MANIFEST_DRIFT guard on disagreement. */
export function syncedVersion(entries: { file: string; version: string }[]): string {
  try {
    return assertInSync(entries);
  } catch (e) {
    throw new GuardError("MANIFEST_DRIFT", (e as Error).message);
  }
}
