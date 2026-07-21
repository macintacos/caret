// `caret install-rumdl` (EXC-828): the discrete, install.sh-invoked step that
// eagerly acquires rumdl. Injection seams (ensure/isPresent/write) let the command
// run without touching the network or the real state dir; the report distinguishes
// a fresh install from an already-cached one so the idempotency check reads cleanly.
import { expect, test } from "bun:test";

import { type InstallRumdlDeps, runInstallRumdlSubcommand } from "@/commands/install-rumdl.ts";

function run(over: Partial<InstallRumdlDeps> = {}) {
  const lines: string[] = [];
  const promise = runInstallRumdlSubcommand({
    ensure: async () => ({ bin: "/x/rumdl", config: "/x/rumdl.toml", installed: true }),
    write: (s) => lines.push(s),
    ...over,
  });
  return { lines, promise };
}

test("install-rumdl reports the binary as installed when ensureRumdl downloaded it", async () => {
  const { lines, promise } = run();
  await promise;
  const out = lines.join("");
  expect(out).toContain("installed");
  expect(out).toContain("/x/rumdl");
});

test("install-rumdl reports the binary as already present when it was not downloaded", async () => {
  const { lines, promise } = run({
    ensure: async () => ({ bin: "/x/rumdl", config: "/x/rumdl.toml", installed: false }),
  });
  await promise;
  expect(lines.join("")).toContain("already present");
});
