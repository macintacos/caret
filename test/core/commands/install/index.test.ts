// The `caret install` orchestrator: the selection policy (chooser on a TTY, detected
// agents otherwise) and dispatch to the injected target runners.

import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withEnv } from "@test/support/env.ts";
import { fakeServiceManager } from "@test/support/service-manager.ts";
import { installExitCode, runInstallSubcommand } from "@/commands/install/index.ts";
import { INSTALL_TARGET_IDS, type InstallTarget } from "@/commands/install/targets.ts";
import { recordingUI, silentUI } from "@/commands/install/ui.ts";
import { RUMDL_VERSION } from "@/plan/rumdl.ts";

/** Keep a test off the real rumdl download: without this seam the command falls through
 * to the production acquisition, which reaches the network and writes to the state dir. */
const noRumdl = async () => ({ bin: "/tmp/rumdl", installed: false });

/** The resolved local checkout every `--from-local` case installs from, sharing one ref. */
const resolvedCheckout = () => ({ repoDir: "/checkout", ref: "ref" });
const devMarketplaceDir = () => "/dev-mp";
const bothAgents = (): InstallTarget[] => ["claude", "opencode"];

/** The plain install invocation options every rumdl-step case starts from. Pair it with
 * `CLAUDE_ONLY` — without those seams a case reaches the machine's real agents and can
 * run a real installer against the developer's own config dir. */
const PLAIN_INSTALL = { uninstall: false, dryRun: false };

/** Selection seams pinning a case to Claude Code alone, so a run is driven by the test
 * rather than by whichever agents the machine running it happens to have. */
const CLAUDE_ONLY = { detect: (): InstallTarget[] => ["claude"], isInteractive: () => false };

/** Deps that just record which target ran, in order — the recording pair
 * nearly every dispatch test in this file shares. */
function recordingRunners(calls: string[]): { runOpencode: () => void; runClaude: () => void } {
  return {
    runOpencode: () => void calls.push("opencode"),
    runClaude: () => void calls.push("claude"),
  };
}

/** Claude-only selection with both the target run and the rumdl step recorded into
 * `calls`, so a case can assert the order the two happen in. */
function claudeThenRumdlDeps(calls: string[]) {
  return {
    ...CLAUDE_ONLY,
    ui: silentUI,
    runClaude: () => void calls.push("claude"),
    ensureRumdl: async () => {
      calls.push("rumdl");
      return { bin: "/x/rumdl", installed: false };
    },
  };
}

/** Deps shared by the two `--from-local` prewarm outcomes below — the Claude-only
 * selection seams, a resolved checkout, a no-op claude runner, and no rumdl download;
 * only `prewarm` differs. */
function fromLocalPrewarmDeps(ui: ReturnType<typeof recordingUI>, prewarm: () => Promise<void>) {
  return {
    ...CLAUDE_ONLY,
    ui,
    resolveLocal: resolvedCheckout,
    marketplaceDir: devMarketplaceDir,
    runClaude: () => {},
    ensureRumdl: noRumdl,
    prewarm,
  };
}

/** A chooser prompt that always cancels, recording whether it was ever invoked — the
 * fixture every "chooser not offered" and "chooser cancelled" case shares. */
function decliningPrompt(): { prompt: () => Promise<null>; wasPrompted: () => boolean } {
  let called = false;
  return {
    prompt: async () => {
      called = true;
      return null;
    },
    wasPrompted: () => called,
  };
}

test("every outcome maps to an exit code, and only a problem is non-zero", () => {
  expect(installExitCode("ok")).toBe(0);
  expect(installExitCode("refused")).toBe(2);
  expect(installExitCode("failed")).toBe(1);
});

test("runInstallSubcommand dispatches to each selected target with the same opts", async () => {
  const calls: string[] = [];
  await runInstallSubcommand(
    { uninstall: false, dryRun: true },
    {
      detect: () => ["opencode", "claude"],
      isInteractive: () => false,
      ui: silentUI,
      runOpencode: (o) => void calls.push(`opencode:${o.uninstall}:${o.dryRun}`),
      runClaude: (o) => void calls.push(`claude:${o.uninstall}:${o.dryRun}`),
    },
  );
  expect(calls).toEqual(["opencode:false:true", "claude:false:true"]);
});

