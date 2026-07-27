// The `caret install` orchestrator: target parsing (pure), the no-`--target` selection
// policy (chooser on a TTY, detected agents otherwise), and dispatch to the injected
// target runners.

import { afterEach, expect, test } from "bun:test";

import { parseTargets, runInstallSubcommand } from "@/commands/install/index.ts";
import type { InstallTarget } from "@/commands/install/targets.ts";
import { recordingUI, silentUI } from "@/commands/install/ui.ts";
import { RUMDL_VERSION } from "@/plan/rumdl.ts";

/** Keep a test off the real rumdl download: without this seam the command falls through
 * to the production acquisition, which reaches the network and writes to the state dir. */
const noRumdl = async () => ({ bin: "/tmp/rumdl", installed: false });

test("parseTargets accepts a single target, both, and dedupes/preserves order", () => {
  expect(parseTargets("opencode")).toEqual({ targets: ["opencode"] });
  expect(parseTargets("claude")).toEqual({ targets: ["claude"] });
  expect(parseTargets("opencode,claude")).toEqual({ targets: ["opencode", "claude"] });
  expect(parseTargets(" claude , opencode ")).toEqual({ targets: ["claude", "opencode"] });
  expect(parseTargets("opencode,opencode")).toEqual({ targets: ["opencode"] });
});

test("parseTargets errors on an empty or unknown target", () => {
  expect(parseTargets(undefined)).toHaveProperty("error");
  expect(parseTargets("")).toHaveProperty("error");
  const bad = parseTargets("opencode,vim");
  expect("error" in bad && bad.error).toContain("vim");
});

afterEach(() => {
  process.exitCode = 0;
});

test("runInstallSubcommand dispatches to each selected target with the same opts", async () => {
  const calls: string[] = [];
  await runInstallSubcommand(
    { target: "opencode,claude", uninstall: true, dryRun: false },
    {
      ui: silentUI,
      runOpencode: (o) => void calls.push(`opencode:${o.uninstall}:${o.dryRun}`),
      runClaude: (o) => void calls.push(`claude:${o.uninstall}:${o.dryRun}`),
    },
  );
  expect(calls).toEqual(["opencode:true:false", "claude:true:false"]);
});

test("--refresh reaches every target runner, and defaults to off", async () => {
  const seen: (boolean | undefined)[] = [];
  const deps = {
    ui: silentUI,
    ensureRumdl: noRumdl,
    runOpencode: (o: { refresh: boolean }) => void seen.push(o.refresh),
    runClaude: (o: { refresh: boolean }) => void seen.push(o.refresh),
  };
  await runInstallSubcommand(
    { target: "opencode,claude", uninstall: false, dryRun: false, refresh: true },
    deps,
  );
  await runInstallSubcommand({ target: "opencode", uninstall: false, dryRun: false }, deps);
  expect(seen).toEqual([true, true, false]);
});

test("runInstallSubcommand runs only the requested target", async () => {
  const calls: string[] = [];
  await runInstallSubcommand(
    { target: "opencode", uninstall: false, dryRun: true },
    {
      ui: silentUI,
      runOpencode: () => void calls.push("opencode"),
      runClaude: () => void calls.push("claude"),
    },
  );
  expect(calls).toEqual(["opencode"]);
});

test("runInstallSubcommand sets a non-zero exit code and dispatches nothing on a bad target", async () => {
  const calls: string[] = [];
  await runInstallSubcommand(
    { target: "bogus", uninstall: false, dryRun: false },
    {
      ui: silentUI,
      runOpencode: () => void calls.push("opencode"),
      runClaude: () => void calls.push("claude"),
    },
  );
  expect(calls).toEqual([]);
  expect(process.exitCode).toBe(2);
});

test("with no --target on a TTY, the chooser sees the detected agents and drives dispatch", async () => {
  const calls: string[] = [];
  let offered: InstallTarget[] = [];
  await runInstallSubcommand(
    { uninstall: false, dryRun: false },
    {
      detect: () => ["claude"],
      isInteractive: () => true,
      prompt: async (detected) => {
        offered = detected;
        return ["opencode", "claude"];
      },
      ui: silentUI,
      runOpencode: () => void calls.push("opencode"),
      runClaude: () => void calls.push("claude"),
      ensureRumdl: noRumdl,
    },
  );
  expect(offered).toEqual(["claude"]);
  expect(calls).toEqual(["opencode", "claude"]);
});

