import { expect, test } from "bun:test";
import {
  type ComputeResult,
  SCHEMA_VERSION,
  compareUrl,
  errorResult,
  parseCommitMeta,
} from "../../scripts/release/contract.ts";

test("errorResult builds the ok:false payload shape", () => {
  expect(errorResult("NO_BASELINE", "no tags yet")).toEqual({
    ok: false,
    schemaVersion: SCHEMA_VERSION,
    errorCode: "NO_BASELINE",
    message: "no tags yet",
  });
});

test("compareUrl builds a GitHub compare link", () => {
  expect(compareUrl("macintacos/caret", "v0.0.1", "v0.1.0")).toBe(
    "https://github.com/macintacos/caret/compare/v0.0.1...v0.1.0",
  );
});

test("parseCommitMeta extracts a single issue ref and PR number", () => {
  expect(parseCommitMeta("EXC-372 Seed mise run dev (#7)")).toEqual({
    issueRefs: ["EXC-372"],
    prNumber: 7,
  });
});

test("parseCommitMeta returns empty refs and null PR for a plain subject", () => {
  expect(parseCommitMeta("chore: bump deps")).toEqual({
    issueRefs: [],
    prNumber: null,
  });
});

test("parseCommitMeta dedupes refs and reads multiple", () => {
  expect(parseCommitMeta("EXC-1 EXC-1 and EXC-2 land (#10)")).toEqual({
    issueRefs: ["EXC-1", "EXC-2"],
    prNumber: 10,
  });
});

test("a ComputeResult round-trips through JSON unchanged", () => {
  const result: ComputeResult = {
    ok: true,
    schemaVersion: SCHEMA_VERSION,
    bump: "minor",
    currentVersion: "0.0.1",
    previousVersion: "0.0.1",
    version: "0.1.0",
    tag: "v0.1.0",
    previousTag: "v0.0.1",
    headSha: "abc123",
    repoSlug: "macintacos/caret",
    defaultBranch: "trunk",
    releaseBranch: "release/v0.1.0",
    compareUrl: compareUrl("macintacos/caret", "v0.0.1", "v0.1.0"),
    unreleasedCompareUrl: compareUrl("macintacos/caret", "v0.1.0", "HEAD"),
    date: "2026-06-02",
    commits: [
      {
        sha: "def456",
        shortSha: "def456",
        subject: "EXC-372 Seed (#7)",
        issueRefs: ["EXC-372"],
        prNumber: 7,
      },
    ],
    manifests: ["package.json", ".claude-plugin/marketplace.json", ".claude-plugin/plugin.json"],
  };
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
});
