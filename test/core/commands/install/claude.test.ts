// caret's Claude Code install target: drives the `claude` plugin CLI. The runner is
// injected, so these assert the exact commands issued without spawning `claude`, and a
// recording UI pins how the run is reported step by step.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type ClaudeRunner, runInstallClaudeTarget } from "@/commands/install/claude.ts";
import { type InstallUI, recordingUI, silentUI } from "@/commands/install/ui.ts";

// A runner that records every `claude` invocation and returns a scripted result.
function recorder(
  result: Awaited<ReturnType<ClaudeRunner>> = { ok: true, detail: "", stdout: "" },
): {
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

/** The dev-mode `local` option every `--from-local` case installs from. */
const localTarget = { repoDir: "/checkout", marketplaceDir: "/dev-mp" };

/** Run `--from-local` against `runner` with a recording UI and a no-op
 * marketplace writer, returning that UI — the invocation shape shared by every
 * case below that inspects the transcript. */
async function runLocalWithUi(runner: ClaudeRunner): Promise<ReturnType<typeof recordingUI>> {
  const ui = recordingUI();
  await runInstallClaudeTarget(
    { uninstall: false, dryRun: false, local: localTarget },
    { claude: runner, writeDevMarketplace: () => {}, ui },
  );
  return ui;
}

/** A `claude plugin list --json` payload reporting `version` for caret, alongside another
 * plugin so the lookup has to pick caret's entry out rather than take the first. */
function listing(version: string): string {
  return JSON.stringify([
    { id: "other@other", version: "9.9.9", scope: "user", enabled: true },
    { id: "caret@caret", version, scope: "user", enabled: true, installPath: "/cache/caret" },
  ]);
}

/** A runner whose `plugin list --json` replies come from a queue — one per read — so a
 * test can script what Claude reports before and after the update. */
function versioned(listings: string[]): { runner: ClaudeRunner; calls: string[][] } {
  const calls: string[][] = [];
  const queue = [...listings];
  return {
    calls,
    runner: async (args) => {
      calls.push(args);
      return { ok: true, detail: "", stdout: args[1] === "list" ? (queue.shift() ?? "") : "" };
    },
  };
}

// Unconditional, not a fallback: on a machine whose marketplace is already registered
// the marketplace-update step no-ops, and without this refresh the install reads stale
// metadata.
const SUCCESSFUL_INSTALL_CALLS: string[][] = [
  ["plugin", "marketplace", "add", "macintacos/caret"],
  ["plugin", "marketplace", "update", "caret"],
  ["plugin", "install", "caret@caret", "--scope", "user"],
  ["plugin", "enable", "caret@caret"],
  ["plugin", "list", "--json"],
  ["plugin", "update", "caret@caret", "--scope", "user"],
  ["plugin", "list", "--json"],
];

test("install refreshes the marketplace, installs and enables, then updates the plugin", async () => {
  const { runner, calls } = recorder();
  await runInstallClaudeTarget({ uninstall: false, dryRun: false }, { claude: runner });
  expect(calls).toEqual(SUCCESSFUL_INSTALL_CALLS);
});

test("an updated plugin settles with the versions it moved between", async () => {
  const { runner } = versioned([listing("0.7.3"), listing("0.8.1")]);
  const ui = recordingUI();
  await runInstallClaudeTarget({ uninstall: false, dryRun: false }, { claude: runner, ui });
  expect(ui.events).toContain("settled:caret 0.7.3 → 0.8.1 in Claude Code — restart to apply");
});

test("an unchanged version settles as already current", async () => {
  const { runner } = versioned([listing("0.8.1"), listing("0.8.1")]);
  const ui = recordingUI();
  await runInstallClaudeTarget({ uninstall: false, dryRun: false }, { claude: runner, ui });
  expect(ui.events).toContain("settled:caret 0.8.1 in Claude Code — already current");
});

test("an unreadable plugin list still settles, and the install still succeeds", async () => {
  const { runner } = versioned(["not json at all", '{"plugins":[]}']);
  const ui = recordingUI();
  const ok = await runInstallClaudeTarget(
    { uninstall: false, dryRun: false },
    { claude: runner, ui },
  );
  expect(ok).toBe(true);
  expect(ui.events).toContain("settled:Asked Claude Code for the latest caret — restart to apply");
  expect(ui.events.some((e) => e.startsWith("failed:"))).toBe(false);
});

test("a failed plugin update warns and says so, rather than claiming already-current", async () => {
  // The two version reads are identical when the update never lands, so a line derived
  // from them alone would report "already current" — the exact false reassurance this
  // command exists to remove.
  const calls: string[][] = [];
  const runner: ClaudeRunner = async (args) => {
    calls.push(args);
    if (args[1] === "update") return { ok: false, detail: "network down", stdout: "" };
    return { ok: true, detail: "", stdout: args[1] === "list" ? listing("0.7.3") : "" };
  };
  const ui = recordingUI();
  const ok = await runInstallClaudeTarget(
    { uninstall: false, dryRun: false },
    { claude: runner, ui },
  );
  expect(ok).toBe(true); // best-effort: a failed update does not fail the install
  expect(calls).toContainEqual(["plugin", "update", "caret@caret", "--scope", "user"]);
  expect(ui.events).toContain("settled:caret 0.7.3 in Claude Code — the update did not land");
  expect(ui.events.some((e) => e.startsWith("warn:") && e.includes("network down"))).toBe(true);
  expect(ui.events.some((e) => e.startsWith("failed:"))).toBe(false);
});

test("the version read prefers the user-scope row, which is the one the update targets", async () => {
  // `plugin update --scope user` moves the user row; reporting a project row's version
  // beside it would describe a plugin the command never touched.
  const both = (userVersion: string) =>
    JSON.stringify([
      { id: "caret@caret", version: "0.1.0", scope: "project", enabled: true },
      { id: "caret@caret", version: userVersion, scope: "user", enabled: true },
    ]);
  const queue = [both("0.7.3"), both("0.8.1")];
  const runner: ClaudeRunner = async (args) => ({
    ok: true,
    detail: "",
    stdout: args[1] === "list" ? (queue.shift() ?? "") : "",
  });
  const ui = recordingUI();
  await runInstallClaudeTarget({ uninstall: false, dryRun: false }, { claude: runner, ui });
  expect(ui.events).toContain("settled:caret 0.7.3 → 0.8.1 in Claude Code — restart to apply");
});

test("neither --from-local nor --uninstall asks Claude to update the plugin", async () => {
  // Local mode already uninstalls and reinstalls the dev build; an update there would pull
  // the published plugin over it. An uninstall is setting nothing up.
  const local = recorder();
  await runInstallClaudeTarget(
    { uninstall: false, dryRun: false, local: localTarget },
    { claude: local.runner, writeDevMarketplace: () => {} },
  );
  const removed = recorder();
  await runInstallClaudeTarget({ uninstall: true, dryRun: false }, { claude: removed.runner });
  for (const calls of [local.calls, removed.calls]) {
    expect(calls.some((c) => c[1] === "update" || c[1] === "list")).toBe(false);
  }
});

test("the dry-run preview lists the marketplace refresh and the plugin update", async () => {
  const { runner } = recorder();
  const bodies: string[] = [];
  const ui: InstallUI = { ...silentUI, note: (body) => void bodies.push(body) };
  await runInstallClaudeTarget({ uninstall: false, dryRun: true }, { claude: runner, ui });
  expect(bodies.join("\n")).toContain("claude plugin marketplace update caret");
  expect(bodies.join("\n")).toContain("claude plugin update caret@caret --scope user");
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
  const { runner, calls } = recorder({ ok: false, missing: true, detail: "ENOENT", stdout: "" });
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
    return n === 1
      ? { ok: false, detail: "already added", stdout: "" }
      : { ok: false, detail: "boom", stdout: "" };
  };
  await runInstallClaudeTarget({ uninstall: false, dryRun: false }, { claude: runner });
  expect(calls).toEqual(SUCCESSFUL_INSTALL_CALLS.slice(0, 3));
});