test("--refresh reaches every target runner, and defaults to off", async () => {
  const seen: (boolean | undefined)[] = [];
  const deps = {
    ui: silentUI,
    ensureRumdl: noRumdl,
    isInteractive: () => false,
    runOpencode: (o: { refresh: boolean }) => void seen.push(o.refresh),
    runClaude: (o: { refresh: boolean }) => void seen.push(o.refresh),
  };
  await runInstallSubcommand(
    { uninstall: false, dryRun: false, refresh: true },
    { ...deps, detect: bothAgents },
  );
  await runInstallSubcommand(
    { uninstall: false, dryRun: false },
    { ...deps, detect: () => ["opencode"] },
  );
  expect(seen).toEqual([true, true, false]);
});

test("on a TTY, the chooser sees the detected agents and drives dispatch", async () => {
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
      ...recordingRunners(calls),
      ensureRumdl: noRumdl,
    },
  );
  expect(offered).toEqual(["claude"]);
  expect(calls).toEqual(["opencode", "claude"]);
});

test("a cancelled chooser installs nothing", async () => {
  const calls: string[] = [];
  const chooser = decliningPrompt();
  await runInstallSubcommand(
    { uninstall: false, dryRun: false },
    {
      detect: bothAgents,
      isInteractive: () => true,
      prompt: chooser.prompt,
      ui: silentUI,
      ...recordingRunners(calls),
    },
  );
  expect(chooser.wasPrompted()).toBe(true);
  expect(calls).toEqual([]);
});

test("with no TTY, every detected agent is installed without prompting", async () => {
  const calls: string[] = [];
  const chooser = decliningPrompt();
  await runInstallSubcommand(
    { uninstall: false, dryRun: false },
    {
      detect: bothAgents,
      isInteractive: () => false,
      prompt: chooser.prompt,
      ui: silentUI,
      ...recordingRunners(calls),
      ensureRumdl: noRumdl,
    },
  );
  expect(chooser.wasPrompted()).toBe(false);
  expect(calls).toEqual(["claude", "opencode"]);
});

test("with no TTY and no agent detected, it falls back to Claude Code", async () => {
  const calls: string[] = [];
  await runInstallSubcommand(
    { uninstall: false, dryRun: false },
    {
      detect: () => [],
      isInteractive: () => false,
      prompt: async () => null,
      ui: silentUI,
      ...recordingRunners(calls),
      ensureRumdl: noRumdl,
    },
  );
  expect(calls).toEqual(["claude"]);
});

test("--uninstall removes caret from every agent in the registry, without asking", async () => {
  const calls: string[] = [];
  const chooser = decliningPrompt();
  await runInstallSubcommand(
    { uninstall: true, dryRun: false },
    {
      // A TTY with one agent detected: neither fact may narrow what an uninstall removes.
      detect: () => ["claude"],
      isInteractive: () => true,
      prompt: chooser.prompt,
      ui: silentUI,
      runOpencode: (o) => void calls.push(`opencode:${o.uninstall}`),
      runClaude: (o) => void calls.push(`claude:${o.uninstall}`),
    },
  );
  expect(chooser.wasPrompted()).toBe(false);
  expect(calls).toEqual(INSTALL_TARGET_IDS.map((id) => `${id}:true`));
});

test("installing ensures rumdl once, after the targets", async () => {
  const calls: string[] = [];
  await runInstallSubcommand(PLAIN_INSTALL, claudeThenRumdlDeps(calls));
  expect(calls).toEqual(["claude", "rumdl"]);
});

test("the service is registered after the targets, so a refresh cycles the new build", async () => {
  const calls: string[] = [];
  // A config path nobody wrote, so the run reads the schema default rather than whatever
  // residency this machine's own caret is configured for.
  const absentConfig = join(await mkdtemp(join(tmpdir(), "caret-install-index-")), "config.toml");
  await withEnv({ CARET_CONFIG_FILE: absentConfig }, () =>
    runInstallSubcommand(PLAIN_INSTALL, {
      ...claudeThenRumdlDeps(calls),
      service: () => ({
        label: "caret.service",
        optOutSurface: "`systemctl --user`",
        manager: fakeServiceManager({ calls }).manager,
      }),
      installLauncher: () => {},
    }),
  );
  expect(calls).toEqual(["claude", "rumdl", "install"]);
});

