// caret's pi install target. Every change goes through pi's own package commands
// (`pi install`, `pi update`, `pi remove`), so pi's settings.json stays pi's to write.

import { homedir } from "node:os";
import { resolve } from "node:path";

import { PI_FLOOR, type PiVersion, readPiVersion } from "@/adapters/pi/host.ts";
import { type PiCaretEntry, piAgentDir, readPiCaretEntries } from "@/adapters/pi/install.ts";
import type { LocalInstall } from "@/commands/install/local.ts";
import { type InstallUI, silentUI } from "@/commands/install/ui.ts";
import { errorMessage } from "@/lib/types.ts";
import { runCommand } from "@/service/run.ts";

const CARET_NPM_SOURCE = "npm:@macintacos/caret";
const PI_PACKAGE = "@earendil-works/pi-coding-agent";

/** Run a `pi` subcommand: ok, or a failure detail. Never rejects. */
export type PiRunner = (args: string[]) => Promise<{ ok: boolean; detail: string }>;

const piCli: PiRunner = async (args) => {
  const { code, stderr } = await runCommand(["pi", ...args]);
  return { ok: code === 0, detail: stderr.trim() || `pi exited ${code}` };
};

type PiStep =
  | { kind: "remove"; entry: PiCaretEntry }
  | { kind: "install"; source: string }
  | { kind: "update"; entry: PiCaretEntry }
  | { kind: "pinned"; entry: PiCaretEntry };

function planPiSteps(
  entries: PiCaretEntry[],
  { uninstall, localDir }: { uninstall: boolean; localDir?: string },
): PiStep[] {
  if (uninstall) return entries.map((entry) => ({ kind: "remove", entry }));
  if (localDir !== undefined) {
    return [
      ...entries
        .filter((e) => !(e.form === "local" && e.dir === localDir))
        .map((entry): PiStep => ({ kind: "remove", entry })),
      { kind: "install", source: localDir },
    ];
  }
  const removals = entries
    .filter((e) => e.form === "local")
    .map((entry): PiStep => ({ kind: "remove", entry }));
  const npm = entries.find((e) => e.form === "npm");
  if (!npm) return [...removals, { kind: "install", source: CARET_NPM_SOURCE }];
  const pinned = npm.form === "npm" && npm.pinned;
  return [...removals, { kind: pinned ? "pinned" : "update", entry: npm }];
}

function piArgs(step: Exclude<PiStep, { kind: "pinned" }>): string[] {
  switch (step.kind) {
    case "remove":
      return ["remove", removeArg(step.entry)];
    case "install":
      return ["install", step.source];
    case "update":
      return ["update", CARET_NPM_SOURCE];
  }
}

// `pi remove` resolves a path against the cwd, so a local entry goes by its resolved dir.
const removeArg = (entry: PiCaretEntry) => (entry.form === "npm" ? entry.source : entry.dir);

/** Guidance for a pi that can't take caret (any status but "ok"). */
function preflightError(version: PiVersion): string {
  if (version.status === "missing") {
    return `pi isn't on PATH. Install \`${PI_PACKAGE}\` (${PI_FLOOR} or later) and re-run \`caret install\`.`;
  }
  if (version.status === "pre-rename") {
    return `pi ${version.version} is the old \`@mariozechner/pi-coding-agent\`. pi is now published as \`${PI_PACKAGE}\` — install that (${PI_FLOOR} or later) and re-run \`caret install\`.`;
  }
  return `pi ${version.version} is older than ${PI_FLOOR}. Upgrade \`${PI_PACKAGE}\` and re-run \`caret install\`.`;
}

export async function runInstallPiTarget(
  opts: { uninstall: boolean; dryRun: boolean; local?: LocalInstall },
  deps: {
    pi?: PiRunner;
    piVersion?: () => PiVersion;
    agentDir?: string;
    home?: string;
    ui?: InstallUI;
  } = {},
): Promise<boolean> {
  const ui = deps.ui ?? silentUI;
  const run = deps.pi ?? piCli;
  const version = (deps.piVersion ?? (() => readPiVersion()))();
  if (opts.uninstall && version.status === "missing") {
    ui.info("No `pi` on PATH — nothing to remove from pi.");
    return true;
  }
  if (!opts.uninstall && version.status !== "ok") {
    ui.error(preflightError(version));
    return false;
  }

  const agentDir = deps.agentDir ?? piAgentDir();
  const home = deps.home ?? homedir();
  const localDir = opts.local ? resolve(opts.local.repoDir) : undefined;
  const steps = planPiSteps(readPiCaretEntries(agentDir, home), {
    uninstall: opts.uninstall,
    localDir,
  });
  if (steps.length === 0) {
    ui.info("pi has no caret entry — nothing to remove.");
    return true;
  }

  if (opts.dryRun) {
    const lines = steps.map((s) =>
      s.kind === "pinned" ? `(pinned, left alone) ${s.entry.source}` : `pi ${piArgs(s).join(" ")}`,
    );
    ui.note(lines.join("\n"), "pi — would run");
    return true;
  }

  const exec = async (args: string[]) => {
    const r = await run(args);
    if (!r.ok) throw new Error(`\`pi ${args.join(" ")}\`: ${r.detail}`);
  };
  const removed: string[] = [];
  try {
    for (const step of steps) {
      switch (step.kind) {
        case "remove": {
          const arg = removeArg(step.entry);
          await ui.step(
            `Removing ${arg} from pi`,
            () => exec(["remove", arg]),
            () => `Removed ${arg} from pi`,
          );
          removed.push(arg);
          break;
        }
        case "install":
          await ui.step(
            `Installing ${step.source} in pi`,
            () => exec(["install", step.source]),
            () =>
              localDir === undefined
                ? `Installed ${step.source} in pi`
                : `Installed ${step.source} in pi — pi loads the checkout in place, so a rebuild applies after \`/reload\``,
          );
          break;
        case "update": {
          const before = step.entry.version;
          await ui.step(
            `Updating ${CARET_NPM_SOURCE} in pi`,
            async () => {
              await exec(["update", CARET_NPM_SOURCE]);
              return (
                readPiCaretEntries(agentDir, home).find((e) => e.form === "npm")?.version ?? null
              );
            },
            (v) =>
              before === v
                ? `caret ${v} is already current in pi`
                : `caret ${before ?? "(not installed)"} → ${v ?? "unknown"} in pi`,
          );
          break;
        }
        case "pinned":
          ui.info(
            `${step.entry.source} is pinned, so caret left it alone — \`pi install ${CARET_NPM_SOURCE}\` unpins it.`,
          );
          break;
      }
    }
  } catch (e) {
    ui.error(`pi: ${errorMessage(e)}`);
    return false;
  }
  if (!opts.uninstall && removed.length > 0) {
    ui.info(`Removed ${removed.join(", ")} from pi so it loads caret once.`);
  }
  return true;
}
