// Standing gate for the two-package TypeScript arrangement (EXC-1089). caret type-checks
// with TypeScript 7 — the Go port — while keeping `typescript` at ^6 installed alongside
// it. That is not a hold on adoption; it is svelte-check's own documented setup for
// TypeScript 7 (its bin/ts-version-check.js throws with exactly this recipe, and its
// README repeats it), plus the fact that two suites in this directory import the compiler
// API as a parsing library rather than driving `tsc`.
//
// Both halves of the arrangement fail SILENTLY when they decay, which is the whole reason
// this file exists. Neither tsc nor svelte-check announces which compiler it used: strip
// the `--tsgo` flag and svelte-check checks the entire Svelte half with the 6.x peer and
// still reports zero errors; let node_modules/.bin/tsc win the bin-name collision the
// other way and `tsc` does the same for the backend program. Every gate stays green while
// the adoption this issue landed has quietly reverted. Nothing else in the tree notices,
// so the invocations are asserted here, as text, where a rewrite has to walk past them.
//
// This file replaces test/structure/typescript-hold.test.ts, which gated the opposite
// decision (EXC-1083's "hold at ^6"). That suite is not merely obsolete — it would still
// PASS, because every literal it asserts is still true; only its premise died. A green
// gate over a stale claim is invisible, which is worse than a red one, so it is replaced
// rather than left to rot.
//
// Expect a red on the last test to mean "simplify", not "broken": it fires when upstream
// widens svelte-check's peer range to admit 7.x, which is the moment the second install
// stops being necessary and the whole arrangement collapses to one `typescript@7`.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type ParseError, parse as parseJsonc } from "jsonc-parser";
import semver from "semver";

import pkg from "@root/package.json" with { type: "json" };

// The suite sits at test/structure/, two levels below the repo root; resolving against
// import.meta.dir reads the real tree regardless of the runner's cwd.
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

const errors: ParseError[] = [];
const lock = parseJsonc(readFileSync(join(REPO_ROOT, "bun.lock"), "utf8"), errors, {
  allowTrailingComma: true,
}) as BunLock;

const hk = readFileSync(join(REPO_ROOT, "hk.pkl"), "utf8");

/** The `check` line of a named hk step. Read from the file rather than by evaluating the
 * pkl, so the gate needs no pkl toolchain and reads what a human reviewing the diff sees. */
function checkLine(step: string): string {
  const line = hk.split("\n").find((l) => l.includes(step));
  const body = hk.slice(hk.indexOf(line as string));
  return (
    body
      .slice(0, body.indexOf("\n  }"))
      .split("\n")
      .find((l) => l.includes("check =")) ?? ""
  );
}

test("TypeScript 7 is installed under the alias svelte-check looks for", () => {
  // svelte-check resolves `@typescript/native` first and `@typescript/native-preview`
  // second (dist/src/index.js), so the alias name is load-bearing, not cosmetic. Asserting
  // the RESOLVED version as well as the declared range is what catches the arrangement
  // being re-pointed at a second copy of 6.x, which would leave every gate green.
  expect(pkg.devDependencies["@typescript/native"]).toStartWith("npm:typescript@");
  expect(semver.major(lock.packages["@typescript/native"]?.[0]?.split("@").pop() as string)).toBe(
    7,
  );
});

test("the tsc step names the 7.x binary by path, not by bin-name lookup", () => {
  // Both installed packages declare a `tsc` bin, so node_modules/.bin/tsc is whichever
  // install wrote the link last. `bun x tsc` would therefore pick the compiler by luck,
  // and picking 6.x is silent: the backend program type-checks clean under either.
  expect(checkLine("TypeScript(Check)")).toContain("node_modules/@typescript/native/bin/tsc");
});

test("the svelte-check step still routes the UI program through tsgo", () => {
  // Without a tsgo flag svelte-check falls back to the 6.x peer for the entire Svelte
  // half — zero errors, zero warnings, and the UI no longer checked by the compiler this
  // repo adopted. This is the arrangement's one truly invisible failure.
  expect(checkLine("Svelte(Check)")).toMatch(/--tsgo(-experimental-api)?\b/);
});

test("the second install is still necessary", () => {
  // Read from the lock rather than from svelte-check's installed package.json: the lock is
  // committed, so the gate decides the same way on a cold checkout as it does locally.
  const peer = lock.packages["svelte-check"]?.[2]?.peerDependencies?.typescript;
  // Asserted before the range comparison below, which an undefined peer would otherwise
  // satisfy vacuously — bun's lock tuple shape is not a stable contract.
  expect(typeof peer).toBe("string");
  // When this reds, svelte-check has learned to type-check Svelte against a plain
  // `typescript@7`: drop the alias, move `typescript` to ^7, and delete this file.
  expect(semver.satisfies("7.0.0", peer as string)).toBe(false);
  expect(pkg.devDependencies.typescript).toStartWith("^6");
});
