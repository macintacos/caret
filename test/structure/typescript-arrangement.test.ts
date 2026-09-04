// Standing gate for the two-package TypeScript arrangement (EXC-1089). caret type-checks
// with TypeScript 7 — the Go port, installed as the `@typescript/native` alias — while
// keeping `typescript` at ^6 alongside it. The 6.x install is load-bearing twice over:
// svelte-check refuses to run against a plain 7 (its bin/ts-version-check.js throws with
// exactly this recipe), and e2e-conventions.test.ts and tokenize-conventions.test.ts in
// this directory import the compiler API as a parsing library, which 7.x moves behind
// ./unstable/* subpaths that expose no standalone parse.
//
// Both halves of the arrangement fail SILENTLY when they decay, which is why this file
// asserts the invocations rather than trusting them. Neither checker announces which
// compiler it used: drop the `--tsgo` flag and svelte-check checks the whole Svelte half
// with the 6.x peer, still reporting zero errors; let node_modules/.bin/tsc win the
// `tsc` bin-name collision the other way and the backend program does the same. Every
// gate stays green while the adoption has quietly reverted, and nothing else notices.
//
// Expect a red on the last test to mean "simplify", not "broken": it fires when upstream
// widens svelte-check's peer range to admit 7.x. That clears only the first of the two
// reasons above — collapsing to a single `typescript@7` also means porting the two
// conventions suites off the compiler API, in the same pass.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type ParseError, parse as parseJsonc } from "jsonc-parser";
import semver from "semver";

import pkg from "@root/package.json" with { type: "json" };

// From import.meta.dir, not cwd, so the suite reads the real tree wherever it runs.
const REPO_ROOT = join(import.meta.dir, "..", "..");

/** bun.lock is JSONC — unquoted-safe keys and trailing commas — so it needs a tolerant
 * parser rather than `JSON.parse`. Each `packages` value is a tuple whose first element is
 * the resolved `name@version` and whose third carries the manifest metadata, peer ranges
 * included. */
interface BunLock {
  packages: Record<
    string,
    [string, string, { peerDependencies?: Record<string, string> }, ...unknown[]]
  >;
}

const lockErrors: ParseError[] = [];
const lock = parseJsonc(readFileSync(join(REPO_ROOT, "bun.lock"), "utf8"), lockErrors, {
  allowTrailingComma: true,
}) as BunLock;

const hk = readFileSync(join(REPO_ROOT, "hk.pkl"), "utf8");

/**
 * The `check` command of a named hk step, read as text rather than by evaluating the pkl
 * — which would need the toolchain and buy nothing over reading what a reviewer sees.
 *
 * Anchored on `["<step>` and on a line whose first token is `check =`, because a comment
 * cannot forge either: every step in hk.pkl is introduced as a quoted mapping key, and the
 * explanatory comments beside these two steps quote their own invocations verbatim. A
 * looser `includes` match would return the COMMENT and pass while the real command had
 * lost its flag — the exact false green this suite exists to prevent. Both misses throw,
 * so a renamed step fails by name instead of returning an empty string that reads as a
 * missing flag.
 */
function checkLine(step: string): string {
  const start = hk.indexOf(`["${step}`);
  if (start < 0) throw new Error(`hk.pkl declares no step named ${step}`);
  const line = hk
    .slice(start, hk.indexOf("\n  }", start))
    .split("\n")
    .find((l) => l.trimStart().startsWith("check ="));
  if (!line) throw new Error(`hk.pkl step ${step} declares no check command`);
  return line;
}

test("the lock parsed, so the assertions below read real metadata", () => {
  // Without this a corrupted lock surfaces as `undefined` three tests down rather than as
  // the parse failure it is.
  expect(lockErrors).toEqual([]);
});

test("TypeScript 7 is installed under the alias svelte-check looks for", () => {
  // svelte-check resolves `@typescript/native` before `@typescript/native-preview`, so the
  // alias name is load-bearing. The RESOLVED major is asserted as well as the declared
  // range: re-pointing the alias at a second copy of 6.x would leave every gate green.
  expect(pkg.devDependencies["@typescript/native"]).toStartWith("npm:typescript@");
  const resolved = lock.packages["@typescript/native"]?.[0]?.split("@").pop();
  expect(typeof resolved).toBe("string");
  expect(semver.major(resolved as string)).toBe(7);
});

test("the tsc step names the 7.x binary by path, not by bin-name lookup", () => {
  expect(checkLine("TypeScript(Check)")).toContain("node_modules/@typescript/native/bin/tsc");
});

test("the svelte-check step still routes the UI program through tsgo", () => {
  expect(checkLine("Svelte(Check)")).toMatch(/--tsgo(-experimental-api)?\b/);
});

test("the arrangement is still described where the range is", () => {
  // Both directions at once, the shape exact-pin.test.ts uses for its own block: a range
  // that left ^6 with the entry still there describes an obligation that ended, and an
  // entry deleted under a range still at ^6 leaves the ^6 bare. package.json's `held`
  // entry is the only end-to-end account of why two TypeScript majors are installed.
  expect("typescript" in pkg.held).toBe(pkg.devDependencies.typescript.startsWith("^6"));
});

test("the second install is still necessary", () => {
  // Read from the lock rather than from svelte-check's installed package.json: the lock is
  // committed, so the gate decides the same way on a cold checkout as it does locally.
  const peer = lock.packages["svelte-check"]?.[2]?.peerDependencies?.typescript;
  // Asserted before the range comparison below, which an undefined peer would otherwise
  // satisfy vacuously — bun's lock tuple shape is not a stable contract.
  expect(typeof peer).toBe("string");
  // When this reds, svelte-check has learned to type-check Svelte against a plain
  // `typescript@7`. Dropping the alias and moving this range to ^7 then also requires
  // porting e2e-conventions.test.ts and tokenize-conventions.test.ts off the 6.x compiler
  // API, which is the second reason the install is here.
  expect(semver.satisfies("7.0.0", peer as string)).toBe(false);
  expect(pkg.devDependencies.typescript).toStartWith("^6");
});