test("a cancelled chooser installs nothing", async () => {
  const calls: string[] = [];
  let prompted = false;
  await runInstallSubcommand(
    { uninstall: false, dryRun: false },
    {
      detect: () => ["claude", "opencode"],
      isInteractive: () => true,
      prompt: async () => {
        prompted = true;
        return null;
      },
      ui: silentUI,
      runOpencode: () => void calls.push("opencode"),
      runClaude: () => void calls.push("claude"),
    },
  );
  expect(prompted).toBe(true);
  expect(calls).toEqual([]);
});

test("with no --target and no TTY, every detected agent is installed without prompting", async () => {
  const calls: string[] = [];
  let prompted = false;
  await runInstallSubcommand(
    { uninstall: false, dryRun: false },
    {
      detect: () => ["claude", "opencode"],
      isInteractive: () => false,
      prompt: async () => {
        prompted = true;
        return null;
      },
      ui: silentUI,
      runOpencode: () => void calls.push("opencode"),
      runClaude: () => void calls.push("claude"),
      ensureRumdl: noRumdl,
    },
  );
  expect(prompted).toBe(false);
  expect(calls).toEqual(["claude", "opencode"]);
});

test("with no --target, no TTY, and no agent detected, it falls back to Claude Code", async () => {
  const calls: string[] = [];
  await runInstallSubcommand(
    { uninstall: false, dryRun: false },
    {
      detect: () => [],
      isInteractive: () => false,
      prompt: async () => null,
      ui: silentUI,
      runOpencode: () => void calls.push("opencode"),
      runClaude: () => void calls.push("claude"),
      ensureRumdl: noRumdl,
    },
  );
  expect(calls).toEqual(["claude"]);
});

test("with no --target, the chooser is told whether this is an uninstall", async () => {
  let asked: boolean | undefined;
  await runInstallSubcommand(
    { uninstall: true, dryRun: false },
    {
      detect: () => ["claude"],
      isInteractive: () => true,
      prompt: async (_detected, uninstall) => {
        asked = uninstall;
        return [];
      },
      ui: silentUI,
      runClaude: () => {},
    },
  );
  expect(asked).toBe(true);
});

test("installing ensures rumdl once, after the targets", async () => {
  const calls: string[] = [];
  await runInstallSubcommand(
    { target: "claude", uninstall: false, dryRun: false },
    {
      ui: silentUI,
      runClaude: () => void calls.push("claude"),
      ensureRumdl: async () => {
        calls.push("rumdl");
        return { bin: "/x/rumdl", installed: false };
      },
    },
  );
  expect(calls).toEqual(["claude", "rumdl"]);
});

test("the rumdl step reports a fresh download, naming the binary", async () => {
  const ui = recordingUI();
  await runInstallSubcommand(
    { target: "claude", uninstall: false, dryRun: false },
    {
      ui,
      runClaude: () => {},
      ensureRumdl: async () => ({ bin: "/x/rumdl", installed: true }),
    },
  );
  expect(ui.events).toContain(`settled:rumdl ${RUMDL_VERSION} installed at /x/rumdl`);
});

test("the rumdl step reports an already-cached binary as present, not downloaded", async () => {
  const ui = recordingUI();
  await runInstallSubcommand(
    { target: "claude", uninstall: false, dryRun: false },
    {
      ui,
      runClaude: () => {},
      ensureRumdl: async () => ({ bin: "/x/rumdl", installed: false }),
    },
  );
  expect(ui.events).toContain(`settled:rumdl ${RUMDL_VERSION} already present at /x/rumdl`);
});

test("uninstalling and --dry-run never download rumdl", async () => {
  const calls: string[] = [];
  const deps = {
    runClaude: () => {},
    ui: silentUI,
    ensureRumdl: async () => {
      calls.push("rumdl");
      return { bin: "/x/rumdl", installed: false };
    },
  };
  await runInstallSubcommand({ target: "claude", uninstall: true, dryRun: false }, deps);
  await runInstallSubcommand({ target: "claude", uninstall: false, dryRun: true }, deps);
  expect(calls).toEqual([]);
});

