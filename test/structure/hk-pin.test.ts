// Standing gate for the hk pin invariant (EXC-1072). hk is pinned twice: mise.toml's
// `[tools] hk` provisions the binary, and hk.pkl's `amends`/`import` URLs name the Pkl
// package whose schema that binary evaluates. The skew between them is silent, which is
// why it needs a test: `hk validate` passes happily on a 1.55 binary reading a 1.50
// schema, and the only symptom is that steps quietly stop matching files — a stale hk.pkl
// reverts the shell builtins to their pre-1.51 globs and drops every extensionless script
// from shfmt and shellcheck without a word.
//
// mise.toml and hk.pkl each state the lockstep in prose ("Keep hk in lockstep with
// hk.pkl's amends/import version"). This suite is what makes it falsifiable: a bump that
// moves one file and not the other fails `bun test` on the spot.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseToml } from "smol-toml";

// From import.meta.dir, not cwd, so the suite reads the real tree wherever it runs.
const REPO_ROOT = join(import.meta.dir, "..", "..");

const read = (name: string) => readFileSync(join(REPO_ROOT, name), "utf-8");

const pin = (parseToml(read("mise.toml")) as { tools: { hk?: string } }).tools.hk;
if (typeof pin !== "string") throw new Error("mise.toml carries no [tools] hk pin to check");

const locked = (
  parseToml(read("mise.lock")) as unknown as { tools: { hk?: { version: string }[] } }
).tools.hk?.[0];
if (!locked) throw new Error("mise.lock carries no [[tools.hk]] entry to pin against");

/** Every version string the hk.pkl package URLs name — the release tag and the package
 * name are spelled separately in each URL, and either can be missed in a hand edit. */
const urlVersions = [...read("hk.pkl").matchAll(/\/v([\d.]+)\/hk@([\d.]+)#/g)].flatMap(
  ([, tag, pkg]) => [tag, pkg],
);

test("hk.pkl's package URLs all name the release mise.lock resolved", () => {
  // Asserted before the set comparison, which a regex that stopped matching would satisfy
  // vacuously — and it does stop matching on, say, a prerelease tag `[\d.]+` can't spell.
  expect(urlVersions.length).toBeGreaterThan(0);
  expect([...new Set(urlVersions)]).toEqual([locked.version]);
});

test("mise.toml's hk pin admits the release mise.lock resolved", () => {
  // Both sides get a trailing dot so the prefix is compared per version component: a `1.5`
  // pin must not read as satisfied by the `1.55.0` the lock resolved.
  expect(`${locked.version}.`).toStartWith(`${pin}.`);
});
