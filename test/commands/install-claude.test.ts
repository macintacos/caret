// caret's Claude Code install target: drives the `claude` plugin CLI. The runner is
// injected, so these assert the exact commands issued without spawning `claude`, and a
// recording UI pins how the run is reported step by step.

import { expect, test } from "bun:test";

import { type ClaudeRunner, runInstallClaudeTarget } from "@/commands/install/claude.ts";
import { recordingUI } from "@/commands/install/ui.ts";

// A runner that records every `claude` invocation and returns a scripted result.
function recorder(result: Awaited<ReturnType<ClaudeRunner>> = { ok: true, detail: "" }): {
  runner: ClaudeRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  return {
    calls,
    runner: async (args) => {
      calls.push(args);
      return result;
    },
  };
}

test("install adds the marketplace, then installs and enables the plugin", async () => {
  const { runner, calls } = recorder();
  await runInstallClaudeTarget({ uninstall: false, dryRun: false }, { claude: runner });
  expect(calls).toEqual([
    ["plugin", "marketplace", "add", "macintacos/caret"],
    ["plugin", "install", "caret@caret", "--scope", "user"],
    ["plugin", "enable", "caret@caret"],
  ]);
});

test("uninstall removes the plugin", async () => {
  const { runner, calls } = recorder();
  await runInstallClaudeTarget({ uninstall: true, dryRun: false }, { claude: runner });
  expect(calls).toEqual([["plugin", "uninstall", "caret@caret"]]);
});

test("dry-run prints the commands without spawning claude", async () => {
  const { runner, calls } = recorder();
  const ui = recordingUI();
  await runInstallClaudeTarget({ uninstall: false, dryRun: true }, { claude: runner, ui });
  expect(calls).toEqual([]);
  // Previewed as a note, never as steps — nothing is happening to narrate.
  expect(ui.events.filter((e) => e.startsWith("step:"))).toEqual([]);
  expect(ui.events.some((e) => e.startsWith("note:"))).toBe(true);
});

test("a missing claude CLI stops after the first step (guidance, not a crash)", async () => {
  const { runner, calls } = recorder({ ok: false, missing: true, detail: "ENOENT" });
  const ui = recordingUI();
  await runInstallClaudeTarget({ uninstall: false, dryRun: false }, { claude: runner, ui });
  // Bails on the first (marketplace add) step rather than pressing on to install.
  expect(calls).toEqual([["plugin", "marketplace", "add", "macintacos/caret"]]);
  expect(ui.events).toContain("failed:Registering the caret marketplace");
  expect(ui.events.some((e) => e.startsWith("error:"))).toBe(true);
});

test("a failed marketplace add is best-effort; a failed install is fatal", async () => {
  // marketplace add fails (already registered), install fails for real -> stop there.
  let n = 0;
  const calls: string[][] = [];
  const runner: ClaudeRunner = async (args) => {
    calls.push(args);
    n++;
    return n === 1 ? { ok: false, detail: "already added" } : { ok: false, detail: "boom" };
  };
  await runInstallClaudeTarget({ uninstall: false, dryRun: false }, { claude: runner });
  expect(calls).toEqual([
    ["plugin", "marketplace", "add", "macintacos/caret"],
    ["plugin", "install", "caret@caret", "--scope", "user"],
  ]);
});

test("--from-local registers the generated dev marketplace, never the published one", async () => {
  const { runner, calls } = recorder();
  const written: [string, string][] = [];
  await runInstallClaudeTarget(
    { uninstall: false, dryRun: false, local: { repoDir: "/checkout", marketplaceDir: "/dev-mp" } },
    { claude: runner, writeDevMarketplace: (repo, out) => void written.push([repo, out]) },
  );
  expect(written).toEqual([["/checkout", "/dev-mp"]]);
  expect(calls).toEqual([
    ["plugin", "marketplace", "add", "/dev-mp"],
    // Reinstall so the fresh build lands in the plugin cache even though the version is
    // unchanged — the dev loop's defining difference from the published path.
    ["plugin", "uninstall", "caret@caret"],
    ["plugin", "install", "caret@caret", "--scope", "user"],
    ["plugin", "enable", "caret@caret"],
  ]);
  expect(JSON.stringify(calls)).not.toContain("macintacos/caret");
});

test("--from-local falls back to updating the marketplace when the add fails", async () => {
  // `marketplace add` fails once the dev marketplace is already registered; the update
  // re-reads the same generated dir, so the run still installs the local build.
  const calls: string[][] = [];
  const runner: ClaudeRunner = async (args) => {
    calls.push(args);
    return args[2] === "add" ? { ok: false, detail: "already exists" } : { ok: true, detail: "" };
  };
  await runInstallClaudeTarget(
    { uninstall: false, dryRun: false, local: { repoDir: "/checkout", marketplaceDir: "/dev-mp" } },
    { claude: runner, writeDevMarketplace: () => {} },
  );
  expect(calls[0]).toEqual(["plugin", "marketplace", "add", "/dev-mp"]);
  expect(calls[1]).toEqual(["plugin", "marketplace", "update", "caret"]);
  expect(calls).toContainEqual(["plugin", "install", "caret@caret", "--scope", "user"]);
});

test("--from-local stops when neither the marketplace add nor its update lands", async () => {
  // Pressing on would install the PUBLISHED plugin into a dev loop — silently wrong.
  const calls: string[][] = [];
  const runner: ClaudeRunner = async (args) => {
    calls.push(args);
    return args[1] === "marketplace" ? { ok: false, detail: "nope" } : { ok: true, detail: "" };
  };
  const ui = recordingUI();
  await runInstallClaudeTarget(
    { uninstall: false, dryRun: false, local: { repoDir: "/checkout", marketplaceDir: "/dev-mp" } },
    { claude: runner, writeDevMarketplace: () => {}, ui },
  );
  expect(calls).toEqual([
    ["plugin", "marketplace", "add", "/dev-mp"],
    ["plugin", "marketplace", "update", "caret"],
  ]);
  expect(ui.events.some((e) => e.startsWith("error:"))).toBe(true);
});

test("--from-local --dry-run writes no marketplace and spawns no claude", async () => {
  const { runner, calls } = recorder();
  const written: string[] = [];
  const ui = recordingUI();
  await runInstallClaudeTarget(
    { uninstall: false, dryRun: true, local: { repoDir: "/checkout", marketplaceDir: "/dev-mp" } },
    { claude: runner, writeDevMarketplace: (_r, out) => void written.push(out), ui },
  );
  expect(calls).toEqual([]);
  expect(written).toEqual([]);
  // The preview says it is the local build, so a reader sees which caret would install.
  expect(ui.events).toContain("note:Claude Code (local build) — would run");
});

test("the install narrates one step per phase, naming each claude command as it runs", async () => {
  const { runner } = recorder();
  const ui = recordingUI();
  await runInstallClaudeTarget({ uninstall: false, dryRun: false }, { claude: runner, ui });
  expect(ui.events.filter((e) => e.startsWith("step:"))).toEqual([
    "step:Registering the caret marketplace",
    "step:Installing the caret plugin",
  ]);
  // The spinner shows the underlying command while each phase runs.
  expect(ui.events).toContain("detail:claude plugin install caret@caret --scope user");
});