test("a failing rumdl download leaves the install successful", async () => {
  const calls: string[] = [];
  await runInstallSubcommand(
    { target: "claude", uninstall: false, dryRun: false },
    {
      ui: silentUI,
      runClaude: () => void calls.push("claude"),
      ensureRumdl: () => Promise.reject(new Error("offline")),
    },
  );
  expect(calls).toEqual(["claude"]);
  expect(process.exitCode).toBe(0);
});

test("the reporter reaches the real target runners, not just the orchestrator", async () => {
  // Dry-run so the Claude target only previews (no `claude` spawn). With no runner
  // overrides this exercises production dispatch — the wiring that silently fell back
  // to the no-op UI when the reporter was passed in the runner's deps position.
  const ui = recordingUI();
  await runInstallSubcommand({ target: "claude", uninstall: false, dryRun: true }, { ui });
  expect(ui.events).toContain("note:Claude Code — would run");
});

test("--from-local hands every target the resolved checkout and prewarms once, last", async () => {
  const calls: string[] = [];
  let handed: unknown;
  await runInstallSubcommand(
    { target: "claude", uninstall: false, dryRun: false, fromLocal: true },
    {
      ui: silentUI,
      resolveLocal: () => ({ repoDir: "/checkout", ref: "v0.7.2-dirty" }),
      marketplaceDir: () => "/dev-mp",
      runClaude: (o) => {
        calls.push("claude");
        handed = o.local;
      },
      ensureRumdl: async () => {
        calls.push("rumdl");
        return { bin: "/x/rumdl", installed: false };
      },
      prewarm: async () => void calls.push("prewarm"),
    },
  );
  expect(handed).toEqual({ repoDir: "/checkout", marketplaceDir: "/dev-mp" });
  expect(calls).toEqual(["claude", "rumdl", "prewarm"]);
});

test("without --from-local nothing prewarms and no target sees a checkout", async () => {
  const calls: string[] = [];
  let handed: unknown = "untouched";
  await runInstallSubcommand(
    { target: "claude", uninstall: false, dryRun: false },
    {
      ui: silentUI,
      runClaude: (o) => {
        handed = o.local;
      },
      ensureRumdl: noRumdl,
      prewarm: async () => void calls.push("prewarm"),
    },
  );
  expect(handed).toBeUndefined();
  expect(calls).toEqual([]);
});

test("--from-local outside a built checkout installs nothing and exits non-zero", async () => {
  const calls: string[] = [];
  const ui = recordingUI();
  await runInstallSubcommand(
    { target: "claude", uninstall: false, dryRun: false, fromLocal: true },
    {
      ui,
      resolveLocal: () => {
        throw new Error("run `mise run build` first");
      },
      runClaude: () => void calls.push("claude"),
      ensureRumdl: noRumdl,
      prewarm: async () => void calls.push("prewarm"),
    },
  );
  expect(calls).toEqual([]);
  expect(process.exitCode).toBe(2);
  expect(ui.events.some((e) => e.includes("mise run build"))).toBe(true);
});

test("--from-local --uninstall is refused: local mode only installs", async () => {
  const calls: string[] = [];
  await runInstallSubcommand(
    { target: "claude", uninstall: true, dryRun: false, fromLocal: true },
    {
      ui: silentUI,
      resolveLocal: () => ({ repoDir: "/checkout", ref: "ref" }),
      runClaude: () => void calls.push("claude"),
    },
  );
  expect(calls).toEqual([]);
  expect(process.exitCode).toBe(2);
});

test("--from-local --dry-run previews without prewarming", async () => {
  const calls: string[] = [];
  await runInstallSubcommand(
    { target: "claude", uninstall: false, dryRun: true, fromLocal: true },
    {
      ui: silentUI,
      resolveLocal: () => ({ repoDir: "/checkout", ref: "ref" }),
      marketplaceDir: () => "/dev-mp",
      runClaude: () => void calls.push("claude"),
      prewarm: async () => void calls.push("prewarm"),
    },
  );
  expect(calls).toEqual(["claude"]);
});

