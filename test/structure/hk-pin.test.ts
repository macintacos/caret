// Standing gate for the hk pin invariant (EXC-1072). hk is pinned twice: mise.toml's
// `[tools] hk` provisions the binary, and hk.pkl's `amends`/`import` URLs name the Pkl
// package whose schema that binary evaluates. Bump one without the other and hk runs a
// newer binary against an older schema — the failure surfaces as an obscure Pkl
// evaluation error at commit time, on someone else's machine.
//
// mise.toml and hk.pkl each state the lockstep in prose ("Keep hk in lockstep with
// hk.pkl's amends/import version"). This suite is what makes it falsifiable: a bump that
// moves one file and not the other fails `bun test` on the spot.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseToml } from "smol-toml";

// The suite sits at test/structure/, two levels below the repo root; resolving against
// import.meta.dir reads the real tree regardless of the runner's cwd.
const REPO_ROOT = join(import.meta.dir, "..", "..");

const read = (name: string) => readFileSync(join(REPO_ROOT, name), "utf-8");

const pin = (parseToml(read("mise.toml")) as { tools: { hk: string } }).tools.hk;

const locked = (
  parseToml(read("mise.lock")) as unknown as { tools: { hk?: { version: string }[] } }
).tools.hk?.[0];
if (!locked) throw new Error("mise.lock carries no [[tools.hk]] entry to pin against");

/** Every `v<version>/hk@<version>` the package URLs in hk.pkl name. Both halves are
 * captured because hk.pkl spells the version twice per URL — the release tag and the
 * package name — and either can be missed in a hand edit. */
const urlVersions = [...read("hk.pkl").matchAll(/\/v([\d.]+)\/hk@([\d.]+)#/g)].flatMap(
  ([, tag, pkg]) => [tag, pkg],
);

test("hk.pkl's amends and import both name the release mise.lock resolved", () => {
  // Four: two URLs, each naming the version in its tag and again in its package.
  expect(urlVersions).toEqual([locked.version, locked.version, locked.version, locked.version]);
});

test("mise.toml's hk pin admits the release mise.lock resolved", () => {
  expect(`${locked.version}.`.startsWith(`${pin}.`)).toBe(true);
});
