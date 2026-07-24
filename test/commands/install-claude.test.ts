// caret's Claude Code install target: drives the `claude` plugin CLI. The runner is
// injected, so these assert the exact commands issued without spawning `claude`, and a
// recording UI pins how the run is reported step by step.

import { expect, test } from "bun:test";

import { type ClaudeRunner, runInstallClaudeTarget } from "@/commands/install-claude.ts";
import { recordingUI } from "@/commands/install-ui.ts";

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
