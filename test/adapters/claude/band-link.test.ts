// `caret band-link`: the link Claude Code's plan-waiting band (mod/hooks/band.tsx) shows.
// Covers the bounded poll for the session's review and the CLI's off switch.

import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { drainProcess } from "@test/support/cli-process.ts";
import { setupTempStateDir } from "@test/support/env.ts";
import { awaitPendingReview, type BandLinkDeps } from "@/commands/band-link.ts";

function deps(answers: Array<string | undefined | Error>, sleeps: number[] = []): BandLinkDeps {
  return {
    pendingReviewId: async () => {
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  };
}

test("awaitPendingReview returns the review found on the first poll", async () => {
  const sleeps: number[] = [];
  expect(await awaitPendingReview(deps(["r1"], sleeps))).toBe("r1");
  expect(sleeps).toEqual([]);
});

test("awaitPendingReview keeps polling through rejections and empty answers", async () => {
  const sleeps: number[] = [];
  const found = await awaitPendingReview(
    deps([new Error("no daemon"), undefined, "r2"], sleeps),
    25,
    200,
  );
  expect(found).toBe("r2");
  expect(sleeps).toEqual([200, 200]);
});

test("awaitPendingReview gives up after its attempt budget", async () => {
  const sleeps: number[] = [];
  const found = await awaitPendingReview(deps([], sleeps), 3, 50);
  expect(found === undefined).toBe(true);
  expect(sleeps).toEqual([50, 50]);
});

const stateDir = setupTempStateDir("caret-band-link-");

test("caret band-link prints nothing and exits 0 with the band turned off", async () => {
  const configFile = join(stateDir(), "config.toml");
  await writeFile(configFile, "[review]\nband = false\n");
  const r = await drainProcess(
    Bun.spawn([process.execPath, "src/cli.ts", "band-link", "--session", "x"], {
      env: { ...process.env, CARET_CONFIG_FILE: configFile },
      stdout: "pipe",
      stderr: "pipe",
    }),
  );
  expect(r.exit).toBe(0);
  expect(r.stdout).toBe("");
});