test("a failed enable is best-effort: the install still completes", async () => {
  // `plugin enable` fails on a plugin Claude already has enabled; that is not a reason
  // to report a failed install.
  const calls: string[][] = [];
  const runner: ClaudeRunner = async (args) => {
    calls.push(args);
    return args[1] === "enable"
      ? { ok: false, detail: "already enabled", stdout: "" }
      : { ok: true, detail: "", stdout: "" };
  };
  const ui = recordingUI();
  await runInstallClaudeTarget({ uninstall: false, dryRun: false }, { claude: runner, ui });
  expect(calls).toEqual(SUCCESSFUL_INSTALL_CALLS);
  expect(ui.events.some((e) => e.startsWith("error:"))).toBe(false);
  expect(ui.events.some((e) => e.startsWith("failed:"))).toBe(false);
});

test("--from-local registers the generated dev marketplace, never the published one", async () => {
  const { runner, calls } = recorder();
  const written: [string, string][] = [];
  await runInstallClaudeTarget(
    { uninstall: false, dryRun: false, local: localTarget },
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

test("--from-local survives a clean machine: uninstall and enable failures are best-effort", async () => {
  // Nothing to uninstall on a first install, and enable fails on an already-enabled
  // plugin; the reinstall must still land the fresh build.
  const calls: string[][] = [];
  const runner: ClaudeRunner = async (args) => {
    calls.push(args);
    return args[1] === "uninstall" || args[1] === "enable"
      ? { ok: false, detail: "nothing to do", stdout: "" }
      : { ok: true, detail: "", stdout: "" };
  };
  const ui = await runLocalWithUi(runner);
  expect(calls).toContainEqual(["plugin", "install", "caret@caret", "--scope", "user"]);
  expect(ui.events.some((e) => e.startsWith("error:"))).toBe(false);
});

test("--from-local falls back to updating the marketplace when the add fails", async () => {
  // `marketplace add` fails once the dev marketplace is already registered; the update
  // re-reads the same generated dir, so the run still installs the local build.
  const calls: string[][] = [];
  const runner: ClaudeRunner = async (args) => {
    calls.push(args);
    return args[2] === "add"
      ? { ok: false, detail: "already exists", stdout: "" }
      : { ok: true, detail: "", stdout: "" };
  };
  await runInstallClaudeTarget(
    { uninstall: false, dryRun: false, local: localTarget },
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
    return args[1] === "marketplace"
      ? { ok: false, detail: "nope", stdout: "" }
      : { ok: true, detail: "", stdout: "" };
  };
  const ui = await runLocalWithUi(runner);
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
    { uninstall: false, dryRun: true, local: localTarget },
    { claude: runner, writeDevMarketplace: (_r, out) => void written.push(out), ui },
  );
  expect(calls).toEqual([]);
  expect(written).toEqual([]);
  // The preview says it is the local build, so a reader sees which caret would install.
  expect(ui.events).toContain("note:Claude Code (local build) — would run");
});

test("a reported failure is returned to the caller, a clean install is not", async () => {
  const failing: ClaudeRunner = async () => ({ ok: false, detail: "boom", stdout: "" });
  expect(
    await runInstallClaudeTarget({ uninstall: false, dryRun: false }, { claude: failing }),
  ).toBe(false);
  const { runner } = recorder();
  expect(
    await runInstallClaudeTarget({ uninstall: false, dryRun: false }, { claude: runner }),
  ).toBe(true);
});

test("--from-local writes a real dev marketplace through the production wiring", async () => {
  // Every other local-mode test injects the writer; this one runs the default so a broken
  // default can't stay green.
  const dir = mkdtempSync(join(tmpdir(), "caret-claude-"));
  try {
    const { runner } = recorder();
    await runInstallClaudeTarget(
      {
        uninstall: false,
        dryRun: false,
        local: { repoDir: dir, marketplaceDir: join(dir, "dev-marketplace") },
      },
      { claude: runner },
    );
    const manifest = readFileSync(
      join(dir, "dev-marketplace", ".claude-plugin", "marketplace.json"),
      "utf8",
    );
    expect(JSON.parse(manifest).plugins[0].source).toBe("./caret");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the install narrates one step per phase, naming each claude command as it runs", async () => {
  const { runner } = recorder();
  const ui = recordingUI();
  await runInstallClaudeTarget({ uninstall: false, dryRun: false }, { claude: runner, ui });
  expect(ui.events.filter((e) => e.startsWith("step:"))).toEqual([
    "step:Registering the caret marketplace",
    "step:Installing the caret plugin",
    "step:Updating the caret plugin",
  ]);
  // The spinner shows the underlying command while each phase runs.
  expect(ui.events).toContain("detail:claude plugin install caret@caret --scope user");
});
