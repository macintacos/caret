import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withEnv } from "@test/support/env.ts";
import {
  existingOpencodeCachePackageDirs,
  opencodeCachePackageDir,
} from "@/adapters/opencode/paths.ts";

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "caret-oc-paths-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const packages = () => join(tmp, "opencode", "packages");

test("a plugin entry maps to its cache dir verbatim, pin and all", () => {
  withEnv({ XDG_CACHE_HOME: tmp }, () => {
    expect(opencodeCachePackageDir("@macintacos/caret")).toBe(
      join(packages(), "@macintacos/caret"),
    );
    expect(opencodeCachePackageDir("@macintacos/caret@latest")).toBe(
      join(packages(), "@macintacos/caret@latest"),
    );
    expect(opencodeCachePackageDir("@macintacos/caret@1.0.2")).toBe(
      join(packages(), "@macintacos/caret@1.0.2"),
    );
  });
});

test("caret's cache dirs are the bare dir and its pinned siblings, never a same-prefix package", () => {
  for (const name of ["caret", "caret@latest", "caret@0.7.3", "caret-tools"]) {
    mkdirSync(join(packages(), "@macintacos", name), { recursive: true });
  }
  withEnv({ XDG_CACHE_HOME: tmp }, () => {
    expect(existingOpencodeCachePackageDirs()).toEqual(
      ["caret", "caret@0.7.3", "caret@latest"].map((n) => join(packages(), "@macintacos", n)),
    );
  });
});