test.each([
  ["a fresh download, naming the binary", true, "installed at"],
  ["an already-cached binary as present, not downloaded", false, "already present at"],
])("the rumdl step reports %s", async (_label, installed, phrase) => {
  const ui = recordingUI();
  await runInstallSubcommand(PLAIN_INSTALL, {
    ...CLAUDE_ONLY,
    ui,
    runClaude: () => {},
    ensureRumdl: async () => ({ bin: "/x/rumdl", installed }),
  });
  expect(ui.events).toContain(`settled:rumdl ${RUMDL_VERSION} ${phrase} /x/rumdl`);
});

test("uninstalling and --dry-run never download rumdl", async () => {
  const calls: string[] = [];
  const deps = {
    ...CLAUDE_ONLY,
    runClaude: () => {},
    runOpencode: () => {},
    ui: silentUI,
    ensureRumdl: async () => {
      calls.push("rumdl");
      return { bin: "/x/rumdl", installed: false };
    },
  };
  await runInstallSubcommand({ uninstall: true, dryRun: false }, deps);
  await runInstallSubcommand({ uninstall: false, dryRun: true }, deps);
  expect(calls).toEqual([]);
});

test("a failing rumdl download leaves the install successful", async () => {
  const calls: string[] = [];
  const outcome = await runInstallSubcommand(PLAIN_INSTALL, {
    ...CLAUDE_ONLY,
    ui: silentUI,
    runClaude: () => void calls.push("claude"),
    ensureRumdl: () => Promise.reject(new Error("offline")),
  });
  expect(calls).toEqual(["claude"]);
  expect(outcome).toBe("ok");
});

test("the reporter reaches the real target runners, not just the orchestrator", async () => {
  // Dry-run so the Claude target only previews (no `claude` spawn). With no runner
  // overrides this exercises production dispatch — the wiring that silently fell back
  // to the no-op UI when the reporter was passed in the runner's deps position.
  const ui = recordingUI();
  await runInstallSubcommand({ uninstall: false, dryRun: true }, { ...CLAUDE_ONLY, ui });
  expect(ui.events).toContain("note:Claude Code — would run");
});