test("the prewarm step reports that prewarm ran, not that the daemon was swapped", async () => {
  // prewarm retires a retireable daemon but reuses a legacy one, and can't report which
  // happened — so the step must not claim the fresh build is now serving.
  const ui = recordingUI();
  await runInstallSubcommand(
    { target: "claude", uninstall: false, dryRun: false, fromLocal: true },
    {
      ui,
      resolveLocal: () => ({ repoDir: "/checkout", ref: "ref" }),
      marketplaceDir: () => "/dev-mp",
      runClaude: () => {},
      ensureRumdl: noRumdl,
      prewarm: async () => {},
    },
  );
  expect(ui.events).toContain("settled:Ran the fresh build's prewarm");
});

test("a dry run closes by saying nothing was changed", async () => {
  const ui = recordingUI();
  await runInstallSubcommand({ target: "claude", uninstall: false, dryRun: true }, { ui });
  expect(ui.events).toContain("outro:Dry run complete — nothing was changed.");
});

test("a target that reports failure exits non-zero and never claims caret was installed", async () => {
  // A green `mise run build --install` over a dev loop that installed nothing is what
  // this pins against: the exit code is the task's exit code.
  const calls: string[] = [];
  const ui = recordingUI();
  await runInstallSubcommand(
    { target: "claude", uninstall: false, dryRun: false, fromLocal: true },
    {
      ui,
      resolveLocal: () => ({ repoDir: "/checkout", ref: "ref" }),
      marketplaceDir: () => "/dev-mp",
      runClaude: () => false,
      ensureRumdl: async () => {
        calls.push("rumdl");
        return { bin: "/x/rumdl", installed: false };
      },
      prewarm: async () => void calls.push("prewarm"),
    },
  );
  expect(process.exitCode).toBe(1);
  expect(ui.events.some((e) => e.startsWith("outro:caret"))).toBe(false);
  // Nothing downstream runs: the build never landed, so there is nothing to warm.
  expect(calls).toEqual([]);
});

test("a throwing target is reported and fails the run rather than escaping the command", async () => {
  // An escaping throw reaches the CLI's fail-safe handler, which prints a hook deny line
  // and exits 0 — nonsense from an install command.
  const ui = recordingUI();
  await runInstallSubcommand(
    { target: "claude", uninstall: false, dryRun: false },
    {
      ui,
      runClaude: () => {
        throw new Error("EACCES");
      },
      ensureRumdl: noRumdl,
    },
  );
  expect(process.exitCode).toBe(1);
  expect(ui.events.some((e) => e.includes("EACCES"))).toBe(true);
});

test("--from-local --dry-run previews from a checkout that was never built", async () => {
  // The artifact guard is what makes a real run fail early; a preview changes nothing, so
  // it must still render (doc/ADVANCED.md points readers at exactly this command).
  let askedFor: boolean | undefined;
  await runInstallSubcommand(
    { target: "claude", uninstall: false, dryRun: true, fromLocal: true },
    {
      ui: silentUI,
      resolveLocal: (opts) => {
        askedFor = opts?.requireArtifacts;
        return { repoDir: "/checkout", ref: "ref" };
      },
      marketplaceDir: () => "/dev-mp",
      runClaude: () => {},
    },
  );
  expect(askedFor).toBe(false);
});

test("a failing prewarm still leaves the install successful", async () => {
  const ui = recordingUI();
  await runInstallSubcommand(
    { target: "claude", uninstall: false, dryRun: false, fromLocal: true },
    {
      ui,
      resolveLocal: () => ({ repoDir: "/checkout", ref: "ref" }),
      marketplaceDir: () => "/dev-mp",
      runClaude: () => {},
      ensureRumdl: noRumdl,
      prewarm: () => Promise.reject(new Error("daemon busy")),
    },
  );
  expect(process.exitCode).toBe(0);
  expect(ui.events.some((e) => e.startsWith("outro:"))).toBe(true);
});

test("--dry-run without --target previews the detected agents instead of prompting", async () => {
  const calls: string[] = [];
  let prompted = false;
  await runInstallSubcommand(
    { uninstall: false, dryRun: true },
    {
      detect: () => ["opencode"],
      isInteractive: () => true,
      prompt: async () => {
        prompted = true;
        return null;
      },
      ui: silentUI,
      runOpencode: () => void calls.push("opencode"),
      runClaude: () => void calls.push("claude"),
    },
  );
  expect(prompted).toBe(false);
  expect(calls).toEqual(["opencode"]);
});
