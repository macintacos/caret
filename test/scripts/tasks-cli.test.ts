import { describe, expect, test } from "bun:test";
import type { RunDevOptions } from "../../scripts/dev/run.ts";
import { buildProgram } from "../../scripts/tasks/cli.ts";

// The dev action is injectable, so these drive the real commander tree (parsing,
// defaults, coercion) and capture the options it would hand runDev — without
// spawning the daemon/Vite/driver. This pins the task→CLI contract: `mise run
// dev <flags>` forwards to the `dev` subcommand and commander owns the flags.
async function parseDevArgs(args: string[]): Promise<RunDevOptions> {
  let captured: RunDevOptions | undefined;
  const program = buildProgram(async (opts) => {
    captured = opts;
  });
  await program.parseAsync(["dev", ...args], { from: "user" });
  if (!captured) throw new Error("dev action was not invoked");
  return captured;
}

describe("tasks CLI: dev command", () => {
  test("defaults: num-versions 3, notify false", async () => {
    expect(await parseDevArgs([])).toEqual({ numVersions: 3, notify: false });
  });

  test("parses --num-versions", async () => {
    expect(await parseDevArgs(["--num-versions", "5"])).toEqual({ numVersions: 5, notify: false });
  });

  test("parses --notify", async () => {
    expect(await parseDevArgs(["--notify"])).toEqual({ numVersions: 3, notify: true });
  });

  test("parses both flags together, in any order", async () => {
    expect(await parseDevArgs(["--notify", "--num-versions", "7"])).toEqual({
      numVersions: 7,
      notify: true,
    });
  });
});