test("--from-local hands every target the resolved checkout and prewarms once, last", async () => {
  const calls: string[] = [];
  let handed: unknown;
  await runInstallSubcommand(
    { uninstall: false, dryRun: false, fromLocal: true },
    {
      ...CLAUDE_ONLY,
      ui: silentUI,
      resolveLocal: () => ({ repoDir: "/checkout", ref: "v0.7.2-dirty" }),
      marketplaceDir: devMarketplaceDir,
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
  await runInstallSubcommand(PLAIN_INSTALL, {
    ...CLAUDE_ONLY,
    ui: silentUI,
    runClaude: (o) => {
      handed = o.local;
    },
    ensureRumdl: noRumdl,
    prewarm: async () => void calls.push("prewarm"),
  });
  expect(handed).toBeUndefined();
  expect(calls).toEqual([]);
});

test("--from-local outside a built checkout installs nothing and is refused", async () => {
  const calls: string[] = [];
  const ui = recordingUI();
  const outcome = await runInstallSubcommand(
    { uninstall: false, dryRun: false, fromLocal: true },
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
  expect(outcome).toBe("refused");
  expect(ui.events.some((e) => e.includes("mise run build"))).toBe(true);
});

test("--from-local --uninstall is refused: local mode only installs", async () => {
  const calls: string[] = [];
  const outcome = await runInstallSubcommand(
    { uninstall: true, dryRun: false, fromLocal: true },
    {
      ui: silentUI,
      resolveLocal: resolvedCheckout,
      runClaude: () => void calls.push("claude"),
    },
  );
  expect(calls).toEqual([]);
  expect(outcome).toBe("refused");
});

test("--from-local --dry-run previews without prewarming", async () => {
  const calls: string[] = [];
  await runInstallSubcommand(
    { uninstall: false, dryRun: true, fromLocal: true },
    {
      ...CLAUDE_ONLY,
      ui: silentUI,
      resolveLocal: resolvedCheckout,
      marketplaceDir: devMarketplaceDir,
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
    { uninstall: false, dryRun: false, fromLocal: true },
    fromLocalPrewarmDeps(ui, async () => {}),
  );
  expect(ui.events).toContain("settled:Ran the fresh build's prewarm");
});

test("a dry run closes by saying nothing was changed", async () => {
  const ui = recordingUI();
  await runInstallSubcommand({ uninstall: false, dryRun: true }, { ...CLAUDE_ONLY, ui });
  expect(ui.events).toContain("outro:Dry run complete — nothing was changed.");
});

test("a target that reports failure exits non-zero and never claims caret was installed", async () => {
  // A green `mise run build --install` over a dev loop that installed nothing is what
  // this pins against: the exit code is the task's exit code.
  const calls: string[] = [];
  const ui = recordingUI();
  const outcome = await runInstallSubcommand(
    { uninstall: false, dryRun: false, fromLocal: true },
    {
      ...CLAUDE_ONLY,
      ui,
      resolveLocal: resolvedCheckout,
      marketplaceDir: devMarketplaceDir,
      runClaude: () => false,
      ensureRumdl: async () => {
        calls.push("rumdl");
        return { bin: "/x/rumdl", installed: false };
      },
      prewarm: async () => void calls.push("prewarm"),
    },
  );
  expect(outcome).toBe("failed");
  expect(ui.events.some((e) => e.startsWith("outro:caret"))).toBe(false);
  // Nothing downstream runs: the build never landed, so there is nothing to warm.
  expect(calls).toEqual([]);
});

test("a throwing target is reported and fails the run rather than escaping the command", async () => {
  // An escaping throw reaches the CLI's fail-safe handler, which prints a hook deny line
  // and exits 0 — nonsense from an install command.
  const ui = recordingUI();
  const outcome = await runInstallSubcommand(PLAIN_INSTALL, {
    ...CLAUDE_ONLY,
    ui,
    runClaude: () => {
      throw new Error("EACCES");
    },
    ensureRumdl: noRumdl,
  });
  expect(outcome).toBe("failed");
  expect(ui.events.some((e) => e.includes("EACCES"))).toBe(true);
});

test("--from-local --dry-run previews from a checkout that was never built", async () => {
  // The artifact guard is what makes a real run fail early; a preview changes nothing, so
  // it must still render (doc/DEVELOPMENT.md points readers at exactly this command).
  let askedFor: boolean | undefined;
  await runInstallSubcommand(
    { uninstall: false, dryRun: true, fromLocal: true },
    {
      ...CLAUDE_ONLY,
      ui: silentUI,
      resolveLocal: (opts) => {
        askedFor = opts?.requireArtifacts;
        return resolvedCheckout();
      },
      marketplaceDir: devMarketplaceDir,
      runClaude: () => {},
    },
  );
  expect(askedFor).toBe(false);
});

test("a failing prewarm still leaves the install successful", async () => {
  const ui = recordingUI();
  const outcome = await runInstallSubcommand(
    { uninstall: false, dryRun: false, fromLocal: true },
    fromLocalPrewarmDeps(ui, () => Promise.reject(new Error("daemon busy"))),
  );
  expect(outcome).toBe("ok");
  expect(ui.events.some((e) => e.startsWith("outro:"))).toBe(true);
});

test("--dry-run previews the detected agents instead of prompting", async () => {
  const calls: string[] = [];
  const chooser = decliningPrompt();
  await runInstallSubcommand(
    { uninstall: false, dryRun: true },
    {
      detect: () => ["opencode"],
      isInteractive: () => true,
      prompt: chooser.prompt,
      ui: silentUI,
      ...recordingRunners(calls),
    },
  );
  expect(chooser.wasPrompted()).toBe(false);
  expect(calls).toEqual(["opencode"]);
});
