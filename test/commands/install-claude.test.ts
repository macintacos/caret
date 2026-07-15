// caret's Claude Code install target: drives the `claude` plugin CLI. The runner is
// injected, so these assert the exact commands issued without spawning `claude`.

import { expect, test } from "bun:test";
import { type ClaudeRunner, runInstallClaudeTarget } from "../../src/commands/install-claude.ts";

// A runner that records every `claude` invocation and returns a scripted result.
function recorder(result: ReturnType<ClaudeRunner> = { ok: true, detail: "" }): {
  runner: ClaudeRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  return {
    calls,
    runner: (args) => {
      calls.push(args);
      return result;
    },
  };
}

test("install adds the marketplace, then installs and enables the plugin", () => {
  const { runner, calls } = recorder();
  runInstallClaudeTarget({ uninstall: false, dryRun: false }, { claude: runner });
  expect(calls).toEqual([
    ["plugin", "marketplace", "add", "macintacos/caret"],
    ["plugin", "install", "caret@caret", "--scope", "user"],
    ["plugin", "enable", "caret@caret"],
  ]);
});

test("uninstall removes the plugin", () => {
  const { runner, calls } = recorder();
  runInstallClaudeTarget({ uninstall: true, dryRun: false }, { claude: runner });
  expect(calls).toEqual([["plugin", "uninstall", "caret@caret"]]);
});

test("dry-run prints the commands without spawning claude", () => {
  const { runner, calls } = recorder();
  runInstallClaudeTarget({ uninstall: false, dryRun: true }, { claude: runner });
  expect(calls).toEqual([]);
});

test("a missing claude CLI stops after the first step (guidance, not a crash)", () => {
  const { runner, calls } = recorder({ ok: false, missing: true, detail: "ENOENT" });
  runInstallClaudeTarget({ uninstall: false, dryRun: false }, { claude: runner });
  // Bails on the first (marketplace add) step rather than pressing on to install.
  expect(calls).toEqual([["plugin", "marketplace", "add", "macintacos/caret"]]);
});

test("a failed marketplace add is best-effort; a failed install is fatal", () => {
  // marketplace add fails (already registered), install fails for real -> stop there.
  let n = 0;
  const calls: string[][] = [];
  const runner: ClaudeRunner = (args) => {
    calls.push(args);
    n++;
    return n === 1 ? { ok: false, detail: "already added" } : { ok: false, detail: "boom" };
  };
  runInstallClaudeTarget({ uninstall: false, dryRun: false }, { claude: runner });
  expect(calls).toEqual([
    ["plugin", "marketplace", "add", "macintacos/caret"],
    ["plugin", "install", "caret@caret", "--scope", "user"],
  ]);
});
