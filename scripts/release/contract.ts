// The script <-> skill data contract. `compute` prints exactly one JSON object
// on stdout: a ComputeResult on success or a ReleaseError on a clean guard
// rejection. The skill parses (never scrapes) this, so the "agent never invents
// the version" guarantee rests on a typed payload. All builders here are pure.

import type { BumpLevel } from "./version.ts";

/** Bumped whenever the payload shape changes incompatibly. */
export const SCHEMA_VERSION = 1;

/** Stable machine-readable reasons a release step can refuse. */
export type ErrorCode =
  | "NO_BASELINE"
  | "DIRTY_TREE"
  | "DETACHED_HEAD"
  | "WRONG_BRANCH"
  | "TAG_EXISTS"
  | "MANIFEST_DRIFT"
  | "NOT_A_REPO"
  | "NO_GH"
  | "BAD_BUMP"
  | "CHANGELOG_MISSING"
  | "PREFLIGHT_FAILED"
  | "BRANCH_DIVERGED"
  | "PR_CLOSED"
  | "ALREADY_MERGED"
  | "NOT_MERGED"
  | "INTERNAL";

/** One commit in the range since the last release, with parsed metadata. */
export interface CommitInfo {
  sha: string;
  shortSha: string;
  subject: string;
  issueRefs: string[];
  prNumber: number | null;
}

/** The success payload `compute` emits for the skill to author the changelog. */
export interface ComputeResult {
  ok: true;
  schemaVersion: number;
  bump: BumpLevel;
  currentVersion: string;
  /** The version of the latest release tag; the bump baseline. */
  previousVersion: string;
  version: string;
  tag: string;
  previousTag: string | null;
  headSha: string;
  repoSlug: string;
  defaultBranch: string;
  releaseBranch: string;
  compareUrl: string;
  unreleasedCompareUrl: string;
  commits: CommitInfo[];
  manifestsInSync: boolean;
}

/** The failure payload for a clean, expected guard rejection. */
export interface ReleaseError {
  ok: false;
  schemaVersion: number;
  errorCode: ErrorCode;
  message: string;
}

/** Builds a ReleaseError with the current schema version stamped in. */
export function errorResult(errorCode: ErrorCode, message: string): ReleaseError {
  return { ok: false, schemaVersion: SCHEMA_VERSION, errorCode, message };
}

/** A GitHub compare URL, e.g. `.../compare/v0.0.1...v0.1.0`. */
export function compareUrl(repoSlug: string, from: string, to: string): string {
  return `https://github.com/${repoSlug}/compare/${from}...${to}`;
}

const ISSUE_REF = /\b[A-Z]{2,}-\d+\b/g;
const PR_SUFFIX = /\(#(\d+)\)\s*$/;

/** Parses issue refs (e.g. EXC-372, deduped, in order) and the `(#N)` PR suffix. */
export function parseCommitMeta(subject: string): {
  issueRefs: string[];
  prNumber: number | null;
} {
  const issueRefs: string[] = [];
  for (const match of subject.matchAll(ISSUE_REF)) {
    const ref = match[0];
    if (!issueRefs.includes(ref)) issueRefs.push(ref);
  }
  const pr = PR_SUFFIX.exec(subject);
  const prNumber = pr?.[1] !== undefined ? Number(pr[1]) : null;
  return { issueRefs, prNumber };
}
