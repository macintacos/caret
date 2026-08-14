// Standing gate for the TypeScript 7 hold (EXC-1083). package.json's `held` block records
// why `typescript` stops at ^6 and what would lift it: a svelte-check release that
// type-checks Svelte against a plain `typescript@7`. svelte-check is the only type-checker
// over the Svelte half, so until then a move to 7.x replaces the UI type gate with a hard
// throw from bin/ts-version-check.js — a partial adoption, which is the one outcome the
// evaluation ruled out.
//
// A trigger written only in prose is a trigger nobody checks. This suite makes it
// falsifiable in both directions, the shape exact-pin.test.ts uses for its own block: the
// hold reds if it stops being described, and the trigger reds the moment upstream widens —
// in front of whoever is running the dependency sweep, which is the only moment anyone is
// positioned to act on it. Expect a red here to mean "re-evaluate", not "broken": the peer
// range widening is necessary for the move, not sufficient, so it sends you back through
// the trial rather than straight to a bump.
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
 * parser rather than `JSON.parse`. Each `packages` value is a tuple whose third element
 * carries the resolved manifest metadata, peer ranges included. */
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

/** Read from the lock rather than from svelte-check's installed package.json: the lock is
 * committed, so the gate decides the same way on a cold checkout as it does locally. */
const peer = lock.packages["svelte-check"]?.[2]?.peerDependencies?.typescript;

test("the lock still states svelte-check's typescript peer range", () => {
  // Asserted before the range comparison below, which an undefined peer would otherwise
  // satisfy vacuously — bun's lock tuple shape is not a stable contract.
  expect(typeof peer).toBe("string");
});

test("the hold is still described where the range is", () => {
  // Both directions at once: a range that left ^6 with the entry still there describes a
  // hold that ended, and an entry deleted under a range still at ^6 leaves the ^6 bare.
  expect("typescript" in pkg.held).toBe(pkg.devDependencies.typescript.startsWith("^6"));
});

test("svelte-check still refuses a plain typescript@7", () => {
  expect(semver.satisfies("7.0.0", peer as string)).toBe(false);
});
