// A variable bin/caret-launcher reads but the unit never records resolves to its
// default under the supervisor — which is how a machine that merely relocates an XDG
// root drives the launcher into its `evict()` branch, deleting the unit and the
// launcher itself. The set is maintained in TypeScript and consumed by shell, so
// nothing but this suite makes the coupling falsifiable.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SUPERVISED_VAR, WORLD_VARS } from "@/service/manager.ts";

const LAUNCHER = join(import.meta.dir, "..", "..", "bin", "caret-launcher");

test("every environment variable bin/caret-launcher reads is recorded in the unit", () => {
  const referenced = new Set(
    [...readFileSync(LAUNCHER, "utf8").matchAll(/\$\{?([A-Z][A-Z0-9_]*)/g)].map(
      ([, name]) => name as string,
    ),
  );
  // The launcher rebuilds PATH around the bun it resolved, so carrying the
  // installing shell's would defeat the resolution it just did.
  referenced.delete("PATH");
  // SUPERVISED_VAR is recorded too, but written by serviceEnvironment rather than
  // captured from the installing shell.
  const recorded: readonly string[] = [...WORLD_VARS, SUPERVISED_VAR];
  expect([...referenced].filter((name) => !recorded.includes(name))).toEqual([]);
});
