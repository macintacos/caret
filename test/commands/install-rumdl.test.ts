// `caret install-rumdl` (EXC-828): the discrete, install.sh-invoked step that
// eagerly acquires rumdl. Injection seams (ensure/isPresent/write) let the command
// run without touching the network or the real state dir; the report distinguishes
// a fresh install from an already-cached one so the idempotency check reads cleanly.
import { expect, test } from "bun:test";

import { type InstallRumdlDeps, runInstallRumdlSubcommand } from "@/commands/install-rumdl.ts";

function run(over: Partial<InstallRumdlDeps> = {}) {
  const lines: string[] = [];
  const promise = runInstallRumdlSubcommand({
    ensure: async () => ({ bin: "/x/rumdl", config: "/x/rumdl.toml" }),
    isPresent: () => false,
    write: (s) => lines.push(s),
    ...over,
  });
  return { lines, promise };
}

test("install-rumdl reports the binary as installed on a fresh machine", async () => {
  const { lines, promise } = run({ isPresent: () => false });
  await promise;
  const out = lines.join("");
  expect(out).toContain("installed");
  expect(out).toContain("/x/rumdl");
});

test("install-rumdl reports the binary as already present when cached", async () => {
  const { lines, promise } = run({ isPresent: () => true });
  await promise;
  expect(lines.join("")).toContain("already present");
});
